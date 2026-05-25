/**
 * @file projectionLogic.ts
 * @description Helper functions for aggregating unmatched recurring transaction instances
 * and projecting upcoming balances for the calendar month.
 */

import { format } from 'date-fns';
import {
  runMatchingEngine,
  calculateIdfWeights,
  calculateTokenOverlap,
  getLongestCommonSubstring,
  getInstancesPerPeriod,
  getExpectedDatesInMonth,
} from './matchingLogic';

/**
 * Parses the numeric calendar day from a projected occurrence string description.
 *
 * @param occurrence - String like "Day 15" or "May 20th" or "Unknown"
 * @returns The extracted day number, or 99 if unknown (sorts to the end).
 */
export function parseDay(occurrence: string | undefined): number {
  if (!occurrence || occurrence === 'Unknown') return 99;
  const match = occurrence.match(/(?:Day\s+)?(\d+)/i);
  if (match) return parseInt(match[1]);
  return 99;
}

/**
 * Calculates all unmatched recurring transaction instances expected in a given calendar month.
 * Automatically handles matches by profile (both explicitly linked and dynamically identified)
 * and early posting fallbacks, returning the chronologically sorted unmatched instances.
 *
 * @param transactions - The array of transactions to evaluate.
 * @param recurringProfiles - The configured recurring transaction profiles.
 * @param year - The specific calendar year (e.g. 2026).
 * @param month - The specific 0-indexed calendar month (e.g. 4 for May).
 * @param todayDate - The current day of the month (1-31).
 * @returns An array of unmatched recurring instances with calendar day projections.
 */
