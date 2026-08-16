"use client";

import { useCallback, useEffect, useState } from "react";
import { api, master } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type {
  Customer,
  CustomerReport,
  LedgerEntry,
  Supplier,
  SupplierReport,
} from "@/lib/types";

type Party = Supplier | Customer;

interface PartyManagerProps {
  type: "supplier" | "customer";
  canManage: boolean;
}

interface FormState {
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  tax_number: string;
  credit_limit: string;
}

const emptyForm: FormState = {
  name: "",
  company: "",
  phone: "",
  email: "",
  address: "",
  tax_number: "",
  credit_limit: "0",
};

const ENTRY_LABELS: Record<string, string> = {
  opening_balance: "Opening balance",
  payment: "Payment",
  credit_note: "Credit note",
  purchase: "Purchase",
  sale: "Sale",
  return: "Return",
};

const METHOD_OPTIONS = ["cash", "bank_transfer", "cheque", "card", "other"];

type ActionType = "payment" | "credit_note" | "opening_balance" | "loyalty";

export default function PartyManager({ type, canManage }: PartyManagerProps) {
  const { toast } = useToast();
  const isSupplier = type === "supplier";

  const [items, setItems] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Party | null>(null);
  const [report, setReport] = useState<SupplierReport | CustomerReport | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [entryType, setEntryType] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const [action, setAction] = useState<ActionType | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSaving, setActionSaving] = useState(false);
  const [actionForm, setActionForm] = useState({
    amount: "",
    method: "cash",
    reference: "",
    note: "",
    points: "",
  });

  const label = isSupplier ? "supplier" : "customer";
  const cap = isSupplier ? "Supplier" : "Customer";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const crud = isSupplier ? master.suppliers : master.customers;
      const data = await crud.list({
        page,
        page_size: pageSize,
        search: search || undefined,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      toast(err instanceof Error ? err.message : `Failed to load ${label}s`, "error");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, isSupplier, label, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback(
    async (party: Party) => {
      setDetailLoading(true);
      setReport(null);
      setEntries([]);
      try {
        const [rep, led] = await Promise.all([
          isSupplier
            ? api.reports.supplier(party.id)
            : api.reports.customer(party.id),
          (isSupplier
            ? api.ledger.supplierEntries(party.id, { page_size: 100 })
            : api.ledger.customerEntries(party.id, { page_size: 100 })
          ).catch(() => ({ items: [], total: 0 } as never)),
        ]);
        setReport(rep as SupplierReport | CustomerReport);
        setEntries((led as { items: LedgerEntry[] }).items);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load ledger", "error");
      } finally {
        setDetailLoading(false);
      }
    },
    [isSupplier, toast]
  );

  function openDetail(party: Party) {
    setDetail(party);
    setEntryType("");
    loadDetail(party);
  }

  function refreshDetail() {
    if (detail) loadDetail(detail);
    load();
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(p: Party) {
    setEditing(p);
    const c = p as Customer;
    setForm({
      name: p.name,
      company: (p as Supplier).company ?? "",
      phone: p.phone ?? "",
      email: p.email ?? "",
      address: p.address ?? "",
      tax_number: (p as Supplier).tax_number ?? "",
      credit_limit: String(c.credit_limit ?? 0),
    });
    setFormError("");
    setFormOpen(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const crud = isSupplier ? master.suppliers : master.customers;
      if (editing) {
        const payload: Record<string, unknown> = { name: form.name.trim() };
        if (isSupplier) {
          if (form.company.trim()) payload.company = form.company.trim();
          if (form.phone.trim()) payload.phone = form.phone.trim();
          if (form.email.trim()) payload.email = form.email.trim();
          if (form.address.trim()) payload.address = form.address.trim();
          if (form.tax_number.trim()) payload.tax_number = form.tax_number.trim();
        } else {
          if (form.phone.trim()) payload.phone = form.phone.trim();
          if (form.email.trim()) payload.email = form.email.trim();
          if (form.address.trim()) payload.address = form.address.trim();
          payload.credit_limit = Number(form.credit_limit) || 0;
        }
        await crud.update(editing.id, payload);
        toast(`${cap} updated`, "success");
      } else {
        const payload: Record<string, unknown> = { name: form.name.trim() };
        if (isSupplier) {
          if (form.company.trim()) payload.company = form.company.trim();
          if (form.phone.trim()) payload.phone = form.phone.trim();
          if (form.email.trim()) payload.email = form.email.trim();
          if (form.address.trim()) payload.address = form.address.trim();
          if (form.tax_number.trim()) payload.tax_number = form.tax_number.trim();
        } else {
          if (form.phone.trim()) payload.phone = form.phone.trim();
          if (form.email.trim()) payload.email = form.email.trim();
          if (form.address.trim()) payload.address = form.address.trim();
          payload.credit_limit = Number(form.credit_limit) || 0;
        }
        await crud.create(payload);
        toast(`${cap} created`, "success");
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function openAction(actionType: ActionType) {
    setAction(actionType);
    setActionForm({
      amount: "",
      method: "cash",
      reference: "",
      note: "",
      points: "",
    });
    setActionError("");
  }

  async function submitAction(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !action) return;
    setActionError("");
    const amount = Number(actionForm.amount);
    if (action !== "loyalty" && (!amount || amount <= 0)) {
      setActionError("Enter a valid amount greater than zero.");
      return;
    }
    setActionSaving(true);
    try {
      if (isSupplier) {
        if (action === "payment") {
          await api.ledger.supplierPayment(detail.id, {
            amount,
            method: actionForm.method,
            reference: actionForm.reference || undefined,
            note: actionForm.note || undefined,
          });
          toast("Payment recorded", "success");
        } else if (action === "credit_note") {
          await api.ledger.supplierCreditNote(detail.id, {
            amount,
            reference: actionForm.reference || undefined,
            note: actionForm.note || undefined,
          });
          toast("Credit note posted", "success");
        } else {
          await api.ledger.supplierOpeningBalance(detail.id, {
            amount,
            note: actionForm.note || undefined,
          });
          toast("Opening balance set", "success");
        }
      } else {
        if (action === "payment") {
          await api.ledger.customerPayment(detail.id, {
            amount,
            method: actionForm.method,
            reference: actionForm.reference || undefined,
            note: actionForm.note || undefined,
          });
          toast("Payment recorded", "success");
        } else if (action === "credit_note") {
          await api.ledger.customerCreditNote(detail.id, {
            amount,
            reference: actionForm.reference || undefined,
            note: actionForm.note || undefined,
          });
          toast("Credit note posted", "success");
        } else if (action === "loyalty") {
          const delta = Number(actionForm.points);
          if (!delta) {
            setActionError("Enter a points value.");
            return;
          }
          await api.ledger.customerLoyalty(detail.id, delta);
          toast(`Loyalty adjusted by ${delta}`, "success");
        } else {
          await api.ledger.customerOpeningBalance(detail.id, {
            amount,
            note: actionForm.note || undefined,
          });
          toast("Opening balance set", "success");
        }
      }
      setAction(null);
      refreshDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const summary = report as SupplierReport | CustomerReport | null;
  const sr = report as SupplierReport | null;
  const cr = report as CustomerReport | null;
  const filteredEntries =
    entryType === "" ? entries : entries.filter((e) => e.entry_type === entryType);

  const actionTitle =
    !action ? "" : isSupplier
      ? action === "payment"
        ? `Record supplier payment — ${detail?.name}`
        : action === "credit_note"
          ? `Credit note — ${detail?.name}`
          : `Set opening balance — ${detail?.name}`
      : action === "payment"
        ? `Record customer payment — ${detail?.name}`
        : action === "credit_note"
          ? `Credit note — ${detail?.name}`
          : action === "loyalty"
            ? `Adjust loyalty points — ${detail?.name}`
            : `Set opening balance — ${detail?.name}`;

  return (
    <div className="animate-fade-up">
      <PageHeader title={`${cap}s`} subtitle={`${total} ${label}s in the system`}>
        {canManage && (
          <button onClick={openAdd} className="btn btn-primary">
            + New {label}
          </button>
        )}
      </PageHeader>

      <div className="toolbar">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={`Search ${label}s…`}
          className="input sm:max-w-xs"
        />
      </div>

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={isSupplier ? "🚚" : "🧑‍🤝‍🧑"}
            title={`No ${label}s found`}
            hint={
              canManage
                ? `Create a ${label} to start tracking.`
                : `No ${label}s recorded yet.`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{cap}</th>
                  <th className="hidden md:table-cell">
                    {isSupplier ? "Company" : "Contact"}
                  </th>
                  <th className="text-right">Due balance</th>
                  {!isSupplier && (
                    <th className="hidden text-right sm:table-cell">
                      Points
                    </th>
                  )}
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-bold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.phone || "—"}</p>
                    </td>
                    <td className="hidden text-slate-500 md:table-cell">
                      {isSupplier
                        ? (p as Supplier).company || "—"
                        : p.email || "—"}
                    </td>
                    <td className="text-right">
                      <span
                        className={`font-bold tabular-nums ${
                          p.due_balance > 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {p.due_balance.toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })}
                      </span>
                    </td>
                    {!isSupplier && (
                      <td className="hidden text-right text-slate-500 tabular-nums sm:table-cell">
                        {(p as Customer).loyalty_points ?? 0}
                      </td>
                    )}
                    <td className="text-right">
                      <button
                        onClick={() => openDetail(p)}
                        className="btn btn-sm btn-secondary"
                      >
                        Ledger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn btn-sm btn-secondary disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn btn-sm btn-secondary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* create / edit */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : `New ${label}`}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="label">Name *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder={isSupplier ? "Acme Supplies Ltd." : "Jane Customer"}
              autoFocus
              className="input"
            />
          </div>
          {isSupplier && (
            <div>
              <label className="label">Company</label>
              <input
                name="company"
                value={form.company}
                onChange={handleChange}
                placeholder="Company name"
                className="input"
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Phone</label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="+1 555 000 0000"
                className="input"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="contact@example.com"
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="label">Address</label>
            <input
              name="address"
              value={form.address}
              onChange={handleChange}
              placeholder="Street, city"
              className="input"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {isSupplier ? (
              <div>
                <label className="label">Tax number</label>
                <input
                  name="tax_number"
                  value={form.tax_number}
                  onChange={handleChange}
                  placeholder="VAT / TIN"
                  className="input"
                />
              </div>
            ) : (
              <div>
                <label className="label">Credit limit</label>
                <input
                  name="credit_limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.credit_limit}
                  onChange={handleChange}
                  className="input"
                />
              </div>
            )}
          </div>
          {formError && (
            <p className="text-xs font-semibold text-red-600">{formError}</p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary w-full"
          >
            {saving ? "Saving…" : editing ? "Save changes" : `Create ${label}`}
          </button>
        </form>
      </Modal>

      {/* ledger detail */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.name} — Ledger` : ""}
        maxWidth="max-w-3xl"
      >
        {detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
              <div>
                <p className="text-xs text-slate-400">Due balance</p>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    detail.due_balance > 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {detail.due_balance.toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <>
                    <button
                      onClick={() => openAction("payment")}
                      className="btn btn-sm btn-primary"
                    >
                      💵 Payment
                    </button>
                    <button
                      onClick={() => openAction("credit_note")}
                      className="btn btn-sm bg-sky-500 text-white hover:bg-sky-600"
                    >
                      📝 Credit note
                    </button>
                    <button
                      onClick={() => openAction("opening_balance")}
                      className="btn btn-sm bg-slate-800 text-white hover:bg-slate-900"
                    >
                      ⚖️ Opening balance
                    </button>
                    {!isSupplier && (
                      <button
                        onClick={() => openAction("loyalty")}
                        className="btn btn-sm bg-purple-500 text-white hover:bg-purple-600"
                      >
                        ⭐ Loyalty
                      </button>
                    )}
                  </>
                )}
                {!isSupplier && canManage && (
                  <button
                    onClick={() => openEdit(detail)}
                    className="btn btn-sm bg-slate-200 text-slate-700 hover:bg-slate-300"
                  >
                    ✏️ Edit
                  </button>
                )}
              </div>
            </div>

            {!isSupplier && summary && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Total sales
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {(cr?.total_sales ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Total paid
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {(cr?.total_payments ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Credit limit
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {(cr?.credit_limit ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Loyalty points
                  </p>
                  <p className="text-sm font-bold text-purple-600">
                    {cr?.loyalty_points ?? 0}
                  </p>
                </div>
              </div>
            )}

            {isSupplier && summary && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Purchases
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {(sr?.total_purchases ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Total paid
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {(sr?.total_payments ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Credit notes
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {(sr?.total_credit_notes ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Products supplied
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {sr?.products_supplied ?? 0}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500">Ledger entries</p>
              <select
                value={entryType}
                onChange={(e) => setEntryType(e.target.value)}
                className="select w-auto"
              >
                <option value="">All types</option>
                {Object.keys(ENTRY_LABELS).map((t) => (
                  <option key={t} value={t}>
                    {ENTRY_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {detailLoading ? (
              <div className="grid place-items-center py-10 text-sm text-slate-400">
                Loading ledger…
              </div>
            ) : filteredEntries.length === 0 ? (
              <EmptyState
                icon="🧾"
                title="No entries"
                hint="Ledger entries will appear here."
              />
            ) : (
              <div className="table-shell">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="hidden sm:table-cell">Details</th>
                        <th className="text-right">Debit</th>
                        <th className="text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((e) => (
                        <tr key={e.id}>
                          <td className="text-xs text-slate-500">
                            {new Date(e.entry_date).toLocaleDateString()}
                          </td>
                          <td>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                e.direction === "debit"
                                  ? "bg-red-50 text-red-600"
                                  : "bg-emerald-50 text-emerald-600"
                              }`}
                            >
                              {ENTRY_LABELS[e.entry_type] ?? e.entry_type}
                            </span>
                          </td>
                          <td className="hidden max-w-[180px] truncate text-xs text-slate-400 sm:table-cell">
                            {e.note || e.reference || "—"}
                          </td>
                          <td className="text-right font-semibold tabular-nums text-red-600">
                            {e.direction === "debit"
                              ? e.amount.toFixed(2)
                              : "—"}
                          </td>
                          <td className="text-right font-semibold tabular-nums text-emerald-600">
                            {e.direction === "credit"
                              ? e.amount.toFixed(2)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* actions */}
      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={actionTitle}
        maxWidth="max-w-sm"
      >
        <form onSubmit={submitAction} className="space-y-5">
          {action === "loyalty" ? (
            <div>
              <label className="label">Points change (use - to subtract)</label>
              <input
                type="number"
                value={actionForm.points}
                onChange={(e) =>
                  setActionForm((f) => ({ ...f, points: e.target.value }))
                }
                autoFocus
                placeholder="e.g. 50"
                className="input"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="label">Amount *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={actionForm.amount}
                  onChange={(e) =>
                    setActionForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  autoFocus
                  placeholder="0.00"
                  className="input"
                />
              </div>
              {action === "payment" && (
                <div>
                  <label className="label">Method</label>
                  <select
                    value={actionForm.method}
                    onChange={(e) =>
                      setActionForm((f) => ({ ...f, method: e.target.value }))
                    }
                    className="select"
                  >
                    {METHOD_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {action === "payment" || action === "credit_note" ? (
                <div>
                  <label className="label">Reference</label>
                  <input
                    value={actionForm.reference}
                    onChange={(e) =>
                      setActionForm((f) => ({ ...f, reference: e.target.value }))
                    }
                    placeholder="Optional ref / cheque no."
                    className="input"
                  />
                </div>
              ) : null}
              <div>
                <label className="label">Note</label>
                <input
                  value={actionForm.note}
                  onChange={(e) =>
                    setActionForm((f) => ({ ...f, note: e.target.value }))
                  }
                  placeholder="Optional note"
                  className="input"
                />
              </div>
            </>
          )}
          {actionError && (
            <p className="text-xs font-semibold text-red-600">{actionError}</p>
          )}
          <button
            type="submit"
            disabled={actionSaving}
            className="btn btn-primary w-full"
          >
            {actionSaving
              ? "Saving…"
              : action === "loyalty"
                ? "Adjust points"
                : action === "payment"
                  ? "Record payment"
                  : action === "credit_note"
                    ? "Post credit note"
                    : "Set opening balance"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
