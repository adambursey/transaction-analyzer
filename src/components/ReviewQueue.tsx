import React, { useState, useMemo, useEffect } from 'react';
import { Check, X, Edit3, Loader2, ChevronUp, ChevronDown, Filter, Trash2 } from 'lucide-react';

interface ReviewQueueProps {
  transactions: any[];
  taxonomy: Record<string, string[]>;
  onApprove: (id: string, category: string, subcategory: string) => Promise<void>;
  onBulkApprove: (updates: {id: string, category: string, subcategory: string}[]) => Promise<void>;
}

export function ReviewQueue({ transactions, taxonomy, onApprove, onBulkApprove }: ReviewQueueProps) {
  const pendingTransactions = transactions.filter(tx => tx.status === 'pending_review');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editSubcategory, setEditSubcategory] = useState("");
  
  const [isApproving, setIsApproving] = useState<string | null>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  const [filterText, setFilterText] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc'|'desc' } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Editing state for bulk edit
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkEditCategory, setBulkEditCategory] = useState("");
  const [bulkEditSubcategory, setBulkEditSubcategory] = useState("");

  const filteredAndSorted = useMemo(() => {
    let result = [...pendingTransactions];
    
    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter(tx => 
        (tx.Description || "").toLowerCase().includes(lower) ||
        (tx.Category || "").toLowerCase().includes(lower) ||
        (tx.Subcategory || "").toLowerCase().includes(lower) ||
        Math.abs(tx.Amount).toString().includes(lower)
      );
    }

    if (sortConfig !== null) {
      result.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        
        if (sortConfig.key === 'Amount') {
          valA = Math.abs(valA);
          valB = Math.abs(valB);
        }
        
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [pendingTransactions, filterText, sortConfig]);

  // Clear selections when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterText]);

  if (pendingTransactions.length === 0) return null;

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(filteredAndSorted.map(t => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleEditClick = (tx: any) => {
    setEditingId(tx.id);
    setEditCategory(tx.Category || "");
    setEditSubcategory(tx.Subcategory || "");
  };

  const handleApprove = async (tx: any, isDirectApprove = false) => {
    const targetId = tx.id;
    const cat = isDirectApprove ? tx.Category : editCategory;
    const subcat = isDirectApprove ? tx.Subcategory : editSubcategory;
    
    setIsApproving(targetId);
    try {
      await onApprove(targetId, cat, subcat);
      if (!isDirectApprove) setEditingId(null);
    } catch (err) {
      console.error("Failed to approve:", err);
      alert("Failed to approve.");
    } finally {
      setIsApproving(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkApproving(true);
    try {
      const updates = Array.from(selectedIds)
        .map(id => pendingTransactions.find(t => t.id === id))
        .filter((tx): tx is any => tx !== undefined && !!tx.Category) // Prevent empty category approval
        .map(tx => ({
          id: tx.id,
          category: tx.Category,
          subcategory: tx.Subcategory
        }));

      if (updates.length > 0) {
        await onBulkApprove(updates);
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Bulk approve failed:", err);
      alert("Failed to bulk approve");
    } finally {
      setIsBulkApproving(false);
    }
  };

  const applyBulkEdit = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkApproving(true);
    try {
      const updates = Array.from(selectedIds).map((id: string) => ({
        id,
        category: bulkEditCategory,
        subcategory: bulkEditSubcategory
      }));
      await onBulkApprove(updates);
      setSelectedIds(new Set());
      setIsBulkEditing(false);
      setBulkEditCategory("");
      setBulkEditSubcategory("");
    } catch (err) {
      console.error("Bulk edit failed:", err);
      alert("Failed to bulk edit");
    } finally {
      setIsBulkApproving(false);
    }
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden mb-6 shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 p-4">
        <h3 className="text-yellow-500 font-bold text-lg flex items-center gap-2">
          Review Queue ({pendingTransactions.length})
        </h3>
        <p className="text-slate-300 text-sm mt-1">
          Review and approve these imported transactions.
        </p>
      </div>

      <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center bg-slate-900">
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Filter transactions..." 
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              className="w-full pl-9 pr-10 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            />
            {filterText && (
              <button 
                onClick={() => setFilterText("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <span className="text-sm text-slate-400">{selectedIds.size} selected</span>
            {isBulkEditing ? (
              <div className="flex items-center gap-2">
                <select value={bulkEditCategory} onChange={e => { setBulkEditCategory(e.target.value); setBulkEditSubcategory(""); }} className="bg-slate-800 text-white text-sm border border-slate-600 rounded px-2 py-1">
                  <option value="">Select Category...</option>
                  {Object.keys(taxonomy).sort().map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <select value={bulkEditSubcategory} onChange={e => setBulkEditSubcategory(e.target.value)} disabled={!bulkEditCategory} className="bg-slate-800 text-white text-sm border border-slate-600 rounded px-2 py-1">
                  <option value="">None</option>
                  {bulkEditCategory && taxonomy[bulkEditCategory]?.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                </select>
                <button onClick={applyBulkEdit} disabled={isBulkApproving} className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 flex items-center gap-1">
                  {isBulkApproving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Apply
                </button>
                <button onClick={() => setIsBulkEditing(false)} className="px-2 py-1 text-slate-400 hover:text-white">Cancel</button>
              </div>
            ) : (
              <>
                <button 
                  onClick={() => {
                    // Calculate most common category/subcategory pair among selected
                    const selectedTxs = Array.from(selectedIds)
                      .map(id => pendingTransactions.find(t => t.id === id))
                      .filter(tx => tx && tx.Category);
                    
                    let bestCat = "";
                    let bestSubcat = "";
                    
                    if (selectedTxs.length > 0) {
                      const counts: Record<string, number> = {};
                      let maxCount = 0;
                      selectedTxs.forEach(tx => {
                        const key = `${tx.Category}||${tx.Subcategory || ""}`;
                        counts[key] = (counts[key] || 0) + 1;
                        if (counts[key] > maxCount) {
                          maxCount = counts[key];
                          bestCat = tx.Category;
                          bestSubcat = tx.Subcategory || "";
                        }
                      });
                    }
                    
                    setBulkEditCategory(bestCat);
                    setBulkEditSubcategory(bestSubcat);
                    setIsBulkEditing(true);
                  }} 
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded flex items-center gap-1"
                >
                  <Edit3 className="w-4 h-4" /> Bulk Edit
                </button>
                <button onClick={handleBulkApprove} disabled={isBulkApproving} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded flex items-center gap-1">
                  {isBulkApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve All Selected
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
            <tr className="text-slate-400 border-b border-slate-700">
              <th className="p-3 w-10 text-center">
                <input 
                  type="checkbox" 
                  checked={selectedIds.size > 0 && selectedIds.size === filteredAndSorted.length}
                  onChange={handleSelectAll}
                  className="rounded border-slate-600 bg-slate-800"
                />
              </th>
              <th className="p-3 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('Date')}>
                Date {sortConfig?.key === 'Date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="p-3 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('Description')}>
                Description {sortConfig?.key === 'Description' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="p-3 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('Amount')}>
                Amount {sortConfig?.key === 'Amount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="p-3 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('Category')}>
                Category {sortConfig?.key === 'Category' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="p-3 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('Subcategory')}>
                Subcategory {sortConfig?.key === 'Subcategory' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="p-3 font-medium w-28 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredAndSorted.map(tx => {
              const isEditing = editingId === tx.id;
              
              return (
                <tr key={tx.id} className={`hover:bg-slate-800/30 transition-colors ${selectedIds.has(tx.id) ? 'bg-slate-800/20' : ''}`}>
                  <td className="p-3 text-center">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(tx.id)}
                      onChange={() => handleSelectOne(tx.id)}
                      className="rounded border-slate-600 bg-slate-800"
                    />
                  </td>
                  <td className="p-3 text-slate-300 whitespace-nowrap">{tx.Date}</td>
                  <td className="p-3 text-slate-200">{tx.Description}</td>
                  <td className={`p-3 font-medium ${tx.Amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    ${Math.abs(tx.Amount).toFixed(2)}
                  </td>
                  
                  {isEditing ? (
                    <>
                      <td className="p-3">
                        <select
                          value={editCategory}
                          onChange={e => { setEditCategory(e.target.value); setEditSubcategory(""); }}
                          className="w-full bg-slate-800 border border-slate-600 rounded p-1 text-white text-sm"
                        >
                          <option value="">Select...</option>
                          {Object.keys(taxonomy).sort().map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </td>
                      <td className="p-3">
                        <select
                          value={editSubcategory}
                          onChange={e => setEditSubcategory(e.target.value)}
                          disabled={!editCategory}
                          className="w-full bg-slate-800 border border-slate-600 rounded p-1 text-white text-sm disabled:opacity-50"
                        >
                          <option value="">None</option>
                          {editCategory && taxonomy[editCategory]?.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                        </select>
                      </td>
                      <td className="p-3 flex gap-2 justify-center">
                        <button
                          onClick={() => handleApprove(tx, false)}
                          disabled={isApproving === tx.id}
                          className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
                          title="Save & Approve"
                        >
                          {isApproving === tx.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white transition-colors"
                          title="Cancel"
                        >
                          <X size={16} />
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 text-blue-400 font-medium">
                        {tx.Category || <span className="text-slate-500 italic">None</span>}
                      </td>
                      <td className="p-3 text-sky-400 font-medium">
                        {tx.Subcategory || <span className="text-slate-500 italic">None</span>}
                      </td>
                      <td className="p-3 flex gap-2 justify-center">
                        <button
                          onClick={() => handleApprove(tx, true)}
                          disabled={isApproving === tx.id || !tx.Category}
                          className="p-1.5 rounded bg-green-600/80 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
                          title="Approve Suggestion"
                        >
                          {isApproving === tx.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => handleEditClick(tx)}
                          className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white transition-colors"
                          title="Edit"
                        >
                          <Edit3 size={16} />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredAndSorted.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            No transactions match the filter.
          </div>
        )}
      </div>
    </div>
  );
}
