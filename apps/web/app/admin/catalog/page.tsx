'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Tags,
  Plus,
  Edit2,
  Merge,
  XCircle,
  ChevronRight,
  Search,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface Category {
  categoryId: string;
  name: string;
  status: 'active' | 'inactive';
  productCount: number;
  activeSellers: number;
  createdAt: string;
  updatedAt: string;
}

interface CategoryAlias {
  alias: string;
  language: string;
  canonicalName: string;
  categoryId: string;
  createdAt: string;
}

interface MergePreview {
  affectedProducts: number;
  affectedSellers: number;
  sourceName: string;
  targetName: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function CatalogPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  // Form states
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [aliases, setAliases] = useState<CategoryAlias[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [newAliasLang, setNewAliasLang] = useState('en');
  const [submitting, setSubmitting] = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/v1/admin/catalog/categories`);
      if (!res.ok) throw new Error('Failed to fetch categories');
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const activeCategories = categories.filter(c => c.status === 'active');
  const filtered = activeCategories.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  // ── CRUD Handlers ──

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/catalog/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to create category');
      setNewCategoryName('');
      setShowAddModal(false);
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRename = async () => {
    if (!selectedCategory || !renameName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/catalog/categories/${selectedCategory.categoryId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: renameName.trim() }),
        },
      );
      if (!res.ok) throw new Error('Failed to rename category');
      setShowRenameModal(false);
      setSelectedCategory(null);
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (categoryId: string) => {
    if (!confirm('Deactivate this category? It will be hidden from customers but products are preserved.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/catalog/categories/${categoryId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to deactivate');
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate');
    }
  };

  const handleFetchMergePreview = async () => {
    if (!mergeSourceId || !mergeTargetId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/catalog/categories/merge-preview?source=${mergeSourceId}&target=${mergeTargetId}`,
      );
      if (!res.ok) throw new Error('Failed to fetch preview');
      const data = await res.json();
      setMergePreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview');
    }
  };

  const handleMerge = async () => {
    if (!mergeSourceId || !mergeTargetId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/catalog/categories/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: mergeSourceId, targetId: mergeTargetId }),
      });
      if (!res.ok) throw new Error('Failed to merge');
      setShowMergeModal(false);
      setMergePreview(null);
      setMergeSourceId('');
      setMergeTargetId('');
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenAliases = async (category: Category) => {
    setSelectedCategory(category);
    setShowAliasModal(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/catalog/categories/${category.categoryId}/aliases`,
      );
      if (!res.ok) throw new Error('Failed to fetch aliases');
      const data = await res.json();
      setAliases(data.aliases || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load aliases');
    }
  };

  const handleAddAlias = async () => {
    if (!selectedCategory || !newAlias.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/catalog/categories/${selectedCategory.categoryId}/aliases`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias: newAlias.trim(), language: newAliasLang }),
        },
      );
      if (!res.ok) throw new Error('Failed to add alias');
      setNewAlias('');
      // Refresh aliases
      await handleOpenAliases(selectedCategory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add alias');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAlias = async (alias: string) => {
    if (!selectedCategory) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/catalog/categories/${selectedCategory.categoryId}/aliases/${alias}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to delete alias');
      await handleOpenAliases(selectedCategory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete alias');
    }
  };

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Global Catalog Manager</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage product categories, aliases, and merge operations.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowMergeModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Merge className="h-4 w-4" />
            Merge
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add Category
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search categories..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Category List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <Tags className="h-12 w-12 text-gray-300" />
          <h2 className="mt-4 text-lg font-semibold text-gray-700">No categories found</h2>
          <p className="mt-1 text-sm text-gray-500">Add your first category to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Category Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Product Count</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Active Sellers</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map(cat => (
                <tr key={cat.categoryId} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{cat.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{cat.productCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{cat.activeSellers}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setSelectedCategory(cat); setRenameName(cat.name); setShowRenameModal(true); }}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Rename"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleOpenAliases(cat)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Manage Aliases"
                      >
                        <Tags className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeactivate(cat.categoryId)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                        title="Deactivate"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Category Modal */}
      {showAddModal && (
        <Modal title="Add Category" onClose={() => setShowAddModal(false)}>
          <input
            type="text"
            placeholder="Category name"
            value={newCategoryName}
            onChange={e => setNewCategoryName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowAddModal(false)} className="rounded-lg border px-3 py-2 text-sm">Cancel</button>
            <button onClick={handleAddCategory} disabled={submitting} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}

      {/* Rename Modal */}
      {showRenameModal && selectedCategory && (
        <Modal title={`Rename "${selectedCategory.name}"`} onClose={() => setShowRenameModal(false)}>
          <input
            type="text"
            placeholder="New name"
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-2 text-xs text-gray-500">This will update all products referencing this category.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowRenameModal(false)} className="rounded-lg border px-3 py-2 text-sm">Cancel</button>
            <button onClick={handleRename} disabled={submitting} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </Modal>
      )}

      {/* Merge Modal */}
      {showMergeModal && (
        <Modal title="Merge Categories" onClose={() => { setShowMergeModal(false); setMergePreview(null); }}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Source (will be merged into target)</label>
              <select
                value={mergeSourceId}
                onChange={e => { setMergeSourceId(e.target.value); setMergePreview(null); }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select source...</option>
                {activeCategories.map(c => (
                  <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Target (will absorb source)</label>
              <select
                value={mergeTargetId}
                onChange={e => { setMergeTargetId(e.target.value); setMergePreview(null); }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select target...</option>
                {activeCategories.filter(c => c.categoryId !== mergeSourceId).map(c => (
                  <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
                ))}
              </select>
            </div>

            {mergeSourceId && mergeTargetId && !mergePreview && (
              <button onClick={handleFetchMergePreview} className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100">
                Preview Impact
              </button>
            )}

            {mergePreview && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
                <p className="font-medium text-amber-800">
                  Merging &ldquo;{mergePreview.sourceName}&rdquo; into &ldquo;{mergePreview.targetName}&rdquo;
                </p>
                <p className="mt-1 text-amber-700">
                  Will affect <span className="font-semibold">{mergePreview.affectedProducts}</span> products from{' '}
                  <span className="font-semibold">{mergePreview.affectedSellers}</span> sellers.
                </p>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setShowMergeModal(false); setMergePreview(null); }} className="rounded-lg border px-3 py-2 text-sm">Cancel</button>
            <button
              onClick={handleMerge}
              disabled={submitting || !mergePreview}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submitting ? 'Merging...' : 'Confirm Merge'}
            </button>
          </div>
        </Modal>
      )}

      {/* Alias Management Modal */}
      {showAliasModal && selectedCategory && (
        <Modal title={`Aliases for "${selectedCategory.name}"`} onClose={() => { setShowAliasModal(false); setAliases([]); }}>
          <div className="space-y-3">
            {aliases.length === 0 ? (
              <p className="text-sm text-gray-500">No aliases configured.</p>
            ) : (
              <div className="space-y-1">
                {aliases.map(a => (
                  <div key={a.alias} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <div>
                      <span className="text-sm font-medium text-gray-800">{a.alias}</span>
                      <span className="ml-2 text-xs text-gray-400">({a.language})</span>
                    </div>
                    <button
                      onClick={() => handleDeleteAlias(a.alias)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New alias (e.g., किराना)"
                value={newAlias}
                onChange={e => setNewAlias(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <select
                value={newAliasLang}
                onChange={e => setNewAliasLang(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
              >
                <option value="en">EN</option>
                <option value="hi">HI</option>
                <option value="ta">TA</option>
                <option value="te">TE</option>
                <option value="mr">MR</option>
                <option value="bn">BN</option>
                <option value="gu">GU</option>
                <option value="kn">KN</option>
              </select>
              <button
                onClick={handleAddAlias}
                disabled={submitting || !newAlias.trim()}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Modal Component ──

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
