import React, { useEffect, useState } from 'react';
import { Clock, Trash2, Loader2, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

interface ImportHistoryProps {
  onRollbackComplete: () => void;
  refreshTrigger?: number;
}

/**
 * ImportHistory Component.
 * Displays a list of recent imports and AI reclassifications.
 * Allows users to review recent actions and rollback (undo) them if necessary.
 *
 * @param props.onRollbackComplete - Callback triggered when a rollback completes successfully.
 * @param props.refreshTrigger - A dependency value used to trigger a data refresh from the parent.
 */
export function ImportHistory({ onRollbackComplete, refreshTrigger = 0 }: ImportHistoryProps) {
  const [imports, setImports] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const fetchImports = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/imports');
      const data = await res.json();
      if (res.ok) {
        setImports(data.imports || []);
      }
    } catch (err) {
      console.error('Failed to fetch imports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImports();
  }, [refreshTrigger]);

  const handleRollback = async (importId: string, isReclassification: boolean = false) => {
    // Show appropriate warning depending on whether it's an import or a reclassification
    const msg = isReclassification
      ? "Are you sure you want to rollback this AI reclassification? This will revert all associated transactions back to 'Uncategorized'."
      : 'Are you sure you want to rollback this import? This will permanently delete all transactions associated with it.';

    if (!window.confirm(msg)) {
      return;
    }

    setRollingBackId(importId);
    try {
      const res = await fetch('/api/import/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId }),
      });

      if (!res.ok) throw new Error('Rollback failed');

      await fetchImports();
      onRollbackComplete();
    } catch (err) {
      console.error(err);
      alert('Failed to rollback import.');
    } finally {
      setRollingBackId(null);
    }
  };

  const handleMarkOk = async (importId: string) => {
    try {
      const res = await fetch('/api/import/ok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId }),
      });
      if (!res.ok) throw new Error('Failed to mark OK');
      setImports(imports.filter((imp) => imp.importId !== importId));
    } catch (err) {
      console.error(err);
      alert('Failed to mark OK');
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (imports.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden mt-8 mb-6">
      <div className="bg-slate-800/50 border-b border-slate-700 p-4">
        <h3 className="text-white font-bold text-lg flex items-center gap-2">
          <Clock className="text-blue-500" size={20} />
          Import History
        </h3>
      </div>

      <div className="p-4">
        <div className="space-y-3">
          {imports.map((imp) => (
            <div
              key={imp.importId}
              className="flex items-center justify-between bg-slate-800 p-4 rounded-lg border border-slate-700"
            >
              <div>
                <p className="text-white font-medium">{imp.filename}</p>
                <p className="text-slate-400 text-sm mt-1">
                  {format(new Date(imp.date), "MMM d, yyyy 'at' h:mm a")} • {imp.count} transactions
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleMarkOk(imp.importId)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  title="Mark as OK (hides from history)"
                >
                  <CheckCircle size={16} />
                  <span className="text-sm font-medium">OK</span>
                </button>
                <button
                  onClick={() => handleRollback(imp.importId, imp.reclassification)}
                  disabled={rollingBackId === imp.importId}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  title="Rollback Import"
                >
                  {rollingBackId === imp.importId ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  <span className="text-sm font-medium">Rollback</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
