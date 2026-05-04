import React, { useState } from 'react';
import { Check, X, Edit3, ChevronRight } from 'lucide-react';

interface ReviewQueueProps {
  transactions: any[];
  onApprove: (id: string, category: string, subcategory: string) => Promise<void>;
}

export function ReviewQueue({ transactions, onApprove }: ReviewQueueProps) {
  const pendingTransactions = transactions.filter(tx => tx.status === 'pending_review');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editSubcategory, setEditSubcategory] = useState("");
  const [isApproving, setIsApproving] = useState<string | null>(null);

  if (pendingTransactions.length === 0) return null;

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
      if (!isDirectApprove) {
        setEditingId(null);
      }
    } catch (err) {
      console.error("Failed to approve:", err);
      alert("Failed to approve. See console for details.");
    } finally {
      setIsApproving(null);
    }
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden mb-6">
      <div className="bg-yellow-500/20 border-b border-yellow-500/30 p-4">
        <h3 className="text-yellow-500 font-bold text-lg flex items-center gap-2">
          Review Queue ({pendingTransactions.length})
        </h3>
        <p className="text-slate-300 text-sm mt-1">
          Gemini suggested categories for these imported transactions. Please review and approve them.
        </p>
      </div>

      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 text-sm border-b border-slate-700">
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Description</th>
              <th className="p-3 font-medium">Amount</th>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Subcategory</th>
              <th className="p-3 font-medium w-32 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {pendingTransactions.map(tx => {
              const isEditing = editingId === tx.id;
              
              return (
                <tr key={tx.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-3 text-slate-300 whitespace-nowrap">{tx.Date}</td>
                  <td className="p-3 text-slate-200">{tx.Description}</td>
                  <td className={`p-3 font-medium ${tx.Amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    ${Math.abs(tx.Amount).toFixed(2)}
                  </td>
                  
                  {isEditing ? (
                    <>
                      <td className="p-3">
                        <input
                          type="text"
                          value={editCategory}
                          onChange={e => setEditCategory(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-600 rounded p-1 text-white text-sm"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={editSubcategory}
                          onChange={e => setEditSubcategory(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-600 rounded p-1 text-white text-sm"
                        />
                      </td>
                      <td className="p-3 flex gap-2 justify-center">
                        <button
                          onClick={() => handleApprove(tx, false)}
                          disabled={isApproving === tx.id}
                          className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
                          title="Save & Approve"
                        >
                          <Check size={16} />
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
                          <Check size={16} />
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
      </div>
    </div>
  );
}
