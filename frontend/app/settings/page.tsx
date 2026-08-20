"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import type { SettingValue } from "@/lib/types";

const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "store_name", label: "Store name", hint: "Shown on receipts and dashboards" },
  { key: "currency", label: "Currency symbol", hint: "e.g. Rs, $, £" },
  { key: "tax_rate", label: "Default tax rate (%)", hint: "Applied to new sales" },
  { key: "low_stock_threshold", label: "Low stock threshold", hint: "Alerts when stock falls below this" },
  { key: "receipt_footer", label: "Receipt footer", hint: "Multi-line message printed at the bottom of receipts (one line per break)" },
];

const EZCASH_FIELDS: { key: string; label: string; hint: string; type?: string }[] = [
  { key: "ezcash_enabled", label: "EZ Cash Enabled", hint: "true to enable, false to disable", type: "toggle" },
  { key: "ezcash_sandbox", label: "Sandbox Mode", hint: "true for test/sandbox, false for live production", type: "toggle" },
  { key: "ezcash_api_url", label: "API URL", hint: "Provider API endpoint URL (leave empty for sandbox)" },
  { key: "ezcash_api_key", label: "API Key", hint: "Provider API key for authentication" },
  { key: "ezcash_api_secret", label: "API Secret", hint: "Provider API secret" },
  { key: "ezcash_timeout", label: "Request Timeout (seconds)", hint: "HTTP request timeout for provider calls" },
  { key: "ezcash_denominations", label: "Quick Denominations", hint: "Comma-separated amounts (e.g. 100,250,500,1000)" },
];

const DEFAULT_FOOTER_PREVIEW =
  "Thank you for your purchase!\nReturn policy: Items eligible for return within 3 days with receipt.";

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await api.settings.get();
      const map: Record<string, string> = {};
      Object.values(data.settings).forEach((s: SettingValue) => {
        map[s.key] = s.value ?? "";
      });
      setValues(map);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key: string, e: React.FormEvent) {
    e.preventDefault();
    setSaving(key);
    try {
      await api.settings.update(key, values[key] ?? "");
      toast("Settings saved", "success");
      setDirty((d) => ({ ...d, [key]: false }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(null);
    }
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon="🔒"
        title="No access"
        hint="Only administrators can manage settings."
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Settings" subtitle="Store-wide defaults used across the system" />

      <div className="max-w-2xl space-y-5">
        {loading ? (
          <div className="card grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : (
          FIELDS.map((f) => (
            <form
              key={f.key}
              onSubmit={(e) => save(f.key, e)}
              className="card"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <label className="label">{f.label}</label>
                  <p className="mb-1.5 text-xs text-slate-400">{f.hint}</p>
                  {f.key === "receipt_footer" ? (
                    <textarea
                      rows={4}
                      value={values[f.key] ?? ""}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [f.key]: e.target.value }));
                        setDirty((d) => ({ ...d, [f.key]: true }));
                      }}
                      className="textarea"
                    />
                  ) : (
                    <input
                      value={values[f.key] ?? ""}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [f.key]: e.target.value }));
                        setDirty((d) => ({ ...d, [f.key]: true }));
                      }}
                      className="input"
                    />
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!dirty[f.key] || saving === f.key}
                  className="btn btn-primary"
                >
                  {saving === f.key ? "Saving…" : "Save"}
                </button>
              </div>

              {f.key === "receipt_footer" && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Print preview
                  </p>
                  <div className="rounded-xl bg-slate-100 px-4 py-4">
                    <div
                      className="mx-auto bg-white px-4 py-3 font-mono text-xs text-slate-700 shadow-sm ring-1 ring-slate-200"
                      style={{ width: "min(80mm, 100%)" }}
                    >
                      {((values[f.key] ?? "").trim()
                        ? (values[f.key] ?? "").split("\n")
                        : DEFAULT_FOOTER_PREVIEW.split("\n")
                      ).map((line, i) => (
                        <p key={i} className="text-center leading-relaxed">
                          {line || "\u00A0"}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </form>
          ))
        )}
      </div>

      <div className="max-w-2xl mt-8">
        <h2 className="text-lg font-bold text-slate-800 mb-4">EZ Cash Reload Settings</h2>
        <div className="space-y-5">
          {loading ? (
            <div className="card grid place-items-center py-20 text-sm text-slate-400">
              Loading…
            </div>
          ) : (
            EZCASH_FIELDS.map((f) => (
              <form
                key={f.key}
                onSubmit={(e) => save(f.key, e)}
                className="card"
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="label">{f.label}</label>
                    <p className="mb-1.5 text-xs text-slate-400">{f.hint}</p>
                    {f.type === "toggle" ? (
                      <button
                        type="button"
                        onClick={() => {
                          const newVal = values[f.key] === "true" ? "false" : "true";
                          setValues((v) => ({ ...v, [f.key]: newVal }));
                          setDirty((d) => ({ ...d, [f.key]: true }));
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                          values[f.key] === "true" ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                            values[f.key] === "true" ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    ) : (
                      <input
                        value={values[f.key] ?? ""}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [f.key]: e.target.value }));
                          setDirty((d) => ({ ...d, [f.key]: true }));
                        }}
                        className="input"
                      />
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!dirty[f.key] || saving === f.key}
                    className="btn btn-primary"
                  >
                    {saving === f.key ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
