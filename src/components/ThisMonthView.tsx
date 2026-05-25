/**
 * @file ThisMonthView.tsx
 * @description Component for displaying projected cash flow and remaining recurring transactions for the current calendar month.
 * It uses the core matching engine to identify which transactions have occurred and which are upcoming,
 * providing a forward-looking view of the user's financial status.
 */

import React, { useState, useEffect } from 'react';
import {
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowRight,
  Clock,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  DollarSign,
  Tag,
} from 'lucide-react';
import {
  runMatchingEngine,
  calculateIdfWeights,
  calculateTokenOverlap,
  getLongestCommonSubstring,
  getInstancesPerPeriod,
  getExpectedDatesInMonth,
  MatchingResult,
} from '../utils/matchingLogic';
import { format } from 'date-fns';

/**
 * Props expected by the ThisMonthView component.
 */
interface ThisMonthViewProps {
  /** The full array of transactions loaded from the spreadsheet database */
  transactions: any[];
  /** The user's current actual balance across active accounts */
  currentBalance: number;
}

/**
 * ThisMonthView Component.
 * Computes which of the user's active recurring transaction profiles (e.g. bills, salary)
 * have occurred or are still remaining for the current calendar month.
 * Provides KPI metrics and a projected balance at the end of the calendar month.
 *
 * @param props - Component props containing transaction list and current balance.
 * @returns Renders the dashboard projection cards and chronological remaining transaction items.
 */
