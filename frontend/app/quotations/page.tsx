"use client";

import { useCallback, useEffect, useState } from "react";
import { api, master } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import CustomerSelector, { type CustomerSelection } from "@/components/CustomerSelector";
import LineItemsTable, { type LineItemState } from "@/components/LineItemsTable";
import QuotationPrintModal from "@/components/QuotationPrintModal";
import { formatMoney } from "@/lib/constants";
import type { Customer, Product, Quotation } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-sky-50 text-sky-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  converted: "bg-purple-50 text-purple-700",
  cancelled: "bg-red-50 text-red-700",
};

const FILTERS = ["all", "draft", "sent", "accepted", "rejected", "converted", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export default function QuotationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";
  const canView = canManage || user?.role === "accountant" || user?.role === "cashier";

  const [filter, setFilter] = useState<Filter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Create / Edit modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<number | null>(null);
  const [quotationNumber, setQuotationNumber] = useState("");
  const [quotationDate, setQuotationDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [status, setStatus] = useState<"draft" | "sent" | "accepted" | "rejected">("draft");
  const [taxRate, setTaxRate] = useState(0);
  const [overallDiscount, setOverallDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [customerSelection, setCustomerSelection] = useState<CustomerSelection>({
    id: null,
    name: "",
    phone: "",
    address: "",
    type: "Retail",
  });

  const [lines, setLines] = useState<LineItemState[]>([
    {
      product_id: null,
      product_name: "",
      product_type: "Goods",
      description: "",
      qty: 1,
      unit: "pcs",
      price: 0,
      discount: 0,
      tax: 0,
      line_total: 0,
    },
  ]);

  // Print modal state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printQuotationTarget, setPrintQuotationTarget] = useState<Quotation | null>(null);

  // Convert to sale state
  const [convertQ, setConvertQ] = useState<Quotation | null>(null);
  const [convertMethod, setConvertMethod] = useState("cash");
  const [convertPaid, setConvertPaid] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState("");

  const loadQuotations = useCallback(async () => {
    try {
      const data = await api.quotations.list({
        page_size: 100,
        status: filter === "all" ? undefined : filter,
        q: searchQuery.trim() || undefined,
      });
      setQuotations(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter, searchQuery]);

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
    const timer = setTimeout(loadQuotations, 300);
    return () => clearTimeout(timer);
  }, [loadQuotations]);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  function handleOpenNew() {
    setEditingQuotationId(null);
    setQuotationNumber("");
    const today = new Date().toISOString().split("T")[0];
    setQuotationDate(today);

    // Default valid until 14 days
    const next14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    setValidUntil(next14Days);

    setStatus("draft");
    setCustomerSelection({
      id: null,
      name: "",
      phone: "",
      address: "",
      type: "Retail",
    });
    setTaxRate(0);
    setOverallDiscount(0);
    setNotes("");
    setTerms("1. Validity: Prices quoted are valid until the date specified.\n2. Payment: Net 30 days from invoice date.\n3. Delivery: Subject to stock availability.");
    setLines([
      {
        product_id: null,
        product_name: "",
        product_type: "Goods",
        description: "",
        qty: 1,
        unit: "pcs",
        price: 0,
        discount: 0,
        tax: 0,
        line_total: 0,
      },
    ]);
    setFormError("");
    setFormOpen(true);
  }

  function handleOpenEdit(q: Quotation) {
    setEditingQuotationId(q.id);
    setQuotationNumber(q.quotation_number);
    setQuotationDate(new Date(q.created_at).toISOString().split("T")[0]);
    setValidUntil(q.valid_until ? new Date(q.valid_until).toISOString().split("T")[0] : "");
    setStatus((q.status as any) || "draft");
    setCustomerSelection({
      id: q.customer_id,
      name: q.customer_name || "",
      phone: q.customer_phone || "",
      address: q.customer_address || "",
      type: q.customer_type || "Retail",
    });
    setTaxRate(q.tax_rate || 0);
    setOverallDiscount(q.discount_amount || 0);
    setNotes(q.notes || "");
    setTerms(q.terms || "");

    setLines(
      q.items.map((i) => ({
        id: i.id,
        product_id: i.product_id ?? null,
        product_name: i.product_name,
        product_type: i.product_type || "Goods",
        description: i.description || "",
        qty: i.qty,
        unit: i.unit || "pcs",
        price: i.price,
        discount: i.discount || 0,
        tax: i.tax || 0,
        line_total: i.line_total,
      }))
    );

    setFormError("");
    setFormOpen(true);
  }

  function handleOpenPrint(q: Quotation) {
    setPrintQuotationTarget(q);
    setPrintModalOpen(true);
  }

  async function handleSaveQuotation(statusToSave: "draft" | "sent") {
    setFormError("");

    // Validation
    const custName = customerSelection.name.trim();
    if (!custName) {
      setFormError("Customer name is required.");
      return;
    }

    const validLines = lines.filter((l) => l.product_name.trim().length > 0);
    if (validLines.length === 0) {
      setFormError("Please add at least one item line with a product name.");
      return;
    }

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];
      if (line.qty <= 0) {
        setFormError(`Line #${i + 1} quantity must be greater than 0.`);
        return;
      }
      if (line.price < 0) {
        setFormError(`Line #${i + 1} unit price cannot be negative.`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        customer_id: customerSelection.id,
        customer_name: custName,
        customer_phone: customerSelection.phone || undefined,
        customer_address: customerSelection.address || undefined,
        customer_type: customerSelection.type || "Retail",
        status: statusToSave,
        tax_rate: Number(taxRate) || 0,
        discount_amount: Number(overallDiscount) || 0,
        notes: notes || undefined,
        terms: terms || undefined,
        valid_until: validUntil ? new Date(validUntil).toISOString() : undefined,
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

      let saved: Quotation;
      if (editingQuotationId) {
        saved = await api.quotations.update(editingQuotationId, payload);
        toast(`Quotation ${saved.quotation_number} updated`, "success");
      } else {
        saved = await api.quotations.create(payload as any);
        toast(`Quotation ${saved.quotation_number} created`, "success");
      }

      setFormOpen(false);
      loadQuotations();

      // If user wants to immediately print after save
      return saved;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save quotation";
      setFormError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndPrint() {
    const saved = await handleSaveQuotation(status === "sent" ? "sent" : "draft");
    if (saved) {
      handleOpenPrint(saved);
    }
  }

  async function submitConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!convertQ || converting) return;
    if (convertQ.status === "converted" || convertQ.converted_sale_id) {
      toast(`Quotation ${convertQ.quotation_number} is already converted to an invoice`, "info");
      setConvertQ(null);
      return;
    }
    setConverting(true);
    setConvertError("");
    try {
      const sale = await api.quotations.convert(convertQ.id, {
        payment_method: convertMethod,
        paid: Number(convertPaid) || 0,
      });

      // Optimistically update local quotation list immediately
      setQuotations((prev) =>
        prev.map((item) =>
          item.id === convertQ.id
            ? { ...item, status: "converted", converted_sale_id: sale.id }
            : item
        )
      );

      toast(`Quotation ${convertQ.quotation_number} converted to Invoice #${sale.id}!`, "success");
      setConvertQ(null);
      await loadQuotations();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Conversion failed";
      if (msg.toLowerCase().includes("already converted")) {
        setQuotations((prev) =>
          prev.map((item) =>
            item.id === convertQ.id
              ? { ...item, status: "converted" }
              : item
          )
        );
        toast(`Quotation ${convertQ.quotation_number} is already converted to an invoice`, "info");
        setConvertQ(null);
        await loadQuotations();
      } else {
        setConvertError(msg);
        toast(msg, "error");
      }
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <PageHeader
        title="Quotations"
        subtitle="Create, manage, print and convert price estimates & quotes"
      >
        {canManage && (
          <button
            type="button"
            onClick={handleOpenNew}
            className="btn btn-primary"
          >
            + New Quotation
          </button>
        )}
      </PageHeader>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status filters */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/80">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                filter === f
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Quote #, customer name..."
            className="w-full sm:w-72 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Quotations List Table */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading quotations...</div>
      ) : quotations.length === 0 ? (
        <EmptyState
          title="No quotations found"
          hint="Create and send professional price quotes to your retail and wholesale customers."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Quote No</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Customer Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Grand Total</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotations.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50/60 transition group">
                  <td className="py-3 px-4 font-mono font-bold text-primary-700">{q.quotation_number}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {new Date(q.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{q.customer_name || "Walk-in"}</div>
                    {q.customer_phone && (
                      <div className="text-[11px] text-slate-400">{q.customer_phone}</div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      {q.customer_type || "Retail"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${
                        STATUS_STYLES[q.status] || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 text-sm">
                    {formatMoney(q.total)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* Print button on list */}
                      <button
                        type="button"
                        onClick={() => handleOpenPrint(q)}
                        title="Print / Export PDF"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
                      >
                        🖨️ Print
                      </button>

                      {/* Edit button */}
                      {canManage && q.status !== "converted" && !q.converted_sale_id && (
                        <button
                          type="button"
                          disabled={converting}
                          onClick={() => handleOpenEdit(q)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 transition shadow-sm disabled:opacity-50"
                        >
                          Edit
                        </button>
                      )}

                      {/* Convert to Sale or Already Invoiced Badge */}
                      {q.status === "converted" || q.converted_sale_id ? (
                        <span
                          title={`Converted to Invoice #${q.converted_sale_id || ""}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 border border-purple-200"
                        >
                          <span>✓ Invoiced</span>
                          {q.converted_sale_id && (
                            <span className="font-mono text-[10px]">#{q.converted_sale_id}</span>
                          )}
                        </span>
                      ) : canManage && q.status !== "cancelled" ? (
                        <button
                          type="button"
                          disabled={converting}
                          onClick={() => {
                            if (converting) return;
                            setConvertQ(q);
                            setConvertPaid(String(q.total));
                          }}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Invoice ⚡
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* =========================================================================
          Create / Edit Quotation Modal (Full feature specification)
         ========================================================================= */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingQuotationId ? `Edit Quotation #${quotationNumber}` : "New Quotation"}
        maxWidth="max-w-6xl"
      >
        <div className="space-y-6 py-1">
          {formError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 font-medium">
              ⚠️ {formError}
            </div>
          )}

          {/* Quotation Header Details */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                Quotation No
              </label>
              <input
                type="text"
                disabled
                value={quotationNumber || "(Auto-generated)"}
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-mono font-bold text-slate-700"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Date</label>
              <input
                type="date"
                value={quotationDate}
                onChange={(e) => setQuotationDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                Valid Until
              </label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-primary-500 focus:outline-none"
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {/* Customer Selection Section */}
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

          {/* Quotation Item Lines Table */}
          <LineItemsTable
            items={lines}
            products={products}
            customerType={customerSelection.type}
            onChange={setLines}
            onProductCreated={(newProd) => setProducts((prev) => [newProd, ...prev])}
            notes={notes}
            onChangeNotes={setNotes}
            terms={terms}
            onChangeTerms={setTerms}
            taxRate={taxRate}
            onChangeTaxRate={setTaxRate}
            overallDiscount={overallDiscount}
            onChangeOverallDiscount={setOverallDiscount}
          />

          {/* Form Action Buttons Bar */}
          <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {/* Print Preview Button */}
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveAndPrint}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                <span>🖨️</span>
                <span>Print / PDF Preview</span>
              </button>

              {/* Save Draft */}
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveQuotation("draft")}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                Save Draft
              </button>

              {/* Save and Send */}
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveQuotation("sent")}
                className="btn btn-primary btn-sm"
              >
                {saving ? "Saving..." : "Save and Send"}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Quotation Print & PDF Modal */}
      <QuotationPrintModal
        open={printModalOpen}
        quotation={printQuotationTarget}
        onClose={() => setPrintModalOpen(false)}
      />

      {/* Convert to Sale Modal */}
      <Modal
        open={Boolean(convertQ)}
        onClose={() => {
          if (!converting) {
            setConvertQ(null);
            setConvertError("");
          }
        }}
        title={convertQ ? `Convert ${convertQ.quotation_number} to Invoice` : ""}
      >
        {convertQ && (
          <form onSubmit={submitConvert} className="space-y-4">
            {convertQ.status === "converted" || convertQ.converted_sale_id ? (
              <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-800">
                <p className="font-bold">✓ This quotation has already been converted to an Invoice.</p>
                {convertQ.converted_sale_id && (
                  <p className="mt-1 font-mono text-[11px]">Invoice Sale ID: #{convertQ.converted_sale_id}</p>
                )}
              </div>
            ) : null}

            <p className="text-xs text-slate-600">
              Quotation total:{" "}
              <span className="font-bold text-slate-900 font-mono text-sm">
                {formatMoney(convertQ.total)}
              </span>
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment method</label>
              <select
                disabled={converting || convertQ.status === "converted" || Boolean(convertQ.converted_sale_id)}
                value={convertMethod}
                onChange={(e) => setConvertMethod(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 focus:border-primary-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-75"
              >
                {["cash", "card", "bank_transfer", "cheque", "credit", "other"].map((m) => (
                  <option key={m} value={m}>
                    {m.replace("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount paid now</label>
              <input
                disabled={converting || convertQ.status === "converted" || Boolean(convertQ.converted_sale_id)}
                type="number"
                min="0"
                step="any"
                value={convertPaid}
                onChange={(e) => setConvertPaid(e.target.value)}
                autoFocus
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 focus:border-primary-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-75"
              />
            </div>
            {convertError && <p className="text-xs font-semibold text-red-600">{convertError}</p>}
            <button
              type="submit"
              disabled={converting || convertQ.status === "converted" || Boolean(convertQ.converted_sale_id)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {converting ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Converting to Invoice…</span>
                </>
              ) : convertQ.status === "converted" || convertQ.converted_sale_id ? (
                "Already Converted to Invoice"
              ) : (
                "Confirm & Convert to Invoice"
              )}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
