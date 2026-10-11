"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { can } from "@/lib/nlp/permissions";
import type { Branch, StockTransfer } from "@/lib/types";

export default function TransfersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [form, setForm] = useState({
    from_branch_id: 0,
    to_branch_id: 0,
    notes: "",
    items: [{ product_id: 0, quantity: 1 }] as { product_id: number; quantity: number }[],
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [t, b] = await Promise.all([
        api.transfers.list(filterStatus ? { status: filterStatus } : {}),
        api.branches.list(true),
      ]);
      setTransfers(t);
      setBranches(b);
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    if (user && !can(user.role, "transfer.view")) {
      router.push("/pos");
      return;
    }
    load();
  }, [user, router, load]);

  const handleAction = async (id: number, action: "approve" | "complete" | "cancel") => {
    try {
      if (action === "approve") await api.transfers.approve(id);
      else if (action === "complete") await api.transfers.complete(id);
      else await api.transfers.cancel(id);
      await load();
    } catch (err: any) {
      setError(err.message || `Failed to ${action} transfer`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.transfers.create(form);
      setShowForm(false);
      setForm({ from_branch_id: 0, to_branch_id: 0, notes: "", items: [{ product_id: 0, quantity: 1 }] });
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to create transfer");
    }
  };

  const canManage = user && can(user.role, "transfer.manage");

  const statusColor = (s: string) => {
    switch (s) {
      case "pending": return "bg-yellow-100 text-yellow-700";
      case "approved": return "bg-blue-100 text-blue-700";
      case "completed": return "bg-green-100 text-green-700";
      case "cancelled": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header connected={false} lastEvent="" />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Stock Transfers</h1>
          <div className="flex gap-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {canManage && (
              <button
                onClick={() => setShowForm(!showForm)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                + New Transfer
              </button>
            )}
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>}

        {showForm && (
          <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">New Stock Transfer</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">From Branch</label>
                  <select
                    value={form.from_branch_id}
                    onChange={(e) => setForm({ ...form, from_branch_id: Number(e.target.value) })}
                    className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                    required
                  >
                    <option value={0}>Select source</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">To Branch</label>
                  <select
                    value={form.to_branch_id}
                    onChange={(e) => setForm({ ...form, to_branch_id: Number(e.target.value) })}
                    className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                    required
                  >
                    <option value={0}>Select destination</option>
                    {branches.filter((b) => b.id !== form.from_branch_id).map((b) => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>
              </div>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
              />
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  Create Transfer
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded-lg hover:bg-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : transfers.length === 0 ? (
          <p className="text-gray-500">No transfers found.</p>
        ) : (
          <div className="space-y-3">
            {transfers.map((t) => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-white">{t.transfer_number}</span>
                    <span className="ml-2 text-sm text-gray-500">
                      {t.from_branch_name} &rarr; {t.to_branch_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(t.status)}`}>
                      {t.status}
                    </span>
                    {canManage && t.status === "pending" && (
                      <button onClick={() => handleAction(t.id, "approve")} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                        Approve
                      </button>
                    )}
                    {canManage && t.status === "approved" && (
                      <button onClick={() => handleAction(t.id, "complete")} className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">
                        Complete
                      </button>
                    )}
                    {canManage && (t.status === "pending" || t.status === "approved") && (
                      <button onClick={() => handleAction(t.id, "cancel")} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {t.items.length > 0 && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {t.items.map((i) => `${i.product_name} x${i.quantity}`).join(", ")}
                  </div>
                )}
                <div className="mt-1 text-xs text-gray-400">
                  Created: {new Date(t.created_at).toLocaleString()}
                  {t.created_by_name && ` by ${t.created_by_name}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
