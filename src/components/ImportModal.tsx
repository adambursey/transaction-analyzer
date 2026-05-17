import React, { useState } from 'react';
import Papa from 'papaparse';
import { X, Loader2, UploadCloud } from 'lucide-react';
import { generateSignature } from '../utils/importLogic';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportStarted?: (totalCount: number) => void;
  onImportProgress?: (processed: number, total: number) => void;
  onImportComplete: (result: { success: boolean; message: string; geminiError?: string }) => void;
  totalTransactionsCount?: number;
}

/**
 * ImportModal Component.
 * Provides a UI for users to upload a CSV file of transactions.
 * Handles parsing the CSV via PapaParse, performing local deduplication,
 * and chunking the data to send to the server API to avoid request timeouts.
 *
 * @param props.isOpen - Whether the modal is visible.
 * @param props.onClose - Callback to close the modal.
 * @param props.onImportStarted - Callback when the async import process begins.
 * @param props.onImportProgress - Callback indicating progress of the chunked import.
 * @param props.onImportComplete - Callback when the entire import finishes.
 */
export function ImportModal({
  isOpen,
  onClose,
  onImportComplete,
  onImportStarted,
  onImportProgress,
  totalTransactionsCount = 0,
}: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [useSavedMapping, setUseSavedMapping] = useState(false);
  const [savedMappingStatus, setSavedMappingStatus] = useState<{
    exists: boolean;
    count: number;
    date: string | null;
  }>({ exists: false, count: 0, date: null });

  React.useEffect(() => {
    if (isOpen) {
      fetch('/api/admin/saved-mapping-status')
        .then((res) => res.json())
        .then((data) => {
          if (data.exists) {
            setSavedMappingStatus({
              exists: data.exists,
              count: data.transactionCount,
              date: data.savedAt,
            });
            setUseSavedMapping(true); // Default to true if it exists
          } else {
            setSavedMappingStatus({ exists: false, count: 0, date: null });
            setUseSavedMapping(false);
          }
        })
        .catch((err) => console.error('Failed to fetch saved mapping status', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsImporting(true);
    setError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const transactions = results.data.map((row: any) => ({
            Date: row['Posting Date'] || row['Date'] || '',
            Description: row['Description'] || '',
            Amount: parseFloat(row['Amount']) || 0,
            Type: row['Type'] || '',
            Balance: row['Balance']
              ? parseFloat(row['Balance'].toString().replace(/[^0-9.-]+/g, ''))
              : undefined,
          }));

          // Run local deduplication to ensure the file itself has no duplicates
          // We use a Set of generated signatures to track what we've already seen in this file.
          const seen = new Set<string>();
          const uniqueTransactions = transactions.filter((tx: any) => {
            const sig = generateSignature(tx);
            if (!seen.has(sig)) {
              seen.add(sig);
              return true;
            }
            return false;
          });

          const total = uniqueTransactions.length;
          const skippedLocal = transactions.length - uniqueTransactions.length;
          if (skippedLocal > 0) {
            console.log(`[ImportModal] Removed ${skippedLocal} intra-file duplicates locally.`);
          }

          // Close modal immediately and show status banner
          setFile(null);
          setIsImporting(false);
          onImportStarted(total);
          onClose();

          // Process the filtered transactions in chunks (e.g., 50 at a time)
          // This prevents large files from timing out the server connection or hitting payload limits.
          const chunkSize = 50;
          let processed = 0;
          let exactMatchesCount = 0;
          let pendingReviewCount = 0;
          let skippedCountTotal = skippedLocal;
          let hasGeminiError = false;
          let lastGeminiError = '';
          const importId = `import_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

          console.log(
            `[ImportModal] Starting async chunk import loop. Total chunks: ${Math.ceil(total / chunkSize)}`
          );

          const chunks = [];
          for (let i = 0; i < total; i += chunkSize) {
            chunks.push({ i, chunk: uniqueTransactions.slice(i, i + chunkSize) });
          }

          const maxConcurrency = 3;
          let activeCount = 0;
          let chunkIndex = 0;

          await new Promise<void>((resolve, reject) => {
            const next = () => {
              if (chunkIndex >= chunks.length && activeCount === 0) {
                resolve();
                return;
              }
              while (activeCount < maxConcurrency && chunkIndex < chunks.length) {
                const current = chunks[chunkIndex++];
                activeCount++;

                processChunk(current)
                  .then(() => {
                    activeCount--;
                    next();
                  })
                  .catch((err) => {
                    reject(err);
                  });
              }
            };

            const processChunk = async ({ i, chunk }: any) => {
              const chunkNum = Math.floor(i / chunkSize) + 1;
              console.log(
                `[ImportModal] Sending chunk ${chunkNum}: tx ${i} to ${i + chunk.length}`
              );

              const res = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: file.name,
                  transactions: chunk,
                  importId,
                  useSavedMapping: totalTransactionsCount < 100 ? useSavedMapping : false,
                }),
              });

              console.log(
                `[ImportModal] Received response for chunk ${chunkNum}. Status: ${res.status}`
              );
              const data = await res.json();

              if (!res.ok) {
                console.error(`[ImportModal] HTTP error for chunk ${chunkNum}:`, data);
                throw new Error(data.error || 'Failed to import chunk');
              }

              processed += chunk.length;

              // Extract stats from the chunk
              if (data.message) {
                const exactMatch = data.message.match(/(\d+) auto-categorized/);
                if (exactMatch) exactMatchesCount += parseInt(exactMatch[1], 10);

                const pendingMatch = data.message.match(/(\d+) pending review/);
                if (pendingMatch) pendingReviewCount += parseInt(pendingMatch[1], 10);
              }

              if (data.skippedCount) {
                skippedCountTotal += data.skippedCount;
              }

              if (data.geminiError) {
                hasGeminiError = true;
                lastGeminiError = data.geminiError;
              }

              if (onImportProgress) {
                onImportProgress(processed, total);
              }
            };

            // Kick off the initial workers
            next();
          });

          console.log(
            `[ImportModal] Finished all chunks. Final processed count: ${processed}. Exact: ${exactMatchesCount}, Pending: ${pendingReviewCount}, Skipped: ${skippedCountTotal}`
          );
          let finalMessage = `Imported ${total - skippedCountTotal} transactions. ${exactMatchesCount} auto-categorized, ${pendingReviewCount} pending review.`;
          if (skippedCountTotal > 0) {
            finalMessage += ` Skipped ${skippedCountTotal} duplicates.`;
          }

          onImportComplete({
            success: true,
            message: finalMessage,
            geminiError: hasGeminiError ? lastGeminiError : undefined,
          });
        } catch (err: any) {
          console.error('[ImportModal] Error caught in complete callback:', err);
          onImportComplete({ success: false, message: err.message || 'Error importing' });
        }
      },
      error: (err) => {
        console.error(`[ImportModal] Papa Parse error:`, err);
        setError(`CSV Parse Error: ${err.message}`);
        setIsImporting(false);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl w-full max-w-md p-6 border border-slate-700 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <UploadCloud className="text-blue-500" />
          Import Transactions
        </h2>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-blue-500 transition-colors cursor-pointer bg-slate-800/50">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              id="csv-upload"
            />
            <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center gap-2">
              <UploadCloud size={40} className="text-slate-400" />
              <span className="text-slate-300 font-medium">
                {file ? file.name : 'Click to select a CSV file'}
              </span>
              <span className="text-slate-500 text-sm">Chase format supported</span>
            </label>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
              {error}
            </div>
          )}

          {totalTransactionsCount < 100 && savedMappingStatus.exists && (
            <div className="bg-blue-900/30 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3 mt-4">
              <input
                type="checkbox"
                id="useSavedMapping"
                checked={useSavedMapping}
                onChange={(e) => setUseSavedMapping(e.target.checked)}
                className="mt-1 rounded border-slate-600 bg-slate-800 text-blue-500"
              />
              <label
                htmlFor="useSavedMapping"
                className="text-sm text-slate-300 cursor-pointer flex-1"
              >
                <span className="text-white font-medium block">
                  Use saved classification dictionary
                </span>
                Use the taxonomy model saved on{' '}
                {savedMappingStatus.date
                  ? new Date(savedMappingStatus.date).toLocaleDateString()
                  : 'Unknown'}{' '}
                ({savedMappingStatus.count} categorized transactions) instead of rebuilding it from
                the current database.
              </label>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-8">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!file || isImporting}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isImporting ? <Loader2 size={16} className="animate-spin" /> : null}
              {isImporting ? 'Parsing...' : 'Import CSV'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
