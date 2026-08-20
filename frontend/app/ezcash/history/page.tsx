"use client";

import { useCallback, useEffect, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/constants";
import type { EzCashReload } from "@/lib/types";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "successful", label: "Successful" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_STYLES: Record<string, string> = {
  successful: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
  cancelled: "bg-slate-100 text-slate-600",
};

export default function EzCashHistoryPage() {
  const [items, setItems] = useState<EzCashReload[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detail, setDetail] = useState<EzCashReload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.ezcash.list({
        phone: phone || undefined,
        reference: reference || undefined,
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        page_size: 20,
      });
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [phone, reference, status, dateFrom, dateTo, page]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (status) params.set("status", status);
    window.open(
      `${API_BASE}/ezcash/reports/export?${params.toString()}`,
      "_blank"
    );
  }

  return (
    <div>
      <PageHeader title="EZ Cash Reload History" subtitle={`${total} transactions`}>
        <button onClick={exportCsv} className="btn btn-secondary text-sm">
          Export CSV
        </button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPage(1);
          }}
          placeholder="Search phone..."
          className="input w-40"
        />
        <input
          type="text"
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
            setPage(1);
          }}
          placeholder="Search reference..."
          className="input w-40"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="select w-36"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="input w-40"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="input w-40"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading...</div>
      ) : items.length === 0 ? (
        <EmptyState title="No reload transactions found" hint="Try adjusting your filters" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Carrier</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Cashier</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{r.reference_number}</td>
                  <td className="px-4 py-3">{r.phone_number}</td>
                  <td className="px-4 py-3 text-xs capitalize text-slate-500">{r.operator_name ?? r.carrier ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-bold">{formatMoney(r.amount)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${
                        STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.created_by_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setDetail(r)}
                      className="text-xs font-semibold text-emerald-600 hover:underline"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn btn-secondary text-sm"
          >
            Prev
          </button>
          <span className="text-sm text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn btn-secondary text-sm"
          >
            Next
          </button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" onClick={() => setDetail(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Transaction Details</h3>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Reference</span>
                <span className="font-mono font-semibold">{detail.reference_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Phone</span>
                <span>{detail.phone_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Normalized</span>
                <span className="font-mono">{detail.normalized_phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="text-lg font-bold">{formatMoney(detail.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method</span>
                <span className="capitalize">{detail.payment_method ?? "—"}</span>
              </div>
              {detail.operator_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Network</span>
                  <span className="capitalize">{detail.operator_name}</span>
                </div>
              )}
              {detail.delivered_amount != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Delivered</span>
                  <span className="font-semibold">{detail.delivered_amount} {detail.delivered_currency}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${
                    STATUS_STYLES[detail.status] ?? ""
                  }`}
                >
                  {detail.status}
                </span>
              </div>
              {detail.provider_reference && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Provider Ref</span>
                  <span className="font-mono">{detail.provider_reference}</span>
                </div>
              )}
              {detail.failure_reason && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Failure Reason</span>
                  <span className="text-red-600">{detail.failure_reason}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Cashier</span>
                <span>{detail.created_by_name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date</span>
                <span>{formatDate(detail.created_at)}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {(detail.status === "failed" || detail.status === "cancelled") && (
                <button
                  onClick={async () => {
                    try {
                      const r = await api.ezcash.retry(detail.id);
                      setDetail(r);
                      load();
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="btn btn-primary flex-1 text-sm"
                >
                  Retry
                </button>
              )}
              {detail.status === "pending" && (
                <button
                  onClick={async () => {
                    try {
                      const r = await api.ezcash.cancel(detail.id);
                      setDetail(r);
                      load();
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="btn btn-secondary flex-1 text-sm text-red-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