export function getUnmatchedRecurringInstances(
  transactions: any[],
  recurringProfiles: any[],
  year: number,
  month: number,
  todayDate: number
): any[] {
  const currentYear = year;
  const currentMonth = month;
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

  const unmatchedTxs = transactions.filter((t) => !t.matched);
  const alreadyMatchedTxs = transactions.filter((t) => t.matched === true);

  // Run the robust standard matching engine for the current month's unmatched transactions.
  const matchResults = runMatchingEngine(
    unmatchedTxs,
    recurringProfiles,
    currentYear,
    currentMonth,
    todayDate,
    transactions
  );

  // Run standard matching engine for early postings evaluation.
  const prevMatchResults = runMatchingEngine(
    unmatchedTxs,
    recurringProfiles,
    prevYear,
    prevMonth,
    31,
    transactions
  );

  // Run on already matched transactions to dynamically associate.
  const alreadyMatchedResults = runMatchingEngine(
    alreadyMatchedTxs,
    recurringProfiles,
    currentYear,
    currentMonth,
    todayDate,
    transactions,
    true
  );

  const prevAlreadyMatchedResults = runMatchingEngine(
    alreadyMatchedTxs,
    recurringProfiles,
    prevYear,
    prevMonth,
    31,
    transactions,
    true
  );

  const matchesByProfile = new Map<string, any[]>();
  recurringProfiles.forEach((rt) => matchesByProfile.set(rt.id, []));

  // 1. Highest Priority: Aggregate explicitly associated matched transactions.
  transactions.forEach((tx) => {
    if (tx.matched === true) {
      const associatedProfile = recurringProfiles.find(
        (rt) => rt.exampleTransactionIds && rt.exampleTransactionIds.includes(tx.id)
      );
      if (associatedProfile) {
        const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
        const txYear = txDate.getFullYear();
        const txMonth = txDate.getMonth();

        const isCurrentMonth = txYear === currentYear && txMonth === currentMonth;
        let isEarlyPosting = false;
        if (associatedProfile.frequency === 'monthly') {
          const isPrevMonth = txYear === prevYear && txMonth === prevMonth;
          if (isPrevMonth) {
            const expectedDay = parseDay(associatedProfile.projectedOccurrence);
            if (expectedDay <= 5 && txDate.getDate() >= 25) {
              isEarlyPosting = true;
            }
          }
        }

        if (isCurrentMonth || isEarlyPosting) {
          const list = matchesByProfile.get(associatedProfile.id) || [];
          if (!list.some((existingTx) => existingTx.id === tx.id)) {
            list.push(tx);
            matchesByProfile.set(associatedProfile.id, list);
          }
        }
      }
    }
  });

  // 2. Second Priority: Aggregate dynamically matched transactions from this month's unmatched run.
  matchResults.forEach((r) => {
    if (r.matches.length > 0) {
      const recId = r.matches[0].recurringId;
      const list = matchesByProfile.get(recId) || [];
      if (!list.some((existingTx) => existingTx.id === r.transaction.id)) {
        list.push(r.transaction);
        matchesByProfile.set(recId, list);
      }
    }
  });

  // 3. Third Priority: Aggregate dynamically matched transactions from alreadyMatchedResults.
  alreadyMatchedResults.forEach((r) => {
    if (r.matches.length > 0) {
      const recId = r.matches[0].recurringId;
      const list = matchesByProfile.get(recId) || [];
      if (!list.some((existingTx) => existingTx.id === r.transaction.id)) {
        list.push(r.transaction);
        matchesByProfile.set(recId, list);
      }
    }
  });

  // 4. Fourth Priority: Dynamically matched early-posting from previous month.
  prevMatchResults.forEach((r) => {
    if (r.matches.length > 0) {
      const recId = r.matches[0].recurringId;
      const profile = recurringProfiles.find((rt) => rt.id === recId);
      if (profile && profile.frequency === 'monthly') {
        const expectedDay = parseDay(profile.projectedOccurrence);
        const txDate = r.transaction.Date?.toDate
          ? r.transaction.Date.toDate()
          : new Date(r.transaction.Date || r.transaction.date);

        if (expectedDay <= 5 && txDate.getDate() >= 25) {
          const list = matchesByProfile.get(recId) || [];
          if (!list.some((existingTx) => existingTx.id === r.transaction.id)) {
            list.push(r.transaction);
            matchesByProfile.set(recId, list);
          }
        }
      }
    }
  });

  // 5. Fifth Priority: Dynamically matched early-posting from already matched previous month.
  prevAlreadyMatchedResults.forEach((r) => {
    if (r.matches.length > 0) {
      const recId = r.matches[0].recurringId;
      const profile = recurringProfiles.find((rt) => rt.id === recId);
      if (profile && profile.frequency === 'monthly') {
        const expectedDay = parseDay(profile.projectedOccurrence);
        const txDate = r.transaction.Date?.toDate
          ? r.transaction.Date.toDate()
          : new Date(r.transaction.Date || r.transaction.date);

        if (expectedDay <= 5 && txDate.getDate() >= 25) {
          const list = matchesByProfile.get(recId) || [];
          if (!list.some((existingTx) => existingTx.id === r.transaction.id)) {
            list.push(r.transaction);
            matchesByProfile.set(recId, list);
          }
        }
      }
    }
  });

  // Relaxed Fallback
  recurringProfiles.forEach((rt) => {
    const maxInstances = getInstancesPerPeriod(rt);
    const currentMatches = matchesByProfile.get(rt.id)?.length || 0;
    if (rt.status === 'archived' || currentMatches >= maxInstances) return;
    if (rt.frequency !== 'monthly') return;

    const expectedDay = parseDay(rt.projectedOccurrence);
    if (expectedDay > 5) return;

    const examples = (rt.exampleTransactionIds || [])
      .map((id: string) => transactions.find((t: any) => t.id === id))
      .filter(Boolean);

    const exampleDescriptions = examples.map((e: any) => e.Description || '');
    if (exampleDescriptions.length === 0 && rt.description) {
      exampleDescriptions.push(rt.description);
    }

    const isIncome = (rt.amountAverage || 0) > 0;
    const idfWeights = calculateIdfWeights(transactions);
    const totalDocs = transactions.length;

    const alreadyMatchedTxIds = new Set<string>();
    prevMatchResults.forEach((r) => {
      if (r.matches.length > 0 && r.matches[0].recurringId === rt.id) {
        const txDate = r.transaction.Date?.toDate
          ? r.transaction.Date.toDate()
          : new Date(r.transaction.Date);
        if (expectedDay <= 5 && txDate.getDate() >= 25) {
          alreadyMatchedTxIds.add(r.transaction.id);
        }
      }
    });

    const earlyTxs = transactions.filter((tx) => {
      if (alreadyMatchedTxIds.has(tx.id)) return false;

      const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date);
      if (
        txDate.getFullYear() !== prevYear ||
        txDate.getMonth() !== prevMonth ||
        txDate.getDate() < 25
      ) {
        return false;
      }

      const txAmount = tx.Amount;
      if ((isIncome && txAmount <= 0) || (!isIncome && txAmount >= 0)) {
        return false;
      }

      const diffPct =
        Math.abs(Math.abs(txAmount) - Math.abs(rt.amountAverage || 0)) /
        Math.abs(rt.amountAverage || 1);
      if (diffPct > 0.5) return false;

      const tokenScore = calculateTokenOverlap(
        tx.Description || '',
        exampleDescriptions,
        idfWeights,
        totalDocs
      );

      let maxLcs = 0;
      exampleDescriptions.forEach((exDesc: string) => {
        const lcs = getLongestCommonSubstring(tx.Description || '', exDesc);
        if (lcs > maxLcs) maxLcs = lcs;
      });
      const lcsScore = Math.min(1, maxLcs / 8);

      const textScore = tokenScore * 0.5 + lcsScore * 0.5;
      return textScore >= 0.7;
    });

    const needed = maxInstances - currentMatches;
    const matchesToRegister = Math.min(needed, earlyTxs.length);
    if (matchesToRegister > 0) {
      const list = matchesByProfile.get(rt.id) || [];
      for (let k = 0; k < matchesToRegister; k++) {
        list.push(earlyTxs[k]);
      }
      matchesByProfile.set(rt.id, list);
    }
  });

  const unmatchedList: any[] = [];
  recurringProfiles.forEach((rt) => {
    if (rt.status === 'archived') return;

    const expectedDates = getExpectedDatesInMonth(rt, transactions, currentYear, currentMonth);
    if (expectedDates.length === 0) return;

    const maxInst = rt.instancesPerPeriod || 1;
    const expectedInstances: { date: Date; instanceIndex: number }[] = [];
    expectedDates.forEach((date) => {
      for (let i = 0; i < maxInst; i++) {
        expectedInstances.push({ date, instanceIndex: i });
      }
    });

    const matchedTxs = matchesByProfile.get(rt.id) || [];
    const assignedIndices = new Set<number>();

    matchedTxs.forEach((tx) => {
      const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date);
      let closestIndex = -1;
      let minDiff = Infinity;

      expectedInstances.forEach((inst, idx) => {
        if (assignedIndices.has(idx)) return;
        const diff = Math.abs(txDate.getTime() - inst.date.getTime());
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = idx;
        }
      });

      if (closestIndex !== -1) {
        assignedIndices.add(closestIndex);
      }
    });

    expectedInstances.forEach((inst, idx) => {
      if (!assignedIndices.has(idx)) {
        const dayStr = `${format(inst.date, 'MMMM')} ${inst.date.getDate()}`;
        unmatchedList.push({
          ...rt,
          _instanceIndex: inst.instanceIndex,
          projectedOccurrence: dayStr,
          _projectedDate: inst.date,
        });
      }
    });
  });

  unmatchedList.sort((a, b) => {
    const timeA = a._projectedDate ? a._projectedDate.getTime() : parseDay(a.projectedOccurrence);
    const timeB = b._projectedDate ? b._projectedDate.getTime() : parseDay(b.projectedOccurrence);
    return timeA - timeB;
  });

  return unmatchedList;
}
