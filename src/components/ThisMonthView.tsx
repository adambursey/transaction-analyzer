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
import { runMatchingEngine, MatchingResult } from '../utils/matchingLogic';
import { getUnmatchedRecurringInstances } from '../utils/projectionLogic';
import { format } from 'date-fns';

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
export function ThisMonthView({ transactions, currentBalance, onRefresh }: ThisMonthViewProps) {
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
  const [matchedResults, setMatchedResults] = useState<MatchingResult[]>([]);
  const [recurringProfiles, setRecurringProfiles] = useState<any[]>([]);
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => {
    localStorage.setItem('remainingExpanded', String(remainingExpanded));
  }, [remainingExpanded]);

  useEffect(() => {
    localStorage.setItem('matchedExpanded', String(matchedExpanded));
  }, [matchedExpanded]);

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
    </div>
  );
}
