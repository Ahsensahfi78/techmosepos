"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import type { User } from "@/lib/types";

const ROLES = ["super_admin", "admin", "manager", "cashier", "accountant"];

const roleStyles: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700",
  admin: "bg-rose-100 text-rose-700",
  manager: "bg-sky-100 text-sky-700",
  cashier: "bg-emerald-100 text-emerald-700",
  accountant: "bg-amber-100 text-amber-700",
};

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  accountant: "Accountant",
};

interface FormState {
  username: string;
  full_name: string;
  email: string;
  role: string;
  password: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  username: "",
  full_name: "",
  email: "",
  role: "cashier",
  password: "",
  is_active: true,
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<User | null>(null);

  const isAdmin = me?.role === "super_admin" || me?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.users.list({
        page,
        page_size: pageSize,
        search: search || undefined,
        role: roleFilter || undefined,
      });
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, roleFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({
      username: u.username,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      password: "",
      is_active: u.is_active,
    });
    setFormError("");
    setFormOpen(true);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value, type } = e.target;
    setForm((f) => ({
      ...f,
      [name]:
        type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.username.trim() || !form.full_name.trim() || !form.email.trim()) {
      setFormError("Username, full name and email are required.");
      return;
    }
    if (!editing && form.password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (editing && form.password && form.password.length < 8) {
      setFormError("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          full_name: form.full_name.trim(),
          role: form.role,
          is_active: form.is_active,
        };
        if (form.username !== editing.username) {
          payload.username = form.username.trim();
        }
        if (form.email !== editing.email) {
          payload.email = form.email.trim();
        }
        if (form.password) payload.password = form.password;
        await api.users.update(editing.id, payload);
        toast("User updated", "success");
      } else {
        await api.users.create({
          username: form.username.trim(),
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          role: form.role,
          password: form.password,
          is_active: form.is_active,
        });
        toast("User created", "success");
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    try {
      if (deactivating.is_active) {
        await api.users.remove(deactivating.id);
        toast(`"${deactivating.full_name}" deactivated`, "success");
      } else {
        await api.users.update(deactivating.id, { is_active: true });
        toast(`"${deactivating.full_name}" activated`, "success");
      }
      setDeactivating(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
      setDeactivating(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="animate-fade-up">
      <PageHeader title="User Management" subtitle={`${total} users in the system`}>
        <button onClick={openAdd} className="btn btn-primary">
          + New user
        </button>
      </PageHeader>

      <div className="toolbar">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search users…"
          className="input sm:max-w-xs"
        />
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="select"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No users found"
            hint="Adjust your search or create a new user."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="hidden sm:table-cell">Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Joined</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const initials = u.full_name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  const protectedUser =
                    u.role === "super_admin" || u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${
                              u.is_active
                                ? "bg-gradient-to-br from-emerald-400 to-teal-600 text-white"
                                : "bg-slate-200 text-slate-500"
                            }`}
                          >
                            {initials}
                          </span>
                          <div>
                            <p className="font-bold text-slate-800">
                              {u.full_name}
                              {u.id === me?.id && (
                                <span className="ml-1.5 text-[10px] font-semibold text-emerald-600">
                                  (you)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400">
                              @{u.username}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden text-slate-500 sm:table-cell">
                        {u.email}
                      </td>
                      <td>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            roleStyles[u.role] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {roleLabels[u.role] ?? u.role}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                            u.is_active ? "text-emerald-600" : "text-slate-400"
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              u.is_active ? "bg-emerald-500" : "bg-slate-300"
                            }`}
                          />
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="hidden text-xs text-slate-400 md:table-cell">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="text-right">
                        {isAdmin && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => openEdit(u)}
                              className="btn btn-sm btn-ghost"
                            >
                              Edit
                            </button>
                            {!protectedUser && (
                              <button
                                onClick={() => setDeactivating(u)}
                                className={`btn btn-sm ${
                                  u.is_active
                                    ? "btn-danger-soft"
                                    : "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 hover:bg-emerald-100"
                                }`}
                              >
                                {u.is_active ? "Deactivate" : "Activate"}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && users.length > 0 && (
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

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.full_name}` : "New user"}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Username *</label>
              <input
                name="username"
                value={form.username}
                onChange={handleChange}
                placeholder="johndoe"
                autoFocus
                className="input"
              />
            </div>
            <div>
              <label className="label">Full name *</label>
              <input
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                placeholder="John Doe"
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="label">Email *</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="john@shop.com"
              className="input"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Role</label>
              <select
                name="role"
                value={form.role}
                onChange={handleChange}
                className="select"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">
                {editing ? "New password (optional)" : "Password *"}
              </label>
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder={
                  editing ? "Leave blank to keep current" : "Min 8 characters"
                }
                className="input"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              name="is_active"
              type="checkbox"
              checked={form.is_active}
              onChange={handleChange}
              className="h-4 w-4 rounded accent-emerald-600"
            />
            Account active
          </label>
          {formError && (
            <p className="text-xs font-semibold text-red-600">{formError}</p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary w-full"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
          </button>
        </form>
      </Modal>

      <Modal
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        title={deactivating?.is_active ? "Deactivate user" : "Activate user"}
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-2xl">
            {deactivating?.is_active ? "⛔" : "✅"}
          </span>
          <p className="mt-3 text-sm text-slate-600">
            {deactivating?.is_active ? "Deactivate" : "Activate"}{" "}
            <span className="font-bold text-slate-900">
              {deactivating?.full_name}
            </span>
            ?
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setDeactivating(null)}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={confirmDeactivate}
            className={`btn ${
              deactivating?.is_active
                ? "btn-danger"
                : "bg-emerald-500 text-white hover:bg-emerald-600"
            }`}
          >
            Confirm
          </button>
        </div>
      </Modal>
    </div>
  );
}
