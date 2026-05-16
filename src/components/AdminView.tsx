import React, { useState, useEffect } from "react";
import { Loader2, RefreshCw, ArchiveRestore, Archive } from "lucide-react";
import { format } from "date-fns";

export function AdminView({ onDataChanged }: { onDataChanged?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [archivedTxs, setArchivedTxs] = useState<any[]>([]);
  const [allImports, setAllImports] = useState<any[]>([]);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [txRes, importsRes] = await Promise.all([
        fetch("/api/admin/archived-transactions"),
        fetch("/api/admin/all-imports")
      ]);
      const txData = await txRes.json();
      const importsData = await importsRes.json();
      setArchivedTxs(txData.transactions || []);
      setAllImports(importsData.imports || []);
    } catch (err) {
      console.error("Error fetching admin data:", err);
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
      const updates = Array.from(selectedTxIds).map(id => ({ id, status: 'reviewed' }));
      const res = await fetch("/api/transaction/bulk-update", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      if (!res.ok) throw new Error("Failed to restore transactions");
      setSelectedTxIds(new Set());
      await fetchData();
      onDataChanged?.();
    } catch (err) {
      console.error(err);
      alert("Failed to restore transactions");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUnarchiveImport = async (importId: string) => {
    if (!confirm("Are you sure you want to restore this import? This will also unarchive all associated transactions.")) return;
    setIsUpdating(true);
    try {
      const res = await fetch("/api/admin/unarchive-import", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId })
      });
      if (!res.ok) throw new Error("Failed to unarchive import");
      await fetchData();
      onDataChanged?.();
    } catch (err) {
      console.error(err);
      alert("Failed to unarchive import");
    } finally {
      setIsUpdating(false);
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
                {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />}
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
                        checked={selectedTxIds.size === archivedTxs.length && archivedTxs.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedTxIds(new Set(archivedTxs.map(t => t.id)));
                          else setSelectedTxIds(new Set());
                        }}
                        className="rounded border-slate-300 bg-white text-blue-600"
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100">Date</th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100">Description</th>
                    <th className="px-4 py-3 font-semibold border-b border-slate-100 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {archivedTxs.map(tx => (
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
                        {tx.Date ? format(new Date(tx.Date), "MM/dd/yyyy") : "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-slate-800 font-medium truncate max-w-[200px]" title={tx.Description}>
                        {tx.Description}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900">
                        ${Number(tx.Amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
              allImports.map(imp => (
                <div key={imp.id} className={`p-4 border rounded-xl flex items-center justify-between gap-4 ${imp.archived ? 'bg-red-50/30 border-red-100' : 'bg-slate-50/50 border-slate-100'}`}>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-semibold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {imp.id}
                      </span>
                      {imp.archived && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-100 px-2 py-0.5 rounded">Archived</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-800">
                      {format(new Date(imp.date), "PPP 'at' p")}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {imp.transactionCount} transactions parsed, {imp.duplicateCount || 0} duplicates skipped.
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
