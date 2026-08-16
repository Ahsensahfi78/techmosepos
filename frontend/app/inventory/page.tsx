"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { Product, ReorderItem, StockAdjustment } from "@/lib/types";

const REASONS = ["stock_count", "damage", "correction", "write_off", "found_stock"];

export default function InventoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";
  const canView = canManage || user?.role === "accountant" || user?.role === "cashier";

  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [reorder, setReorder] = useState<ReorderItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ reason: "stock_count", note: "" });
  const [lines, setLines] = useState<{ product_id: string; qty_delta: string }[]>([
    { product_id: "", qty_delta: "" },
  ]);

  const load = useCallback(async () => {
    try {
      const data = await api.inventory.adjustments({ page_size: 100 });
      setAdjustments(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReorder = useCallback(async () => {
    try {
      setReorder(await api.reorder.list());
    } catch {
      /* ignore */
    }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      setProducts(await api.products.list());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    loadProducts();
    loadReorder();
  }, [load, loadProducts, loadReorder]);

  const impact = useMemo(() => {
    let delta = 0;
    lines.forEach((l) => {
      if (l.qty_delta) delta += Number(l.qty_delta) || 0;
    });
    return delta;
  }, [lines]);

  function openModal() {
    setForm({ reason: "stock_count", note: "" });
    setLines([{ product_id: "", qty_delta: "" }]);
    setFormError("");
    setModalOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const items = lines
      .filter((l) => l.product_id && l.qty_delta)
      .map((l) => ({
        product_id: Number(l.product_id),
        qty_delta: Number(l.qty_delta),
      }));
    if (items.length === 0) {
      setFormError("Add at least one product with a non-zero quantity.");
      return;
    }
    setSubmitting(true);
    try {
      await api.inventory.createAdjustment({
        reason: form.reason,
        note: form.note || undefined,
        items,
      });
      toast("Stock adjusted", "success");
      setModalOpen(false);
      load();
      loadProducts();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canView) {
    return (
      <EmptyState
        icon="🚫"
        title="No access"
        hint="You do not have permission to view inventory."
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Inventory adjustments"
        subtitle="Correct stock levels after counts, damage or losses"
      >
        {canManage && (
          <button onClick={openModal} className="btn btn-primary">
            + New adjustment
          </button>
        )}
      </PageHeader>

      {reorder.length > 0 && (
        <section className="card mb-5">
          <div className="card-header">
            <h2 className="card-title flex items-center gap-2">
              <span className="relative">
                ⚠️
                <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {reorder.length}
                </span>
              </span>
              Reorder alert
            </h2>
            <p className="text-[11px] font-semibold text-slate-400">
              Below restock threshold
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">In stock</th>
                  <th className="text-right">Threshold</th>
                  <th className="text-right">Suggested order</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map((r) => (
                  <tr
                    key={r.product_id}
                    className="hover:bg-red-50/40"
                  >
                    <td className="font-bold text-slate-800">{r.name}</td>
                    <td className="text-right">
                      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-600">
                        {r.stock}
                      </span>
                    </td>
                    <td className="text-right text-xs text-slate-500">
                      {r.threshold}
                    </td>
                    <td className="text-right font-bold text-emerald-600">
                      {r.suggested_qty} units
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="card overflow-hidden !p-0">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : adjustments.length === 0 ? (
          <EmptyState
            icon="🧮"
            title="No adjustments yet"
            hint={canManage ? "Create an adjustment to fix stock levels." : "No adjustments yet."}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {adjustments.map((a) => (
              <div key={a.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{a.reference}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(a.created_at).toLocaleString()} · by {a.created_by_name || "—"}
                      {a.warehouse_name ? ` · ${a.warehouse_name}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold capitalize text-slate-600">
                    {a.reason}
                  </span>
                </div>
                {a.note && <p className="mt-1 text-xs text-slate-500">{a.note}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.items.map((i) => (
                    <span
                      key={i.id}
                      className="rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
                    >
                      {i.product_name}{" "}
                      <span
                        className={`font-bold ${
                          i.qty_delta > 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {i.qty_delta > 0 ? "+" : ""}
                        {i.qty_delta}
                      </span>{" "}
                      <span className="text-slate-400">
                        ({i.previous_stock} → {i.new_stock})
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New stock adjustment"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Reason</label>
              <select
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                className="select"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Note</label>
              <input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Optional"
                className="input"
              />
            </div>
          </div>

          <div className="card overflow-hidden !p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-700">Products</p>
              <button
                type="button"
                onClick={() => setLines((l) => [...l, { product_id: "", qty_delta: "" }])}
                className="btn btn-sm btn-primary"
              >
                + Add line
              </button>
            </div>
            {lines.map((line, idx) => {
              const product = products.find((p) => String(p.id) === line.product_id);
              return (
                <div
                  key={idx}
                  className="grid grid-cols-12 items-center gap-2 border-b border-slate-50 px-3 py-2 last:border-0"
                >
                  <select
                    value={line.product_id}
                    onChange={(e) =>
                      setLines((l) =>
                        l.map((x, i) => (i === idx ? { ...x, product_id: e.target.value } : x))
                      )
                    }
                    className="select col-span-7 text-xs"
                  >
                    <option value="">Select product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (stock {p.stock})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={line.qty_delta}
                    onChange={(e) =>
                      setLines((l) =>
                        l.map((x, i) => (i === idx ? { ...x, qty_delta: e.target.value } : x))
                      )
                    }
                    placeholder={product ? `+/- to ${product.stock}` : "± qty"}
                    className="input col-span-4 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setLines((l) => l.filter((_, i) => i !== idx))}
                    className="btn-icon-sm col-span-1"
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-xs font-semibold text-slate-500">
              Net stock change{" "}
              <span
                className={`text-sm font-bold ${
                  impact > 0 ? "text-emerald-600" : impact < 0 ? "text-red-600" : "text-slate-700"
                }`}
              >
                {impact > 0 ? "+" : ""}
                {impact}
              </span>
            </span>
          </div>

          {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting ? "Saving…" : "Apply adjustment"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
