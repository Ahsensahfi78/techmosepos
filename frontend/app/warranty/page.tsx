"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { Product, ProductUnit } from "@/lib/types";

const UNIT_STATUSES = ["in_stock", "sold", "returned", "service"];

const STATUS_STYLES: Record<string, string> = {
  in_stock: "bg-slate-100 text-slate-600",
  sold: "bg-emerald-50 text-emerald-600",
  returned: "bg-red-50 text-red-600",
  service: "bg-amber-50 text-amber-600",
};

export default function WarrantyPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "manager";

  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    product_id: "",
    imei: "",
    serial_number: "",
    warranty_months: "",
  });

  const [expiringDays, setExpiringDays] = useState(30);
  const [expiring, setExpiring] = useState<ProductUnit[]>([]);

  const tracked = useMemo(
    () => products.filter((p) => p.track_imei),
    [products]
  );

  const load = useCallback(async () => {
    try {
      const data = await api.warranty.units({
        page_size: 100,
        q: search || undefined,
        status: statusFilter || undefined,
      });
      setUnits(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  const loadProducts = useCallback(async () => {
    try {
      setProducts(await api.products.list());
    } catch {
      /* ignore */
    }
  }, []);

  const loadExpiring = useCallback(async () => {
    try {
      setExpiring(await api.warranty.expiring(expiringDays));
    } catch {
      /* ignore */
    }
  }, [expiringDays]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadExpiring();
  }, [loadExpiring]);

  function openModal() {
    setForm({ product_id: "", imei: "", serial_number: "", warranty_months: "" });
    setFormError("");
    setModalOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.product_id) {
      setFormError("Select a product.");
      return;
    }
    setSubmitting(true);
    try {
      await api.warranty.createUnit({
        product_id: Number(form.product_id),
        imei: form.imei.trim() || undefined,
        serial_number: form.serial_number.trim() || undefined,
        warranty_months: form.warranty_months
          ? Number(form.warranty_months)
          : undefined,
      });
      toast("Unit registered", "success");
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(unit: ProductUnit, status: string) {
    try {
      await api.warranty.updateStatus(unit.id, status);
      toast(`Unit marked ${status.replace("_", " ")}`, "success");
      load();
      loadExpiring();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  }

  function daysTo(d: string | null): string {
    if (!d) return "—";
    const diff = Math.ceil(
      (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return diff <= 0 ? "Expired" : `${diff}d left`;
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="IMEI & Warranty"
        subtitle="Track serialised units and expiring warranties"
      >
        {canManage && (
          <button onClick={openModal} className="btn btn-primary">
            + Register unit
          </button>
        )}
      </PageHeader>

      <div className="card !p-4">
        <div className="card-header">
          <h2 className="card-title">Expiring warranties</h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {[30, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => setExpiringDays(d)}
                className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                  expiringDays === d
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {expiring.length === 0 ? (
          <p className="py-2 text-xs text-slate-400">
            No warranties expiring in the next {expiringDays} days.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {expiring.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-800">
                    {u.product_name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500">
                    {u.imei || u.serial_number || `#${u.id}`}
                  </p>
                  {u.customer_name && (
                    <p className="truncate text-[11px] text-slate-400">
                      {u.customer_name}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
                  {daysTo(u.warranty_expiry)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search IMEI or serial number…"
          className="input"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select sm:w-44"
        >
          <option value="">All statuses</option>
          {UNIT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : units.length === 0 ? (
          <EmptyState
            icon="🛡️"
            title="No units registered"
            hint={
              canManage
                ? "Register a unit to start tracking its IMEI and warranty."
                : "No units match your search."
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>IMEI / Serial</th>
                <th className="hidden md:table-cell">Customer</th>
                <th className="hidden lg:table-cell">Warranty</th>
                <th>Status</th>
                {canManage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td className="font-bold text-slate-800">
                    {u.product_name}
                  </td>
                  <td>
                    <p className="font-mono text-xs font-semibold text-slate-700">
                      {u.imei || "—"}
                    </p>
                    {u.serial_number && (
                      <p className="font-mono text-[11px] text-slate-400">
                        {u.serial_number}
                      </p>
                    )}
                  </td>
                  <td className="hidden text-xs text-slate-500 md:table-cell">
                    {u.customer_name || "—"}
                  </td>
                  <td className="hidden lg:table-cell">
                    {u.warranty_expiry ? (
                      <div>
                        <p className="text-xs font-semibold text-slate-600">
                          {new Date(u.warranty_expiry).toLocaleDateString()}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {daysTo(u.warranty_expiry)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                        STATUS_STYLES[u.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {u.status.replace("_", " ")}
                    </span>
                  </td>
                  {canManage && (
                    <td className="text-right">
                      <select
                        value={u.status}
                        onChange={(e) => setStatus(u, e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 outline-none focus:border-emerald-500"
                      >
                        {UNIT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Register unit"
        maxWidth="max-w-md"
      >
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="label">Product *</label>
            <select
              value={form.product_id}
              onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}
              className="select"
            >
              <option value="">Select a tracked product</option>
              {tracked.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.warranty_months ? ` (${p.warranty_months} mo)` : ""}
                </option>
              ))}
            </select>
          </div>
          {tracked.length === 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              No products have IMEI tracking enabled. Enable “track IMEI” on a
              product to register units.
            </p>
          )}
          <div>
            <label className="label">IMEI</label>
            <input
              value={form.imei}
              onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))}
              placeholder="e.g. 356938035643809"
              className="input font-mono"
            />
          </div>
          <div>
            <label className="label">Serial number</label>
            <input
              value={form.serial_number}
              onChange={(e) =>
                setForm((f) => ({ ...f, serial_number: e.target.value }))
              }
              className="input font-mono"
            />
          </div>
          <div>
            <label className="label">Warranty (months)</label>
            <input
              type="number"
              min="0"
              value={form.warranty_months}
              onChange={(e) =>
                setForm((f) => ({ ...f, warranty_months: e.target.value }))
              }
              placeholder="Defaults to product warranty"
              className="input"
            />
          </div>
          {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting ? "Saving…" : "Register unit"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
