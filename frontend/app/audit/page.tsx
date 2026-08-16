"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import type { AuditLog } from "@/lib/types";

export default function AuditPage() {
  const { toast } = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.audit.list({
        page,
        page_size: pageSize,
        search: search || undefined,
        entity_type: entityType || undefined,
      });
      setLogs(data.items);
      setTotal(data.total);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load audit log", "error");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, entityType, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const entityTypes = Array.from(new Set(logs.map((l) => l.entity_type))).sort();

  return (
    <div className="animate-fade-up">
      <PageHeader title="Audit Log" subtitle={`${total} recorded actions`} />

      <div className="toolbar">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search actions or details…"
          className="input sm:max-w-xs"
        />
        <select
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(1);
          }}
          className="select"
        >
          <option value="">All entities</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="table-shell">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon="🕵️"
            title="No audit entries"
            hint="Actions will appear here as they happen."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th className="hidden sm:table-cell">Entity</th>
                  <th>User</th>
                  <th className="hidden md:table-cell">Details</th>
                  <th className="text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-600">
                        {l.action}
                      </span>
                    </td>
                    <td className="hidden text-xs font-medium text-slate-500 sm:table-cell">
                      {l.entity_type}
                      {l.entity_id ? ` #${l.entity_id}` : ""}
                    </td>
                    <td className="text-xs text-slate-500">
                      {l.username ?? "system"}
                    </td>
                    <td className="hidden max-w-xs truncate text-xs text-slate-400 md:table-cell">
                      {l.details}
                    </td>
                    <td className="text-right text-xs text-slate-400">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && logs.length > 0 && (
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
    </div>
  );
}
