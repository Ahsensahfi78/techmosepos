"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useAuth } from "@/lib/auth-context";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import type {
  RelatedTransaction,
  TransactionDetail,
  TransactionRecord,
} from "@/lib/types";

const PAGE_SIZE = 20;

const TYPE_META: Record<string, { label: string; tone: string }> = {
  sale: { label: "Sale", tone: "bg-emerald-100 text-emerald-700" },
  purchase: { label: "Purchase", tone: "bg-sky-100 text-sky-700" },
  sale_return: { label: "Sale Return", tone: "bg-amber-100 text-amber-700" },
  purchase_return: {
    label: "Purchase Return",
    tone: "bg-rose-100 text-rose-700",
  },
};

const QUICK_TYPES = [
  { key: "", label: "All" },
  { key: "sale", label: "Sales" },
  { key: "purchase", label: "Purchases" },
  { key: "sale_return", label: "Sale Returns" },
  { key: "purchase_return", label: "Purchase Returns" },
];

const DATE_PRESETS = [
  { key: "", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

const METHODS = ["cash", "card", "cheque", "bank"];
const STATUSES = [
  "completed",
  "partial",
  "returned",
  "paid",
  "unpaid",
  "received",
  "cancelled",
];

function statusTone(status: string) {
  const map: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    paid: "bg-emerald-100 text-emerald-700",
    received: "bg-emerald-100 text-emerald-700",
    partial: "bg-amber-100 text-amber-700",
    returned: "bg-rose-100 text-rose-700",
    unpaid: "bg-slate-100 text-slate-600",
    cancelled: "bg-slate-100 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-600";
}

function presetRange(preset: string): { from?: string; to?: string } {
  if (!preset) return {};
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (preset === "today") return { from: iso(startOf(now)) };
  if (preset === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: iso(startOf(y)), to: iso(startOf(now)) };
  }
  if (preset === "week") {
    const d = new Date(now);
    const day = d.getDay() === 0 ? 7 : d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day - 1));
    return { from: iso(startOf(monday)) };
  }
  if (preset === "month") {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  }
  return {};
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-LK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-LK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center text-sm text-slate-400">Loading…</div>}>
      <TransactionsInner />
    </Suspense>
  );
}

