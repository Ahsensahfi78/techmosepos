"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { Cheque } from "@/lib/types";

type Tab = "received" | "issued";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-600",
  cleared: "bg-emerald-50 text-emerald-600",
  returned: "bg-red-50 text-red-600",
};

export default function ChequesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    user?.role === "accountant";

  const [tab, setTab] = useState<Tab>("received");
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    number: "",
    bank: "",
    account_name: "",
    payee: "",
    amount: "",
    due_date: "",
    notes: "",
  });

  const load = useCallback(async () => {
    try {
      const data = await api.cheques.list({ direction: tab, page_size: 100 });
      setCheques(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  function openModal() {
    setForm({
      number: "",
      bank: "",
      account_name: "",
      payee: "",
      amount: "",
      due_date: "",
      notes: "",
    });
    setFormError("");
    setModalOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    try {
      await api.cheques.create({
        direction: tab,
        number: form.number || undefined,
        bank: form.bank || undefined,
        account_name: form.account_name || undefined,
        payee: form.payee || undefined,
        amount,
        due_date: form.due_date ? new Date(form.due_date).toISOString() : undefined,
        notes: form.notes || undefined,
      });
      toast("Cheque recorded", "success");
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(cheque: Cheque, status: string) {
    try {
      await api.cheques.updateStatus(cheque.id, status);
      toast(`Cheque marked ${status}`, "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  }

  async function removeCheque(cheque: Cheque) {
    try {
      await api.cheques.remove(cheque.id);
      toast("Cheque deleted", "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  const pending = cheques.filter((c) => c.status === "pending");
  const cleared = cheques.filter((c) => c.status === "cleared");
  const returned = cheques.filter((c) => c.status === "returned");
  const pendingValue = pending.reduce((s, c) => s + c.amount, 0);
  const clearedValue = cleared.reduce((s, c) => s + c.amount, 0);
  const returnedValue = returned.reduce((s, c) => s + c.amount, 0);

  const cards = [
    { label: "Pending", value: pendingValue, count: pending.length, cls: "text-amber-600", bg: "bg-amber-50" },
    { label: "Cleared", value: clearedValue, count: cleared.length, cls: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Returned", value: returnedValue, count: returned.length, cls: "text-red-600", bg: "bg-red-50" },
  ];

  if (!canManage) {
    return (
      <EmptyState
        icon="🚫"
        title="No access"
        hint="You do not have permission to manage cheques."
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Cheques" subtitle="Track received and issued cheques">
        <button
          onClick={openModal}
          className="btn btn-primary"
        >
          + Add {tab === "received" ? "received" : "issued"} cheque
        </button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="card !p-4 flex items-center justify-between"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {c.label}
              </p>
              <p className={`text-xl font-bold tabular-nums ${c.cls}`}>
                {c.value.toLocaleString(undefined, {
                  style: "currency",
                  currency: "PKR",
                })}
              </p>
            </div>
            <span
              className={`grid h-10 w-10 place-items-center rounded-xl ${c.bg} ${c.cls} text-sm font-bold`}
            >
              {c.count}
            </span>
          </div>
        ))}
      </div>

      <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["received", `Received (${tab === "received" ? total : ""})`],
            ["issued", `Issued (${tab === "issued" ? total : ""})`],
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

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : cheques.length === 0 ? (
          <EmptyState
            icon="💳"
            title={`No ${tab} cheques`}
            hint="Add a cheque to start tracking it."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Cheque #</th>
                  <th>Bank</th>
                  <th className="hidden md:table-cell">Account / Payee</th>
                  <th className="hidden md:table-cell">Due</th>
                  <th>Status</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/60"
                  >
                    <td className="font-bold text-slate-800">{c.number || `#${c.id}`}</td>
                    <td className="text-slate-600">{c.bank || "—"}</td>
                    <td className="hidden text-xs text-slate-400 md:table-cell">
                      {tab === "received" ? c.account_name || "—" : c.payee || "—"}
                    </td>
                    <td className="hidden text-xs text-slate-400 md:table-cell">
                      {c.due_date ? new Date(c.due_date).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                          STATUS_STYLES[c.status] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="text-right font-bold tabular-nums">
                      {c.amount.toLocaleString(undefined, {
                        style: "currency",
                        currency: "PKR",
                      })}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {c.status === "pending" && (
                          <>
                            <button
                              onClick={() => setStatus(c, "cleared")}
                              className="btn btn-sm btn-primary"
                            >
                              Clear
                            </button>
                            <button
                              onClick={() => setStatus(c, "returned")}
                              className="btn btn-sm btn-danger-soft"
                            >
                              Bounce
                            </button>
                          </>
                        )}
                        {c.status === "cleared" && (
                          <button
                            onClick={() => setStatus(c, "returned")}
                            className="btn btn-sm btn-danger-soft"
                          >
                            Bounce
                          </button>
                        )}
                        <button
                          onClick={() => removeCheque(c)}
                          className="btn btn-sm btn-danger-soft"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Add ${tab} cheque`}
        maxWidth="max-w-md"
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Cheque number</label>
              <input
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Bank</label>
              <input
                value={form.bank}
                onChange={(e) => setForm((f) => ({ ...f, bank: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="label">
                {tab === "received" ? "Account name" : "Payee"}
              </label>
              <input
                value={tab === "received" ? form.account_name : form.payee}
                onChange={(e) =>
                  setForm((f) =>
                    tab === "received"
                      ? { ...f, account_name: e.target.value }
                      : { ...f, payee: e.target.value }
                  )
                }
                className="input"
              />
            </div>
            <div>
              <label className="label">Amount *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                autoFocus
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="label">Due date</label>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="label">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="input"
            />
          </div>
          {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting ? "Saving…" : "Save cheque"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
