import React, { useState, useMemo } from 'react';
import { X, Save, Calculator, Loader2 } from 'lucide-react';
import { TransactionTable } from './TransactionTable';

interface AddRecurringModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: any[];
  analysis: any;
  taxonomy: any;
  onSave: (payload: any) => Promise<void>;
}

export function AddRecurringModal({
  isOpen,
  onClose,
  transactions,
  analysis,
  taxonomy,
  onSave,
}: AddRecurringModalProps) {
  const [frequency, setFrequency] = useState('monthly');
  const [isFrequencyTouched, setIsFrequencyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [projectedOccurrence, setProjectedOccurrence] = useState('Unknown');
  const [isSaving, setIsSaving] = useState(false);

  // Local state for the table's global filters, since this modal shouldn't affect the main app
  const [selectedAccount, setSelectedAccount] = useState('All');
  const [selectedYear, setSelectedYear] = useState('All');
  const [selectedMonth, setSelectedMonth] = useState('All Months');

  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());

  const availableYears = useMemo(() => {
    if (!analysis || !analysis.allTransactions) return [];
    const years = new Set<string>();
    analysis.allTransactions.forEach((tx: any) => {
      if (tx._yearKey) years.add(tx._yearKey);
    });
    return Array.from(years).sort().reverse();
  }, [analysis]);

  const headers = useMemo(() => {
    if (!analysis || !analysis.columnsIdentified) return [];
    const base = [
      analysis.columnsIdentified.date,
      analysis.columnsIdentified.description,
      analysis.columnsIdentified.amount,
      analysis.columnsIdentified.category,
      analysis.columnsIdentified.subcategory,
    ].filter(Boolean);
    return base;
  }, [analysis]);

  React.useEffect(() => {
    if (!isOpen) return;
    const selectedTxs = Array.from(selectedTxIds)
      .map((id) => transactions.find((t) => t.id === id))
      .filter((t) => t !== undefined);

    let newProjection = 'Unknown';
    if (selectedTxs.length > 0) {
      const dates = selectedTxs
        .map((tx) => new Date(tx._date || tx.Date))
        .filter((d) => !isNaN(d.getTime()));

      let effectiveFrequency = frequency;

      // Try to guess the frequency if the user hasn't manually set it yet
      if (!isFrequencyTouched && dates.length > 1) {
        const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
        let totalDaysDiff = 0;
        for (let i = 1; i < sortedDates.length; i++) {
          totalDaysDiff +=
            (sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
        }
        const avgDays = totalDaysDiff / (sortedDates.length - 1);

        let guessedFreq = 'monthly';
        if (avgDays <= 10) guessedFreq = 'weekly';
        else if (avgDays <= 20) guessedFreq = 'bi-weekly';
        else if (avgDays <= 45) guessedFreq = 'monthly';
        else if (avgDays <= 120) guessedFreq = 'quarterly';
        else if (avgDays <= 200) guessedFreq = 'semi-annual';
        else guessedFreq = 'yearly';

        if (guessedFreq !== frequency) {
          setFrequency(guessedFreq);
          effectiveFrequency = guessedFreq;
        }
      }

      if (dates.length > 0) {
        const daysOfWeek = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        const months = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ];

        const getMode = (arr: number[]) => {
          const counts = arr.reduce(
            (acc, val) => {
              acc[val] = (acc[val] || 0) + 1;
              return acc;
            },
            {} as Record<number, number>
          );
          return parseInt(
            Object.keys(counts).reduce((a, b) =>
              counts[parseInt(a)] > counts[parseInt(b)] ? a : b
            )
          );
        };

        const getOrdinal = (n: number) => {
          const s = ['th', 'st', 'nd', 'rd'];
          const v = n % 100;
          return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };

        switch (effectiveFrequency) {
          case 'weekly':
          case 'bi-weekly': {
            newProjection = daysOfWeek[getMode(dates.map((d) => d.getDay()))];
            break;
          }
          case 'monthly':
          case 'semi-annual': {
            newProjection = getOrdinal(getMode(dates.map((d) => d.getDate())));
            break;
          }
          case 'quarterly': {
            const daysOfQuarter = dates.map((d) => {
              const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
              return Math.floor((d.getTime() - qStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            });
            newProjection = `Day ${getMode(daysOfQuarter)}`;
            break;
          }
          case 'yearly': {
            const modeMonthDay = getMode(dates.map((d) => d.getMonth() * 100 + d.getDate()));
            const m = Math.floor(modeMonthDay / 100);
            const day = modeMonthDay % 100;
            newProjection = `${months[m]} ${getOrdinal(day)}`;
            break;
          }
        }
      }
    }
    setProjectedOccurrence(newProjection);
  }, [selectedTxIds, frequency, transactions, isOpen, isFrequencyTouched]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!description.trim()) {
      alert('Please enter a description (nickname) for this recurring transaction.');
      return;
    }

    if (selectedTxIds.size === 0) {
      if (
        !confirm(
          'You have not selected any example transactions. The average amount will be $0. Are you sure you want to continue?'
        )
      ) {
        return;
      }
    }

    const selectedTxs = Array.from(selectedTxIds)
      .map((id) => transactions.find((t) => t.id === id))
      .filter((t) => t !== undefined);

    let sum = 0;
    let min = 0;
    let max = 0;

    if (selectedTxs.length > 0) {
      const amounts = selectedTxs.map((tx) =>
        tx._isExpense ? -tx._parsedAmount : tx._parsedAmount
      );
      sum = amounts.reduce((acc, curr) => acc + curr, 0);
      min = Math.min(...amounts);
      max = Math.max(...amounts);
    }

    const avg = selectedTxs.length > 0 ? sum / selectedTxs.length : 0;

    setIsSaving(true);
    try {
      await onSave({
        frequency,
        description,
        amountAverage: avg,
        amountMin: min,
        amountMax: max,
        exampleTransactionIds: Array.from(selectedTxIds),
        matchedTransactionIds: [],
        projectedOccurrence,
      });
      // Reset form
      setFrequency('monthly');
      setIsFrequencyTouched(false);
      setDescription('');
      setProjectedOccurrence('Unknown');
      setSelectedTxIds(new Set());
      onClose();
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(true); // Should be false, wait I will fix this
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-50 w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-white">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Add Recurring Transaction</h2>
            <p className="text-sm text-slate-500 mt-1">
              Define the schedule and select example occurrences.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Description / Nickname
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Netflix Subscription"
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => {
                  setFrequency(e.target.value);
                  setIsFrequencyTouched(true);
                }}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              >
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi-annual">Semi-annual</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Projected Schedule
              </label>
              <input
                type="text"
                value={projectedOccurrence}
                onChange={(e) => setProjectedOccurrence(e.target.value)}
                placeholder="Auto-calculates..."
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              />
            </div>
          </div>

          <div className="flex-1 min-h-[400px]">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">
              Select Example Transactions
            </h3>
            {analysis ? (
              <TransactionTable
                transactions={transactions}
                analysis={analysis}
                taxonomy={taxonomy}
                availableYears={availableYears}
                headers={headers}
                selectedAccount={selectedAccount}
                setSelectedAccount={setSelectedAccount}
                selectedYear={selectedYear}
                setSelectedYear={setSelectedYear}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                selectedTxIds={selectedTxIds}
                setSelectedTxIds={setSelectedTxIds}
                hideBulkActions={true}
                hideTotalsToggle={true}
                onRowClick={(tx) => {
                  const next = new Set(selectedTxIds);
                  if (next.has(tx.id)) next.delete(tx.id);
                  else next.add(tx.id);
                  setSelectedTxIds(next);
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-slate-200">
                <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 bg-white flex items-center justify-between mt-auto shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
            <Calculator className="w-4 h-4 text-blue-500" />
            <span className="font-semibold text-slate-900">{selectedTxIds.size}</span> selected
            examples
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Recurring Transaction
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
