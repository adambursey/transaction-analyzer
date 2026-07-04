import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, ArchiveRestore, Archive, Upload, ArrowRightLeft } from 'lucide-react';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { stringSimilarity } from '../utils/importLogic';

/**
 * AdminView Component.
 * Provides administrative controls for the application, such as:
 * - Reclassifying uncategorized transactions using AI.
 * - Deduplicating the database.
 * - Viewing and restoring archived transactions.
 * - Viewing the history of all imports.
 *
 * @param props.onDataChanged - Callback function to trigger a global data refresh when admin actions complete.
 * @param props.transactions - The full array of transactions loaded in the app.
 */
export function AdminView({
  onDataChanged,
  transactions = [],
}: {
  onDataChanged?: () => void;
  transactions?: any[];
}) {
  const [selectedAccount, setSelectedAccount] = useState<'Checking' | 'Savings'>('Checking');
  const [loading, setLoading] = useState(true);
  const [archivedTxs, setArchivedTxs] = useState<any[]>([]);
  const [allImports, setAllImports] = useState<any[]>([]);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [reclassifyProgress, setReclassifyProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  const [duplicateCount, setDuplicateCount] = useState(0);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [savedMappingStatus, setSavedMappingStatus] = useState<{
    exists: boolean;
    count: number;
    date: string | null;
  }>({ exists: false, count: 0, date: null });

  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillFile, setBackfillFile] = useState<File | null>(null);

  const uncategorizedTxs = transactions.filter(
    (t) => !t._category || t._category === 'Uncategorized'
  );
  const uncategorizedCount = uncategorizedTxs.length;

  const [resolvedDupeIds, setResolvedDupeIds] = useState<Set<string>>(new Set());

  const potentialDuplicates = transactions
    .filter((t) => t.status === 'potential_duplicate' && !resolvedDupeIds.has(t.id))
    .map((dupe) => {
      const original = transactions.find((t) => t.id === dupe.duplicateOfId);
      const similarity = original
        ? stringSimilarity(dupe.Description || '', original.Description || '')
        : 0;
      return { dupe, original, similarity };
    })
    .filter((item) => item.original) // Ensure original exists
    .sort((a, b) => b.similarity - a.similarity);

  const reconciliationAdjustments = transactions
    .filter(
      (t) =>
        t.Category === 'Reconciliation Adjustment' ||
        t._category === 'Reconciliation Adjustment' ||
        t._category === 'Reconciliation Discrepancy'
    )
    .sort((a, b) => {
      const dateA = new Date(a.Date).getTime();
      const dateB = new Date(b.Date).getTime();
      return dateB - dateA;
    });

  const [isResolvingDupe, setIsResolvingDupe] = useState<string | null>(null);

  const handleResolveDuplicate = async (
    newId: string,
    oldId: string,
    action: 'keep_original' | 'replace_original' | 'keep_both'
  ) => {
    setIsResolvingDupe(newId);
    try {
      const res = await fetch('/api/admin/resolve-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newId, oldId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve duplicate');

      // Optimistically hide the resolved duplicate from the queue
      setResolvedDupeIds(new Set(resolvedDupeIds).add(newId));

      // We purposefully do NOT call onDataChanged() immediately because we don't want
      // the background data fetch to cause the global loading spinner and interrupt
      // the user while they are flying through the queue.
      // The background data will naturally be synced on next view switch or manual refresh.
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setIsResolvingDupe(null);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [txRes, importsRes, dupRes, mappingRes] = await Promise.all([
        fetch(`/api/admin/archived-transactions?account=${selectedAccount}`),
        fetch(`/api/admin/all-imports`),
        fetch(`/api/admin/duplicate-stats?account=${selectedAccount}`),
        fetch('/api/admin/saved-mapping-status'),
      ]);
      const txData = await txRes.json();
      const importsData = await importsRes.json();
      const dupData = await dupRes.json();
      const mappingData = await mappingRes.json();

      setArchivedTxs(txData.transactions || []);
      setAllImports(importsData.imports || []);
      setDuplicateCount(dupData.count || 0);
      if (mappingData.exists) {
        setSavedMappingStatus({
          exists: mappingData.exists,
          count: mappingData.transactionCount,
          date: mappingData.savedAt,
        });
      } else {
        setSavedMappingStatus({ exists: false, count: 0, date: null });
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount]);

  const handleSaveMapping = async () => {
    setIsSavingMapping(true);
    try {
      const res = await fetch('/api/admin/save-mapping', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save mapping');
      alert(`Success! Saved dictionary with ${data.count} mapping rules.`);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setIsSavingMapping(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRestoreTxs = async () => {
    if (selectedTxIds.size === 0) return;
    setIsUpdating(true);
    try {
      const updates = Array.from(selectedTxIds).map((id) => ({ id, status: 'reviewed' }));
      const res = await fetch('/api/transaction/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error('Failed to restore transactions');
      setSelectedTxIds(new Set());
      await fetchData();
      onDataChanged?.();
    } catch (err) {
      console.error(err);
      alert('Failed to restore transactions');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUnarchiveImport = async (importId: string) => {
    if (
      !confirm(
        'Are you sure you want to restore this import? This will also unarchive all associated transactions.'
      )
    )
      return;
    setIsUpdating(true);
    try {
      const res = await fetch('/api/admin/unarchive-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId }),
      });
      if (!res.ok) throw new Error('Failed to unarchive import');
      await fetchData();
      onDataChanged?.();
    } catch (err) {
      console.error(err);
      alert('Failed to unarchive import');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReclassify = async () => {
    if (uncategorizedCount === 0) {
      alert('No uncategorized transactions to reclassify.');
      return;
    }

    setIsReclassifying(true);
    setReclassifyProgress({ processed: 0, total: uncategorizedCount });

    const chunkSize = 50;
    const maxConcurrency = 3;
    const importId = `reclassify_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // We only send the IDs to the server to minimize payload size.
    // The server will query Firestore to get the actual transaction data to send to Gemini.
    const allIds = uncategorizedTxs.map((t: any) => t.id).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < allIds.length; i += chunkSize) {
      chunks.push(allIds.slice(i, i + chunkSize));
    }

    let processed = 0;
    let chunkIndex = 0;
    let activeCount = 0;
    let hasGeminiError = false;
    let lastGeminiError = '';

    try {
      await new Promise<void>((resolve, reject) => {
        // We use a custom concurrency queue to process chunks of IDs.
        // This prevents hitting rate limits on the Gemini API while remaining fast.
        const next = () => {
          if (chunkIndex >= chunks.length && activeCount === 0) {
            resolve();
            return;
          }
          while (activeCount < maxConcurrency && chunkIndex < chunks.length) {
            const currentChunk = chunks[chunkIndex++];
            activeCount++;

            processChunk(currentChunk)
              .then(() => {
                activeCount--;
                next();
              })
              .catch((err) => reject(err));
          }
        };

        const processChunk = async (idsChunk: string[]) => {
          const res = await fetch('/api/admin/reclassify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: idsChunk, importId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to reclassify chunk');

          if (data.geminiError) {
            hasGeminiError = true;
            lastGeminiError = data.geminiError;
          }

          processed += idsChunk.length;
          setReclassifyProgress({ processed, total: uncategorizedCount });
        };

        next();
      });

      alert(
        `Success! Reclassified ${uncategorizedCount} transactions. They are now in the Review Queue.${hasGeminiError ? `\n\nNote: Gemini returned an error on some chunks: ${lastGeminiError}` : ''}`
      );
      onDataChanged?.();
      fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setIsReclassifying(false);
      setReclassifyProgress(null);
    }
  };

  const [isMatchingTransfers, setIsMatchingTransfers] = useState(false);

  const handleMatchTransfers = async () => {
    setIsMatchingTransfers(true);
    try {
      const res = await fetch('/api/admin/match-transfers', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to match transfers');

      alert(`Success! Found and linked ${data.matchCount} internal transfers.`);
      onDataChanged?.();
      fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setIsMatchingTransfers(false);
    }
  };

  const handleDeduplicate = async () => {
    if (duplicateCount === 0) return;
    if (
      !confirm(
        `Are you sure you want to move ${duplicateCount} duplicate transactions to the Archive? You can easily restore them later if needed.`
      )
    )
      return;

    setIsDeduplicating(true);
    try {
      const res = await fetch('/api/admin/deduplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: selectedAccount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to deduplicate');

      alert(`Success! Moved ${data.deletedCount} duplicate transactions to the Archive.`);
      onDataChanged?.();
      fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setIsDeduplicating(false);
    }
  };

  const [isScanningDupes, setIsScanningDupes] = useState(false);
  const handleScanPotentialDuplicates = async () => {
    setIsScanningDupes(true);
    try {
      const res = await fetch('/api/admin/scan-potential-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: selectedAccount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan');

      if (data.flaggedCount > 0) {
        alert(`Found ${data.flaggedCount} potential duplicates! They are now in the Review Queue.`);
      } else {
        alert('No potential duplicates found in the existing database.');
      }
      onDataChanged?.();
      fetchData();
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setIsScanningDupes(false);
    }
  };

  const handleBackfill = async () => {
    if (!backfillFile) return;
    setIsBackfilling(true);

    Papa.parse(backfillFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const transactions = results.data.map((row: any) => ({
            Date: row['Posting Date'] || row['Date'] || '',
            Description: row['Description'] || '',
            Amount: parseFloat(row['Amount']) || 0,
            Balance: row['Balance']
              ? parseFloat(row['Balance'].toString().replace(/[^0-9.-]+/g, ''))
              : undefined,
          }));

          const res = await fetch('/api/admin/backfill-and-reconcile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions, account: selectedAccount }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to backfill balances');

          alert(
            `Success! Successfully updated ${data.updatedBalances} balances and generated ${data.discrepanciesGenerated} discrepancies.`
          );
          setBackfillFile(null);
          onDataChanged?.();
          fetchData();
        } catch (err: any) {
          console.error(err);
          alert('Error during backfill: ' + err.message);
        } finally {
          setIsBackfilling(false);
        }
      },
      error: (error) => {
        alert('CSV Parsing error: ' + error.message);
        setIsBackfilling(false);
      },
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-slate-500 dark:text-slate-400 font-medium">Loading admin data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Admin Controls</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label
              htmlFor="admin-account-select"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Account:
            </label>
            <select
              id="admin-account-select"
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value as any)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all shadow-sm"
            >
              <option value="Checking">Checking</option>
              <option value="Savings">Savings</option>
            </select>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-slate-950 transition-colors shadow-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh Data
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-8">
        <h3 className="font-bold text-slate-800 dark:text-slate-200 mb-4 text-lg">
          Maintenance Actions
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                Reclassify Uncategorized Transactions
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Found{' '}
                <strong className="text-slate-700 dark:text-slate-300">{uncategorizedCount}</strong>{' '}
                transactions currently missing a category. Running this will use AI to automatically
                classify them based on your history and place them in the Review Queue.
              </p>
              {reclassifyProgress && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Classifying...</span>
                    <span>
                      {reclassifyProgress.processed} / {reclassifyProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2 transition-all duration-300"
                      style={{
                        width: `${Math.round((reclassifyProgress.processed / reclassifyProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleReclassify}
              disabled={isReclassifying || uncategorizedCount === 0}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isReclassifying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {isReclassifying ? 'Classifying...' : 'Run AI Classification'}
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                Deduplicate Database
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Found <strong className="text-orange-600">{duplicateCount}</strong> duplicate
                transactions in your database. Running this will move redundant copies to the
                Archive below while preserving your categorized ones.
              </p>
            </div>
            <button
              onClick={handleDeduplicate}
              disabled={isDeduplicating || duplicateCount === 0}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {isDeduplicating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              {isDeduplicating ? 'Archiving...' : 'Archive Duplicates'}
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                Scan for Potential Duplicates
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Scans existing active transactions for date and amount collisions (with differing
                descriptions). Flags them for your review in the queue above.
              </p>
            </div>
            <button
              onClick={handleScanPotentialDuplicates}
              disabled={isScanningDupes}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-800 font-semibold rounded-lg hover:bg-orange-200 disabled:opacity-50 transition-colors"
            >
              {isScanningDupes ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {isScanningDupes ? 'Scanning...' : 'Scan Database'}
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                Match Internal Transfers
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Scans all Checking and Savings transactions for internal transfers based on date,
                amount, and description. Matched transactions will be linked and removed from net
                cash flow calculations.
              </p>
            </div>
            <button
              onClick={handleMatchTransfers}
              disabled={isMatchingTransfers}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {isMatchingTransfers ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="w-4 h-4" />
              )}
              {isMatchingTransfers ? 'Matching...' : 'Match Transfers'}
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                Save Classification Dictionary
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Save the current relationship between descriptions and categories/subcategories.
                {savedMappingStatus.exists && (
                  <span className="block mt-2 text-emerald-600 font-medium">
                    Current dictionary saved on{' '}
                    {savedMappingStatus.date
                      ? new Date(savedMappingStatus.date).toLocaleDateString()
                      : 'Unknown'}{' '}
                    ({savedMappingStatus.count} transactions used).
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={handleSaveMapping}
              disabled={isSavingMapping}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isSavingMapping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArchiveRestore className="w-4 h-4" />
              )}
              {isSavingMapping ? 'Saving...' : 'Save Dictionary'}
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                Database Reconciliation & Backfill
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-3">
                Upload a CSV bank export to backfill historical balances and automatically generate
                System Reconciliation Discrepancies for any detected mathematical gaps.
              </p>
              <input
                type="file"
                accept=".csv"
                id="backfill-upload"
                className="hidden"
                onChange={(e) => setBackfillFile(e.target.files?.[0] || null)}
              />
              <label
                htmlFor="backfill-upload"
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-slate-950 cursor-pointer transition-colors"
                aria-label="Upload Backfill CSV"
              >
                <Upload className="w-4 h-4" />
                {backfillFile ? backfillFile.name : 'Select CSV File'}
              </label>
            </div>
            <button
              onClick={handleBackfill}
              disabled={isBackfilling || !backfillFile}
              className="shrink-0 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {isBackfilling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {isBackfilling ? 'Processing...' : 'Process Backfill'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Archived Transactions */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Archive className="w-5 h-5 text-slate-400" />
              Archived Transactions ({archivedTxs.length})
            </h3>
            {selectedTxIds.size > 0 && (
              <button
                onClick={handleRestoreTxs}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {isUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArchiveRestore className="w-4 h-4" />
                )}
                Restore Selected
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            {archivedTxs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                <Archive className="w-12 h-12 mb-3 opacity-20" />
                <p>No archived transactions found.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left border-separate border-spacing-0">
                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-white dark:bg-slate-900 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={
                          selectedTxIds.size === archivedTxs.length && archivedTxs.length > 0
                        }
                        onChange={(e) => {
                          if (e.target.checked)
                            setSelectedTxIds(new Set(archivedTxs.map((t) => t.id)));
                          else setSelectedTxIds(new Set());
                        }}
                        className="rounded border-slate-300 bg-white dark:bg-slate-900 text-blue-600"
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800">
                      Date
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800">
                      Description
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800 text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {archivedTxs.map((tx) => (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-slate-950/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedTxIds.has(tx.id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedTxIds);
                            if (e.target.checked) newSet.add(tx.id);
                            else newSet.delete(tx.id);
                            setSelectedTxIds(newSet);
                          }}
                          className="rounded border-slate-300 bg-white dark:bg-slate-900 text-blue-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">
                        {tx.Date ? format(new Date(tx.Date), 'MM/dd/yyyy') : 'Unknown'}
                      </td>
                      <td
                        className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium truncate max-w-[200px]"
                        title={tx.Description}
                      >
                        {tx.Description}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-slate-100">
                        $
                        {Number(
                          typeof tx.Amount === 'string'
                            ? tx.Amount.replace(/[^0-9.-]+/g, '')
                            : tx.Amount
                        ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* System Reconciliation Adjustments */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-slate-400" />
              System Reconciliation Adjustments ({reconciliationAdjustments.length})
            </h3>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            {reconciliationAdjustments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                <RefreshCw className="w-12 h-12 mb-3 opacity-20" />
                <p>No reconciliation adjustments found.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left border-separate border-spacing-0">
                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-white dark:bg-slate-900 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800">
                      Date
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800">
                      Description
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 dark:border-slate-800 text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {reconciliationAdjustments.map((tx) => (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-slate-950/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">
                        {tx.Date ? format(new Date(tx.Date), 'MM/dd/yyyy') : 'Unknown'}
                      </td>
                      <td
                        className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium truncate max-w-[200px]"
                        title={tx.Description}
                      >
                        {tx.Description}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-slate-100">
                        {Number(tx.Amount) < 0 ? '-' : ''}$
                        {Math.abs(
                          Number(
                            typeof tx.Amount === 'string'
                              ? tx.Amount.replace(/[^0-9.-]+/g, '')
                              : tx.Amount
                          )
                        ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Potential Duplicates Review Queue */}
        {potentialDuplicates.length > 0 && (
          <div className="bg-orange-50 rounded-2xl border border-orange-200 p-6 overflow-hidden">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-orange-900 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-orange-600" />
                  Review Potential Duplicates ({potentialDuplicates.length})
                </h2>
                <p className="text-orange-700 text-sm mt-1 max-w-2xl">
                  The following incoming transactions matched the exact Date and Amount of an
                  existing transaction, but had a different Description. Please review each pair and
                  determine how to resolve the conflict.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {potentialDuplicates.map(({ dupe, original, similarity }) => {
                const simPercent = Math.round(similarity * 100);
                return (
                  <div
                    key={dupe.id}
                    className="bg-white dark:bg-slate-900 border border-orange-200 rounded-lg p-4 shadow-sm relative overflow-hidden"
                  >
                    {/* Similarity Badge */}
                    <div
                      className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold rounded-bl-lg ${
                        simPercent > 80
                          ? 'bg-emerald-100 text-emerald-800'
                          : simPercent > 50
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {simPercent}% Match
                    </div>

                    <div className="grid grid-cols-2 gap-6 relative mt-4">
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-orange-100 -translate-x-1/2"></div>

                      {/* Left Side: Original */}
                      <div className="pr-2">
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                          Existing Record
                        </div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
                          {original.Description}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          {original._effectiveDateStr || original.Date} • ${original.Amount}
                        </div>
                        <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400">
                          {original._category || 'Uncategorized'}
                          {original._subcategory && ` • ${original._subcategory}`}
                        </div>
                      </div>

                      {/* Right Side: Incoming */}
                      <div className="pl-2">
                        <div className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-2">
                          New Incoming Record
                        </div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
                          {dupe.Description}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          {dupe.Date} • ${dupe.Amount}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() =>
                              handleResolveDuplicate(dupe.id, original.id, 'keep_original')
                            }
                            disabled={isResolvingDupe === dupe.id}
                            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-md transition-colors"
                            title="Delete the new record and keep the existing one exactly as is."
                          >
                            Ignore New
                          </button>
                          <button
                            onClick={() =>
                              handleResolveDuplicate(dupe.id, original.id, 'replace_original')
                            }
                            disabled={isResolvingDupe === dupe.id}
                            className="px-3 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-800 text-sm font-medium rounded-md transition-colors"
                            title="Delete the new record, but update the existing record's description to match this new one."
                          >
                            Merge (Update Desc)
                          </button>
                          <button
                            onClick={() =>
                              handleResolveDuplicate(dupe.id, original.id, 'keep_both')
                            }
                            disabled={isResolvingDupe === dupe.id}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium rounded-md transition-colors"
                            title="These are two different transactions. Keep both in the database."
                          >
                            Keep Both
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* All Imports Log */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Archive className="w-5 h-5 text-slate-400" />
              All Import Logs ({allImports.length})
            </h3>
          </div>
          <div className="overflow-y-auto flex-1 p-4 space-y-3">
            {allImports.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                <Archive className="w-12 h-12 mb-3 opacity-20" />
                <p>No import history found.</p>
              </div>
            ) : (
              allImports.map((imp) => (
                <div
                  key={imp.id}
                  className={`p-4 border rounded-xl flex items-center justify-between gap-4 ${imp.archived ? 'bg-red-50/30 border-red-100' : 'bg-slate-50 dark:bg-slate-950/50 border-slate-100 dark:border-slate-800'}`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                        {imp.id}
                      </span>
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded border bg-blue-50 text-blue-600 border-blue-200">
                        {imp.account || 'Checking'}
                      </span>
                      {imp.archived && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-100 px-2 py-0.5 rounded">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {format(new Date(imp.date), "PPP 'at' p")}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {imp.transactionCount} transactions parsed, {imp.duplicateCount || 0}{' '}
                      duplicates skipped.
                    </p>
                  </div>
                  {imp.archived && (
                    <button
                      onClick={() => handleUnarchiveImport(imp.id)}
                      disabled={isUpdating}
                      className="shrink-0 px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
