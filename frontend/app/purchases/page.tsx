"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, master } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type {
  Product,
  Purchase,
  PurchaseOrder,
  PurchaseReturn,
  Supplier,
} from "@/lib/types";

type Tab = "orders" | "purchases" | "returns";

const STATUS_STYLES: Record<string, string> = {
  ordered: "bg-sky-50 text-sky-600",
  partial: "bg-amber-50 text-amber-600",
  received: "bg-emerald-50 text-emerald-600",
  cancelled: "bg-slate-100 text-slate-500",
  draft: "bg-slate-100 text-slate-500",
  unpaid: "bg-red-50 text-red-600",
  paid: "bg-emerald-50 text-emerald-600",
};

interface POLine {
  product_id: string;
  qty_ordered: string;
  cost_price: string;
}

export default function PurchasesPage() {
  return (
    <Suspense
      fallback={<div className="grid h-40 place-items-center text-sm text-slate-400">Loading…</div>}
    >
      <PurchasesInner />
    </Suspense>
  );
}

function PurchasesInner() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";
  const canView =
    canManage || user?.role === "accountant";

  const [tab, setTab] = useState<Tab>("orders");

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [returnTotal, setReturnTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [poForm, setPoForm] = useState({
    supplier_id: "",
    discount_amount: "0",
    tax_amount: "0",
    notes: "",
  });
  const [poLines, setPoLines] = useState<POLine[]>([
    { product_id: "", qty_ordered: "1", cost_price: "" },
  ]);

  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<number, number>>({});
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState("");

  const [cancelOrder, setCancelOrder] = useState<PurchaseOrder | null>(null);

  const [payPurchase, setPayPurchase] = useState<Purchase | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  const [returnPurchase, setReturnPurchase] = useState<Purchase | null>(null);
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState("");

  const loadSuppliers = useCallback(async () => {
    try {
      const data = await master.suppliers.list({ page_size: 100 });
      setSuppliers(data.items);
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
    loadSuppliers();
    loadProducts();
  }, [loadSuppliers, loadProducts]);

  const loadOrders = useCallback(async () => {
    try {
      const data = await api.purchases.orders({ page_size: 50 });
      setOrders(data.items);
      setOrderTotal(data.total);
    } catch {
      /* ignore */
    }
  }, []);

  const loadPurchases = useCallback(async () => {
    try {
      const data = await api.purchases.list({ page_size: 50 });
      setPurchases(data.items);
      setPurchaseTotal(data.total);
    } catch {
      /* ignore */
    }
  }, []);

  const loadReturns = useCallback(async () => {
    try {
      const data = await api.purchases.returns({ page_size: 50 });
      setReturns(data.items);
      setReturnTotal(data.total);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (tab === "orders") loadOrders().finally(() => setLoading(false));
    else if (tab === "purchases") loadPurchases().finally(() => setLoading(false));
    else loadReturns().finally(() => setLoading(false));
  }, [tab, loadOrders, loadPurchases, loadReturns]);

  useEffect(() => {
    const pid = searchParams.get("purchase");
    const wantReturn = searchParams.get("return") === "1";
    if (!pid || !wantReturn) return;
    const id = Number(pid);
    if (!Number.isFinite(id)) return;
    api.purchases
      .get(id)
      .then((p) => {
        setTab("purchases");
        openReturn(p);
      })
      .catch(() => {
        /* ignore invalid deep link */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const poSubtotal = useMemo(
    () =>
      poLines.reduce((sum, l) => {
        const q = Number(l.qty_ordered) || 0;
        const c = Number(l.cost_price) || 0;
        return sum + q * c;
      }, 0),
    [poLines]
  );
  const poTotal = Math.max(
    0,
    poSubtotal - (Number(poForm.discount_amount) || 0) + (Number(poForm.tax_amount) || 0)
  );

  function updatePoLine(idx: number, patch: Partial<POLine>) {
    setPoLines((lines) => lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function openCreate() {
    setPoForm({ supplier_id: "", discount_amount: "0", tax_amount: "0", notes: "" });
    setPoLines([{ product_id: "", qty_ordered: "1", cost_price: "" }]);
    setCreateError("");
    setCreateOpen(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    if (!poForm.supplier_id) {
      setCreateError("Select a supplier.");
      return;
    }
    const items = poLines
      .filter((l) => l.product_id && Number(l.qty_ordered) > 0)
      .map((l) => ({
        product_id: Number(l.product_id),
        qty_ordered: Number(l.qty_ordered),
        cost_price: Number(l.cost_price) || 0,
      }));
    if (items.length === 0) {
      setCreateError("Add at least one line item.");
      return;
    }
    setCreating(true);
    try {
      await api.purchases.createOrder({
        supplier_id: Number(poForm.supplier_id),
        discount_amount: Number(poForm.discount_amount) || 0,
        tax_amount: Number(poForm.tax_amount) || 0,
        notes: poForm.notes || undefined,
        items,
      });
      toast("Purchase order created", "success");
      setCreateOpen(false);
      loadOrders();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  function openReceive(po: PurchaseOrder) {
    setReceiveOrder(po);
    setInvoiceNumber("");
    setReceiveError("");
    const q: Record<number, number> = {};
    po.items.forEach((i) => {
      q[i.product_id] = i.qty_ordered - i.qty_received;
    });
    setReceiveQty(q);
  }

  async function submitReceive(e: React.FormEvent) {
    e.preventDefault();
    if (!receiveOrder) return;
    setReceiveError("");
    const qty = Object.entries(receiveQty)
      .filter(([, q]) => Number(q) > 0)
      .map(([pid, q]) => ({ product_id: Number(pid), qty: Number(q) }));
    if (qty.length === 0) {
      setReceiveError("Enter at least one quantity to receive.");
      return;
    }
    setReceiving(true);
    try {
      await api.purchases.receiveOrder(receiveOrder.id, {
        qty,
        invoice_number: invoiceNumber || undefined,
      });
      toast("Stock received", "success");
      setReceiveOrder(null);
      loadOrders();
      loadPurchases();
    } catch (err) {
      setReceiveError(err instanceof Error ? err.message : "Receive failed");
    } finally {
      setReceiving(false);
    }
  }

  async function confirmCancel() {
    if (!cancelOrder) return;
    try {
      await api.purchases.cancelOrder(cancelOrder.id);
      toast(`PO ${cancelOrder.po_number} cancelled`, "success");
      setCancelOrder(null);
      loadOrders();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Cancel failed", "error");
      setCancelOrder(null);
    }
  }

  function openPay(p: Purchase) {
    setPayPurchase(p);
    setPayAmount(String(p.due_amount));
    setPayMethod("cash");
    setPayError("");
  }

  async function submitPay(e: React.FormEvent) {
    e.preventDefault();
    if (!payPurchase) return;
    setPayError("");
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      setPayError("Enter a valid amount.");
      return;
    }
    setPaying(true);
    try {
      await api.purchases.pay(payPurchase.id, { amount, method: payMethod });
      toast("Payment recorded", "success");
      setPayPurchase(null);
      loadPurchases();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  function openReturn(p: Purchase) {
    setReturnPurchase(p);
    setReturnReason("");
    setReturnError("");
    const q: Record<number, number> = {};
    p.items.forEach((i) => {
      q[i.product_id] = 0;
    });
    setReturnQty(q);
  }

  async function submitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!returnPurchase) return;
    setReturnError("");
    const items = Object.entries(returnQty)
      .filter(([, q]) => Number(q) > 0)
      .map(([pid, q]) => ({ product_id: Number(pid), qty: Number(q) }));
    if (items.length === 0) {
      setReturnError("Enter at least one quantity to return.");
      return;
    }
    setReturning(true);
    try {
      await api.purchases.returnGoods(returnPurchase.id, {
        reason: returnReason || undefined,
        items,
      });
      toast("Purchase return recorded", "success");
      setReturnPurchase(null);
      loadPurchases();
      loadReturns();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : "Return failed");
    } finally {
      setReturning(false);
    }
  }

  if (!canView) {
    return (
      <EmptyState
        icon="🚫"
        title="No access"
        hint="You do not have permission to view purchases."
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Purchases" subtitle="Purchase orders, receiving and supplier payments">
        {canManage && (
          <button onClick={openCreate} className="btn btn-primary">
            + New purchase order
          </button>
        )}
      </PageHeader>

      <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["orders", `Purchase orders (${orderTotal})`],
            ["purchases", `Received (${purchaseTotal})`],
            ["returns", `Returns (${returnTotal})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
              tab === t
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden !p-0">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : tab === "orders" && orders.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No purchase orders"
            hint={canManage ? "Create a purchase order to get started." : "No purchase orders yet."}
          />
        ) : tab === "purchases" && purchases.length === 0 ? (
          <EmptyState
            icon="📦"
            title="No purchases received"
            hint="Received stock will appear here."
          />
        ) : tab === "returns" && returns.length === 0 ? (
          <EmptyState icon="↩️" title="No returns" hint="Purchase returns will appear here." />
        ) : (
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  {tab === "orders" && (
                    <>
                      <th>PO #</th>
                      <th>Supplier</th>
                      <th className="hidden md:table-cell">Date</th>
                      <th>Status</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Actions</th>
                    </>
                  )}
                  {tab === "purchases" && (
                    <>
                      <th>Purchase #</th>
                      <th>Supplier</th>
                      <th className="hidden md:table-cell">Invoice</th>
                      <th>Status</th>
                      <th className="hidden text-right sm:table-cell">Due</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Actions</th>
                    </>
                  )}
                  {tab === "returns" && (
                    <>
                      <th>Return #</th>
                      <th>Purchase</th>
                      <th>Supplier</th>
                      <th className="hidden md:table-cell">Reason</th>
                      <th className="text-right">Total</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {tab === "orders" &&
                  orders.map((po) => (
                    <tr
                      key={po.id}
                    >
                      <td className="font-bold text-slate-800">
                        {po.po_number}
                      </td>
                      <td className="text-slate-600">{po.supplier_name}</td>
                      <td className="hidden text-xs text-slate-400 md:table-cell">
                        {new Date(po.order_date).toLocaleDateString()}
                      </td>
                      <td>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                            STATUS_STYLES[po.status] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {po.status}
                        </span>
                      </td>
                      <td className="text-right font-bold tabular-nums">
                        {po.total.toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {canManage &&
                            (po.status === "ordered" || po.status === "partial") && (
                              <button
                                onClick={() => openReceive(po)}
                                className="btn btn-sm btn-secondary"
                              >
                                Receive
                              </button>
                            )}
                          {canManage &&
                            po.status !== "cancelled" &&
                            po.status !== "received" && (
                              <button
                                onClick={() => setCancelOrder(po)}
                                className="btn btn-sm btn-danger-soft"
                              >
                                Cancel
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                {tab === "purchases" &&
                  purchases.map((p) => (
                    <tr
                      key={p.id}
                    >
                      <td className="font-bold text-slate-800">
                        {p.purchase_number}
                      </td>
                      <td className="text-slate-600">{p.supplier_name}</td>
                      <td className="hidden text-xs text-slate-400 md:table-cell">
                        {p.invoice_number || "—"}
                      </td>
                      <td>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                            STATUS_STYLES[p.status] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="hidden text-right text-xs text-red-600 tabular-nums sm:table-cell">
                        {p.due_amount.toFixed(2)}
                      </td>
                      <td className="text-right font-bold tabular-nums">
                        {p.total.toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {canManage && p.due_amount > 0.001 && (
                            <button
                              onClick={() => openPay(p)}
                              className="btn btn-sm btn-secondary"
                            >
                              Pay
                            </button>
                          )}
                          {canManage && (
                            <button
                              onClick={() => openReturn(p)}
                              className="btn btn-sm btn-secondary"
                            >
                              Return
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                {tab === "returns" &&
                  returns.map((r) => (
                    <tr
                      key={r.id}
                    >
                      <td className="font-bold text-slate-800">
                        {r.return_number}
                      </td>
                      <td className="text-slate-600">{r.purchase_number}</td>
                      <td className="text-slate-600">{r.supplier_name}</td>
                      <td className="hidden max-w-[200px] truncate text-xs text-slate-400 md:table-cell">
                        {r.reason || "—"}
                      </td>
                      <td className="text-right font-bold tabular-nums">
                        {r.total.toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* create PO */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New purchase order"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={submitCreate} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Supplier *</label>
              <select
                value={poForm.supplier_id}
                onChange={(e) => setPoForm((f) => ({ ...f, supplier_id: e.target.value }))}
                className="select"
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Discount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={poForm.discount_amount}
                onChange={(e) => setPoForm((f) => ({ ...f, discount_amount: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Tax</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={poForm.tax_amount}
                onChange={(e) => setPoForm((f) => ({ ...f, tax_amount: e.target.value }))}
                className="input"
              />
            </div>
          </div>

          <div className="card overflow-hidden !p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-xs font-bold text-slate-600">Line items</p>
              <button
                type="button"
                onClick={() =>
                  setPoLines((l) => [...l, { product_id: "", qty_ordered: "1", cost_price: "" }])
                }
                className="btn btn-sm btn-secondary"
              >
                + Add line
              </button>
            </div>
            {poLines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 items-center gap-2 border-b border-slate-50 px-3 py-2 last:border-0"
              >
                <select
                  value={line.product_id}
                  onChange={(e) => updatePoLine(idx, { product_id: e.target.value })}
                  className="col-span-6 rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-emerald-500"
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
                  value={line.qty_ordered}
                  onChange={(e) => updatePoLine(idx, { qty_ordered: e.target.value })}
                  placeholder="Qty"
                  className="col-span-2 rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-emerald-500"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.cost_price}
                  onChange={(e) => updatePoLine(idx, { cost_price: e.target.value })}
                  placeholder="Cost"
                  className="col-span-3 rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setPoLines((l) => l.filter((_, i) => i !== idx))}
                  className="col-span-1 grid place-items-center text-slate-300 hover:text-red-500"
                  aria-label="Remove line"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-xs font-semibold text-slate-500">
              Subtotal {poSubtotal.toFixed(2)} · Total{" "}
              <span className="text-sm font-bold text-slate-900">{poTotal.toFixed(2)}</span>
            </span>
          </div>

          <div>
            <label className="label">Notes</label>
            <input
              value={poForm.notes}
              onChange={(e) => setPoForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes"
              className="input"
            />
          </div>

          {createError && <p className="text-xs font-semibold text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="btn btn-primary w-full"
          >
            {creating ? "Creating…" : "Create purchase order"}
          </button>
        </form>
      </Modal>

      {/* receive */}
      <Modal
        open={!!receiveOrder}
        onClose={() => setReceiveOrder(null)}
        title={`Receive stock — ${receiveOrder?.po_number ?? ""}`}
        maxWidth="max-w-2xl"
      >
        {receiveOrder && (
          <form onSubmit={submitReceive} className="space-y-5">
            <p className="text-xs text-slate-500">
              Supplier: <span className="font-bold text-slate-700">{receiveOrder.supplier_name}</span>
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-xs font-semibold uppercase text-slate-400">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">To receive</th>
                  </tr>
                </thead>
                <tbody>
                  {receiveOrder.items.map((i) => {
                    const remaining = i.qty_ordered - i.qty_received;
                    return (
                      <tr key={i.id} className="border-b border-slate-50">
                        <td className="px-3 py-2 text-xs font-semibold text-slate-700">
                          {i.product_name}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">{i.qty_ordered}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-600">
                          {i.qty_received}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {remaining > 0 ? (
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              value={receiveQty[i.product_id] ?? 0}
                              onChange={(e) =>
                                setReceiveQty((q) => ({
                                  ...q,
                                  [i.product_id]: Math.min(remaining, Number(e.target.value)),
                                }))
                              }
                              className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs outline-none focus:border-emerald-500"
                            />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <label className="label">Invoice number</label>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="Optional supplier invoice #"
                className="input"
              />
            </div>
            {receiveError && <p className="text-xs font-semibold text-red-600">{receiveError}</p>}
            <button
              type="submit"
              disabled={receiving}
              className="btn btn-primary w-full"
            >
              {receiving ? "Receiving…" : "Receive stock"}
            </button>
          </form>
        )}
      </Modal>

      {/* cancel confirm */}
      <Modal
        open={!!cancelOrder}
        onClose={() => setCancelOrder(null)}
        title="Cancel purchase order"
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-2xl">
            ⚠️
          </span>
          <p className="mt-3 text-sm text-slate-600">
            Cancel <span className="font-bold text-slate-900">{cancelOrder?.po_number}</span>?
            This cannot be undone.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setCancelOrder(null)}
            className="btn btn-secondary"
          >
            Keep
          </button>
          <button
            onClick={confirmCancel}
            className="btn btn-danger"
          >
            Cancel order
          </button>
        </div>
      </Modal>

      {/* payment */}
      <Modal
        open={!!payPurchase}
        onClose={() => setPayPurchase(null)}
        title={`Record payment — ${payPurchase?.purchase_number ?? ""}`}
        maxWidth="max-w-sm"
      >
        {payPurchase && (
          <form onSubmit={submitPay} className="space-y-5">
            <p className="text-xs text-slate-500">
              Outstanding:{" "}
              <span className="font-bold text-red-600">
                {payPurchase.due_amount.toFixed(2)}
              </span>
            </p>
            <div>
              <label className="label">Amount *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                autoFocus
                className="input"
              />
            </div>
            <div>
              <label className="label">Method</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="select"
              >
                {["cash", "bank_transfer", "cheque", "card", "other"].map((m) => (
                  <option key={m} value={m}>
                    {m.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            {payError && <p className="text-xs font-semibold text-red-600">{payError}</p>}
            <button
              type="submit"
              disabled={paying}
              className="btn btn-primary w-full"
            >
              {paying ? "Saving…" : "Record payment"}
            </button>
          </form>
        )}
      </Modal>

      {/* return */}
      <Modal
        open={!!returnPurchase}
        onClose={() => setReturnPurchase(null)}
        title={`Return goods — ${returnPurchase?.purchase_number ?? ""}`}
        maxWidth="max-w-2xl"
      >
        {returnPurchase && (
          <form onSubmit={submitReturn} className="space-y-5">
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-xs font-semibold uppercase text-slate-400">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Qty bought</th>
                    <th className="px-3 py-2 text-right">Return qty</th>
                  </tr>
                </thead>
                <tbody>
                  {returnPurchase.items.map((i) => (
                    <tr key={i.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-700">
                        {i.product_name}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">{i.qty}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max={i.qty}
                          value={returnQty[i.product_id] ?? 0}
                          onChange={(e) =>
                            setReturnQty((q) => ({
                              ...q,
                              [i.product_id]: Math.min(i.qty, Number(e.target.value)),
                            }))
                          }
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs outline-none focus:border-emerald-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <label className="label">Reason</label>
              <input
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="e.g. damaged, wrong item"
                className="input"
              />
            </div>
            {returnError && <p className="text-xs font-semibold text-red-600">{returnError}</p>}
            <button
              type="submit"
              disabled={returning}
              className="btn btn-primary w-full"
            >
              {returning ? "Processing…" : "Record return"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