function TransactionsInner() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canSeePurchases = ["super_admin", "admin", "manager", "accountant"].includes(
    user?.role ?? ""
  );

  const [qInput, setQInput] = useState(searchParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [quickType, setQuickType] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [partyType, setPartyType] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    items: TransactionRecord[];
    total: number;
    total_pages: number;
  }>({ items: [], total: 0, total_pages: 1 });

  const [detailKey, setDetailKey] = useState<{ type: string; db_id: number } | null>(
    null
  );
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(qInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const range = useMemo(() => {
    if (customFrom || customTo) {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : undefined,
        to: customTo
          ? new Date(new Date(customTo).getTime() + 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      };
    }
    return presetRange(datePreset);
  }, [datePreset, customFrom, customTo]);

  const resetPage = useCallback(() => setPage(1), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.transactions.feed({
        q: debouncedQ || undefined,
        type: quickType || undefined,
        party_type: partyType || undefined,
        method: method || undefined,
        status: status || undefined,
        date_from: range.from,
        date_to: range.to,
        page,
        page_size: PAGE_SIZE,
      });
      setData({ items: res.items, total: res.total, total_pages: res.total_pages });
    } catch {
      setData({ items: [], total: 0, total_pages: 1 });
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, quickType, partyType, method, status, range, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detailKey) return;
    setDetailLoading(true);
    setDetail(null);
    api.transactions
      .detail(detailKey.type, detailKey.db_id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [detailKey]);

  const quickTypes = useMemo(
    () =>
      canSeePurchases
        ? QUICK_TYPES
        : QUICK_TYPES.filter((t) => !["purchase", "purchase_return"].includes(t.key)),
    [canSeePurchases]
  );

  const activeFilterCount =
    (debouncedQ ? 1 : 0) +
    (quickType ? 1 : 0) +
    (datePreset ? 1 : 0) +
    (partyType ? 1 : 0) +
    (method ? 1 : 0) +
    (status ? 1 : 0);

  function clearFilters() {
    setQInput("");
    setDebouncedQ("");
    setQuickType("");
    setDatePreset("");
    setCustomFrom("");
    setCustomTo("");
    setPartyType("");
    setMethod("");
    setStatus("");
    setPage(1);
  }

  function openDetail(rec: { type: string; db_id: number }) {
    setDetailKey(rec);
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Transactions"
        subtitle="Search every sale, purchase and return from one place"
      >
        <a href="/pos" className="btn btn-primary">
          + New Sale
        </a>
      </PageHeader>

      {/* Search */}
      <div className="toolbar">
        <div className="relative w-full sm:max-w-md">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search invoice, receipt, customer, phone, product, SKU, barcode…"
            className="input pl-12"
            autoComplete="off"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`btn btn-sm ${
              showFilters ? "btn-primary" : "btn-secondary"
            }`}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 rounded-full bg-white/25 px-2 text-[11px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="btn btn-sm btn-ghost">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Quick type pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {quickTypes.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setQuickType(t.key);
              resetPage();
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
              quickType === t.key
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 hidden h-6 w-px self-center bg-slate-200 sm:block" />
        {DATE_PRESETS.map((d) => (
          <button
            key={d.key}
            onClick={() => {
              setDatePreset(d.key);
              resetPage();
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              datePreset === d.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <div className="card mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Party type</label>
            <select
              className="select"
              value={partyType}
              onChange={(e) => {
                setPartyType(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any party</option>
              <option value="customer">Customer</option>
              {canSeePurchases && <option value="supplier">Supplier</option>}
              <option value="none">Walk-in</option>
            </select>
          </div>
          <div>
            <label className="label">Payment method</label>
            <select
              className="select"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any method</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Date range</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  if (e.target.value) setDatePreset("");
                  resetPage();
                }}
              />
              <span className="text-slate-400">–</span>
              <input
                type="date"
                className="input"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  if (e.target.value) setDatePreset("");
                  resetPage();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="mb-3 text-sm font-medium text-slate-500">
        {loading ? "Searching…" : `${data.total.toLocaleString()} result${data.total === 1 ? "" : "s"}`}
      </div>

      {loading && data.items.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No transactions found"
          hint="Try another date, a customer phone, an invoice number, or a product name."
        />
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Party</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => {
                const meta = TYPE_META[t.type];
                return (
                  <tr
                    key={t.key}
                    onClick={() => openDetail(t)}
                    className="cursor-pointer"
                  >
                    <td className="whitespace-nowrap text-slate-500">
                      {fmtDate(t.date)}
                    </td>
                    <td>
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.tone}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="font-semibold text-slate-800">
                      {t.reference}
                    </td>
                    <td>
                      <div className="text-sm font-semibold text-slate-700">
                        {t.party_name ?? "Walk-in"}
                      </div>
                      {t.party_phone && (
                        <div className="text-xs text-slate-400">{t.party_phone}</div>
                      )}
                    </td>
                    <td className="text-right font-semibold tabular-nums text-slate-800">
                      {formatMoney(t.total)}
                    </td>
                    <td>
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${statusTone(t.status)}`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(t);
                        }}
                        className="btn btn-sm btn-secondary"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Page {page} of {data.total_pages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-sm btn-secondary disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
              disabled={page >= data.total_pages}
              className="btn btn-sm btn-secondary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={!!detailKey}
        onClose={() => setDetailKey(null)}
        title="Transaction details"
        maxWidth="max-w-3xl"
      >
        {detailLoading || !detail ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading… {""}
          </div>
        ) : (
          <TransactionDetailView
            detail={detail}
            onOpen={(type, id) => openDetail({ type, db_id: id })}
          />
        )}
      </Modal>
    </div>
  );
}

function TransactionDetailView({
  detail,
  onOpen,
}: {
  detail: TransactionDetail;
  onOpen: (type: string, id: number) => void;
}) {
  const meta = TYPE_META[detail.type] ?? { label: detail.type, tone: "bg-slate-100 text-slate-600" };

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.tone}`}>
            {meta.label}
          </span>
          <span className="text-lg font-bold text-slate-900">{detail.reference}</span>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${statusTone(detail.status)}`}
          >
            {detail.status}
          </span>
        </div>
        <span className="text-sm text-slate-400">{fmtDateTime(detail.date)}</span>
      </div>

      {/* Party */}
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {detail.party_type === "supplier"
            ? "Supplier / Distributor"
            : detail.party_type === "customer"
              ? "Customer"
              : "Party"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-bold text-slate-800">
            {detail.party_name ?? "Walk-in customer"}
          </span>
          {detail.party_phone && (
            <a
              href={`tel:${detail.party_phone}`}
              className="text-sm font-medium text-emerald-600 hover:underline"
            >
              {detail.party_phone}
            </a>
          )}
          {detail.party_email && (
            <a
              href={`mailto:${detail.party_email}`}
              className="text-sm text-slate-500 hover:underline"
            >
              {detail.party_email}
            </a>
          )}
        </div>
        {detail.created_by && (
          <div className="mt-1 text-xs text-slate-400">
            Handled by {detail.created_by}
          </div>
        )}
      </div>

      {/* Money summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Subtotal" value={formatMoney(detail.subtotal)} />
        {detail.discount > 0 && <Stat label="Discount" value={`-${formatMoney(detail.discount)}`} />}
        {detail.tax > 0 && <Stat label="Tax" value={`+${formatMoney(detail.tax)}`} />}
        <Stat label="Total" value={formatMoney(detail.total)} strong />
        <Stat label="Paid" value={formatMoney(detail.paid)} />
        {detail.due > 0 ? (
          <Stat label="Due" value={formatMoney(detail.due)} warn />
        ) : (
          <Stat label="Change" value={formatMoney(Math.max(0, detail.paid - detail.total))} />
        )}
      </div>

      {/* Items with supplier traceability */}
      <div>
        <h4 className="mb-2 text-sm font-bold text-slate-700">
          Items <span className="font-medium text-slate-400">({detail.items.length})</span>
        </h4>
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-center">Qty</th>
                <th className="px-2 py-2 text-right">Unit</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.items.map((it) => (
                <tr key={it.product_id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">
                      {it.product_name}
                    </div>
                    {(it.sku || it.barcode) && (
                      <div className="text-[11px] text-slate-400">
                        {[it.sku, it.barcode].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {(detail.type === "sale" || detail.type === "sale_return") &&
                      it.source_purchase && (
                        <div className="mt-1.5 rounded-lg border border-sky-100 bg-sky-50 p-2.5 text-[11px] text-sky-900">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-sky-800">
                            <span>
                              {detail.type === "sale_return" ? "↩ Returned goods from" : "Sourced from"}{" "}
                              {it.source_purchase.supplier_name ?? "unknown supplier"}
                            </span>
                            {it.source_purchase.supplier_phone && (
                              <a
                                href={`tel:${it.source_purchase.supplier_phone}`}
                                className="font-medium text-sky-700 underline"
                              >
                                {it.source_purchase.supplier_phone}
                              </a>
                            )}
                            {it.source_purchase.supplier_email && (
                              <a
                                href={`mailto:${it.source_purchase.supplier_email}`}
                                className="font-medium text-sky-700 underline"
                              >
                                {it.source_purchase.supplier_email}
                              </a>
                            )}
                          </div>
                          <div className="mt-0.5 text-sky-700">
                            {it.source_purchase.purchase_number}
                            {it.source_purchase.purchase_date && (
                              <> · {fmtDate(it.source_purchase.purchase_date)}</>
                            )}
                            {" · cost "}
                            {formatMoney(it.source_purchase.cost_price)}
                            {it.source_purchase.invoice_number && (
                              <> · inv {it.source_purchase.invoice_number}</>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <button
                              onClick={() =>
                                onOpen("purchase", it.source_purchase!.purchase_id)
                              }
                              className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-sky-700"
                            >
                              View Purchase
                            </button>
                            <a
                              href={`tel:${it.source_purchase.supplier_phone ?? ""}`}
                              className="rounded-md border border-sky-300 bg-white px-2 py-1 text-[11px] font-bold text-sky-700 transition hover:bg-sky-50"
                            >
                              Contact Supplier
                            </a>
                            <a
                              href="/suppliers"
                              className="rounded-md border border-sky-300 bg-white px-2 py-1 text-[11px] font-bold text-sky-700 transition hover:bg-sky-50"
                            >
                              View Supplier
                            </a>
                            {detail.type === "sale_return" && (
                              <a
                                href={`/purchases?return=1&purchase=${it.source_purchase.purchase_id}`}
                                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100"
                              >
                                Create Supplier Return
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums">{it.qty}</td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {formatMoney(it.unit_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(it.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payments */}
      {detail.payments.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">Payments</h4>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
            {detail.payments.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-white px-4 py-2.5 text-sm"
              >
                <span className="capitalize text-slate-600">
                  {p.method}
                  {p.reference && (
                    <span className="ml-2 text-xs text-slate-400">{p.reference}</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Original / related */}
      {detail.original && (
        <RelatedBox
          label="Returned against"
          related={detail.original}
          onOpen={onOpen}
        />
      )}
      {detail.related_returns.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">
            Returns ({detail.related_returns.length})
          </h4>
          <div className="space-y-2">
            {detail.related_returns.map((r) => (
              <RelatedBox key={r.key} label="" related={r} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}

      {/* Stock movements */}
      {detail.movements.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">Stock movements</h4>
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-2 py-2 text-right">Change</th>
                  <th className="px-2 py-2 text-right">Before</th>
                  <th className="px-2 py-2 text-right">After</th>
                  <th className="px-4 py-2 text-left">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.movements.map((m, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 text-slate-700">{m.product_name}</td>
                    <td
                      className={`px-2 py-2.5 text-right font-bold tabular-nums ${
                        m.change_qty > 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {m.change_qty > 0 ? `+${m.change_qty}` : m.change_qty}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-500">
                      {m.previous_stock}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                      {m.new_stock}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {fmtDateTime(m.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail.note && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-bold">Note:</span> {detail.note}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <a href="/pos" className="btn btn-primary btn-sm">
          + New Sale
        </a>
        <a
          href={detail.type.includes("purchase") ? "/purchases" : "/sales"}
          className="btn btn-secondary btn-sm"
        >
          Open {detail.type.includes("purchase") ? "Purchases" : "Sales"} module
        </a>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  strong = false,
  warn = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 tabular-nums ${
          strong
            ? "text-lg font-bold text-slate-900"
            : warn
              ? "text-base font-bold text-rose-600"
              : "text-base font-semibold text-slate-700"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function RelatedBox({
  label,
  related,
  onOpen,
}: {
  label: string;
  related: RelatedTransaction;
  onOpen: (type: string, id: number) => void;
}) {
  const meta = TYPE_META[related.type] ?? { label: related.type, tone: "bg-slate-100 text-slate-600" };
  return (
    <div>
      {label && (
        <h4 className="mb-2 text-sm font-bold text-slate-700">{label}</h4>
      )}
      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.tone}`}>
            {meta.label}
          </span>
          <span className="text-sm font-semibold text-slate-700">
            {related.reference}
          </span>
          {related.date && (
            <span className="text-xs text-slate-400">{fmtDate(related.date)}</span>
          )}
          <span className="text-sm font-semibold tabular-nums text-slate-700">
            {formatMoney(related.total)}
          </span>
        </div>
        <button
          onClick={() => onOpen(related.type, related.db_id)}
          className="btn btn-sm btn-secondary"
        >
          View
        </button>
      </div>
    </div>
  );
}
