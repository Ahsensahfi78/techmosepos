"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { FinanceEntry } from "@/lib/types";

type Tab = "expenses" | "income";

const CATEGORY_PRESETS = [
  "Rent",
  "Utilities",
  "Salaries",
  "Supplies",
  "Maintenance",
  "Marketing",
  "Other",
];

export default function FinancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    user?.role === "accountant";

  const [tab, setTab] = useState<Tab>("expenses");
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total_expenses: 0, total_income: 0, net: 0 });
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ category: "", amount: "", note: "", date: "" });

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.finance.summary());
    } catch {
      /* ignore */
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const data =
        tab === "expenses"
          ? await api.finance.expenses({ page_size: 100 })
          : await api.finance.income({ page_size: 100 });
      setEntries(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setLoading(true);
    loadList();
  }, [loadList]);

  function openModal() {
    setForm({ category: "", amount: "", note: "", date: "" });
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
    const payload = {
      category: form.category || (tab === "expenses" ? "Miscellaneous" : "Other Income"),
      amount,
      note: form.note || undefined,
      entry_date: form.date ? new Date(form.date).toISOString() : undefined,
    };
    setSubmitting(true);
    try {
      if (tab === "expenses") await api.finance.createExpense(payload);
      else await api.finance.createIncome(payload);
      toast(`${tab === "expenses" ? "Expense" : "Income"} recorded`, "success");
      setModalOpen(false);
      loadList();
      loadSummary();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeEntry(entry: FinanceEntry) {
    try {
      if (tab === "expenses") await api.finance.deleteExpense(entry.id);
      else await api.finance.deleteIncome(entry.id);
      toast("Entry deleted", "success");
      loadList();
      loadSummary();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  const cards = [
    {
      label: "Total income",
      value: summary.total_income,
      icon: "📈",
      accent: "from-emerald-500 to-teal-600",
      shadow: "shadow-emerald-200",
    },
    {
      label: "Total expenses",
      value: summary.total_expenses,
      icon: "💸",
      accent: "from-rose-500 to-red-600",
      shadow: "shadow-rose-200",
    },
    {
      label: "Net position",
      value: summary.net,
      icon: "⚖️",
      accent: summary.net >= 0 ? "from-sky-500 to-indigo-600" : "from-orange-500 to-red-600",
      shadow: "shadow-sky-200",
    },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Expenses & Income" subtitle="Record business expenses and other income">
        {canManage && (
          <button onClick={openModal} className="btn btn-primary">
            + Add {tab === "expenses" ? "expense" : "income"}
          </button>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="card !p-4 flex items-center gap-3"
          >
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${c.accent} text-lg shadow-lg ${c.shadow}`}
            >
              {c.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {c.label}
              </p>
              <p className="text-xl font-bold tabular-nums text-slate-900">
                {c.value.toLocaleString(undefined, {
                  style: "currency",
                  currency: "PKR",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["expenses", `Expenses (${tab === "expenses" ? total : ""})`],
            ["income", `Income (${tab === "income" ? total : ""})`],
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
        ) : entries.length === 0 ? (
          <EmptyState
            icon={tab === "expenses" ? "💸" : "📈"}
            title={`No ${tab} recorded`}
            hint={canManage ? `Add your first ${tab === "expenses" ? "expense" : "income"} entry.` : "No entries yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Note</th>
                  <th className="hidden md:table-cell">Date</th>
                  <th className="hidden md:table-cell">By</th>
                  <th className="text-right">Amount</th>
                  {canManage && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                        {e.category}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate text-slate-600">
                      {e.note || "—"}
                    </td>
                    <td className="hidden text-xs text-slate-400 md:table-cell">
                      {new Date(e.entry_date).toLocaleDateString()}
                    </td>
                    <td className="hidden text-xs text-slate-400 md:table-cell">
                      {e.created_by_name || "—"}
                    </td>
                    <td
                      className={`text-right font-bold tabular-nums ${
                        tab === "expenses" ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {e.amount.toLocaleString(undefined, {
                        style: "currency",
                        currency: "PKR",
                      })}
                    </td>
                    {canManage && (
                      <td className="text-right">
                        <button
                          onClick={() => removeEntry(e)}
                          className="btn btn-sm btn-danger-soft"
                        >
                          Delete
                        </button>
                      </td>
                    )}
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
        title={`Add ${tab === "expenses" ? "expense" : "income"}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="label">Category *</label>
            <input
              list="category-presets"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder={tab === "expenses" ? "Miscellaneous" : "Other Income"}
              className="input"
            />
            <datalist id="category-presets">
              {CATEGORY_PRESETS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="input"
            />
          </div>
          <div>
            <label className="label">Note</label>
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Optional description"
              className="input"
            />
          </div>
          {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting ? "Saving…" : `Add ${tab === "expenses" ? "expense" : "income"}`}
          </button>
        </form>
      </Modal>
    </div>
  );
}
