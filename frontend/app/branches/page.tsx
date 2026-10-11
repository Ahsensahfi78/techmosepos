"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { can } from "@/lib/nlp/permissions";
import type { Branch } from "@/lib/types";

export default function BranchesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: "", code: "", location: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.branches.list();
      setBranches(data);
    } catch {
      setError("Failed to load branches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && !can(user.role, "branch.view")) {
      router.push("/pos");
      return;
    }
    load();
  }, [user, router, load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (editing) {
        await api.branches.update(editing.id, form);
      } else {
        await api.branches.create(form);
      }
      setShowForm(false);
      setEditing(null);
      setForm({ name: "", code: "", location: "" });
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to save branch");
    }
  };

  const handleEdit = (branch: Branch) => {
    setEditing(branch);
    setForm({ name: branch.name, code: branch.code, location: branch.location || "" });
    setShowForm(true);
  };

  const canManage = user && can(user.role, "branch.manage");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header connected={false} lastEvent="" />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Branches</h1>
          {canManage && (
            <button
              onClick={() => { setEditing(null); setForm({ name: "", code: "", location: "" }); setShowForm(true); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Branch
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>
        )}

        {showForm && (
          <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
              {editing ? "Edit Branch" : "New Branch"}
            </h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="text"
                placeholder="Branch Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                required
              />
              <input
                type="text"
                placeholder="Code (e.g. KLM)"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                required
                maxLength={20}
              />
              <input
                type="text"
                placeholder="Location (optional)"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
              />
              <div className="md:col-span-3 flex gap-2">
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  {editing ? "Update" : "Create"}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded-lg hover:bg-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : branches.length === 0 ? (
          <p className="text-gray-500">No branches found.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div key={b.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{b.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${b.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {b.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Code: {b.code}</p>
                {b.location && <p className="text-sm text-gray-500 dark:text-gray-400">Location: {b.location}</p>}
                {canManage && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => handleEdit(b)} className="text-sm px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">
                      Edit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
