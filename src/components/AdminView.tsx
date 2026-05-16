import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw, ArchiveRestore, Archive } from 'lucide-react';
import { format } from 'date-fns';

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

  const uncategorizedTxs = transactions.filter(
    (t) => !t._category || t._category === 'Uncategorized'
  );
  const uncategorizedCount = uncategorizedTxs.length;

  const fetchData = async () => {
    setLoading(true);
    try {
      const [txRes, importsRes, dupRes] = await Promise.all([
        fetch('/api/admin/archived-transactions'),
        fetch('/api/admin/all-imports'),
        fetch('/api/admin/duplicate-stats'),
      ]);
      const txData = await txRes.json();
      const importsData = await importsRes.json();
      const dupData = await dupRes.json();

      setArchivedTxs(txData.transactions || []);
      setAllImports(importsData.imports || []);
      setDuplicateCount(dupData.count || 0);
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
      const res = await fetch('/api/admin/deduplicate', { method: 'POST' });
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-slate-500 font-medium">Loading admin data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Admin Controls</h2>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh Data
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
        <h3 className="font-bold text-slate-800 mb-4 text-lg">Maintenance Actions</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700">
                Reclassify Uncategorized Transactions
              </h4>
              <p className="text-sm text-slate-500 mt-1">
                Found <strong className="text-slate-700">{uncategorizedCount}</strong> transactions
                currently missing a category. Running this will use AI to automatically classify
                them based on your history and place them in the Review Queue.
              </p>
              {reclassifyProgress && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Classifying...</span>
                    <span>
                      {reclassifyProgress.processed} / {reclassifyProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
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

          <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
            <div className="flex-1 mr-8">
              <h4 className="font-semibold text-slate-700">Deduplicate Database</h4>
              <p className="text-sm text-slate-500 mt-1">
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
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Archived Transactions */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
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
                <thead className="text-xs text-slate-500 uppercase bg-white sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 w-10 text-center">
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
                        className="rounded border-slate-300 bg-white text-blue-600"
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100">Date</th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100">
                      Description
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {archivedTxs.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
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
                          className="rounded border-slate-300 bg-white text-blue-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {tx.Date ? format(new Date(tx.Date), 'MM/dd/yyyy') : 'Unknown'}
                      </td>
                      <td
                        className="px-4 py-3 text-slate-800 font-medium truncate max-w-[200px]"
                        title={tx.Description}
                      >
                        {tx.Description}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900">
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

        {/* All Imports Log */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
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
                  className={`p-4 border rounded-xl flex items-center justify-between gap-4 ${imp.archived ? 'bg-red-50/30 border-red-100' : 'bg-slate-50/50 border-slate-100'}`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-semibold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {imp.id}
                      </span>
                      {imp.archived && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-100 px-2 py-0.5 rounded">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-800">
                      {format(new Date(imp.date), "PPP 'at' p")}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
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
