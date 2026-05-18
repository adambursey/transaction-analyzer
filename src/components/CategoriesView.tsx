import React, { useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  AlertTriangle,
  Loader2,
  Save,
  X,
  Check,
  Edit3,
} from 'lucide-react';
import { AddRecurringModal } from './AddRecurringModal';

interface CategoriesViewProps {
  taxonomy: Record<string, string[]>;
  transactions: any[];
  analysis: any;
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
  analysis,
  onUpdate,
  onCategorySelect,
}: CategoriesViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isCategoriesExpanded, setIsCategoriesExpanded] = useState(true);
  const [isRecurringExpanded, setIsRecurringExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recurringTransactions, setRecurringTransactions] = useState<any[]>([]);
  const [isAddRecurringOpen, setIsAddRecurringOpen] = useState(false);
  const [expandedRecurringIds, setExpandedRecurringIds] = useState<Set<string>>(new Set());
  const [editingProjectionId, setEditingProjectionId] = useState<string | null>(null);
  const [editingProjectionValue, setEditingProjectionValue] = useState('');
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null);
  const [editingDescriptionValue, setEditingDescriptionValue] = useState('');
  const [recurringSort, setRecurringSort] = useState<{
    key: 'name' | 'amount';
    dir: 'asc' | 'desc';
  }>({ key: 'amount', dir: 'desc' });

  const fetchRecurring = async () => {
    try {
      const res = await fetch('/api/recurring');
      if (res.ok) {
        const data = await res.json();
        setRecurringTransactions(data.recurring || []);
      }
    } catch (err) {
      console.error('Failed to fetch recurring transactions', err);
    }
  };

  // Fetch recurring transactions on mount
  React.useEffect(() => {
    fetchRecurring();
  }, []);

  const handleArchiveRecurring = async (id: string) => {
    if (!confirm('Are you sure you want to archive this recurring transaction?')) return;
    try {
      const res = await fetch(`/api/recurring/${id}/archive`, { method: 'POST' });
      if (res.ok) {
        fetchRecurring();
      }
    } catch (err) {
      console.error('Failed to archive recurring transaction', err);
    }
  };

  const handleUpdateRecurringField = async (id: string, updates: any) => {
    try {
      const res = await fetch(`/api/recurring/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update recurring transaction');
      setEditingProjectionId(null);
      setEditingDescriptionId(null);
      await fetchRecurring();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSaveRecurring = async (payload: any) => {
    const res = await fetch('/api/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to save recurring transaction');
    fetchRecurring();
  };

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

      {/* Categories Section */}
      <div className="mb-8">
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 cursor-pointer group"
          onClick={() => setIsCategoriesExpanded(!isCategoriesExpanded)}
        >
          <div>
            <h2 className="text-xl font-bold text-slate-900">Categories</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage the categories and subcategories available for transactions.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {isEmpty && isCategoriesExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleInit();
                }}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Auto-build from Transactions
              </button>
            )}
            <button className="p-1 rounded text-slate-400 group-hover:text-slate-600 transition-colors">
              {isCategoriesExpanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {isCategoriesExpanded && !isEmpty && (
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
                                editingSubcategory?.cat === cat &&
                                editingSubcategory?.old === subcat;
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
                                        onKeyDown={(e) =>
                                          e.key === 'Enter' && saveSubcategoryEdit()
                                        }
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

      {/* Recurring Transactions Section */}
      <div className="border-t border-slate-100 pt-8">
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 cursor-pointer group"
          onClick={() => setIsRecurringExpanded(!isRecurringExpanded)}
        >
          <div>
            <h2 className="text-xl font-bold text-slate-900">Recurring Transactions</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage recurring income and expenses for balance forecasting.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-1 rounded text-slate-400 group-hover:text-slate-600 transition-colors">
              {isRecurringExpanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {isRecurringExpanded && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-500">Sort by:</span>
                <select
                  value={`${recurringSort.key}-${recurringSort.dir}`}
                  onChange={(e) => {
                    const [key, dir] = e.target.value.split('-');
                    setRecurringSort({ key: key as any, dir: dir as any });
                  }}
                  className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2"
                >
                  <option value="amount-desc">Amount (Highest to Lowest)</option>
                  <option value="amount-asc">Amount (Lowest to Highest)</option>
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                </select>
              </div>
              <button
                onClick={() => setIsAddRecurringOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Recurring Transaction
              </button>
            </div>

            {recurringTransactions.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-500 bg-slate-50">
                <p>No recurring transactions found. Add one above.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {[...recurringTransactions]
                  .sort((a, b) => {
                    if (recurringSort.key === 'amount') {
                      const valA = a.amountAverage || 0;
                      const valB = b.amountAverage || 0;
                      const isIncomeA = valA >= 0;
                      const isIncomeB = valB >= 0;

                      if (isIncomeA !== isIncomeB) {
                        return recurringSort.dir === 'desc'
                          ? isIncomeA
                            ? -1
                            : 1
                          : isIncomeA
                            ? 1
                            : -1;
                      }

                      const absA = Math.abs(valA);
                      const absB = Math.abs(valB);
                      return recurringSort.dir === 'asc' ? absA - absB : absB - absA;
                    } else {
                      const valA = String(a.description || '').toLowerCase();
                      const valB = String(b.description || '').toLowerCase();
                      if (valA < valB) return recurringSort.dir === 'asc' ? -1 : 1;
                      if (valA > valB) return recurringSort.dir === 'asc' ? 1 : -1;
                      return 0;
                    }
                  })
                  .map((rt) => {
                    const isExpanded = expandedRecurringIds.has(rt.id);
                    return (
                      <div key={rt.id} className="group">
                        <div
                          className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => {
                            const next = new Set(expandedRecurringIds);
                            if (next.has(rt.id)) next.delete(rt.id);
                            else next.add(rt.id);
                            setExpandedRecurringIds(next);
                          }}
                        >
                          <div className="flex items-center gap-4">
                            <button className="text-slate-400 hover:text-slate-600">
                              {isExpanded ? (
                                <ChevronUp className="w-5 h-5" />
                              ) : (
                                <ChevronDown className="w-5 h-5" />
                              )}
                            </button>
                            <div>
                              {editingDescriptionId === rt.id ? (
                                <div className="flex items-center mb-1">
                                  <input
                                    type="text"
                                    value={editingDescriptionValue}
                                    onChange={(e) => setEditingDescriptionValue(e.target.value)}
                                    className="bg-white border border-slate-300 font-semibold text-slate-900 text-sm rounded px-2 py-0.5 focus:ring-blue-500 focus:border-blue-500"
                                    onClick={(e) => e.stopPropagation()}
                                    autoFocus
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdateRecurringField(rt.id, {
                                        description: editingDescriptionValue,
                                      });
                                    }}
                                    className="ml-2 text-blue-600 hover:text-blue-800"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingDescriptionId(null);
                                    }}
                                    className="ml-1 text-slate-400 hover:text-slate-600"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center group/title">
                                  <h3 className="font-semibold text-slate-900">{rt.description}</h3>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingDescriptionValue(rt.description || '');
                                      setEditingDescriptionId(rt.id);
                                    }}
                                    className="ml-2 text-slate-400 hover:text-blue-600 opacity-0 group-hover/title:opacity-100 transition-opacity"
                                    title="Edit Name"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                              <div className="flex items-center text-sm text-slate-500 capitalize">
                                <span>{rt.frequency}</span>
                                {editingProjectionId === rt.id ? (
                                  <div className="flex items-center ml-2">
                                    <span className="font-medium text-slate-400 mx-1">•</span>
                                    <input
                                      type="text"
                                      value={editingProjectionValue}
                                      onChange={(e) => setEditingProjectionValue(e.target.value)}
                                      className="bg-white border border-slate-300 text-slate-900 text-xs rounded px-2 py-0.5 ml-1 focus:ring-blue-500 focus:border-blue-500"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateRecurringField(rt.id, {
                                          projectedOccurrence: editingProjectionValue,
                                        });
                                      }}
                                      className="ml-2 text-blue-600 hover:text-blue-800"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingProjectionId(null);
                                      }}
                                      className="ml-1 text-slate-400 hover:text-slate-600"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    {rt.projectedOccurrence &&
                                      rt.projectedOccurrence !== 'Unknown' && (
                                        <>
                                          <span className="font-medium text-slate-400 mx-1">•</span>
                                          <span className="font-medium text-slate-600 ml-1">
                                            {rt.projectedOccurrence}
                                          </span>
                                        </>
                                      )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingProjectionValue(rt.projectedOccurrence || '');
                                        setEditingProjectionId(rt.id);
                                      }}
                                      className="ml-2 text-slate-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Edit Projection"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <p
                                className={`font-mono font-semibold ${rt.amountAverage < 0 ? 'text-slate-900' : 'text-emerald-600'}`}
                              >
                                $
                                {Math.abs(rt.amountAverage).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </p>
                              <p className="text-xs text-slate-500">avg per occurrence</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleArchiveRecurring(rt.id);
                              }}
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Archive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 pl-16">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                              Example Transactions ({rt.exampleTransactionIds?.length || 0})
                            </h4>
                            {rt.exampleTransactionIds && rt.exampleTransactionIds.length > 0 ? (
                              <ul className="space-y-2">
                                {rt.exampleTransactionIds
                                  .map((id: string) => ({
                                    id,
                                    tx: transactions.find((t) => t.id === id),
                                  }))
                                  .sort((a: any, b: any) => {
                                    if (!a.tx && !b.tx) return 0;
                                    if (!a.tx) return 1;
                                    if (!b.tx) return -1;
                                    const dateA = new Date(a.tx._date || a.tx.Date).getTime();
                                    const dateB = new Date(b.tx._date || b.tx.Date).getTime();
                                    return dateB - dateA; // Most to least recent
                                  })
                                  .map(({ id, tx }: any) => {
                                    if (!tx)
                                      return (
                                        <li key={id} className="text-sm text-slate-400">
                                          Transaction {id} not found
                                        </li>
                                      );
                                    const d = new Date(tx._date || tx.Date);
                                    const dateStr = !isNaN(d.getTime())
                                      ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
                                      : String(tx.Date);
                                    return (
                                      <li
                                        key={id}
                                        className="flex justify-between items-center text-sm bg-white p-2 rounded border border-slate-200"
                                      >
                                        <span className="text-slate-600">
                                          {dateStr} - {tx.Description}
                                        </span>
                                        <span
                                          className={`font-mono ${tx._isExpense ? 'text-slate-900' : 'text-emerald-600'}`}
                                        >
                                          ${tx._parsedAmount?.toFixed(2)}
                                        </span>
                                      </li>
                                    );
                                  })}
                              </ul>
                            ) : (
                              <p className="text-sm text-slate-500">No examples selected.</p>
                            )}

                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 mt-6">
                              Matched Occurrences
                            </h4>
                            <p className="text-sm text-slate-500 italic">
                              Matching engine coming soon...
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </div>

      <AddRecurringModal
        isOpen={isAddRecurringOpen}
        onClose={() => setIsAddRecurringOpen(false)}
        transactions={transactions}
        analysis={analysis}
        taxonomy={taxonomy}
        onSave={handleSaveRecurring}
      />
    </div>
  );
}
