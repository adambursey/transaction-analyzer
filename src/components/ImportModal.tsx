import React, { useState } from 'react';
import Papa from 'papaparse';
import { UploadCloud, X, Loader2 } from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  getTokens: () => string | null;
}

export function ImportModal({ isOpen, onClose, onImportComplete, getTokens }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError(null);
      setSuccess(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsImporting(true);
    setError(null);
    setSuccess(null);

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

          const tokens = getTokens();
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          if (tokens) {
            headers['Authorization'] = `Bearer ${encodeURIComponent(tokens)}`;
          }

          const res = await fetch('/api/import', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              filename: file.name,
              transactions
            })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to import');

          setSuccess(data.message);
          onImportComplete();
          // Clear file
          setFile(null);
        } catch (err: any) {
          setError(err.message || 'Error parsing CSV');
        } finally {
          setIsImporting(false);
        }
      },
      error: (err) => {
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
          {success && <div className="text-green-400 text-sm bg-green-400/10 p-3 rounded-lg border border-green-400/20">{success}</div>}

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
              {isImporting ? "Importing..." : "Import CSV"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
