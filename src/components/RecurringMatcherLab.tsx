import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Play,
  AlertCircle,
  CheckCircle2,
  Calendar,
  DollarSign,
  Tag,
} from 'lucide-react';
import { runMatchingEngine, MatchingResult } from '../utils/matchingLogic';

interface MatcherLabProps {
  transactions: any[];
}

export function RecurringMatcherLab({ transactions }: MatcherLabProps) {
  const [recurringTransactions, setRecurringTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultsByMonth, setResultsByMonth] = useState<
    Record<string, { totalTx: number; results: any[] }>
  >({});
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  async function fetchRecurring() {
    setLoading(true);
    try {
      const res = await fetch('/api/recurring');
      if (res.ok) {
        const data = await res.json();
        setRecurringTransactions(data.recurring || []);
      }
    } catch (err) {
      console.error('Failed to fetch recurring transactions', err);
    } finally {
      setLoading(false);
    }
  }

  // Fetch recurring transactions on mount
  useEffect(() => {
    fetchRecurring();
  }, []);

  const runMatching = () => {
    setLoading(true);

    const now = new Date();
    const currentYear = 2026;
    const monthsToRun = [0, 1, 2, 3, 4]; // Jan to May

    const monthlyData: Record<string, { totalTx: number; results: any[] }> = {};

    monthsToRun.forEach((month) => {
      const todayDate =
        currentYear === now.getFullYear() && month === now.getMonth() ? now.getDate() : 31;

      const matchResults = runMatchingEngine(
        transactions,
        recurringTransactions,
        currentYear,
        month,
        todayDate,
        transactions
      );

      const monthName = new Date(currentYear, month).toLocaleString('default', {
        month: 'long',
        year: 'numeric',
      });
      monthlyData[monthName] = {
        totalTx: transactions.filter((tx) => {
          const txDate = tx.Date?.toDate
            ? tx.Date.toDate()
            : new Date(tx.Date || tx['Posting Date'] || tx.date);
          return txDate.getFullYear() === currentYear && txDate.getMonth() === month;
        }).length,
        results: matchResults,
      };
    });

    setResultsByMonth(monthlyData);
    setExpandedMonths(new Set()); // Collapse all by default
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-blue-600" />
            Recurring Matcher Lab
          </h2>
          <p className="text-slate-500 mt-1">
            Experimental UI to tune matching criteria. No database mutations occur here.
          </p>
        </div>

        <button
          onClick={runMatching}
          disabled={loading || recurringTransactions.length === 0}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          <Play className="w-4 h-4" />
          Run Matching Engine
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Right Panel: Results */}
        <div className="lg:col-span-3">
          {Object.keys(resultsByMonth).length === 0 ? (
            <div className="h-64 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-400">
              {loading ? 'Running algorithm...' : 'Click "Run Matching Engine" to see results'}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(resultsByMonth).map(([monthKey, data]: [string, any]) => {
                const isExpanded = expandedMonths.has(monthKey);
                return (
                  <div
                    key={monthKey}
                    className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm"
                  >
                    {/* Month Header */}
                    <button
                      onClick={() => toggleMonth(monthKey)}
                      className="w-full bg-slate-50 p-4 flex items-center justify-between hover:bg-slate-100 transition-colors text-left"
                    >
                      <div className="flex items-center gap-4">
                        <h3 className="text-lg font-bold text-slate-800">{monthKey}</h3>
                        <div className="flex items-center gap-3 text-xs font-medium">
                          <span className="bg-slate-200 text-slate-700 px-2 py-1 rounded">
                            {data.totalTx} txns
                          </span>
                          <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">
                            {data.results.length} Candidates
                          </span>
                          <span className="bg-green-100 text-green-700 px-2 py-1 rounded">
                            {data.results.filter((r) => r.isAutoMatch).length} Auto
                          </span>
                          <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded">
                            {data.results.filter((r) => r.isConflict).length} Flagged
                          </span>
                        </div>
                      </div>
                      <div className="text-slate-400">{isExpanded ? '▼' : '▶'}</div>
                    </button>

                    {/* Month Content */}
                    {isExpanded && (
                      <div className="p-4 bg-slate-50 border-t border-slate-200">
                        {data.results.length === 0 ? (
                          <div className="text-center text-slate-500 py-8">
                            No matching candidates found for this month.
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {data.results.map((result, idx) => (
                              <div
                                key={idx}
                                className={`p-4 rounded-xl border ${result.isConflict ? 'border-amber-300 bg-amber-50' : result.isAutoMatch ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'}`}
                              >
                                {/* Transaction Header */}
                                <div className="flex justify-between items-start mb-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      {result.isConflict && (
                                        <AlertCircle className="w-4 h-4 text-amber-500" />
                                      )}
                                      {result.isAutoMatch && (
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                      )}
                                      <h4 className="font-semibold text-slate-900">
                                        {result.transaction.Description}
                                      </h4>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                                      <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {result.transaction.Date?.toDate
                                          ? result.transaction.Date.toDate().toLocaleDateString()
                                          : String(result.transaction.Date).split('T')[0]}
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <DollarSign className="w-3.5 h-3.5" />
                                        {Math.abs(result.transaction.Amount).toFixed(2)}
                                      </span>
                                      {result.transaction.Category && (
                                        <span className="flex items-center gap-1">
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
                                            {mIdx === 0 &&
                                              !result.isConflict &&
                                              result.isAutoMatch && (
                                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                                  Top Match
                                                </span>
                                              )}
                                          </div>
                                          <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
                                            <span>Tokens: {m.breakdown.tokenScore}%</span>
                                            <span>Substring: {m.breakdown.lcsChars} chars</span>
                                            <span>Cat Bonus: +{m.breakdown.categoryBonus}%</span>
                                            <span>Expected: ${m.breakdown.amountExpected}</span>
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
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
