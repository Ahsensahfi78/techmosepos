"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";

export default function BackupDataPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const canExport =
    isAdmin || user?.role === "manager" || user?.role === "accountant";

  const restoreRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [importing, setImporting] = useState(false);

  async function handleDownload() {
    try {
      await api.backup.download();
      toast("Backup downloaded", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Download failed", "error");
    }
  }

  async function handleExport() {
    try {
      await api.backup.exportProducts();
      toast("Products exported to CSV", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    }
  }

  async function handleRestore(file: File | undefined) {
    if (!file) return;
    if (!confirm("Restoring will REPLACE all current data. Continue?")) {
      if (restoreRef.current) restoreRef.current.value = "";
      return;
    }
    setRestoring(true);
    try {
      const res = await api.backup.restore(file);
      toast(res.message || "Database restored", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Restore failed", "error");
    } finally {
      setRestoring(false);
      if (restoreRef.current) restoreRef.current.value = "";
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.backup.importProducts(file);
      toast(
        `Imported: ${res.created} created, ${res.updated} updated`,
        "success"
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  if (!isAdmin && !canExport) {
    return (
      <EmptyState
        icon="🚫"
        title="No access"
        hint="You do not have permission to use the data tools."
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Data tools"
        subtitle="Backup, restore and import/export your TechMOS data"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <span className="text-lg">🗄️</span>
              <h2 className="card-title">Database backup</h2>
            </div>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Download a full snapshot of the database, or restore from a
            previously downloaded file. Restoring replaces all current data.
          </p>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <button
                onClick={handleDownload}
                className="btn btn-primary"
              >
                ⬇ Download backup
              </button>
            )}
            {isAdmin && (
              <>
                <button
                  onClick={() => restoreRef.current?.click()}
                  disabled={restoring}
                  className="btn btn-secondary"
                >
                  {restoring ? "Restoring…" : "↑ Restore from file"}
                </button>
                <input
                  ref={restoreRef}
                  type="file"
                  accept=".db,.sqlite,.sqlite3"
                  className="hidden"
                  onChange={(e) => handleRestore(e.target.files?.[0])}
                />
              </>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <span className="text-lg">📦</span>
              <h2 className="card-title">Products CSV</h2>
            </div>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Export the full product catalogue to CSV, or import one back in.
            Rows are matched by product name; existing products are updated.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              className="btn btn-secondary"
            >
              ⬇ Export products CSV
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                  className="btn btn-secondary"
                >
                  {importing ? "Importing…" : "↑ Import products CSV"}
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => handleImport(e.target.files?.[0])}
                />
              </>
            )}
          </div>
        </section>
      </div>

      {isAdmin && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
          ⚠️ Restoring a backup replaces the entire database. Download a fresh
          backup before experimenting with a restore.
        </p>
      )}
    </div>
  );
}