export function ThisMonthView({ transactions, currentBalance }: ThisMonthViewProps) {
  const [loading, setLoading] = useState(true);
  const [unmatched, setUnmatched] = useState<any[]>([]);
  const [projectedBalance, setProjectedBalance] = useState<number>(currentBalance);
  const [expectedImpact, setExpectedImpact] = useState<number>(0);
  const [remainingExpanded, setRemainingExpanded] = useState(true);
  const [matchedExpanded, setMatchedExpanded] = useState(false);
  const [matchedResults, setMatchedResults] = useState<MatchingResult[]>([]);

  useEffect(() => {
    /**
     * Initializes the matching logic and aggregates upcoming recurring projections.
     */
    async function init() {
      try {
        setLoading(true);
        // Fetch active recurring profiles from the backend database
        const res = await fetch('/api/recurring');
        if (!res.ok) throw new Error('Failed to fetch recurring transactions');
        const data = await res.json();
        const recurring = data.recurring || [];

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const todayDate = now.getDate();

        // Run the robust standard matching engine for the current month.
        // We pass todayDate (now.getDate()) so that the engine's built-in look-ahead filter
        // correctly filters out profiles projected for later in the month.
        // This ensures the matching engine does NOT try to match future expected profiles
        // against unrelated early-posting transactions, maintaining 100% accurate matches
        // and leaving future profiles as unmatched so they appear in the "Remaining to Occur" list.
        const matchResults = runMatchingEngine(
          transactions,
          recurring,
          currentYear,
          currentMonth,
          todayDate,
          transactions
        );

        setMatchedResults(matchResults);

        // Run the standard matching engine for the previous month.
        // We pass 31 to evaluate the entire month of April, catching transactions that
        // posted early in the last few days of April.
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        const prevMatchResults = runMatchingEngine(
          transactions,
          recurring,
          prevYear,
          prevMonth,
          31,
          transactions
        );

        // Non-obvious choice: We track the exact matched transaction objects for each recurring profile
        // instead of just incrementing an anonymous count. This enables us to dynamically assign
        // transactions to their closest calendar projection dates (weekly, bi-weekly, or monthly)
        // and show the precise calendar date of each unmatched occurrence.
        const matchesByProfile = new Map<string, any[]>();
        recurring.forEach((rt) => matchesByProfile.set(rt.id, []));

        // For every matched transaction in the current month, record the matched transaction object.
        matchResults.forEach((r) => {
          if (r.matches.length > 0) {
            const recId = r.matches[0].recurringId;
            const list = matchesByProfile.get(recId) || [];
            list.push(r.transaction);
            matchesByProfile.set(recId, list);
          }
        });

        // Catch early posting transactions from the previous month.
        // If a monthly profile is expected in the first 5 days of the current month (Day 1-5),
        // and it successfully matched a transaction in the last week of the previous month (Day 25-31),
        // we count it as matched for the current month.
        prevMatchResults.forEach((r) => {
          if (r.matches.length > 0) {
            const recId = r.matches[0].recurringId;
            const profile = recurring.find((rt) => rt.id === recId);
            if (profile && profile.frequency === 'monthly') {
              const expectedDay = parseDay(profile.projectedOccurrence);
              const txDate = r.transaction.Date?.toDate
                ? r.transaction.Date.toDate()
                : new Date(r.transaction.Date);

              if (expectedDay <= 5 && txDate.getDate() >= 25) {
                const list = matchesByProfile.get(recId) || [];
                list.push(r.transaction);
                matchesByProfile.set(recId, list);
              }
            }
          }
        });

        // Relaxed Fallback for Early Postings:
        // Banks frequently have early payments with higher amount variances (e.g. utility bills).
        // If a monthly profile expected Day 1-5 remains unmatched, we check if a transaction in the
        // last week of the previous month (Day 25-31) shares the same sign, has a very high description
        // similarity (>= 70%), and is within 50% amount variance.
        recurring.forEach((rt) => {
          // Non-obvious choice: For multi-instance profiles (e.g. expected 2x per period), we only skip
          // early-posting checks if the profile's instances have been fully satisfied. If only 1 out of 2
          // instances matched in the current month, the remaining slot is eligible to match an early-posting transaction.
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

          // Non-obvious choice: Exclude any transactions that have already been registered as early postings
          // via standard matches (prevMatchResults) to avoid double-counting them in this relaxed fallback.
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

          // Find all early transactions that match the profile in the last week of the previous month.
          const earlyTxs = transactions.filter((tx) => {
            if (alreadyMatchedTxIds.has(tx.id)) return false;

            const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date);
            // Must be in the previous month, in the last 7 days (Day 25-31)
            if (
              txDate.getFullYear() !== prevYear ||
              txDate.getMonth() !== prevMonth ||
              txDate.getDate() < 25
            ) {
              return false;
            }

            const txAmount = tx.Amount;
            // Must have the same sign (credit vs debit)
            if ((isIncome && txAmount <= 0) || (!isIncome && txAmount >= 0)) {
              return false;
            }

            // Relaxed amount boundary check: up to 50% difference allowed for utility/variable bills
            const diffPct =
              Math.abs(Math.abs(txAmount) - Math.abs(rt.amountAverage || 0)) /
              Math.abs(rt.amountAverage || 1);
            if (diffPct > 0.5) return false;

            // Strict description similarity overlap: >= 70% confidence using TF-IDF and LCS
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

          // Register matches for early posting up to the number of remaining needed instances for the month.
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

        // Filter and collect all unmatched recurring instances expected in this month.
        // Instead of a generic duplication, we generate the actual expected dates in the target month,
        // duplicate them for instancesPerPeriod (multi-instance), and assign our actual matches
        // to the closest expected dates. The remaining unassigned dates are unmatched!
        const unmatchedList: any[] = [];
        recurring.forEach((rt) => {
          if (rt.status === 'archived') return;

          // Generate expected occurrence dates in this calendar month
          const expectedDates = getExpectedDatesInMonth(
            rt,
            transactions,
            currentYear,
            currentMonth
          );
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
              // Non-obvious choice: Overwrite the generic day-of-week string (like "Friday")
              // with the exact calculated calendar date string (e.g. "May 22") for the unmatched list.
              const dayStr = `${format(inst.date, 'MMMM')} ${inst.date.getDate()}`;
              unmatchedList.push({
                ...rt,
                _instanceIndex: inst.instanceIndex,
                projectedOccurrence: dayStr, // Overwrite with exact calculated date!
              });
            }
          });
        });

        // Sort unmatched instances chronologically by their exact calculated dates
        unmatchedList.sort((a, b) => {
          const dayA = parseDay(a.projectedOccurrence);
          const dayB = parseDay(b.projectedOccurrence);
          return dayA - dayB;
        });

        setUnmatched(unmatchedList);

        // Sum up the average impact of all unmatched expected transactions
        let impact = 0;
        unmatchedList.forEach((rt) => {
          impact += rt.amountAverage || 0;
        });

        setExpectedImpact(impact);
        setProjectedBalance(currentBalance + impact);
      } catch (error) {
        console.error('Failed to initialize ThisMonth projections:', error);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [transactions, currentBalance]);

  /**
   * Evaluates if a given recurring profile is expected to occur in a specific calendar month.
   * Monthly profiles are always expected. Yearly profiles are expected if their projectedOccurrence
   * matches the target month.
   *

  /**
   * Parses the numeric calendar day from a projectedoccurrence string description.
   *
   * @param occurrence - String like "Day 15" or "May 20th" or "Unknown"
   * @returns The extracted day number, or 99 if unknown (sorts to the end).
   */
  function parseDay(occurrence: string | undefined): number {
    if (!occurrence || occurrence === 'Unknown') return 99;
    const match = occurrence.match(/(?:Day\s+)?(\d+)/i);
    if (match) return parseInt(match[1]);
    return 99;
  }

  /**
   * Helper to format values as clean USD local currencies.
   *
   * @param val - The amount value.
   * @returns The formatted currency string.
   */
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Math.abs(val));
  };

  const currentMonthName = format(new Date(), 'MMMM');

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-lg font-medium animate-pulse">
          Loading {currentMonthName} projections...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <CalendarDays className="w-8 h-8 text-blue-600" />
            This Month
          </h2>
          <p className="text-slate-500 mt-2 text-lg">
            Projection and upcoming expected transactions for {currentMonthName}.
          </p>
        </div>
      </div>

      {/* Hero Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-slate-200 shadow-sm transition-all duration-300 hover:shadow-md hover:border-slate-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
            <Wallet className="w-24 h-24" />
          </div>
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Current Balance
          </p>
          <p className="text-4xl font-black text-slate-900">
            {currentBalance < 0 ? '-' : ''}
            {formatCurrency(currentBalance)}
          </p>
        </div>

        <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-slate-200 shadow-sm transition-all duration-300 hover:shadow-md hover:border-slate-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500 text-amber-500">
            <Clock className="w-24 h-24" />
          </div>
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Upcoming Impact
          </p>
          <div className="flex items-end gap-3">
            <p className="text-4xl font-black text-slate-900">
              {expectedImpact < 0 ? '-' : '+'}
              {formatCurrency(expectedImpact)}
            </p>
          </div>
          <p className="text-sm text-slate-500 mt-2 flex items-center gap-1.5">
            Across {unmatched.length} expected transactions
          </p>
        </div>

        <div className="relative overflow-hidden bg-white rounded-3xl p-6 border border-slate-200 shadow-sm transition-all duration-300 hover:shadow-md hover:border-slate-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
            {projectedBalance > currentBalance ? (
              <TrendingUp className="w-24 h-24" />
            ) : (
              <TrendingDown className="w-24 h-24" />
            )}
          </div>
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Projected End of Month
          </p>
          <p className="text-4xl font-black text-slate-900">
            {projectedBalance < 0 ? '-' : ''}
            {formatCurrency(projectedBalance)}
          </p>
          <p className="text-sm text-slate-500 mt-2">Based on current balance and known upcoming</p>
        </div>
      </div>

      {/* Unmatched Transactions List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setRemainingExpanded(!remainingExpanded)}
          className="w-full p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Remaining to Occur</h3>
            <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold">
              {unmatched.length} Items
            </span>
          </div>
          <div className="text-slate-400">
            {remainingExpanded ? (
              <ChevronUp className="w-6 h-6 text-slate-500" />
            ) : (
              <ChevronDown className="w-6 h-6 text-slate-500" />
            )}
          </div>
        </button>

        {remainingExpanded &&
          (unmatched.length === 0 ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <p className="text-xl font-semibold text-slate-800 mb-1">All Caught Up!</p>
              <p>All expected recurring transactions for this month have been matched.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {unmatched.map((rt) => {
                const isIncome = (rt.amountAverage || 0) > 0;
                const expectedDay = parseDay(rt.projectedOccurrence);
                const dayStr =
                  expectedDay === 99 ? 'Date Unknown' : `${currentMonthName} ${expectedDay}`;

                return (
                  <div
                    key={`${rt.id}-${rt._instanceIndex || 0}`}
                    className="p-4 md:p-6 hover:bg-slate-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-inner ${isIncome ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}
                      >
                        {isIncome ? (
                          <TrendingUp className="w-6 h-6" />
                        ) : (
                          <TrendingDown className="w-6 h-6" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-semibold text-lg text-slate-900 group-hover:text-blue-600 transition-colors">
                          {rt.description}
                        </h4>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                            <CalendarDays className="w-3.5 h-3.5" />
                            {dayStr}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto mt-2 md:mt-0 pl-16 md:pl-0">
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                          Expected Amount
                        </p>
                        <p
                          className={`font-mono text-lg font-bold ${isIncome ? 'text-emerald-600' : 'text-slate-900'}`}
                        >
                          {isIncome ? '+' : '-'}
                          {formatCurrency(rt.amountAverage || 0)}
                        </p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity hidden md:block transform group-hover:translate-x-1" />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      {/* Matched Transactions List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setMatchedExpanded(!matchedExpanded)}
          className="w-full p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Matched Transactions</h3>
            <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-semibold">
              {matchedResults.length} Items
            </span>
          </div>
          <div className="text-slate-400">
            {matchedExpanded ? (
              <ChevronUp className="w-6 h-6 text-slate-500" />
            ) : (
              <ChevronDown className="w-6 h-6 text-slate-500" />
            )}
          </div>
        </button>

        {matchedExpanded && (
          <div className="p-6 bg-slate-50/50 border-t border-slate-100">
            {matchedResults.length === 0 ? (
              <div className="text-center text-slate-500 py-12">
                No matched transactions found for this month.
              </div>
            ) : (
              <div className="space-y-4">
                {matchedResults.map((result, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border ${result.isConflict ? 'border-amber-300 bg-amber-50' : result.isAutoMatch ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'}`}
                  >
                    {/* Transaction Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          {result.isConflict && <AlertCircle className="w-4 h-4 text-amber-500" />}
                          {result.isAutoMatch && (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          )}
                          <h4 className="font-semibold text-slate-900">
                            {result.transaction.Description}
                          </h4>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                          <span className="flex items-center gap-1 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                            <CalendarDays className="w-3.5 h-3.5" />
                            {result.transaction.Date?.toDate
                              ? result.transaction.Date.toDate().toLocaleDateString()
                              : String(result.transaction.Date).split('T')[0]}
                          </span>
                          <span className="flex items-center gap-1 font-mono font-semibold bg-slate-100 px-2 py-0.5 rounded-md">
                            <DollarSign className="w-3.5 h-3.5" />
                            {Math.abs(result.transaction.Amount).toFixed(2)}
                          </span>
                          {result.transaction.Category && (
                            <span className="flex items-center gap-1 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                              <Tag className="w-3.5 h-3.5" />
                              {result.transaction.Category}{' '}
                              {result.transaction.Subcategory
                                ? `> ${result.transaction.Subcategory}`
                                : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      {result.isConflict && (
                        <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded">
                          Conflict Flagged
                        </span>
                      )}
                    </div>

                    {/* Match Candidates */}
                    <div className="space-y-2 mt-4 pl-4 border-l-2 border-slate-200">
                      {result.matches.map((m: any, mIdx: number) => (
                        <div
                          key={mIdx}
                          className="bg-white p-3 rounded border border-slate-100 shadow-sm flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${mIdx === 0 && !result.isConflict ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
                            >
                              {m.score}%
                            </div>
                            <div>
                              <div className="font-medium text-slate-800 flex items-center gap-2">
                                {m.recurringName}
                                {mIdx === 0 && !result.isConflict && result.isAutoMatch && (
                                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                    Top Match
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
                                <span>Tokens: {m.breakdown?.tokenScore ?? 0}%</span>
                                <span>Substring: {m.breakdown?.lcsChars ?? 0} chars</span>
                                <span>Cat Bonus: +{m.breakdown?.categoryBonus ?? 0}%</span>
                                <span>Expected: {m.breakdown?.amountExpected ?? 'N/A'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
