"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
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

  return (
    <div className="animate-fade-up">
      <PageHeader title="Products" subtitle={`${products.length} items in catalog`}>
        <button onClick={openAdd} className="btn btn-primary">
          + Add product
        </button>
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
            return (
              <div
                key={p.id}
                className={`card !p-4 transition hover:shadow-card ${
                  tone.status === "out"
                    ? "ring-1 ring-red-200 dark:ring-red-900/40"
                    : tone.status === "low"
                      ? "ring-1 ring-amber-200 dark:ring-amber-900/40"
                      : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-2xl">
                    {categoryIcon(p.category)}
                  </span>
                  <StockBadge stock={p.stock} min={p.min_stock} />
                </div>
                <h3 className="mt-3 truncate text-sm font-bold">{p.name}</h3>
                <p className="text-[11px] font-medium text-slate-400">
                  {p.category}
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
    </div>
  );
}
