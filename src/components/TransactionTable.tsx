import React, { useState } from 'react';
import { Search, Loader2, Check, Edit3, Archive } from 'lucide-react';
import { getCategoryColor } from '../utils/colors';

export interface TransactionTableProps {
  transactions: any[];
  analysis: any;
  taxonomy: any;
  availableYears: string[];
  headers: string[];

  selectedAccount: string;
  setSelectedAccount: (val: string) => void;
  selectedYear: string;
  setSelectedYear: (val: string) => void;
  selectedMonth: string;
  setSelectedMonth: (val: string) => void;

  selectedTxIds: Set<string>;
  setSelectedTxIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  hideBulkActions?: boolean;
  isBulkUpdatingTx?: boolean;
  onBulkUpdate?: (updates: any[]) => void;
  onRowClick?: (tx: any) => void;
  hideTotalsToggle?: boolean;
}

export function TransactionTable({
  transactions,
  analysis,
  taxonomy,
  availableYears,
  headers,
  selectedAccount,
  setSelectedAccount,
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  selectedTxIds,
  setSelectedTxIds,
  hideBulkActions = false,
  isBulkUpdatingTx = false,
  onBulkUpdate,
  onRowClick,
  hideTotalsToggle = false,
}: TransactionTableProps) {
  const [txSearchText, setTxSearchText] = useState('');
  const [txFilterCategory, setTxFilterCategory] = useState('');
  const [txFilterSubcategory, setTxFilterSubcategory] = useState('');
  const [txFilterType, setTxFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [txFilterMatched, setTxFilterMatched] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [txSortConfig, setTxSortConfig] = useState<{
    key: string;
    direction: 'asc' | 'desc';
  } | null>({
    key: analysis.columnsIdentified.date,
    direction: 'desc',
  });
  const [showTxTotals, setShowTxTotals] = useState(false);
  const [isBulkEditingTx, setIsBulkEditingTx] = useState(false);
  const [bulkEditTxCategory, setBulkEditTxCategory] = useState('');
  const [bulkEditTxSubcategory, setBulkEditTxSubcategory] = useState('');

  const filteredSubcategories = txFilterCategory ? taxonomy[txFilterCategory] || [] : [];

  const filteredAndSortedTransactions = transactions
    .filter((tx: any) => {
      if (selectedMonth !== 'All Months' && tx._monthKey !== selectedMonth) return false;
      if (txFilterCategory && tx._category !== txFilterCategory) return false;
      if (txFilterSubcategory && tx._subcategory !== txFilterSubcategory) return false;
      if (txFilterType === 'income' && tx._isExpense) return false;
      if (txFilterType === 'expense' && !tx._isExpense) return false;
      if (txFilterMatched === 'matched' && !tx.matched) return false;
      if (txFilterMatched === 'unmatched' && tx.matched) return false;
      if (txSearchText) {
        const terms = txSearchText.toLowerCase().split(/\s+/).filter(Boolean);
        const negativeTerms = terms
          .filter((t) => t.startsWith('-') && t.length > 1)
          .map((t) => t.substring(1));
        const positiveSearchString = terms.filter((t) => !t.startsWith('-')).join(' ');

        const textToSearch = [
          tx.Description || '',
          tx._category || '',
          tx._subcategory || '',
          String(tx.Amount || ''),
        ]
          .join(' ')
          .toLowerCase();

        if (negativeTerms.some((term) => textToSearch.includes(term))) {
          return false;
        }

        if (positiveSearchString) {
          const matchesDesc =
            tx.Description && tx.Description.toLowerCase().includes(positiveSearchString);
          const matchesCat =
            tx._category && tx._category.toLowerCase().includes(positiveSearchString);
          const matchesSubcat =
            tx._subcategory && tx._subcategory.toLowerCase().includes(positiveSearchString);
          const matchesAmount =
            tx.Amount && String(tx.Amount).toLowerCase().includes(positiveSearchString);

          if (!matchesDesc && !matchesCat && !matchesSubcat && !matchesAmount) return false;
        }
      }
      return true;
    })
    .sort((a: any, b: any) => {
      if (!txSortConfig) return 0;
      const { key, direction } = txSortConfig;

      let valA = a[key];
      let valB = b[key];

      if (key === analysis.columnsIdentified.amount) {
        valA = a._parsedAmount;
        valB = b._parsedAmount;
      } else if (key === analysis.columnsIdentified.date) {
        const dateA = a._date instanceof Date ? a._date : new Date(a._date || a[key]);
        const dateB = b._date instanceof Date ? b._date : new Date(b._date || b[key]);
        valA = dateA.getTime();
        valB = dateB.getTime();
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-8 gap-4">
          <div className="col-span-1 md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Search
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-9 p-2.5"
                placeholder="Search description, amount..."
                value={txSearchText}
                onChange={(e) => setTxSearchText(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Account
            </label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="All">All Accounts</option>
              <option value="Checking">Checking</option>
              <option value="Savings">Savings</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value);
                setSelectedMonth('All Months');
              }}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="All">All</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="All Months">All</option>
              {analysis.sortedMonths.map((month: string) => (
                <option key={month} value={month}>
                  {month.split(' ')[0]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Category
            </label>
            <select
              value={txFilterCategory}
              onChange={(e) => {
                setTxFilterCategory(e.target.value);
                setTxFilterSubcategory('');
              }}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="">All</option>
              {analysis.categories.map((cat: string) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Subcategory
            </label>
            <select
              value={txFilterSubcategory}
              onChange={(e) => setTxFilterSubcategory(e.target.value)}
              disabled={!txFilterCategory}
              className={`w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 ${!txFilterCategory ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <option value="">All</option>
              {filteredSubcategories.map((sub: string) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Type
            </label>
            <select
              value={txFilterType}
              onChange={(e) => setTxFilterType(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="all">All</option>
              <option value="income">Income Only</option>
              <option value="expense">Expense Only</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="table-transactions-matched-select"
              className="block text-xs font-semibold text-slate-500 uppercase mb-2"
            >
              Matched Status
            </label>
            <select
              id="table-transactions-matched-select"
              value={txFilterMatched}
              onChange={(e) => setTxFilterMatched(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            >
              <option value="all">All</option>
              <option value="matched">Matched Only</option>
              <option value="unmatched">Unmatched Only</option>
            </select>
          </div>
          <div className="flex items-end gap-4">
            {!hideTotalsToggle && (
              <label className="flex items-center gap-2 cursor-pointer group mb-0.5">
                <input
                  type="checkbox"
                  checked={showTxTotals}
                  onChange={(e) => setShowTxTotals(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 transition-colors"
                />
                <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors whitespace-nowrap">
                  Totals
                </span>
              </label>
            )}
            <button
              onClick={() => {
                setTxFilterCategory('');
                setTxFilterSubcategory('');
                setTxFilterType('all');
                setTxFilterMatched('all');
                setSelectedYear('All');
                setSelectedMonth('All Months');
              }}
              className="mb-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors uppercase tracking-wider"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Edit Banner */}
      {!hideBulkActions && selectedTxIds.size > 0 && (
        <div className="bg-slate-900 rounded-lg p-3 mb-4 flex items-center justify-between text-white shadow-md animate-in fade-in slide-in-from-top-2">
          <span className="text-sm font-medium">{selectedTxIds.size} transactions selected</span>
          {isBulkEditingTx ? (
            <div className="flex items-center gap-2">
              <select
                value={bulkEditTxCategory}
                onChange={(e) => {
                  setBulkEditTxCategory(e.target.value);
                  setBulkEditTxSubcategory('');
                }}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
              >
                <option value="">Category...</option>
                {Object.keys(taxonomy)
                  .sort()
                  .map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
              </select>
              <select
                value={bulkEditTxSubcategory}
                onChange={(e) => setBulkEditTxSubcategory(e.target.value)}
                disabled={!bulkEditTxCategory}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
              >
                <option value="">Subcategory...</option>
                {bulkEditTxCategory &&
                  taxonomy[bulkEditTxCategory]?.map((sub: string) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => {
                  const updates = Array.from(selectedTxIds)
                    .map((id) => transactions.find((t: any) => t.id === id))
                    .filter((tx) => tx !== undefined)
                    .map((tx) => ({
                      id: tx.id,
                      category: bulkEditTxCategory,
                      subcategory: bulkEditTxSubcategory,
                    }));
                  if (onBulkUpdate) onBulkUpdate(updates);
                }}
                disabled={isBulkUpdatingTx}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 flex items-center gap-1"
              >
                {isBulkUpdatingTx ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}{' '}
                Apply
              </button>
              <button
                onClick={() => setIsBulkEditingTx(false)}
                className="px-2 py-1 text-slate-400 hover:text-white text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const selectedTxs = Array.from(selectedTxIds)
                    .map((id) => transactions.find((t: any) => t.id === id))
                    .filter((tx) => tx && tx._category);

                  let bestCat = '';
                  let bestSubcat = '';
                  if (selectedTxs.length > 0) {
                    const counts: Record<string, number> = {};
                    let maxCount = 0;
                    selectedTxs.forEach((tx) => {
                      const key = `${tx._category}||${tx._subcategory || ''}`;
                      counts[key] = (counts[key] || 0) + 1;
                      if (counts[key] > maxCount) {
                        maxCount = counts[key];
                        bestCat = tx._category;
                        bestSubcat = tx._subcategory || '';
                      }
                    });
                  }

                  setBulkEditTxCategory(bestCat);
                  setBulkEditTxSubcategory(bestSubcat);
                  setIsBulkEditingTx(true);
                }}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded flex items-center gap-1"
              >
                <Edit3 className="w-4 h-4" /> Bulk Edit Category
              </button>
              <button
                onClick={() => {
                  if (
                    !confirm(
                      `Are you sure you want to archive ${selectedTxIds.size} transactions? They will be removed from all calculations.`
                    )
                  )
                    return;
                  const updates = Array.from(selectedTxIds).map((id: string) => ({
                    id,
                    status: 'archived',
                  }));
                  if (onBulkUpdate) onBulkUpdate(updates);
                }}
                className="px-3 py-1.5 bg-red-900/40 hover:bg-red-800/60 text-red-200 text-sm rounded flex items-center gap-1 border border-red-800/50"
              >
                <Archive className="w-4 h-4" /> Archive Selected
              </button>
            </div>
          )}
        </div>
      )}

      {/* Transaction Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[700px]">
          <table className="w-full text-sm text-left border-separate border-spacing-0">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-20">
              <tr>
                <th className="px-4 py-4 font-semibold border-b border-slate-100 bg-slate-50 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredAndSortedTransactions.length > 0 &&
                      selectedTxIds.size === filteredAndSortedTransactions.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTxIds(
                          new Set(filteredAndSortedTransactions.map((t: any) => t.id))
                        );
                      } else {
                        setSelectedTxIds(new Set());
                      }
                    }}
                    className="rounded border-slate-300 bg-white"
                  />
                </th>
                {headers
                  .filter((h) => !/year|month|notes|type|balance|status|importid/i.test(h))
                  .map((header) => {
                    const isCategory = header === analysis.columnsIdentified.category;
                    const isSubcategory = header === analysis.columnsIdentified.subcategory;
                    const isDescription = header === analysis.columnsIdentified.description;

                    let widthClass = 'whitespace-nowrap';
                    if (isCategory || isSubcategory)
                      widthClass = 'min-w-[100px] max-w-[150px] break-words';
                    if (isDescription) widthClass = 'min-w-[200px] break-words';

                    return (
                      <th
                        key={header}
                        className={`px-6 py-4 font-semibold border-b border-slate-100 bg-slate-50 cursor-pointer hover:bg-slate-200 transition-colors ${widthClass}`}
                        onClick={() => {
                          setTxSortConfig((current) => ({
                            key: header,
                            direction:
                              current?.key === header && current.direction === 'asc'
                                ? 'desc'
                                : 'asc',
                          }));
                        }}
                      >
                        <div className="flex items-center gap-1">
                          {header}
                          {txSortConfig?.key === header && (
                            <span className="text-slate-400">
                              {txSortConfig.direction === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSortedTransactions.map((tx: any, idx: number) => (
                <tr
                  key={tx.id || idx}
                  className={`hover:bg-slate-50 transition-colors group ${selectedTxIds.has(tx.id) ? 'bg-blue-50/50' : tx._category === 'Reconciliation Discrepancy' ? 'bg-red-50/50' : ''}`}
                >
                  <td
                    className="px-4 py-4 border-b border-slate-100 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTxIds.has(tx.id)}
                      onChange={() => {
                        const next = new Set(selectedTxIds);
                        if (next.has(tx.id)) next.delete(tx.id);
                        else next.add(tx.id);
                        setSelectedTxIds(next);
                      }}
                      className="rounded border-slate-300 bg-white"
                    />
                  </td>
                  {headers
                    .filter((h) => !/year|month|notes|type|balance|status|importid/i.test(h))
                    .map((header) => {
                      const val = tx[header];
                      const isAmount = header === analysis.columnsIdentified.amount;
                      const isCategory = header === analysis.columnsIdentified.category;
                      const isSubcategory = header === analysis.columnsIdentified.subcategory;
                      const isDescription = header === analysis.columnsIdentified.description;
                      const isDate = header === analysis.columnsIdentified.date;
                      const isMatched = header === 'matched';

                      let dotColor = null;
                      if (isCategory) dotColor = getCategoryColor(String(val));

                      let cellClass = 'whitespace-nowrap';
                      if (isAmount) cellClass = 'font-mono text-right whitespace-nowrap';
                      if (isCategory || isSubcategory)
                        cellClass = 'break-words min-w-[100px] max-w-[150px]';
                      if (isDescription) cellClass = 'break-words min-w-[200px]';

                      return (
                        <td
                          key={header}
                          className={`px-6 py-4 border-b border-slate-100 ${cellClass} cursor-pointer`}
                          onClick={(e) => {
                            if (isCategory || isSubcategory) {
                              e.stopPropagation();
                              if (isCategory) setTxFilterCategory(String(val));
                              if (isSubcategory) setTxFilterSubcategory(String(val));
                            } else if (onRowClick) {
                              onRowClick(tx);
                            }
                          }}
                        >
                          {isAmount ? (
                            <span
                              className={
                                tx._isExpense ? 'text-slate-900' : 'text-emerald-600 font-bold'
                              }
                            >
                              $
                              {tx._parsedAmount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          ) : isMatched ? (
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                val ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {val ? 'Matched' : 'Unmatched'}
                            </span>
                          ) : isCategory ? (
                            <div className="flex items-center gap-2">
                              {dotColor && (
                                <div
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: dotColor }}
                                />
                              )}
                              {String(val)}
                            </div>
                          ) : isDate ? (
                            (() => {
                              const d =
                                tx._date instanceof Date ? tx._date : new Date(tx._date || val);
                              return !isNaN(d.getTime())
                                ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
                                : val;
                            })()
                          ) : (
                            val
                          )}
                        </td>
                      );
                    })}
                </tr>
              ))}
            </tbody>
            {showTxTotals && (
              <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200 sticky bottom-0 z-20">
                <tr>
                  {headers
                    .filter((h) => !/year|month|notes/i.test(h))
                    .map((header, idx) => {
                      const isAmount = header === analysis.columnsIdentified.amount;
                      if (idx === 0)
                        return (
                          <td
                            key={header}
                            className="px-6 py-4 border-t border-slate-200"
                            colSpan={2}
                          >
                            TOTAL ({filteredAndSortedTransactions.length})
                          </td>
                        );
                      if (idx === 1) return null; // skipped because of colspan
                      if (isAmount) {
                        const total = filteredAndSortedTransactions.reduce(
                          (sum: number, tx: any) =>
                            sum + (tx._isExpense ? -tx._parsedAmount : tx._parsedAmount),
                          0
                        );
                        return (
                          <td
                            key={header}
                            className={`px-6 py-4 border-t border-slate-200 text-right font-mono ${total < 0 ? 'text-slate-900' : 'text-emerald-600'}`}
                          >
                            $
                            {Math.abs(total).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        );
                      }
                      return <td key={header} className="px-6 py-4 border-t border-slate-200"></td>;
                    })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
