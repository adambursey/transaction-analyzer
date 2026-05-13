import React, { useState } from 'react';
import Papa from 'papaparse';
import { UploadCloud, X, Loader2 } from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (result: { success: boolean; message: string; geminiError?: string }) => void;
  onImportStarted: (txCount: number) => void;
  onImportProgress?: (processed: number, total: number) => void;
}

export function ImportModal({ isOpen, onClose, onImportComplete, onImportStarted, onImportProgress }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            Balance: row['Balance'] || ''
          }));

          const total = transactions.length;

          // Close modal immediately and show status banner
          setFile(null);
          setIsImporting(false);
          onImportStarted(total);
          onClose();

          // Process in chunks of 50
          const chunkSize = 50;
          let processed = 0;
          let exactMatchesCount = 0;
          let pendingReviewCount = 0;
          let hasGeminiError = false;
          let lastGeminiError = "";

          console.log(`[ImportModal] Starting chunk import loop. Total chunks: ${Math.ceil(total/chunkSize)}`);

          for (let i = 0; i < total; i += chunkSize) {
            const chunk = transactions.slice(i, i + chunkSize);
            console.log(`[ImportModal] Sending chunk ${i/chunkSize + 1}: tx ${i} to ${i + chunk.length}`);

            try {
              const res = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: file.name,
                  transactions: chunk
                })
              });

              console.log(`[ImportModal] Received response for chunk ${i/chunkSize + 1}. Status: ${res.status}`);
              const data = await res.json();
              console.log(`[ImportModal] Chunk ${i/chunkSize + 1} data:`, data);
              
              if (!res.ok) {
                console.error(`[ImportModal] HTTP error for chunk ${i/chunkSize + 1}:`, data);
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
            
            if (data.geminiError) {
              hasGeminiError = true;
              lastGeminiError = data.geminiError;
            }

            if (onImportProgress) {
              onImportProgress(Math.min(processed, total), total);
            }
          } catch (chunkErr: any) {
            console.error(`[ImportModal] Chunk failed:`, chunkErr);
            throw chunkErr; // Rethrow to be caught by the outer try-catch
          }
        }

        console.log(`[ImportModal] Finished all chunks. Final processed count: ${processed}. Exact: ${exactMatchesCount}, Pending: ${pendingReviewCount}`);
          const finalMessage = `Imported ${total} transactions. ${exactMatchesCount} auto-categorized, ${pendingReviewCount} pending review.`;
          
          onImportComplete({ 
            success: true, 
            message: finalMessage, 
            geminiError: hasGeminiError ? lastGeminiError : undefined 
          });
        } catch (err: any) {
          console.error("[ImportModal] Error caught in complete callback:", err);
          onImportComplete({ success: false, message: err.message || 'Error importing' });
        }
      },
      error: (err) => {
        console.error(`[ImportModal] Papa Parse error:`, err);
        setError(`CSV Parse Error: ${err.message}`);
        setIsImporting(false);
      }
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
                {file ? file.name : "Click to select a CSV file"}
              </span>
              <span className="text-slate-500 text-sm">Chase format supported</span>
            </label>
          </div>

          {error && <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">{error}</div>}

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
              {isImporting ? "Parsing..." : "Import CSV"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
