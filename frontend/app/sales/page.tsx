"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { SourcePurchase, TransactionDetail, Sale, SaleReturn } from "@/lib/types";

type Tab = "sales" | "returns";

const methods = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank", label: "Bank transfer" },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    partial: "bg-amber-100 text-amber-700",
    returned: "bg-rose-100 text-rose-700",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${
        styles[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

interface ItemSummary {
  name: string;
  qty: number;
  price?: number;
}

function itemLabel(item: { product_name: string; qty: number }): string {
  return item.qty > 1 ? `${item.product_name} ×${item.qty}` : item.product_name;
}

export default function SalesPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const canReturn =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";
  const canView = canReturn || user?.role === "accountant" || user?.role === "cashier";

  const [tab, setTab] = useState<Tab>("sales");
  const [sales, setSales] = useState<Sale[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemsView, setItemsView] = useState<{
    title: string;
    items: ItemSummary[];
  } | null>(null);

  const [paySale, setPaySale] = useState<Sale | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState("");
  const [returnTrace, setReturnTrace] = useState<
    Record<number, SourcePurchase | null> | undefined
  >(undefined);

  const loadSales = useCallback(async () => {
    try {
      setSales(await api.sales.list({ limit: 100 }));
    } catch {
      /* ignore */
    }
  }, []);

  const loadReturns = useCallback(async () => {
    try {
      setReturns(await api.sales.listReturns({ limit: 100 }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (tab === "sales") loadSales().finally(() => setLoading(false));
    else loadReturns().finally(() => setLoading(false));
  }, [tab, loadSales, loadReturns]);

  function openPay(sale: Sale) {
    setPaySale(sale);
    setPayAmount("");
    setPayMethod("cash");
    setPayError("");
  }

  async function submitPayment() {
    if (!paySale) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      setPayError("Enter an amount");
      return;
    }
    setPaying(true);
    try {
      await api.sales.pay(paySale.id, { amount, method: payMethod });
      toast("Payment recorded", "success");
      setPaySale(null);
      loadSales();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  function openReturn(sale: Sale) {
    setReturnSale(sale);
    setReturnQty({});
    setReturnReason("");
    setReturnError("");
    setReturnTrace(undefined);
    api.transactions
      .detail("sale", sale.id)
      .then((d: TransactionDetail) => {
        const map: Record<number, SourcePurchase | null> = {};
        d.items.forEach((it) => {
          map[it.product_id] = it.source_purchase ?? null;
        });
        setReturnTrace(map);
      })
      .catch(() => setReturnTrace({}));
  }

  async function submitReturn() {
    if (!returnSale) return;
    const items = Object.entries(returnQty)
      .map(([product_id, qty]) => ({ product_id: Number(product_id), qty }))
      .filter((i) => i.qty > 0);
    if (items.length === 0) {
      setReturnError("Select a quantity to return");
      return;
    }
    for (const it of returnSale.items) {
      const remaining = it.qty - (it.returned_qty ?? 0);
      const entry = items.find((x) => x.product_id === it.product_id);
      if (entry && entry.qty > remaining) {
        setReturnError(
          `${it.product_name}: only ${remaining} item${remaining === 1 ? "" : "s"} returnable`
        );
        return;
      }
    }
    setReturning(true);
    try {
      await api.sales.createReturn(returnSale.id, {
        reason: returnReason || undefined,
        items,
      });
      toast("Return processed — stock restored", "success");
      setReturnSale(null);
      loadSales();
      loadReturns();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : "Return failed");
    } finally {
      setReturning(false);
    }
  }

  const summary = useMemo(() => {
    const total = sales.reduce((s, x) => s + (x.total || 0), 0);
    const paid = sales.reduce((s, x) => s + (x.paid_amount || 0), 0);
    const due = sales.reduce((s, x) => s + (x.due_amount || 0), 0);
    return { total, paid, due };
  }, [sales]);

  if (!canView) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Sales" />
        <EmptyState
          icon="🔒"
          title="No permission"
          hint="You do not have permission to view sales."
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Sales"
        subtitle="Credit sales, payments and returns"
      >
        <div className="flex gap-2">
          <div className="rounded-xl bg-white px-4 py-2 text-right shadow-sm ring-1 ring-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Sold
            </p>
            <p className="text-sm font-bold text-slate-900">
              {formatMoney(summary.total)}
            </p>
          </div>
          <div className="rounded-xl bg-white px-4 py-2 text-right shadow-sm ring-1 ring-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Collected
            </p>
            <p className="text-sm font-bold text-emerald-600">
              {formatMoney(summary.paid)}
            </p>
          </div>
          <div className="rounded-xl bg-white px-4 py-2 text-right shadow-sm ring-1 ring-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Outstanding
            </p>
            <p className="text-sm font-bold text-rose-600">
              {formatMoney(summary.due)}
            </p>
          </div>
        </div>
      </PageHeader>

      <div className="mb-4 flex gap-2 border-b border-slate-100">
        {(
          [
            ["sales", "Sales"],
            ["returns", "Returns"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold transition ${
              tab === key
                ? "border-emerald-500 text-emerald-600"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : tab === "sales" ? (
        sales.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No sales yet"
            hint="Complete a sale from the POS screen."
          />
        ) : (
          <>
            <div className="hidden md:block">
              <div className="table-shell md:max-h-[70vh] md:overflow-y-auto">
                <table className="table lg:min-w-0 lg:table-fixed">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="font-bold lg:w-16">#</th>
                      <th className="font-bold lg:w-40">Customer</th>
                      <th className="font-bold lg:w-48">Items</th>
                      <th className="text-right font-bold lg:w-24">Total</th>
                      <th className="text-right font-bold lg:w-24">Paid</th>
                      <th className="text-right font-bold lg:w-24">Due</th>
                      <th className="font-bold lg:w-24">Status</th>
                      <th className="font-bold lg:w-28">Date</th>
                      <th className="text-right font-bold lg:w-36">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sales.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/60">
                        <td className="font-semibold text-slate-500">
                          #{s.id}
                        </td>
                        <td className="font-semibold text-slate-800">
                          {s.customer_name ?? (
                            <span className="text-slate-400">Walk-in</span>
                          )}
                          {s.loyalty_points_used > 0 && (
                            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                              {s.loyalty_points_used} pts
                            </span>
                          )}
                        </td>
                        <td className="text-xs text-slate-500 lg:max-w-[240px]">
                          <button
                            type="button"
                            onClick={() =>
                              setItemsView({
                                title: `Sale #${s.id} items`,
                                items: s.items.map((i) => ({
                                  name: i.product_name,
                                  qty: i.qty,
                                  price: i.price,
                                })),
                              })
                            }
                            className="block w-full truncate text-left text-xs text-slate-500"
                            title={s.items.map(itemLabel).join(", ")}
                          >
                            {s.items.map(itemLabel).join(", ")}
                          </button>
                        </td>
                        <td className="text-right font-bold text-slate-900">
                          {formatMoney(s.total)}
                        </td>
                        <td className="text-right text-emerald-600">
                          {formatMoney(s.paid_amount)}
                        </td>
                        <td className="text-right font-semibold text-rose-600">
                          {s.due_amount > 0.001 ? formatMoney(s.due_amount) : "—"}
                        </td>
                        <td>
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="text-xs text-slate-500">
                          {new Date(s.created_at).toLocaleDateString("en-LK")}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            {s.customer_id && s.due_amount > 0.001 && (
                              <button
                                onClick={() => openPay(s)}
                                className="btn btn-sm btn-primary"
                              >
                                Pay
                              </button>
                            )}
                            {canReturn && s.status !== "returned" && (
                              <button
                                onClick={() => openReturn(s)}
                                className="btn btn-sm btn-danger-soft"
                              >
                                Return
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-3 md:hidden">
              {sales.map((s) => (
                <div
                  key={s.id}
                  className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        Sale #{s.id}
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(s.created_at).toLocaleDateString("en-LK")}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {s.customer_name ?? (
                        <span className="text-slate-400">Walk-in</span>
                      )}
                    </p>
                    {s.loyalty_points_used > 0 && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        {s.loyalty_points_used} pts
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setItemsView({
                        title: `Sale #${s.id} items`,
                        items: s.items.map((i) => ({
                          name: i.product_name,
                          qty: i.qty,
                          price: i.price,
                        })),
                      })
                    }
                    className="mt-1 block w-full truncate text-left text-xs text-slate-500"
                    title={s.items.map(itemLabel).join(", ")}
                  >
                    {s.items.map(itemLabel).join(", ")}
                  </button>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Total
                      </p>
                      <p className="text-sm font-bold text-slate-900">
                        {formatMoney(s.total)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Paid
                      </p>
                      <p className="text-sm font-bold text-emerald-600">
                        {formatMoney(s.paid_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Due
                      </p>
                      <p className="text-sm font-bold text-rose-600">
                        {s.due_amount > 0.001 ? formatMoney(s.due_amount) : "—"}
                      </p>
                    </div>
                  </div>
                  {(s.customer_id && s.due_amount > 0.001) ||
                  (canReturn && s.status !== "returned") ? (
                    <div className="mt-3 flex gap-2">
                      {s.customer_id && s.due_amount > 0.001 && (
                        <button
                          onClick={() => openPay(s)}
                          className="btn btn-sm btn-primary flex-1"
                        >
                          Pay
                        </button>
                      )}
                      {canReturn && s.status !== "returned" && (
                        <button
                          onClick={() => openReturn(s)}
                          className="btn btn-sm btn-danger-soft flex-1"
                        >
                          Return
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )
      ) : returns.length === 0 ? (
        <EmptyState
          icon="↩️"
          title="No returns yet"
          hint="Process a return from the Sales tab."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <div className="table-shell md:max-h-[70vh] md:overflow-y-auto">
              <table className="table lg:min-w-0 lg:table-fixed">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="font-bold lg:w-24">Return #</th>
                    <th className="font-bold lg:w-16">Sale</th>
                    <th className="font-bold lg:w-40">Customer</th>
                    <th className="font-bold lg:w-64">Items</th>
                    <th className="text-right font-bold lg:w-24">Refund</th>
                    <th className="font-bold lg:w-40">Reason</th>
                    <th className="font-bold lg:w-28">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returns.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="font-semibold text-slate-500">
                        {r.return_number}
                      </td>
                      <td className="font-semibold text-slate-800">
                        #{r.sale_id}
                      </td>
                      <td className="font-semibold text-slate-800">
                        {r.customer_name ?? (
                          <span className="text-slate-400">Walk-in</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-500 lg:max-w-[280px]">
                        <button
                          type="button"
                          onClick={() =>
                            setItemsView({
                              title: `Return ${r.return_number} items`,
                              items: r.items.map((i) => ({
                                name: i.product_name,
                                qty: i.qty,
                              })),
                            })
                          }
                          className="block w-full truncate text-left text-xs text-slate-500"
                          title={r.items.map(itemLabel).join(", ")}
                        >
                          {r.items.map(itemLabel).join(", ")}
                        </button>
                      </td>
                      <td className="text-right font-bold text-rose-600">
                        {formatMoney(r.total)}
                      </td>
                      <td className="truncate text-xs text-slate-500">
                        {r.reason ?? "—"}
                      </td>
                      <td className="text-xs text-slate-500">
                        {new Date(r.return_date).toLocaleDateString("en-LK")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 md:hidden">
            {returns.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {r.return_number}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(r.return_date).toLocaleDateString("en-LK")}
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">
                    {formatMoney(r.total)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {r.customer_name ?? (
                    <span className="text-slate-400">Walk-in</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setItemsView({
                      title: `Return ${r.return_number} items`,
                      items: r.items.map((i) => ({
                        name: i.product_name,
                        qty: i.qty,
                      })),
                    })
                  }
                  className="mt-1 block w-full truncate text-left text-xs text-slate-500"
                  title={r.items.map(itemLabel).join(", ")}
                >
                  {r.items.map(itemLabel).join(", ")}
                </button>
                <p className="mt-2 text-xs text-slate-500">Sale #{r.sale_id}</p>
                {r.reason && (
                  <p className="mt-1 text-xs text-slate-500">
                    Reason: {r.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!paySale}
        onClose={() => setPaySale(null)}
        title={`Payment for sale #${paySale?.id ?? ""}`}
        maxWidth="max-w-sm"
      >
        {paySale && (
          <>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <span className="font-medium text-slate-500">Outstanding</span>
              <span className="text-lg font-bold text-rose-600">
                {formatMoney(paySale.due_amount)}
              </span>
            </div>
            <label className="label mt-4">Amount</label>
            <input
              autoFocus
              type="number"
              min="0"
              inputMode="numeric"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0"
              className="input mt-1.5 text-xl font-bold"
            />
            <label className="label mt-3">Method</label>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {methods.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPayMethod(m.value)}
                  className={`rounded-lg border py-2 text-xs font-bold transition ${
                    payMethod === m.value
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {payError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
                {payError}
              </p>
            )}
            <button
              onClick={submitPayment}
              disabled={paying}
              className="btn btn-primary mt-4 w-full"
            >
              {paying ? "Recording…" : "Record payment"}
            </button>
          </>
        )}
      </Modal>

      <Modal
        open={!!returnSale}
        onClose={() => setReturnSale(null)}
        title={`Return for sale #${returnSale?.id ?? ""}`}
        maxWidth="max-w-md"
      >
        {returnSale && (
          <>
            <div className="space-y-2">
              {returnSale.items.map((i) => {
                const returned = i.returned_qty ?? 0;
                const remaining = Math.max(0, i.qty - returned);
                const selected = returnQty[i.product_id] ?? 0;
                return (
                  <div
                    key={i.product_id}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-semibold">{i.product_name}</p>
                      <p className="text-xs text-slate-400">
                        {formatMoney(i.price)} each · sold {i.qty}
                      </p>
                      <p className="text-[11px] font-semibold">
                        {returned > 0 ? (
                          <span className="text-amber-600">
                            {returned} returned ·{" "}
                            <span className="text-emerald-600">
                              {remaining} remaining
                            </span>
                          </span>
                        ) : (
                          <span className="text-emerald-600">
                            {remaining} returnable
                          </span>
                        )}
                      </p>
                    {returnTrace !== undefined &&
                      returnTrace[i.product_id] && (
                        <div className="mt-1.5 rounded-lg border border-sky-100 bg-sky-50 px-2 py-1.5 text-[11px] leading-snug text-sky-800">
                          <div className="font-semibold">
                            Sourced from{" "}
                            {returnTrace[i.product_id]!.supplier_name ??
                              "unknown supplier"}
                          </div>
                          <div>
                            {returnTrace[i.product_id]!.purchase_number} · cost{" "}
                            {formatMoney(returnTrace[i.product_id]!.cost_price)}
                            {returnTrace[i.product_id]!.supplier_phone && (
                              <span className="mx-1 text-sky-300">|</span>
                            )}
                            <a
                              href={`tel:${returnTrace[i.product_id]!.supplier_phone ?? ""}`}
                              className="font-bold underline"
                            >
                              {returnTrace[i.product_id]!.supplier_phone}
                            </a>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <a
                              href={`/purchases?return=1&purchase=${returnTrace[i.product_id]!.purchase_id}`}
                              className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-700"
                            >
                              Return to supplier →
                            </a>
                            <a
                              href={`/transactions?q=${encodeURIComponent(returnTrace[i.product_id]!.purchase_number)}`}
                              className="rounded bg-white px-1.5 py-0.5 font-bold text-sky-700 ring-1 ring-sky-200"
                            >
                              Trace purchase
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setReturnQty((q) => ({
                            ...q,
                            [i.product_id]: Math.max(0, (q[i.product_id] ?? 0) - 1),
                          }))
                        }
                        className="grid h-7 w-7 place-items-center rounded-lg bg-white text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 active:scale-90"
                      >
                        −
                      </button>
                      <span className="w-4 text-center text-sm font-bold">
                        {selected}
                      </span>
                      <button
                        onClick={() =>
                          setReturnQty((q) => ({
                            ...q,
                            [i.product_id]: Math.min(
                              remaining,
                              (q[i.product_id] ?? 0) + 1
                            ),
                          }))
                        }
                        disabled={remaining <= 0 || selected >= remaining}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-white text-sm font-bold text-rose-600 shadow-sm ring-1 ring-slate-200 active:scale-90 disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <label className="label mt-4">Reason</label>
            <input
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="e.g. defective item"
              className="input mt-1.5"
            />
            {returnError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
                {returnError}
              </p>
            )}
            <button
              onClick={submitReturn}
              disabled={returning}
              className="btn btn-danger mt-4 w-full"
            >
              {returning ? "Processing…" : "Process return"}
            </button>
          </>
        )}
      </Modal>
      <Modal
        open={!!itemsView}
        onClose={() => setItemsView(null)}
        title={itemsView?.title ?? ""}
        maxWidth="max-w-sm"
      >
        {itemsView && (
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {itemsView.items.map((item, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                  {item.name}
                </span>
                {item.qty > 1 && (
                  <span className="shrink-0 text-sm font-bold text-slate-400">
                    ×{item.qty}
                  </span>
                )}
                {item.price !== undefined && (
                  <span className="shrink-0 text-sm font-semibold text-slate-500">
                    {formatMoney(item.price)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
