"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, master } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import CustomerSelector, { type CustomerSelection } from "@/components/CustomerSelector";
import LineItemsTable, { type LineItemState } from "@/components/LineItemsTable";
import RepairPrintModal from "@/components/RepairPrintModal";
import { formatMoney } from "@/lib/constants";
import type { Customer, Product, Repair } from "@/lib/types";

const STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  received: { label: "Received", cls: "bg-slate-100 text-slate-700" },
  diagnosing: { label: "Diagnosing", cls: "bg-blue-50 text-blue-700" },
  repairing: { label: "In Progress", cls: "bg-amber-50 text-amber-700 font-semibold" },
  in_progress: { label: "In Progress", cls: "bg-amber-50 text-amber-700 font-semibold" },
  ready: { label: "Completed", cls: "bg-emerald-50 text-emerald-700 font-semibold" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700 font-semibold" },
  delivered: { label: "Delivered", cls: "bg-teal-50 text-teal-700" },
  cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "received", label: "Received" },
  { key: "repairing", label: "In Progress" },
  { key: "ready", label: "Completed" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export default function RepairsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";

  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRepairId, setEditingRepairId] = useState<number | null>(null);
  const [editingRepairNo, setEditingRepairNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Customer form state
  const [customerSelection, setCustomerSelection] = useState<CustomerSelection>({
    id: null,
    name: "",
    phone: "",
    address: "",
    type: "Retail",
  });

  // Repair Device details
  const [productName, setProductName] = useState("");
  const [imei, setImei] = useState("");
  const [issue, setIssue] = useState("");
  const [repairStatus, setRepairStatus] = useState("received");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [advanceDeposit, setAdvanceDeposit] = useState("");
  const [technician, setTechnician] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState(
    "1. Goods left over 30 days will be disposed of.\n2. 30-day warranty applies exclusively to replaced components.\n3. Please present this job receipt when claiming your device."
  );

  // Parts & Service lines
  const [lines, setLines] = useState<LineItemState[]>([]);

  // Print Modal state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printRepairTarget, setPrintRepairTarget] = useState<Repair | null>(null);

  // Payment Recording modal state
  const [payTarget, setPayTarget] = useState<Repair | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);

  const loadRepairs = useCallback(async () => {
    try {
      const data = await api.repairs.list({
        page_size: 100,
        q: search.trim() || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setRepairs(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  const loadMasterData = useCallback(async () => {
    try {
      const c = await master.customers.list({ page_size: 200 });
      setCustomers(c.items);
      const p = await api.products.list();
      setProducts(p);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(loadRepairs, 300);
    return () => clearTimeout(t);
  }, [loadRepairs]);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  // Filter repairs by date client-side if date filter is set
  const displayedRepairs = useMemo(() => {
    if (!dateFilter) return repairs;
    return repairs.filter((r) => {
      const createdDate = new Date(r.created_at).toISOString().split("T")[0];
      return createdDate === dateFilter;
    });
  }, [repairs, dateFilter]);

  function handleOpenNew() {
    setEditingRepairId(null);
    setEditingRepairNo("");
    setCustomerSelection({
      id: null,
      name: "",
      phone: "",
      address: "",
      type: "Retail",
    });
    setProductName("");
    setImei("");
    setIssue("");
    setRepairStatus("received");
    setEstimatedCost("");
    setAdvanceDeposit("");
    setTechnician("");
    setNotes("");
    setTerms(
      "1. Goods left over 30 days will be disposed of.\n2. 30-day warranty applies exclusively to replaced components.\n3. Please present this job receipt when claiming your device."
    );
    setLines([
      {
        product_id: null,
        product_name: "Service & Diagnostics",
        product_type: "Service",
        description: "Initial inspection and labor",
        qty: 1,
        unit: "service",
        price: 0,
        discount: 0,
        tax: 0,
        line_total: 0,
      },
    ]);
    setFormError("");
    setModalOpen(true);
  }

  function handleOpenEdit(r: Repair) {
    setEditingRepairId(r.id);
    setEditingRepairNo(r.repair_number);
    setCustomerSelection({
      id: r.customer_id,
      name: r.customer_name || "",
      phone: r.customer_phone || "",
      address: r.customer_address || "",
      type: r.customer_type || "Retail",
    });
    setProductName(r.product_name);
    setImei(r.imei || "");
    setIssue(r.issue || "");
    setRepairStatus(r.status);
    setEstimatedCost(r.estimated_cost ? String(r.estimated_cost) : "");
    setAdvanceDeposit(r.deposit ? String(r.deposit) : "");
    setTechnician(r.technician || "");
    setNotes(r.notes || "");
    setTerms(r.terms || "");

    if (r.items && r.items.length > 0) {
      setLines(
        r.items.map((i) => ({
          id: i.id,
          product_id: i.product_id ?? null,
          product_name: i.product_name,
          product_type: i.product_type || "Service",
          description: i.description || "",
          qty: i.qty,
          unit: i.unit || "pcs",
          price: i.price,
          discount: i.discount || 0,
          tax: i.tax || 0,
          line_total: i.line_total,
        }))
      );
    } else {
      // Fallback line using service charge / parts cost if no itemized lines
      setLines([
        {
          product_id: null,
          product_name: "Service & Diagnostics",
          product_type: "Service",
          description: "Service charge",
          qty: 1,
          unit: "service",
          price: r.service_charge || 0,
          discount: 0,
          tax: 0,
          line_total: r.service_charge || 0,
        },
      ]);
    }

    setFormError("");
    setModalOpen(true);
  }

  function handleOpenPrint(r: Repair) {
    setPrintRepairTarget(r);
    setPrintModalOpen(true);
  }

  async function handleSaveRepair(): Promise<Repair | null> {
    setFormError("");

    if (!customerSelection.name.trim()) {
      setFormError("Customer name is required.");
      return null;
    }
    if (!productName.trim()) {
      setFormError("Item / Device name is required (e.g. Samsung Galaxy A54).");
      return null;
    }

    const validLines = lines.filter((l) => l.product_name.trim().length > 0);
    for (let i = 0; i < validLines.length; i++) {
      if (validLines[i].qty <= 0) {
        setFormError(`Line #${i + 1} quantity must be greater than 0.`);
        return null;
      }
      if (validLines[i].price < 0) {
        setFormError(`Line #${i + 1} unit price cannot be negative.`);
        return null;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        customer_id: customerSelection.id,
        customer_name: customerSelection.name.trim(),
        customer_phone: customerSelection.phone || undefined,
        customer_address: customerSelection.address || undefined,
        customer_type: customerSelection.type || "Retail",
        product_name: productName.trim(),
        imei: imei.trim() || undefined,
        issue: issue.trim() || undefined,
        status: repairStatus,
        estimated_cost: Number(estimatedCost) || 0,
        deposit: Number(advanceDeposit) || 0,
        technician: technician.trim() || undefined,
        notes: notes.trim() || undefined,
        terms: terms.trim() || undefined,
        items: validLines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          product_type: l.product_type,
          description: l.description,
          qty: Number(l.qty) || 1,
          unit: l.unit || "pcs",
          price: Number(l.price) || 0,
          discount: Number(l.discount) || 0,
          tax: Number(l.tax) || 0,
          line_total: Number(l.line_total) || 0,
        })),
      };

      let saved: Repair;
      if (editingRepairId) {
        saved = await api.repairs.update(editingRepairId, payload);
        toast(`Repair ${saved.repair_number} updated`, "success");
      } else {
        saved = await api.repairs.create(payload as any);
        toast(`Repair ticket ${saved.repair_number} created`, "success");
      }

      setModalOpen(false);
      loadRepairs();
      return saved;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save repair ticket";
      setFormError(msg);
      toast(msg, "error");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveAndPrint() {
    const saved = await handleSaveRepair();
    if (saved) {
      handleOpenPrint(saved);
    }
  }

  async function changeStatus(repair: Repair, newStatus: string) {
    try {
      await api.repairs.updateStatus(repair.id, newStatus);
      toast(`${repair.repair_number} status updated to ${newStatus}`, "success");
      loadRepairs();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Status update failed", "error");
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
      setFormError("Enter a valid payment amount.");
      return;
    }
    setPaying(true);
    try {
      await api.repairs.payment(payTarget.id, amount);
      toast(`Payment of ${formatMoney(amount)} recorded for ${payTarget.repair_number}`, "success");
      setPayTarget(null);
      setPayAmount("");
      loadRepairs();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Payment recording failed");
    } finally {
      setPaying(false);
    }
  }

  async function removeRepair(repair: Repair) {
    if (!confirm(`Delete repair ticket ${repair.repair_number}? This cannot be undone.`)) return;
    try {
      await api.repairs.remove(repair.id);
      toast(`Repair ${repair.repair_number} deleted`, "success");
      loadRepairs();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  const activeCount = repairs.filter(
    (r) => !["delivered", "cancelled"].includes(r.status)
  ).length;
  const readyCount = repairs.filter((r) => ["ready", "completed"].includes(r.status)).length;
  const outstandingBalance = repairs.reduce(
    (s, r) => s + Math.max(0, r.total - r.paid_amount),
    0
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Page Header */}
      <PageHeader
        title="Repairs"
        subtitle="Manage service tickets, parts/service billing, and job sheets"
      >
        {canManage && (
          <button
            type="button"
            onClick={handleOpenNew}
            className="btn btn-primary"
          >
            + New Repair
          </button>
        )}
      </PageHeader>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Active Tickets
          </div>
          <div className="mt-1 text-2xl font-black text-slate-800">{activeCount}</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Ready for Pickup / Delivered
          </div>
          <div className="mt-1 text-2xl font-black text-emerald-600">{readyCount}</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Outstanding Balance
          </div>
          <div className="mt-1 text-2xl font-black text-amber-600 font-mono">
            {formatMoney(outstandingBalance)}
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/80">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === f.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Date & Keyword Search */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-primary-500 focus:outline-none"
            title="Filter by creation date"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className="text-xs text-slate-400 hover:text-slate-600"
              title="Clear date"
            >
              ✕
            </button>
          )}

          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Repair #, Device, Customer, IMEI..."
              className="w-full sm:w-64 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Repairs List Table */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading repairs...</div>
      ) : displayedRepairs.length === 0 ? (
        <EmptyState
          title="No repair tickets found"
          hint="Log and manage customer device repairs, diagnostic fees, and parts replacement."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-3">Repair No</th>
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3">Customer</th>
                <th className="py-3 px-2">Customer Type</th>
                <th className="py-3 px-3">Item / Device</th>
                <th className="py-3 px-3">Reported Issue</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Amount</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedRepairs.map((r) => {
                const due = Math.max(0, r.total - r.paid_amount);
                const display = STATUS_DISPLAY[r.status] || {
                  label: r.status,
                  cls: "bg-slate-100 text-slate-700",
                };

                return (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition group">
                    <td className="py-3 px-3 font-mono font-bold text-primary-700">{r.repair_number}</td>
                    <td className="py-3 px-3 text-slate-600">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{r.customer_name || "Walk-in"}</div>
                      {r.customer_phone && (
                        <div className="text-[11px] text-slate-400">{r.customer_phone}</div>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {r.customer_type || "Retail"}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-800">{r.product_name}</div>
                      {r.imei && <div className="text-[10px] text-slate-400 font-mono">IMEI: {r.imei}</div>}
                    </td>
                    <td className="py-3 px-3 max-w-xs truncate text-slate-600" title={r.issue || ""}>
                      {r.issue || "—"}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${display.cls}`}
                      >
                        {display.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="font-mono font-bold text-slate-900">{formatMoney(r.total)}</div>
                      {due > 0 ? (
                        <div className="text-[10px] text-red-600 font-medium font-mono">
                          Due: {formatMoney(due)}
                        </div>
                      ) : (
                        <div className="text-[10px] text-emerald-600 font-medium">Paid in full</div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Print Job Sheet Button on List */}
                        <button
                          type="button"
                          onClick={() => handleOpenPrint(r)}
                          title="Print Job Sheet / Receipt"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
                        >
                          🖨️ Print
                        </button>

                        {/* Edit Button */}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(r)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 transition shadow-sm"
                          >
                            Edit
                          </button>
                        )}

                        {/* Quick Pay Button */}
                        {canManage && due > 0 && (
                          <button
                            type="button"
                            onClick={() => openPayment(r)}
                            className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 transition shadow-sm"
                          >
                            Pay
                          </button>
                        )}

                        {/* Status dropdown */}
                        {canManage && (
                          <select
                            value={r.status}
                            onChange={(e) => changeStatus(r, e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 focus:border-primary-500 focus:outline-none shadow-sm"
                          >
                            <option value="received">Received</option>
                            <option value="repairing">In Progress</option>
                            <option value="ready">Completed</option>
                            <option value="delivered">Delivered</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* =========================================================================
          Create / Edit Repair Ticket Modal (With customer picker & parts lines)
         ========================================================================= */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRepairId ? `Edit Repair Ticket #${editingRepairNo}` : "New Repair Ticket"}
        maxWidth="max-w-6xl"
      >
        <div className="space-y-6 py-1">
          {formError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 font-medium">
              ⚠️ {formError}
            </div>
          )}

          {/* Customer Selection Component */}
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
              Customer Information
            </h3>
            <CustomerSelector
              customers={customers}
              value={customerSelection}
              onChange={setCustomerSelection}
              onCustomerCreated={(newCust) => setCustomers((prev) => [newCust, ...prev])}
            />
          </div>

          {/* Device & Fault Details */}
          <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Item / Device Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product / Device Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Samsung Galaxy A54 5G"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  IMEI / Serial Number
                </label>
                <input
                  type="text"
                  value={imei}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder="Optional IMEI or Serial #"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-primary-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Technician
                </label>
                <input
                  type="text"
                  value={technician}
                  onChange={(e) => setTechnician(e.target.value)}
                  placeholder="e.g. Alex / Workshop"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-primary-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reported Issue & Symptoms
              </label>
              <textarea
                rows={2}
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="Describe screen damage, water contact, charging issue, etc..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Parts & Service Line Items Table */}
          <LineItemsTable
            title="Parts & Service Lines"
            items={lines}
            products={products}
            customerType={customerSelection.type}
            onChange={setLines}
            onProductCreated={(newProd) => setProducts((prev) => [newProd, ...prev])}
            defaultProductType="Service"
            notes={notes}
            onChangeNotes={setNotes}
            terms={terms}
            onChangeTerms={setTerms}
          />

          {/* Financial Breakdown & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Estimated Cost
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder="Optional estimate"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-primary-500 focus:outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Advance / Deposit Payment
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={advanceDeposit}
                onChange={(e) => setAdvanceDeposit(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-primary-500 focus:outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ticket Status</label>
              <select
                value={repairStatus}
                onChange={(e) => setRepairStatus(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-primary-500 focus:outline-none"
              >
                <option value="received">Received</option>
                <option value="repairing">In Progress</option>
                <option value="ready">Completed</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Action Buttons Bar */}
          <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveAndPrint}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                <span>🖨️</span>
                <span>Print Job Sheet</span>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveRepair()}
                className="btn btn-primary btn-sm"
              >
                {submitting ? "Saving..." : "Save Repair Ticket"}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Repair Print & PDF Modal */}
      <RepairPrintModal
        open={printModalOpen}
        repair={printRepairTarget}
        onClose={() => setPrintModalOpen(false)}
      />

      {/* Record Payment Modal */}
      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `Record payment for ${payTarget.repair_number}` : ""}
      >
        {payTarget && (
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="text-xs text-slate-600 space-y-1 bg-slate-50 p-3 rounded-xl">
              <div>Total: {formatMoney(payTarget.total)}</div>
              <div>Already paid: {formatMoney(payTarget.paid_amount)}</div>
              <div className="font-bold text-red-600">
                Outstanding Balance: {formatMoney(Math.max(0, payTarget.total - payTarget.paid_amount))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Amount Received
              </label>
              <input
                type="number"
                min="0.01"
                step="any"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                autoFocus
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 focus:border-primary-500 focus:outline-none font-mono"
              />
            </div>

            {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}

            <button
              type="submit"
              disabled={paying}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-emerald-700 transition"
            >
              {paying ? "Saving..." : "Record Payment"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
