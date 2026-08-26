"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useStock } from "@/hooks/useStock";
import { categoryIcon, formatMoney } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { StockBadge, stockTone } from "@/components/ui/StockBadge";
import { isLowStock, sortByStockPriority } from "@/lib/stock";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { Product } from "@/lib/types";

interface FormState {
  name: string;
  price: string;
  stock: string;
  category: string;
  sku: string;
  barcode: string;
  min_stock: string;
}

const emptyForm: FormState = {
  name: "",
  price: "",
  stock: "",
  category: "",
  sku: "",
  barcode: "",
  min_stock: "",
};

type StockFilter = "all" | "low" | "out";

export default function ProductsPage() {
  const { products } = useStock();
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const canManage = user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [restocking, setRestocking] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState("");
  const [restockSaving, setRestockSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const masterRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const lowCount = useMemo(
    () => products.filter((p) => isLowStock(p.stock, p.min_stock)).length,
    [products]
  );
  const outCount = useMemo(
    () => products.filter((p) => p.stock <= 0).length,
    [products]
  );

  const visible = useMemo(() => {
    const matched = products.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        p.name.toLowerCase().includes(search.toLowerCase())
    );
    if (stockFilter === "low") return matched.filter((p) => isLowStock(p.stock, p.min_stock));
    if (stockFilter === "out") return matched.filter((p) => p.stock <= 0);
    return matched;
  }, [products, category, search, stockFilter]);

  const sorted = useMemo(() => sortByStockPriority(visible), [visible]);

  const visibleIds = useMemo(() => sorted.map((p) => p.id), [sorted]);

  const selectedCount = selectedIds.size;

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;

  useEffect(() => {
    const el = masterRef.current;
    if (el) {
      el.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected, selectedCount]);

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [allVisibleSelected, visibleIds]);

  const toggleProduct = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      price: String(p.price),
      stock: String(p.stock),
      category: p.category,
      sku: p.sku ?? "",
      barcode: p.barcode ?? "",
      min_stock: p.min_stock ? String(p.min_stock) : "",
    });
    setFormError("");
    setFormOpen(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const payload = {
      name: form.name.trim(),
      price: parseFloat(form.price) || 0,
      stock: parseInt(form.stock, 10) || 0,
      category: form.category.trim() || "General",
      sku: form.sku.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      min_stock: parseInt(form.min_stock, 10) || 0,
    };
    if (!payload.name) {
      setFormError("Product name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.products.update(editing.id, payload);
        toast(`"${payload.name}" updated`, "success");
      } else {
        await api.products.create(payload);
        toast(`"${payload.name}" added`, "success");
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function openRestock(p: Product) {
    setRestocking(p);
    setRestockQty("");
  }

  async function confirmRestock() {
    if (!restocking) return;
    const qty = parseInt(restockQty, 10);
    if (!qty || qty <= 0) {
      toast("Enter a quantity to add", "error");
      return;
    }
    setRestockSaving(true);
    try {
      await api.products.update(restocking.id, {
        stock: (restocking.stock || 0) + qty,
      });
      toast(`Added ${qty} units to "${restocking.name}"`, "success");
      setRestocking(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Restock failed", "error");
    } finally {
      setRestockSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.products.remove(deleting.id);
      toast(`"${deleting.name}" deleted`, "success");
      setDeleting(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
      setDeleting(null);
    }
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await api.products.bulkRemove(ids);
      toast(`${result.deleted} product${result.deleted !== 1 ? "s" : ""} deleted`, "success");
      clearSelection();
      setShowBulkDeleteConfirm(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Bulk delete failed", "error");
    } finally {
      setBulkDeleting(false);
    }
  }

  function handlePrintBarcode() {
    const selected = sorted.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    const payload = selected.map((p) => ({ product: p, qty: 1 }));
    try {
      sessionStorage.setItem("barcode-bulk-items", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    router.push("/barcodes");
  }

  function handleExportSelected() {
    const selected = sorted.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    const header = ["Name", "SKU", "Barcode", "Category", "Price", "Stock", "Min Stock"];
    const rows = selected.map((p) => [
      p.name,
      p.sku ?? "",
      p.barcode ?? "",
      p.category,
      String(p.price),
      String(p.stock),
      String(p.min_stock ?? ""),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${selected.length} product${selected.length !== 1 ? "s" : ""} exported`, "success");
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Products" subtitle={`${products.length} items in catalog`}>
        {canManage && (
          <button onClick={openAdd} className="btn btn-primary">
            + Add product
          </button>
        )}
      </PageHeader>

      {lowCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
          <span className="text-xl">⚠️</span>
          <p className="flex-1 text-sm font-semibold text-amber-800 dark:text-amber-300">
            {lowCount} product{lowCount === 1 ? " is" : "s are"} low on stock
            {outCount > 0 && (
              <span className="font-normal">
                {" "}
                (including {outCount} sold out)
              </span>
            )}
            .
          </p>
          <button
            onClick={() => setStockFilter(stockFilter === "low" ? "all" : "low")}
            className="rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-amber-600"
          >
            {stockFilter === "low" ? "Show all" : "Show low stock"}
          </button>
        </div>
      )}

      <div className="toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="input sm:max-w-xs"
        />
        <div className="flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { key: "all", label: "All" },
              { key: "low", label: `Low (${lowCount})` },
              { key: "out", label: `Sold out (${outCount})` },
            ] as { key: StockFilter; label: string }[]
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setStockFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                stockFilter === f.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                category === c
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              ref={masterRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              aria-label="Select all visible products"
            />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Select All
            </span>
          </label>
          <span className="text-sm text-slate-500">
            {selectedCount > 0
              ? `${selectedCount} selected`
              : `${visibleIds.length} products`}
          </span>
          {selectedCount > 0 && (
            <button
              onClick={clearSelection}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              Clear Selection
            </button>
          )}
        </div>
      )}

      {selectedCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
            ☑ {selectedCount} selected
          </span>
          <button
            onClick={clearSelection}
            className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
          >
            Clear
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={handlePrintBarcode}
              className="rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              🏷️ Print Barcode
            </button>
            <button
              onClick={handleExportSelected}
              className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
            >
              📥 Export
            </button>
            {canManage && (
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-red-600"
              >
                🗑️ Delete
              </button>
            )}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No products found"
          hint="Try another search, or add a new product."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((p) => {
            const tone = stockTone(p.stock, p.min_stock);
            const low = tone.status !== "ok";
            const isSelected = selectedIds.has(p.id);
            return (
              <div
                key={p.id}
                className={`card !p-4 transition hover:shadow-card ${
                  isSelected
                    ? "ring-2 ring-emerald-400 dark:ring-emerald-500"
                    : tone.status === "out"
                      ? "ring-1 ring-red-200 dark:ring-red-900/40"
                      : tone.status === "low"
                        ? "ring-1 ring-amber-200 dark:ring-amber-900/40"
                        : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleProduct(p.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      aria-label={`Select ${p.name}`}
                    />
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-2xl">
                      {categoryIcon(p.category)}
                    </span>
                  </div>
                  <StockBadge stock={p.stock} min={p.min_stock} />
                </div>
                <h3 className="mt-3 truncate text-sm font-bold">{p.name}</h3>
                <p className="text-[11px] font-medium text-slate-400">
                  {p.sku && `SKU: ${p.sku}`}
                  {p.sku && p.category && " · "}
                  {!p.sku && p.category}
                  {p.min_stock ? ` · alert below ${p.min_stock}` : ""}
                </p>
                <p className="mt-2 text-base font-bold text-emerald-600">
                  {formatMoney(p.price)}
                </p>
                {low && (
                  <button
                    onClick={() => openRestock(p)}
                    className="mt-2 w-full rounded-lg bg-amber-500 py-1.5 text-xs font-bold text-white transition hover:bg-amber-600"
                  >
                    ⬆ Restock
                  </button>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => openEdit(p)}
                    className="btn btn-sm btn-ghost flex-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting(p)}
                    className="btn btn-sm btn-danger-soft flex-1"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit product" : "Add product"}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="label">Name *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Samsung Galaxy A15"
              autoFocus
              className="input"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Price (LKR)</label>
              <input
                name="price"
                type="number"
                step="any"
                min="0"
                value={form.price}
                onChange={handleChange}
                placeholder="0.00"
                className="input"
              />
            </div>
            <div>
              <label className="label">Stock</label>
              <input
                name="stock"
                type="number"
                min="0"
                value={form.stock}
                onChange={handleChange}
                placeholder="0"
                className="input"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Low-stock alert below (units)</label>
              <input
                name="min_stock"
                type="number"
                min="0"
                value={form.min_stock}
                onChange={handleChange}
                placeholder="e.g. 10"
                className="input"
              />
              <p className="hint">Badge turns orange when stock drops below this.</p>
            </div>
            <div>
              <label className="label">SKU</label>
              <input
                name="sku"
                value={form.sku}
                onChange={handleChange}
                placeholder="e.g. GAL-A15-128"
                className="input"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Barcode</label>
              <input
                name="barcode"
                value={form.barcode}
                onChange={handleChange}
                placeholder="Scan barcode"
                className="input font-mono"
              />
            </div>
            <div>
              <label className="label">Category</label>
              <input
                name="category"
                value={form.category}
                onChange={handleChange}
                placeholder="General"
                className="input"
              />
            </div>
          </div>
          {formError && (
            <p className="text-xs font-semibold text-red-600">{formError}</p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary w-full"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add product"}
          </button>
        </form>
      </Modal>

      <Modal
        open={!!restocking}
        onClose={() => setRestocking(null)}
        title={`Restock — ${restocking?.name ?? ""}`}
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
            <span className="text-sm font-medium text-slate-500">Current stock</span>
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {restocking?.stock ?? 0}
            </span>
          </div>
          <div>
            <label className="label">Add units</label>
            <input
              type="number"
              min="1"
              autoFocus
              value={restockQty}
              onChange={(e) => setRestockQty(e.target.value)}
              placeholder="e.g. 10"
              className="input text-xl font-bold"
            />
          </div>
          <button
            onClick={confirmRestock}
            disabled={restockSaving}
            className="btn btn-primary w-full"
          >
            {restockSaving ? "Saving…" : "Add stock"}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete product"
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-100 text-2xl">
            🗑️
          </span>
          <p className="mt-3 text-sm text-slate-600">
            Delete{" "}
            <span className="font-bold text-slate-900">{deleting?.name}</span>?
            This cannot be undone.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setDeleting(null)}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            className="btn btn-danger"
          >
            Delete
          </button>
        </div>
      </Modal>

      <Modal
        open={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        title="Delete Selected Products"
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-100 text-2xl">
            🗑️
          </span>
          <p className="mt-3 text-sm text-slate-600">
            <span className="font-bold text-slate-900">{selectedCount} product{selectedCount !== 1 ? "s" : ""}</span>{" "}
            {selectedCount === 1 ? "is" : "are"} selected.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            This action may affect inventory and historical transactions.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowBulkDeleteConfirm(false)}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={confirmBulkDelete}
            disabled={bulkDeleting}
            className="btn btn-danger"
          >
            {bulkDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
