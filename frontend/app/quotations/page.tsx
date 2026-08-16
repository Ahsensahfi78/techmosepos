"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, master } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { Customer, Product, Quotation } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-sky-50 text-sky-600",
  converted: "bg-emerald-50 text-emerald-600",
  cancelled: "bg-red-50 text-red-600",
};

const FILTERS = ["all", "draft", "sent", "converted", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export default function QuotationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";
  const canView = canManage || user?.role === "accountant";

  const [filter, setFilter] = useState<Filter>("all");
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [form, setForm] = useState({
    customer_id: "",
    tax_rate: "",
    discount_amount: "0",
    notes: "",
    valid_until: "",
  });
  const [lines, setLines] = useState<{ product_id: string; qty: string; price: string }[]>([
    { product_id: "", qty: "1", price: "" },
  ]);

  const [convertQ, setConvertQ] = useState<Quotation | null>(null);
  const [convertMethod, setConvertMethod] = useState("cash");
  const [convertPaid, setConvertPaid] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.quotations.list({
        page_size: 100,
        status: filter === "all" ? undefined : filter,
      });
      setQuotations(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadMaster = useCallback(async () => {
    try {
      const c = await master.customers.list({ page_size: 100 });
      setCustomers(c.items);
      setProducts(await api.products.list());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    loadMaster();
  }, [loadMaster]);

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.qty) || 0;
        const p = Number(l.price) || 0;
        return sum + q * p;
      }, 0),
    [lines]
  );
  const taxAmount = ((subtotal - (Number(form.discount_amount) || 0)) * (Number(form.tax_rate) || 0)) / 100;
  const grandTotal = Math.max(0, subtotal - (Number(form.discount_amount) || 0) + taxAmount);

  function pickProduct(idx: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    setLines((l) =>
      l.map((x, i) =>
        i === idx
          ? {
              ...x,
              product_id: productId,
              price: product && !x.price ? String(product.price) : x.price,
            }
          : x
      )
    );
  }

  function openCreate() {
    setForm({ customer_id: "", tax_rate: "", discount_amount: "0", notes: "", valid_until: "" });
    setLines([{ product_id: "", qty: "1", price: "" }]);
    setCreateError("");
    setCreateOpen(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    const items = lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({
        product_id: Number(l.product_id),
        qty: Number(l.qty),
        price: Number(l.price) || 0,
      }));
    if (items.length === 0) {
      setCreateError("Add at least one line item.");
      return;
    }
    setCreating(true);
    try {
      await api.quotations.create({
        customer_id: form.customer_id ? Number(form.customer_id) : undefined,
        discount_amount: Number(form.discount_amount) || 0,
        tax_rate: Number(form.tax_rate) || 0,
        notes: form.notes || undefined,
        valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : undefined,
        items,
      });
      toast("Quotation created", "success");
      setCreateOpen(false);
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(q: Quotation, status: string) {
    try {
      await api.quotations.updateStatus(q.id, status);
      toast(`Quotation marked ${status}`, "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  }

  function openConvert(q: Quotation) {
    setConvertQ(q);
    setConvertMethod("cash");
    setConvertPaid(String(q.total));
    setConvertError("");
  }

  async function submitConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!convertQ) return;
    setConvertError("");
    const paid = Number(convertPaid);
    if (isNaN(paid) || paid < 0) {
      setConvertError("Enter a valid amount.");
      return;
    }
    setConverting(true);
    try {
      await api.quotations.convert(convertQ.id, {
        payment_method: convertMethod,
        paid,
      });
      toast("Quotation converted to sale", "success");
      setConvertQ(null);
      load();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setConverting(false);
    }
  }

  async function removeQuotation(q: Quotation) {
    try {
      await api.quotations.remove(q.id);
      toast("Quotation deleted", "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  if (!canView) {
    return (
      <EmptyState
        icon="🚫"
        title="No access"
        hint="You do not have permission to view quotations."
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Quotations" subtitle="Estimates and quotes that can convert to sales">
        {canManage && (
          <button onClick={openCreate} className="btn btn-primary">
            + New quotation
          </button>
        )}
      </PageHeader>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold capitalize transition ${
              filter === f
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {f}
            {f === "all" && ` (${total})`}
          </button>
        ))}
      </div>

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : quotations.length === 0 ? (
          <EmptyState
            icon="📄"
            title="No quotations"
            hint={canManage ? "Create a quotation to get started." : "No quotations yet."}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Customer</th>
                <th className="hidden md:table-cell">Valid until</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id}>
                  <td className="font-bold text-slate-800">{q.quotation_number}</td>
                  <td className="text-slate-600">{q.customer_name || "Walk-in"}</td>
                  <td className="hidden text-xs text-slate-400 md:table-cell">
                    {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                        STATUS_STYLES[q.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="text-right font-bold tabular-nums">
                    {q.total.toLocaleString(undefined, {
                      style: "currency",
                      currency: "PKR",
                    })}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {canManage && (q.status === "draft" || q.status === "sent") && (
                        <>
                          <button
                            onClick={() => openConvert(q)}
                            className="btn btn-sm btn-primary"
                          >
                            Convert
                          </button>
                          {q.status === "draft" && (
                            <button
                              onClick={() => setStatus(q, "sent")}
                              className="btn btn-sm btn-secondary"
                            >
                              Send
                            </button>
                          )}
                          {q.status === "sent" && (
                            <button
                              onClick={() => setStatus(q, "cancelled")}
                              className="btn btn-sm btn-danger-soft"
                            >
                              Cancel
                            </button>
                          )}
                          {q.status === "draft" && (
                            <button
                              onClick={() => removeQuotation(q)}
                              className="btn btn-sm btn-ghost"
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* create */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New quotation"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={submitCreate} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Customer</label>
              <select
                value={form.customer_id}
                onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                className="select"
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Valid until</label>
              <input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Tax rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.tax_rate}
                onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Discount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.discount_amount}
                onChange={(e) => setForm((f) => ({ ...f, discount_amount: e.target.value }))}
                className="input"
              />
            </div>
          </div>

          <div className="card overflow-hidden !p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-700">Line items</p>
              <button
                type="button"
                onClick={() => setLines((l) => [...l, { product_id: "", qty: "1", price: "" }])}
                className="btn btn-sm btn-primary"
              >
                + Add line
              </button>
            </div>
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 items-center gap-2 border-b border-slate-100 px-4 py-2 last:border-0"
              >
                <select
                  value={line.product_id}
                  onChange={(e) => pickProduct(idx, e.target.value)}
                  className="select col-span-5 text-xs"
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
                  min="1"
                  value={line.qty}
                  onChange={(e) =>
                    setLines((l) =>
                      l.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x))
                    )
                  }
                  placeholder="Qty"
                  className="input col-span-2 text-xs"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.price}
                  onChange={(e) =>
                    setLines((l) =>
                      l.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x))
                    )
                  }
                  placeholder="Price"
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
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-xs font-semibold text-slate-500">
              Subtotal {subtotal.toFixed(2)}
            </span>
            <span className="text-xs font-semibold text-slate-500">
              Tax {taxAmount.toFixed(2)} · Total{" "}
              <span className="text-sm font-bold text-slate-900">{grandTotal.toFixed(2)}</span>
            </span>
          </div>

          <div>
            <label className="label">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
              className="input"
            />
          </div>

          {createError && <p className="text-xs font-semibold text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="btn btn-primary w-full"
          >
            {creating ? "Creating…" : "Create quotation"}
          </button>
        </form>
      </Modal>

      {/* convert */}
      <Modal
        open={!!convertQ}
        onClose={() => setConvertQ(null)}
        title={`Convert to sale — ${convertQ?.quotation_number ?? ""}`}
        maxWidth="max-w-sm"
      >
        {convertQ && (
          <form onSubmit={submitConvert} className="space-y-5">
            <p className="text-xs text-slate-500">
              Quote total:{" "}
              <span className="font-bold text-slate-900">
                {convertQ.total.toLocaleString(undefined, {
                  style: "currency",
                  currency: "PKR",
                })}
              </span>
            </p>
            <div>
              <label className="label">Payment method</label>
              <select
                value={convertMethod}
                onChange={(e) => setConvertMethod(e.target.value)}
                className="select"
              >
                {["cash", "bank_transfer", "cheque", "card", "credit", "other"].map((m) => (
                  <option key={m} value={m}>
                    {m.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Amount paid now</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={convertPaid}
                onChange={(e) => setConvertPaid(e.target.value)}
                autoFocus
                className="input"
              />
            </div>
            <p className="text-xs text-slate-500">
              A zero amount creates a credit sale against the customer&apos;s ledger.
            </p>
            {convertError && <p className="text-xs font-semibold text-red-600">{convertError}</p>}
            <button
              type="submit"
              disabled={converting}
              className="btn btn-primary w-full"
            >
              {converting ? "Converting…" : "Convert to sale"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
