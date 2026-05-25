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
  Clock,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  DollarSign,
  Tag,
} from 'lucide-react';
import { runMatchingEngine, MatchingResult } from '../utils/matchingLogic';
import { getUnmatchedRecurringInstances } from '../utils/projectionLogic';
import { format } from 'date-fns';
import { TransactionTable } from './TransactionTable';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

/**
 * Props expected by the ThisMonthView component.
 */
interface ThisMonthViewProps {
  /** The full array of transactions loaded from the spreadsheet database */
  transactions: any[];
  /** The user's current actual balance across active accounts */
  currentBalance: number;
  /** Callback triggered when a transaction matching is manually saved */
  onRefresh?: () => void;
  /** Data analysis metadata */
  analysis?: any;
  /** Custom category taxonomy classification mapping */
  taxonomy?: Record<string, string[]>;
  /** Years list for custom dropdown filtering */
  availableYears?: string[];
  /** Expected headers list for sheets table cells mapping */
  headers?: string[];
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
export function ThisMonthView({
  transactions,
  currentBalance,
  onRefresh,
  analysis,
  taxonomy,
  availableYears,
  headers,
}: ThisMonthViewProps) {
  const [loading, setLoading] = useState(true);
  const [unmatched, setUnmatched] = useState<any[]>([]);
  const [projectedBalance, setProjectedBalance] = useState<number>(currentBalance);
  const [expectedImpact, setExpectedImpact] = useState<number>(0);
  const [remainingExpanded, setRemainingExpanded] = useState(() => {
    const saved = localStorage.getItem('remainingExpanded');
    return saved !== null ? saved === 'true' : true;
  });
  const [matchedExpanded, setMatchedExpanded] = useState(() => {
    const saved = localStorage.getItem('matchedExpanded');
    return saved !== null ? saved === 'true' : false;
  });
  const [occurredExpanded, setOccurredExpanded] = useState(() => {
    const saved = localStorage.getItem('occurredExpanded');
    return saved !== null ? saved === 'true' : true;
  });
  const [projectionExpanded, setProjectionExpanded] = useState(() => {
    const saved = localStorage.getItem('projectionExpanded');
    return saved !== null ? saved === 'true' : true;
  });
  const [matchedResults, setMatchedResults] = useState<MatchingResult[]>([]);
  const [recurringProfiles, setRecurringProfiles] = useState<any[]>([]);
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  // Local state for upcoming transactions table controls
  const [tableAccount, setTableAccount] = useState('All');
  const [tableYear, setTableYear] = useState('All');
  const [tableMonth, setTableMonth] = useState('All Months');
  const [tableSelectedTxIds, setTableSelectedTxIds] = useState<Set<string>>(new Set());

  // Local state for occurred/matched transactions table controls
  const [occurredTableAccount, setOccurredTableAccount] = useState('All');
  const [occurredTableYear, setOccurredTableYear] = useState('All');
  const [occurredTableMonth, setOccurredTableMonth] = useState('All Months');
  const [occurredTableSelectedTxIds, setOccurredTableSelectedTxIds] = useState<Set<string>>(
    new Set()
  );

  // Create robust default values in case props are not passed (e.g. in older unit tests)
  const defaultAnalysis = React.useMemo(() => {
    return {
      columnsIdentified: {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        category: 'Category',
        subcategory: 'Subcategory',
      },
      categories: [],
      sortedMonths: [],
      currentBalance: currentBalance,
      ...(analysis || {}),
    };
  }, [analysis, currentBalance]);

  const defaultTaxonomy = taxonomy || {};
  const defaultAvailableYears = availableYears || [];
  const defaultHeaders = headers || [
    'Date',
    'Description',
    'Amount',
    'Category',
    'Subcategory',
    'matched',
  ];

  // Map unmatched recurring instances into a format compatible with TransactionTable
  const mappedUpcomingTransactions = React.useMemo(() => {
    const dateCol = defaultAnalysis.columnsIdentified.date;
    const descCol = defaultAnalysis.columnsIdentified.description;
    const amtCol = defaultAnalysis.columnsIdentified.amount;
    const catCol = defaultAnalysis.columnsIdentified.category;
    const subcatCol = defaultAnalysis.columnsIdentified.subcategory;

    return unmatched.map((rt) => {
      const isIncome = (rt.amountAverage || 0) > 0;
      const parsedAmount = Math.abs(rt.amountAverage || 0);

      // Try to determine a safe projected date
      let dateVal: Date;
      if (rt._projectedDate) {
        dateVal =
          rt._projectedDate instanceof Date ? rt._projectedDate : new Date(rt._projectedDate);
      } else {
        const expectedDay = parseDay(rt.projectedOccurrence);
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        dateVal = expectedDay === 99 ? new Date(y, m, 28) : new Date(y, m, expectedDay);
      }

      // Look up linked example transaction instances in the global transactions list
      // to dynamically resolve category and subcategory if they are not explicitly set in the profile itself.
      const examples = (rt.exampleTransactionIds || [])
        .map((id: string) => transactions.find((t: any) => t.id === id))
        .filter(Boolean);

      let resolvedCategory = rt.category || '';
      let resolvedSubcategory = rt.subcategory || '';

      // Check example transactions first for non-empty category/subcategory
      if (!resolvedCategory || !resolvedSubcategory) {
        for (const ex of examples) {
          if (!resolvedCategory && ex.Category) {
            resolvedCategory = ex.Category;
          }
          if (!resolvedSubcategory && ex.Subcategory) {
            resolvedSubcategory = ex.Subcategory;
          }
          if (resolvedCategory && resolvedSubcategory) {
            break;
          }
        }
      }

      // Fallback: If still empty, search the historical ledger for transactions matching this profile description
      if (!resolvedCategory || !resolvedSubcategory) {
        const similarTxs = transactions.filter(
          (tx) =>
            tx.Description &&
            rt.description &&
            tx.Description.toUpperCase().includes(rt.description.toUpperCase())
        );
        for (const tx of similarTxs) {
          if (!resolvedCategory && tx.Category) {
            resolvedCategory = tx.Category;
          }
          if (!resolvedSubcategory && tx.Subcategory) {
            resolvedSubcategory = tx.Subcategory;
          }
          if (resolvedCategory && resolvedSubcategory) {
            break;
          }
        }
      }

      return {
        // Generate a 100% globally unique virtual transaction ID by appending the projected date timestamp.
        // This is critical to prevent React VDOM reconciler duplicate key collisions and subsequent DOM leakage/duplication
        // when sorting or displaying multiple expected occurrences of the same recurring transaction profile in the same month.
        id: `${rt.id}-${rt._instanceIndex || 0}-${dateVal.getTime()}`,
        [dateCol]: dateVal,
        [descCol]: rt.description || '',
        [amtCol]: parsedAmount,
        [catCol]: resolvedCategory,
        [subcatCol]: resolvedSubcategory,
        matched: false,

        // Underlying parsed helper fields expected by TransactionTable
        _parsedAmount: parsedAmount,
        _isExpense: !isIncome,
        _date: dateVal,
        _category: resolvedCategory,
        _subcategory: resolvedSubcategory,
        status: 'pending_review',
      };
    });
  }, [unmatched, defaultAnalysis, transactions]);

  // Filter transactions to select all matched (matched === true) transactions for the current calendar month
  const occurredTransactions = React.useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const filtered = transactions.filter((tx) => {
      // Must be matched
      if (!tx.matched) return false;

      // Extract transaction date
      const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
      if (isNaN(txDate.getTime())) return false;

      // Must be in the current calendar month
      return txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth;
    });

    // Map each occurred transaction to ensure all sub-helper fields expected by TransactionTable are safely populated
    return filtered.map((tx) => {
      const dateVal = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
      const parsedAmount =
        tx._parsedAmount !== undefined ? tx._parsedAmount : Math.abs(tx.Amount || tx.amount || 0);
      const isExpense =
        tx._isExpense !== undefined
          ? tx._isExpense
          : tx.Amount !== undefined
            ? tx.Amount < 0
            : tx.amount !== undefined
              ? tx.amount < 0
              : true;

      return {
        ...tx,
        _parsedAmount: parsedAmount,
        _isExpense: isExpense,
        _date: dateVal,
        _category: tx._category || tx.Category || tx.category || 'Uncategorized',
        _subcategory: tx._subcategory || tx.Subcategory || tx.subcategory || '',
      };
    });
  }, [transactions]);

  // Daily actual and projected balance cash flow data calculation
  const dailyCashFlowData = React.useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const firstOfMonth = new Date(currentYear, currentMonth, 1);
    const lastOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const numDays = lastOfMonth.getDate();

    // 1. Reconstruct Daily Actual Balances (Reusing Dashboard Algorithm)
    const dateCol = defaultAnalysis.columnsIdentified.date;
    const chronoSorted = [...transactions].sort((a, b) => {
      const dateA = a[dateCol] ? new Date(a[dateCol]).getTime() : 0;
      const dateB = b[dateCol] ? new Date(b[dateCol]).getTime() : 0;
      return dateA - dateB;
    });

    // Compute a baseline running balance to find the final calculated total balance
    const currentBalances: Record<string, number> = {};
    for (const tx of chronoSorted) {
      const account = tx.Account || 'Default';
      const hasValidBalance = tx.Balance !== undefined && tx.Balance !== null && tx.Balance !== '';

      const rawAmt = tx.Amount !== undefined ? tx.Amount : tx.amount !== undefined ? tx.amount : 0;
      const amt = tx._parsedAmount !== undefined ? tx._parsedAmount : Number(rawAmt);

      if (hasValidBalance) {
        currentBalances[account] = Number(tx.Balance);
      } else {
        const currentVal = currentBalances[account] !== undefined ? currentBalances[account] : 0;
        currentBalances[account] = Number((currentVal + amt).toFixed(2));
      }
    }

    const finalCalculatedTotalBalance = Object.values(currentBalances).reduce(
      (sum, bal) => sum + bal,
      0
    );
    const balanceOffset = currentBalance - finalCalculatedTotalBalance;

    const currentBalancesAdjusted: Record<string, number> = {};
    const dailyActualMap: Record<number, number> = {};
    let lastBalanceBeforeMonth = 0;

    for (const tx of chronoSorted) {
      const account = tx.Account || 'Default';
      const hasValidBalance = tx.Balance !== undefined && tx.Balance !== null && tx.Balance !== '';

      const rawAmt = tx.Amount !== undefined ? tx.Amount : tx.amount !== undefined ? tx.amount : 0;
      const amt = tx._parsedAmount !== undefined ? tx._parsedAmount : Number(rawAmt);

      if (hasValidBalance) {
        currentBalancesAdjusted[account] = Number(tx.Balance);
      } else {
        const currentVal =
          currentBalancesAdjusted[account] !== undefined ? currentBalancesAdjusted[account] : 0;
        currentBalancesAdjusted[account] = Number((currentVal + amt).toFixed(2));
      }

      const calculatedTotal = Object.values(currentBalancesAdjusted).reduce(
        (sum, bal) => sum + bal,
        0
      );
      const totalBalance = calculatedTotal + balanceOffset;

      const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
      if (!isNaN(txDate.getTime())) {
        if (txDate < firstOfMonth) {
          lastBalanceBeforeMonth = totalBalance;
        } else if (txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth) {
          dailyActualMap[txDate.getDate()] = totalBalance;
        }
      }
    }

    // Calculate starting balance by subtracting all transaction amounts on or after firstOfMonth from currentBalance
    let calculatedStartingBalance = currentBalance;
    for (const tx of chronoSorted) {
      const txDate = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
      if (!isNaN(txDate.getTime()) && txDate >= firstOfMonth) {
        const rawAmt =
          tx.Amount !== undefined ? tx.Amount : tx.amount !== undefined ? tx.amount : 0;
        const amt = tx._parsedAmount !== undefined ? tx._parsedAmount : Number(rawAmt);
        calculatedStartingBalance -= amt;
      }
    }

    const startingBalance =
      lastBalanceBeforeMonth !== 0 ? lastBalanceBeforeMonth : calculatedStartingBalance;

    // 2. Reconstruct Daily Projected Balances
    // Pool occurred matched and mapped upcoming expected recurring instances
    const getTxDateObj = (tx: any): Date => {
      if (tx._date instanceof Date) return tx._date;
      const d = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date || tx._date);
      return isNaN(d.getTime()) ? new Date() : d;
    };

    const allRecurringTxs = [...occurredTransactions, ...mappedUpcomingTransactions];

    const sortedRecurring = [...allRecurringTxs].sort((a, b) => {
      return getTxDateObj(a).getTime() - getTxDateObj(b).getTime();
    });

    // We build the data points from Day 1 to numDays
    const isCurrentMonth = now.getFullYear() === currentYear && now.getMonth() === currentMonth;

    // Find the latest day of actual transactions in the current month or today's date
    let maxActualDay = numDays;
    if (isCurrentMonth) {
      maxActualDay = now.getDate();
    } else {
      // Find the max day among the in-month actual transactions
      const actualDaysInMonth = Object.keys(dailyActualMap).map(Number);
      if (actualDaysInMonth.length > 0) {
        maxActualDay = Math.max(...actualDaysInMonth);
      }
    }

    const dataPoints = [];
    let runningActual = startingBalance;
    let runningProjected = startingBalance;

    for (let d = 1; d <= numDays; d++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayLabel = format(new Date(currentYear, currentMonth, d), 'MMM d');

      // Update runningActual: if there was a transaction on this day, its last balance is the end-of-day balance
      if (dailyActualMap[d] !== undefined) {
        runningActual = dailyActualMap[d];
      }

      // Update runningProjected: apply all recurring transactions that fall on this day
      const recurringOnDay = sortedRecurring.filter((tx) => {
        const txDate = getTxDateObj(tx);
        return txDate.getDate() === d;
      });

      for (const tx of recurringOnDay) {
        const amt =
          tx._parsedAmount !== undefined ? tx._parsedAmount : Math.abs(tx.Amount || tx.amount || 0);
        const isExpense =
          tx._isExpense !== undefined
            ? tx._isExpense
            : tx.Amount !== undefined
              ? tx.Amount < 0
              : tx.amount !== undefined
                ? tx.amount < 0
                : true;
        const signedAmt = isExpense ? -amt : amt;
        runningProjected = Number((runningProjected + signedAmt).toFixed(2));
      }

      dataPoints.push({
        date: dateStr,
        dayLabel: dayLabel,
        day: d,
        actualBalance: d <= maxActualDay ? Number(runningActual.toFixed(2)) : undefined,
        projectedBalance: Number(runningProjected.toFixed(2)),
      });
    }

    // Also compute additional metrics for the header KPI summaries
    const latestActual =
      maxActualDay > 0 && dailyActualMap[maxActualDay] !== undefined
        ? dailyActualMap[maxActualDay]
        : runningActual;
    const projectedEnding = runningProjected;

    // Variance today (or up to maxActualDay if in past month)
    const activeActualDay = isCurrentMonth ? now.getDate() : maxActualDay;
    const actualTodayVal =
      dataPoints.find((p) => p.day === activeActualDay)?.actualBalance ?? latestActual;
    const projectedTodayVal =
      dataPoints.find((p) => p.day === activeActualDay)?.projectedBalance ?? startingBalance;
    const varianceToday = Number((actualTodayVal - projectedTodayVal).toFixed(2));

    return {
      dataPoints,
      startingBalance,
      currentActualBalance: latestActual,
      projectedEndingBalance: projectedEnding,
      varianceToday,
      maxActualDay,
      isCurrentMonth,
    };
  }, [
    transactions,
    occurredTransactions,
    mappedUpcomingTransactions,
    defaultAnalysis,
    currentBalance,
  ]);

  useEffect(() => {
    localStorage.setItem('remainingExpanded', String(remainingExpanded));
  }, [remainingExpanded]);

  useEffect(() => {
    localStorage.setItem('matchedExpanded', String(matchedExpanded));
  }, [matchedExpanded]);

  useEffect(() => {
    localStorage.setItem('occurredExpanded', String(occurredExpanded));
  }, [occurredExpanded]);

  useEffect(() => {
    localStorage.setItem('projectionExpanded', String(projectionExpanded));
  }, [projectionExpanded]);

  useEffect(() => {
    /**
     * Initializes the matching logic and aggregates upcoming recurring projections.
     */
    async function init() {
      try {
        setLoading(true);
        // Fetch active recurring profiles from the database
        const res = await fetch('/api/recurring');
        if (!res.ok) throw new Error('Failed to fetch recurring transactions');
        const data = await res.json();
        const recurring = data.recurring || [];
        setRecurringProfiles(recurring);

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const todayDate = now.getDate();

        // Filter transactions into unmatched and already-matched lists
        const unmatchedTxs = transactions.filter((t) => !t.matched);

        // Run the robust standard matching engine for suggestions list
        const matchResults = runMatchingEngine(
          unmatchedTxs,
          recurring,
          currentYear,
          currentMonth,
          todayDate,
          transactions
        );
        setMatchedResults(matchResults);

        // Retrieve unmatched list using the new exported helper!
        const unmatchedList = getUnmatchedRecurringInstances(
          transactions,
          recurring,
          currentYear,
          currentMonth,
          todayDate
        );

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
   * Saves a candidate matching association by marking the transaction as matched
   * and adding the transaction ID as a permanent example under the recurring profile.
   *
   * @param tx - The transaction being matched.
   * @param recurringId - The ID of the target recurring profile.
   */
  const handleSaveMatch = async (tx: any, recurringId: string) => {
    const saveKey = `${tx.id}-${recurringId}`;
    if (savingMap[saveKey]) return;

    setSavingMap((prev) => ({ ...prev, [saveKey]: true }));

    try {
      // Find corresponding recurring profile
      const profile = recurringProfiles.find((p) => p.id === recurringId);
      if (!profile) throw new Error('Recurring profile not found');

      // Append transaction ID ensuring uniqueness
      const currentExamples = profile.exampleTransactionIds || [];
      const updatedExamples = currentExamples.includes(tx.id)
        ? currentExamples
        : [...currentExamples, tx.id];

      // Step 1: Update the recurring profile examples list
      const patchProfileRes = await fetch(`/api/recurring/${recurringId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exampleTransactionIds: updatedExamples,
        }),
      });

      if (!patchProfileRes.ok) {
        const errData = await patchProfileRes.json();
        throw new Error(errData.error || 'Failed to update recurring profile examples');
      }

      // Step 2: Extract a clean timezone-safe date string
      const d = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
      let dateStr = '';
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dateStr = `${y}-${m}-${day}`;
      }

      // Step 3: Update the transaction matched field
      const patchTxRes = await fetch('/api/transaction/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tx.id,
          amount: tx.Amount,
          category: tx.Category || tx._category || 'Uncategorized',
          subcategory: tx.Subcategory || tx._subcategory || '',
          status: tx.status || 'reviewed',
          date: dateStr || undefined,
          matched: true,
        }),
      });

      if (!patchTxRes.ok) {
        const errData = await patchTxRes.json();
        throw new Error(errData.error || 'Failed to update transaction status');
      }

      // Step 4: Refresh data by calling onRefresh
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      alert(err.message || 'An error occurred while saving the match');
    } finally {
      setSavingMap((prev) => {
        const next = { ...prev };
        delete next[saveKey];
        return next;
      });
    }
  };

  /**
   * Saves all automatically suggested transaction matches sequentially.
   * Processes them sequentially to avoid race conditions when multiple transactions
   * are matched to the same recurring profile.
   */
  const handleSaveAllMatches = async () => {
    if (savingAll) return;

    // Filter to candidates that actually have suggested matches
    const candidates = matchedResults.filter((r) => r.matches && r.matches.length > 0);
    if (candidates.length === 0) return;

    setSavingAll(true);

    try {
      // Keep a local list of recurring profiles to aggregate changes correctly
      const localProfiles = [...recurringProfiles];

      for (const result of candidates) {
        const tx = result.transaction;
        // Always save the top-scoring candidate match
        const recurringId = result.matches[0].recurringId;

        const profileIdx = localProfiles.findIndex((p) => p.id === recurringId);
        if (profileIdx === -1) continue;

        const profile = localProfiles[profileIdx];
        const currentExamples = profile.exampleTransactionIds || [];
        const updatedExamples = currentExamples.includes(tx.id)
          ? currentExamples
          : [...currentExamples, tx.id];

        // Update local profiles list to carry over examples to any subsequent sequence item
        localProfiles[profileIdx] = {
          ...profile,
          exampleTransactionIds: updatedExamples,
        };

        // Step 1: Update the recurring profile examples list in the backend
        const patchProfileRes = await fetch(`/api/recurring/${recurringId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exampleTransactionIds: updatedExamples,
          }),
        });

        if (!patchProfileRes.ok) {
          const errData = await patchProfileRes.json();
          throw new Error(
            errData.error ||
              `Failed to update recurring profile examples for ${profile.description}`
          );
        }

        // Step 2: Extract timezone-safe date string
        const d = tx.Date?.toDate ? tx.Date.toDate() : new Date(tx.Date || tx.date);
        let dateStr = '';
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          dateStr = `${y}-${m}-${day}`;
        }

        // Step 3: Update the transaction matched field in the database
        const patchTxRes = await fetch('/api/transaction/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tx.id,
            amount: tx.Amount,
            category: tx.Category || tx._category || 'Uncategorized',
            subcategory: tx.Subcategory || tx._subcategory || '',
            status: tx.status || 'reviewed',
            date: dateStr || undefined,
            matched: true,
          }),
        });

        if (!patchTxRes.ok) {
          const errData = await patchTxRes.json();
          throw new Error(
            errData.error || `Failed to update transaction status for ${tx.Description}`
          );
        }
      }

      // Step 4: Refresh data by calling onRefresh
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      alert(err.message || 'An error occurred while saving all matches');
    } finally {
      setSavingAll(false);
    }
  };

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
  const currentYear = new Date().getFullYear();

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
      {/* Hero Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
              <Wallet className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Current Balance</p>
              <p className="text-2xl font-bold text-slate-900 whitespace-nowrap">
                {currentBalance < 0 ? '-' : ''}
                {formatCurrency(currentBalance)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">
                {unmatched.length} Upcoming Transactions
              </p>
              <p className="text-2xl font-bold text-slate-900 whitespace-nowrap">
                {expectedImpact < 0 ? '-' : '+'}
                {formatCurrency(expectedImpact)}
              </p>
            </div>
          </div>
        </div>

        {(() => {
          const isGrowth = projectedBalance > currentBalance;
          const IconComponent = isGrowth ? TrendingUp : TrendingDown;
          const iconBgClass = isGrowth ? 'bg-emerald-100' : 'bg-rose-100';
          const iconTextClass = isGrowth ? 'text-emerald-600' : 'text-rose-600';
          return (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-4">
                <div
                  className={`w-12 h-12 ${iconBgClass} rounded-full flex items-center justify-center shrink-0`}
                >
                  <IconComponent className={`w-6 h-6 ${iconTextClass}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Projected End of Month</p>
                  <p className="text-2xl font-bold text-slate-900 whitespace-nowrap">
                    {projectedBalance < 0 ? '-' : ''}
                    {formatCurrency(projectedBalance)}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Unmatched Transactions List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setRemainingExpanded(!remainingExpanded)}
          className="w-full p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Upcoming Transactions</h3>
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
            <div className="p-6">
              <TransactionTable
                transactions={mappedUpcomingTransactions}
                analysis={defaultAnalysis}
                taxonomy={defaultTaxonomy}
                availableYears={defaultAvailableYears}
                headers={defaultHeaders}
                selectedAccount={tableAccount}
                setSelectedAccount={setTableAccount}
                selectedYear={tableYear}
                setSelectedYear={setTableYear}
                selectedMonth={tableMonth}
                setSelectedMonth={setTableMonth}
                selectedTxIds={tableSelectedTxIds}
                setSelectedTxIds={setTableSelectedTxIds}
                hideFilters={true}
                hideBulkActions={true}
                hideTotalsToggle={true}
                // Default sort upcoming/projected transactions in chronological ascending order
                defaultSortDirection="asc"
              />
            </div>
          ))}
      </div>

      {/* Occurred Transactions List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-500">
        <button
          onClick={() => setOccurredExpanded(!occurredExpanded)}
          className="w-full p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Matched Transactions</h3>
            <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-semibold">
              {occurredTransactions.length} Items
            </span>
          </div>
          <div className="text-slate-400">
            {occurredExpanded ? (
              <ChevronUp className="w-6 h-6 text-slate-500" />
            ) : (
              <ChevronDown className="w-6 h-6 text-slate-500" />
            )}
          </div>
        </button>

        {occurredExpanded &&
          (occurredTransactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center">
              <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <p className="text-xl font-semibold text-slate-800 mb-1">No Matched Transactions</p>
              <p>No matched transactions have occurred yet this month.</p>
            </div>
          ) : (
            <div className="p-6">
              <TransactionTable
                transactions={occurredTransactions}
                analysis={defaultAnalysis}
                taxonomy={defaultTaxonomy}
                availableYears={defaultAvailableYears}
                headers={defaultHeaders}
                selectedAccount={occurredTableAccount}
                setSelectedAccount={setOccurredTableAccount}
                selectedYear={occurredTableYear}
                setSelectedYear={setOccurredTableYear}
                selectedMonth={occurredTableMonth}
                setSelectedMonth={setOccurredTableMonth}
                selectedTxIds={occurredTableSelectedTxIds}
                setSelectedTxIds={setOccurredTableSelectedTxIds}
                hideFilters={true}
                hideBulkActions={true}
                hideTotalsToggle={true}
                // Default sort occurred transactions in chronological ascending order
                defaultSortDirection="asc"
              />
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
            <h3 className="text-xl font-bold text-slate-800">Pending Matches</h3>
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
                No pending matches found for this month.
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
                          <button
                            onClick={() => handleSaveMatch(result.transaction, m.recurringId)}
                            disabled={savingMap[`${result.transaction.id}-${m.recurringId}`]}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            {savingMap[`${result.transaction.id}-${m.recurringId}`] ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              'Save'
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveAllMatches}
                    disabled={
                      savingAll ||
                      matchedResults.filter((r) => r.matches && r.matches.length > 0).length === 0
                    }
                    className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                  >
                    {savingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving all...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Save All Matches
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cash Flow Projection Chart Card */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-500">
        <button
          onClick={() => setProjectionExpanded(!projectionExpanded)}
          className="w-full p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Cash Flow Projection</h3>
            <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold">
              Projection
            </span>
          </div>
          <div className="text-slate-400">
            {projectionExpanded ? (
              <ChevronUp className="w-6 h-6 text-slate-500" />
            ) : (
              <ChevronDown className="w-6 h-6 text-slate-500" />
            )}
          </div>
        </button>

        {projectionExpanded && (
          <div className="p-6">
            <p className="text-sm text-slate-500 mb-6">
              Daily actual vs. projected cash flow for the month of {currentMonthName}
            </p>

            {/* KPI Metrics Subheader */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div>
                <p className="text-xs text-slate-500 font-medium">Starting Balance</p>
                <p className="text-base font-bold text-slate-800 font-mono mt-0.5">
                  {dailyCashFlowData.startingBalance < 0 ? '-' : ''}
                  {formatCurrency(dailyCashFlowData.startingBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Current Balance</p>
                <p className="text-base font-bold text-slate-800 font-mono mt-0.5">
                  {dailyCashFlowData.currentActualBalance < 0 ? '-' : ''}
                  {formatCurrency(dailyCashFlowData.currentActualBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Projected Ending</p>
                <p className="text-base font-bold text-slate-800 font-mono mt-0.5">
                  {dailyCashFlowData.projectedEndingBalance < 0 ? '-' : ''}
                  {formatCurrency(dailyCashFlowData.projectedEndingBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Month-to-Date Variance</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <p
                    className={`text-base font-bold font-mono ${dailyCashFlowData.varianceToday >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                  >
                    {dailyCashFlowData.varianceToday >= 0 ? '+' : '-'}
                    {formatCurrency(dailyCashFlowData.varianceToday)}
                  </p>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${dailyCashFlowData.varianceToday >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
                  >
                    {dailyCashFlowData.varianceToday >= 0 ? 'Ahead' : 'Behind'}
                  </span>
                </div>
              </div>
            </div>

            {/* Recharts Chart Container */}
            <div className="h-72 w-full">
              {dailyCashFlowData.dataPoints.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={dailyCashFlowData.dataPoints}
                    margin={{ top: 5, right: 5, bottom: 5, left: -10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(val) => `${currentMonthName.substring(0, 3)} ${val}`}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickMargin={10}
                      minTickGap={20}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={{ stroke: '#cbd5e1' }}
                    />
                    <YAxis
                      tickFormatter={(val) => `$${val.toLocaleString()}`}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        const labelName =
                          name === 'actualBalance' ? 'Actual Balance' : 'Projected Balance';
                        const valStr = `$${value.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`;
                        return [valStr, labelName];
                      }}
                      labelFormatter={(label, items) => {
                        if (items && items[0] && items[0].payload) {
                          return `Date: ${items[0].payload.dayLabel}, ${currentYear}`;
                        }
                        return `Day ${label}`;
                      }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const pt = payload[0].payload;
                          const hasActual =
                            pt.actualBalance !== undefined && pt.actualBalance !== null;
                          const variance = hasActual
                            ? Number((pt.actualBalance - pt.projectedBalance).toFixed(2))
                            : 0;
                          return (
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-lg text-sm text-slate-600 font-sans">
                              <p className="font-semibold text-slate-800 mb-2 border-b border-slate-100 pb-1.5">
                                {pt.dayLabel}, {currentYear}
                              </p>
                              <div className="space-y-1.5">
                                {hasActual && (
                                  <div className="flex items-center justify-between gap-6">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600 block" />
                                      Actual Balance:
                                    </span>
                                    <span className="font-mono font-bold text-slate-800">
                                      {pt.actualBalance < 0 ? '-' : ''}
                                      {formatCurrency(pt.actualBalance)}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-6">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 block" />
                                    Projected Balance:
                                  </span>
                                  <span className="font-mono font-bold text-slate-800">
                                    {pt.projectedBalance < 0 ? '-' : ''}
                                    {formatCurrency(pt.projectedBalance)}
                                  </span>
                                </div>
                                {hasActual && (
                                  <div className="flex items-center justify-between gap-6 pt-1.5 border-t border-slate-100">
                                    <span className="text-slate-500 font-medium">Variance:</span>
                                    <span
                                      className={`font-mono font-bold ${variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                                    >
                                      {variance >= 0 ? '+' : '-'}
                                      {formatCurrency(variance)}
                                      <span className="text-[10px] ml-1 px-1 py-0.5 rounded bg-slate-50 uppercase font-semibold">
                                        {variance >= 0 ? 'Ahead' : 'Behind'}
                                      </span>
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="actualBalance"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 5, fill: '#2563eb', stroke: '#fff', strokeWidth: 1.5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedBalance"
                      stroke="#6366f1"
                      strokeWidth={3}
                      strokeDasharray="5 5"
                      dot={false}
                      activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 1.5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  No daily projection data available
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
