import React, { useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Save,
  X,
} from 'lucide-react';

interface CategoriesViewProps {
  taxonomy: Record<string, string[]>;
  transactions: any[];
  onUpdate: () => void;
  onCategorySelect?: (cat: string, subcat?: string) => void;
}

/**
 * CategoriesView Component.
 * Provides a UI for managing the global category and subcategory taxonomy.
 * Allows adding, editing, and deleting categories and subcategories,
 * and ensures safe deletion by checking for existing usage.
 *
 * @param props.taxonomy - The current taxonomy mapping (Category -> Subcategories array).
 * @param props.transactions - All transactions to show usage counts.
 * @param props.onUpdate - Callback when taxonomy is successfully modified.
 * @param props.onCategorySelect - Optional callback when a category is clicked (used for filtering).
 */
export function CategoriesView({
  taxonomy,
  transactions,
  onUpdate,
  onCategorySelect,
}: CategoriesViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingCategory, setEditingCategory] = useState<{ old: string; new: string } | null>(null);
  const [editingSubcategory, setEditingSubcategory] = useState<{
    cat: string;
    old: string;
    new: string;
  } | null>(null);

  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState<{ cat: string; val: string } | null>(null);

  const toggleExpand = (cat: string) => {
    const next = new Set(expanded);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpanded(next);
  };

  const handleSaveTaxonomy = async (newTaxonomy: Record<string, string[]>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/taxonomy/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomy: newTaxonomy }),
      });
      if (!res.ok) throw new Error('Failed to save taxonomy');
      onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkUsage = async (category: string, subcategory?: string) => {
    const res = await fetch('/api/taxonomy/check-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, subcategory }),
    });
    const data = await res.json();
    return data.inUse;
  };

  const handleDeleteCategory = async (cat: string) => {
    setLoading(true);
    try {
      // Prevent deleting a category if it is currently assigned to any transactions
      const inUse = await checkUsage(cat);
      if (inUse) {
        setError(`Cannot delete "${cat}" because it is assigned to existing transactions.`);
        return;
      }

      // Create a copy of the taxonomy, remove the category, and save
      const nextTax = { ...taxonomy };
      delete nextTax[cat];
      await handleSaveTaxonomy(nextTax);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubcategory = async (cat: string, subcat: string) => {
    setLoading(true);
    try {
      // Prevent deleting a subcategory if it is currently assigned to any transactions
      const inUse = await checkUsage(cat, subcat);
      if (inUse) {
        setError(
          `Cannot delete "${subcat}" under "${cat}" because it is assigned to existing transactions.`
        );
        return;
      }

      // Filter out the deleted subcategory and save
      const nextTax = { ...taxonomy };
      nextTax[cat] = nextTax[cat].filter((s) => s !== subcat);
      await handleSaveTaxonomy(nextTax);
    } finally {
      setLoading(false);
    }
  };

  const handleInit = async () => {
    if (!confirm('This will scan all transactions to build the taxonomy. Continue?')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/taxonomy/init', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to init taxonomy');
      onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveCategoryEdit = async () => {
    if (!editingCategory || !editingCategory.new.trim()) return;
    const { old, new: newName } = editingCategory;
    if (old === newName) {
      setEditingCategory(null);
      return;
    }
    if (taxonomy[newName]) {
      setError('Category already exists.');
      return;
    }

    const nextTax = { ...taxonomy };
    nextTax[newName] = nextTax[old];
    delete nextTax[old];
    await handleSaveTaxonomy(nextTax);
    setEditingCategory(null);
  };

  const saveSubcategoryEdit = async () => {
    if (!editingSubcategory || !editingSubcategory.new.trim()) return;
    const { cat, old, new: newName } = editingSubcategory;
    if (old === newName) {
      setEditingSubcategory(null);
      return;
    }
    if (taxonomy[cat].includes(newName)) {
      setError('Subcategory already exists.');
      return;
    }

    const nextTax = { ...taxonomy };
    nextTax[cat] = nextTax[cat].map((s) => (s === old ? newName : s)).sort();
    await handleSaveTaxonomy(nextTax);
    setEditingSubcategory(null);
  };

  const addNewCategory = async () => {
    const val = newCategory.trim();
    if (!val) return;
    if (taxonomy[val]) {
      setError('Category already exists.');
      return;
    }

    const nextTax = { ...taxonomy };
    nextTax[val] = [];
    await handleSaveTaxonomy(nextTax);
    setNewCategory('');
  };

  const addNewSubcategory = async (cat: string) => {
    if (!newSubcategory || !newSubcategory.val.trim()) return;
    const val = newSubcategory.val.trim();
    if (taxonomy[cat].includes(val)) {
      setError('Subcategory already exists.');
      return;
    }

    const nextTax = { ...taxonomy };
    nextTax[cat] = [...nextTax[cat], val].sort();
    await handleSaveTaxonomy(nextTax);
    setNewSubcategory(null);
  };

  const isEmpty = Object.keys(taxonomy).length === 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Category Taxonomy Management</h2>
          <p className="text-sm text-slate-500 mt-1">
            Manage the categories and subcategories available for transactions.
          </p>
        </div>
        {isEmpty && (
          <button
            onClick={handleInit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Auto-build from Transactions
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 border border-red-100">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm">{error}</p>
          </div>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!isEmpty && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="New Category Name..."
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && addNewCategory()}
            />
            <button
              onClick={addNewCategory}
              disabled={!newCategory.trim() || loading}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              Add Category
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {Object.keys(taxonomy)
              .sort()
              .map((cat) => {
                const isExpanded = expanded.has(cat);
                const isEditingCat = editingCategory?.old === cat;

                return (
                  <div key={cat} className="bg-white">
                    <div className="flex items-center gap-3 p-4 hover:bg-slate-50 group">
                      <button
                        onClick={() => toggleExpand(cat)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-400"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>

                      {isEditingCat ? (
                        <div className="flex-1 flex gap-2">
                          <input
                            autoFocus
                            value={editingCategory.new}
                            onChange={(e) =>
                              setEditingCategory({ ...editingCategory, new: e.target.value })
                            }
                            onKeyDown={(e) => e.key === 'Enter' && saveCategoryEdit()}
                            className="px-2 py-1 border rounded text-sm flex-1"
                          />
                          <button onClick={saveCategoryEdit} className="text-green-600 p-1">
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingCategory(null)}
                            className="text-slate-400 p-1"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`flex-1 font-medium text-slate-900 flex items-center gap-2 ${onCategorySelect ? 'cursor-pointer hover:text-blue-600' : ''}`}
                          onClick={() => onCategorySelect && onCategorySelect(cat)}
                        >
                          {cat}
                          <span
                            className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"
                            title="Number of transactions"
                          >
                            {transactions.filter((t) => t._category === cat).length} tx
                          </span>
                        </div>
                      )}

                      {!isEditingCat && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditingCategory({ old: cat, new: cat })}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(cat)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50 pl-12 pr-4 py-3 border-t border-slate-100">
                        <ul className="space-y-1">
                          {transactions.filter((t) => t._category === cat && !t._subcategory)
                            .length > 0 && (
                            <li className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-100 rounded group/sub">
                              <span
                                className={`flex-1 text-sm text-slate-500 italic ${onCategorySelect ? 'cursor-pointer hover:text-blue-600' : ''}`}
                                onClick={() => onCategorySelect && onCategorySelect(cat, '')}
                              >
                                No Subcategory
                              </span>
                            </li>
                          )}
                          {taxonomy[cat].map((subcat) => {
                            const isEditingSub =
                              editingSubcategory?.cat === cat && editingSubcategory?.old === subcat;
                            return (
                              <li
                                key={subcat}
                                className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-100 rounded group/sub"
                              >
                                {isEditingSub ? (
                                  <div className="flex-1 flex gap-2">
                                    <input
                                      autoFocus
                                      value={editingSubcategory.new}
                                      onChange={(e) =>
                                        setEditingSubcategory({
                                          ...editingSubcategory,
                                          new: e.target.value,
                                        })
                                      }
                                      onKeyDown={(e) => e.key === 'Enter' && saveSubcategoryEdit()}
                                      className="px-2 py-1 border rounded text-sm flex-1"
                                    />
                                    <button
                                      onClick={saveSubcategoryEdit}
                                      className="text-green-600 p-1"
                                    >
                                      <Save className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => setEditingSubcategory(null)}
                                      className="text-slate-400 p-1"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span
                                      className={`flex-1 text-sm text-slate-600 ${onCategorySelect ? 'cursor-pointer hover:text-blue-600' : ''}`}
                                      onClick={() =>
                                        onCategorySelect && onCategorySelect(cat, subcat)
                                      }
                                    >
                                      {subcat}
                                    </span>
                                    <div className="flex items-center gap-1 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                                      <button
                                        onClick={() =>
                                          setEditingSubcategory({ cat, old: subcat, new: subcat })
                                        }
                                        className="p-1 text-slate-400 hover:text-blue-600 rounded"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteSubcategory(cat, subcat)}
                                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </li>
                            );
                          })}

                          {newSubcategory?.cat === cat ? (
                            <li className="flex items-center gap-2 py-1.5 px-2 mt-2">
                              <input
                                autoFocus
                                placeholder="Subcategory name..."
                                value={newSubcategory.val}
                                onChange={(e) =>
                                  setNewSubcategory({ ...newSubcategory, val: e.target.value })
                                }
                                onKeyDown={(e) => e.key === 'Enter' && addNewSubcategory(cat)}
                                className="px-2 py-1 border rounded text-sm flex-1"
                              />
                              <button
                                onClick={() => addNewSubcategory(cat)}
                                className="text-green-600 p-1"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setNewSubcategory(null)}
                                className="text-slate-400 p-1"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </li>
                          ) : (
                            <li className="mt-2">
                              <button
                                onClick={() => setNewSubcategory({ cat, val: '' })}
                                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 px-2 py-1"
                              >
                                <Plus className="w-3.5 h-3.5" /> Add Subcategory
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
