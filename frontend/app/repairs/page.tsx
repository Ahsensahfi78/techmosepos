"use client";

import { useCallback, useEffect, useState } from "react";
import { api, master } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import { formatMoney } from "@/lib/constants";
import type { Customer, Repair } from "@/lib/types";

const TRANSITIONS: Record<string, string[]> = {
  received: ["diagnosing", "repairing", "cancelled"],
  diagnosing: ["repairing", "received", "cancelled"],
  repairing: ["ready", "received", "cancelled"],
  ready: ["delivered", "repairing"],
  delivered: [],
  cancelled: [],
};

const STATUS_STYLES: Record<string, string> = {
  received: "bg-slate-100 text-slate-600",
  diagnosing: "bg-blue-50 text-blue-600",
  repairing: "bg-amber-50 text-amber-600",
  ready: "bg-emerald-50 text-emerald-600",
  delivered: "bg-teal-50 text-teal-600",
  cancelled: "bg-red-50 text-red-600",
};

export default function RepairsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";

  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    customer_id: "",
    product_name: "",
    imei: "",
    issue: "",
    service_charge: "",
    parts_cost: "",
    deposit: "",
    technician: "",
    notes: "",
  });

  const [payTarget, setPayTarget] = useState<Repair | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.repairs.list({
        page_size: 100,
        q: search || undefined,
        status: statusFilter || undefined,
      });
      setRepairs(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    master.customers
      .list({ page_size: 100 })
      .then((res) => setCustomers(res.items))
      .catch(() => {});
  }, []);

  function openModal() {
    setForm({
      customer_id: "",
      product_name: "",
      imei: "",
      issue: "",
      service_charge: "",
      parts_cost: "",
      deposit: "",
      technician: "",
      notes: "",
    });
    setFormError("");
    setModalOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.product_name.trim()) {
      setFormError("Product name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await api.repairs.create({
        customer_id: form.customer_id ? Number(form.customer_id) : undefined,
        product_name: form.product_name.trim(),
        imei: form.imei.trim() || undefined,
        issue: form.issue.trim() || undefined,
        service_charge: form.service_charge ? Number(form.service_charge) : 0,
        parts_cost: form.parts_cost ? Number(form.parts_cost) : 0,
        deposit: form.deposit ? Number(form.deposit) : 0,
        technician: form.technician.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast("Repair ticket created", "success");
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(repair: Repair, status: string) {
    try {
      await api.repairs.updateStatus(repair.id, status);
      toast(`${repair.repair_number} → ${status}`, "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  }

  function openPayment(repair: Repair) {
    setPayTarget(repair);
    const due = Math.max(0, repair.total - repair.paid_amount);
    setPayAmount(due > 0 ? String(due) : "");
    setFormError("");
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    setPaying(true);
    try {
      await api.repairs.payment(payTarget.id, amount);
      toast(`Payment of ${formatMoney(amount)} recorded`, "success");
      setPayTarget(null);
      setPayAmount("");
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  async function removeRepair(repair: Repair) {
    if (!confirm(`Delete ${repair.repair_number}? This cannot be undone.`)) return;
    try {
      await api.repairs.remove(repair.id);
      toast("Repair deleted", "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  const activeCount = repairs.filter(
    (r) => !["delivered", "cancelled"].includes(r.status)
  ).length;
  const readyCount = repairs.filter((r) => r.status === "ready").length;
  const outstanding = repairs.reduce(
    (s, r) => s + Math.max(0, r.total - r.paid_amount),
    0
  );

  const cards = [
    { label: "Active tickets", value: String(activeCount), cls: "text-slate-700" },
    { label: "Ready for pickup", value: String(readyCount), cls: "text-emerald-600" },
    {
      label: "Outstanding balance",
      value: formatMoney(outstanding),
      cls: "text-amber-600",
    },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Repairs" subtitle="Service tickets and repair tracking">
        {canManage && (
          <button onClick={openModal} className="btn btn-primary">
            + New repair
          </button>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="card !p-4 flex items-center justify-between"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {c.label}
              </p>
              <p className={`text-xl font-bold tabular-nums ${c.cls}`}>{c.value}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-lg">
              🔧
            </span>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket, product or IMEI…"
          className="input"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select sm:w-48"
        >
          <option value="">All statuses</option>
          {Object.keys(TRANSITIONS).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : repairs.length === 0 ? (
          <EmptyState
            icon="🔧"
            title="No repairs"
            hint={
              canManage
                ? "Create a repair ticket to start tracking service jobs."
                : "No repairs match your filters."
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Product / IMEI</th>
                <th className="hidden md:table-cell">Customer</th>
                <th className="hidden lg:table-cell">Technician</th>
                <th>Status</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {repairs.map((r) => {
                const due = Math.max(0, r.total - r.paid_amount);
                return (
                  <tr key={r.id}>
                    <td>
                      <p className="font-bold text-slate-800">{r.repair_number}</p>
                      <p className="text-[11px] text-slate-400">
                        {new Date(r.created_at).toLocaleString()}
                      </p>
                    </td>
                    <td>
                      <p className="font-semibold text-slate-700">{r.product_name}</p>
                      {r.imei && (
                        <p className="font-mono text-[11px] text-slate-400">{r.imei}</p>
                      )}
                      {r.issue && (
                        <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-slate-400">
                          {r.issue}
                        </p>
                      )}
                    </td>
                    <td className="hidden text-xs text-slate-500 md:table-cell">
                      {r.customer_name || "Walk-in"}
                    </td>
                    <td className="hidden text-xs text-slate-500 lg:table-cell">
                      {r.technician || "—"}
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                          STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <p className="text-xs font-semibold text-slate-500">
                        {formatMoney(r.total)}
                      </p>
                      <p
                        className={`text-[11px] font-bold ${
                          due > 0 ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {due > 0 ? `due ${formatMoney(due)}` : "paid"}
                      </p>
                    </td>
                    <td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {canManage &&
                          TRANSITIONS[r.status]?.map((s) => (
                            <button
                              key={s}
                              onClick={() => changeStatus(r, s)}
                              className="btn btn-sm btn-secondary"
                            >
                              {s}
                            </button>
                          ))}
                        {canManage && due > 0 && (
                          <button
                            onClick={() => openPayment(r)}
                            className="btn btn-sm btn-primary"
                          >
                            Collect
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => removeRepair(r)}
                            className="btn btn-sm btn-ghost"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New repair ticket"
        maxWidth="max-w-lg"
      >
        <form onSubmit={submit} className="space-y-5">
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Product name *</label>
              <input
                value={form.product_name}
                onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
                placeholder="e.g. Samsung Galaxy A54"
                className="input"
              />
            </div>
            <div>
              <label className="label">IMEI</label>
              <input
                value={form.imei}
                onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))}
                placeholder="Optional"
                className="input font-mono"
              />
            </div>
          </div>
          <div>
            <label className="label">Reported issue</label>
            <textarea
              value={form.issue}
              onChange={(e) => setForm((f) => ({ ...f, issue: e.target.value }))}
              rows={2}
              className="textarea"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Service charge</label>
              <input
                type="number"
                min="0"
                value={form.service_charge}
                onChange={(e) =>
                  setForm((f) => ({ ...f, service_charge: e.target.value }))
                }
                placeholder="0"
                className="input"
              />
            </div>
            <div>
              <label className="label">Parts cost</label>
              <input
                type="number"
                min="0"
                value={form.parts_cost}
                onChange={(e) => setForm((f) => ({ ...f, parts_cost: e.target.value }))}
                placeholder="0"
                className="input"
              />
            </div>
            <div>
              <label className="label">Deposit</label>
              <input
                type="number"
                min="0"
                value={form.deposit}
                onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
                placeholder="0"
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="label">Technician</label>
            <input
              value={form.technician}
              onChange={(e) => setForm((f) => ({ ...f, technician: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="textarea"
            />
          </div>
          {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting ? "Saving…" : "Create ticket"}
          </button>
        </form>
      </Modal>

      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={`Collect payment — ${payTarget?.repair_number ?? ""}`}
        maxWidth="max-w-sm"
      >
        {payTarget && (
          <form onSubmit={submitPayment} className="space-y-5">
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Total</span>
                <b className="text-slate-800">{formatMoney(payTarget.total)}</b>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Paid</span>
                <b className="text-emerald-600">{formatMoney(payTarget.paid_amount)}</b>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-sm font-semibold">
                <span className="text-slate-600">Due</span>
                <b className="text-amber-600">
                  {formatMoney(Math.max(0, payTarget.total - payTarget.paid_amount))}
                </b>
              </div>
            </div>
            <div>
              <label className="label">Amount *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                autoFocus
                className="input text-lg font-bold"
              />
            </div>
            {formError && (
              <p className="text-xs font-semibold text-red-600">{formError}</p>
            )}
            <button
              type="submit"
              disabled={paying}
              className="btn btn-primary w-full"
            >
              {paying ? "Recording…" : "Record payment"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
