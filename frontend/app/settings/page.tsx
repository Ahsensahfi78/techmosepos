"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import ReceiptPaper from "@/components/ReceiptPaper";
import type { CartLine } from "@/components/CartPanel";
import {
  applyReceiptRotation,
  fitReceiptPage,
  parseReceiptRotation,
  RECEIPT_WIDTH_MAX_MM,
  RECEIPT_WIDTH_MIN_MM,
} from "@/lib/receiptTheme";
import type { SettingValue } from "@/lib/types";

const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "currency", label: "Currency symbol", hint: "e.g. Rs, $, £" },
  { key: "tax_rate", label: "Default tax rate (%)", hint: "Applied to new sales" },
  { key: "low_stock_threshold", label: "Low stock threshold", hint: "Alerts when stock falls below this" },
];

const EZCASH_FIELDS: { key: string; label: string; hint: string; type?: string }[] = [
  { key: "ezcash_enabled", label: "EZ Cash Enabled", hint: "true to enable, false to disable", type: "toggle" },
  { key: "ezcash_sandbox", label: "Sandbox Mode", hint: "true for test/sandbox, false for live Reloadly production", type: "toggle" },
  { key: "ezcash_client_id", label: "EZ Cash Client ID", hint: "From Dashboard > Developers > API Settings" },
  { key: "ezcash_client_secret", label: "EZ Cash Client Secret", hint: "From Dashboard > Developers > API Settings" },
  { key: "ezcash_timeout", label: "Request Timeout (seconds)", hint: "HTTP request timeout in seconds" },
  { key: "ezcash_denominations", label: "Quick Denominations", hint: "Comma-separated amounts (e.g. 100,250,500,1000)" },
];

type ReceiptField = {
  key: string;
  label: string;
  hint: string;
  kind?: "input" | "textarea";
};

const RECEIPT_FIELDS: ReceiptField[] = [
  { key: "store_name", label: "Shop name", hint: "Bold header line at the top of every receipt" },
  { key: "store_address", label: "Address", hint: "One line per row. Blank = line hidden" },
  { key: "store_phone", label: "Phone number(s)", hint: "Separate multiple numbers with · or a new line" },
  { key: "store_email", label: "Email / website", hint: "Optional. Blank = line hidden" },
  { key: "receipt_footer", label: "Footer message", hint: "e.g. Thank you, come again! Blank = no footer" , kind: "textarea" },
];

const RECEIPT_KEYS = [
  ...RECEIPT_FIELDS.map((f) => f.key),
  "store_logo",
  "receipt_width_mm",
  "receipt_rotate_180",
];

/** Sample cart so Settings can preview a real receipt while you type. */
const PREVIEW_LINES: CartLine[] = [
  {
    product: {
      id: -1,
      name: "Samsung Galaxy A15 128GB",
      price: 32500,
      stock: 1,
      sku: "SGA15-128",
      barcode: "4712345678901",
    },
    qty: 1,
    lineDiscount: 0,
  },
  {
    product: {
      id: -2,
      name: "USB-C Cable 1m",
      price: 850,
      stock: 5,
      sku: "USBC-1M",
      barcode: "4719876543210",
    },
    qty: 2,
    lineDiscount: 100,
  },
];

const PREVIEW_TOTALS = {
  subtotal: 34200,
  discount: 100,
  tax: 0,
  pointsUsed: 0,
  total: 34100,
  paid: 35000,
  due: 0,
  change: 900,
  method: "cash",
};

const WIDTH_OPTIONS: number[] = Array.from(
  { length: RECEIPT_WIDTH_MAX_MM - RECEIPT_WIDTH_MIN_MM + 1 },
  (_, i) => RECEIPT_WIDTH_MIN_MM + i
);

const LOGO_MAX_BYTES = 300_000;

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

  // Keep the preview strip and the runtime @page rule in step with the fields
  // being edited, so Ctrl+P from this page prints the same box the POS uses.
  const previewRef = useRef<HTMLDivElement>(null);
  const receiptSignature = RECEIPT_KEYS.map((k) => values[k] ?? "").join(" ");
  useEffect(() => {
    applyReceiptRotation(values.receipt_rotate_180);
    fitReceiptPage(previewRef.current, values.receipt_width_mm);
  }, [loading, receiptSignature, values.receipt_width_mm, values.receipt_rotate_180]);

  function setValue(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty((d) => ({ ...d, [key]: true }));
  }

  async function saveKeys(formKey: string, keys: string[]) {
    setSaving(formKey);
    try {
      await Promise.all(
        keys.map((k) => api.settings.update(k, values[k] ?? ""))
      );
      toast("Settings saved", "success");
      setDirty((d) => {
        const next = { ...d };
        keys.forEach((k) => (next[k] = false));
        return next;
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(null);
    }
  }

  async function save(key: string, e: React.FormEvent) {
    e.preventDefault();
    await saveKeys(key, [key]);
  }

  const receiptDirty = useMemo(
    () => RECEIPT_KEYS.some((k) => dirty[k]),
    [dirty]
  );

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Logo must be an image file", "error");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast("Logo must be smaller than 300 KB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setValue("store_logo", String(reader.result ?? ""));
    reader.onerror = () => toast("Could not read that file", "error");
    reader.readAsDataURL(file);
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

      {/* ── Receipt / Invoice Details ─────────────────────────────────── */}
      <div className="max-w-2xl mb-5">
        <h2 className="text-lg font-bold text-slate-800 mb-1">
          Receipt / Invoice Details
        </h2>
        <p className="mb-4 text-xs text-slate-400">
          Printed by the POS after every sale. Leave a field blank to drop that
          line from the receipt entirely.
        </p>

        {loading ? (
          <div className="card grid place-items-center py-20 text-sm text-slate-400">
            Loading…
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveKeys("__receipt__", RECEIPT_KEYS);
            }}
            className="card space-y-4"
          >
            {RECEIPT_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <p className="mb-1.5 text-xs text-slate-400">{f.hint}</p>
                {f.kind === "textarea" ? (
                  <textarea
                    rows={f.key === "store_address" ? 2 : 3}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    className="textarea"
                  />
                ) : (
                  <input
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    className="input"
                  />
                )}
              </div>
            ))}

            <div>
              <label className="label">Logo (optional)</label>
              <p className="mb-1.5 text-xs text-slate-400">
                PNG or JPG under 300 KB. Shown above the shop name.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={onLogoFile}
                  className="text-xs text-slate-500 file:btn file:btn-sm"
                />
                {values.store_logo ? (
                  <button
                    type="button"
                    onClick={() => setValue("store_logo", "")}
                    className="btn btn-sm bg-slate-100 text-slate-600 hover:bg-slate-200"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            <div>
              <label className="label">Paper width</label>
              <p className="mb-1.5 text-xs text-slate-400">
                Roll width of the thermal printer, between 58mm and 80mm.
              </p>
              <select
                value={values.receipt_width_mm || "80"}
                onChange={(e) => setValue("receipt_width_mm", e.target.value)}
                className="input"
              >
                {WIDTH_OPTIONS.map((mm) => (
                  <option key={mm} value={String(mm)}>
                    {mm} mm
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Paper orientation</label>
              <p className="mb-1.5 text-xs text-slate-400">
                If the printed receipt comes out upside down, choose
                &ldquo;Rotate 180°&rdquo;. Only the printed copy is rotated —
                the preview here always stays upright. The XP-365B and similar
                TSPL label printers are unaffected.
              </p>
              <select
                data-testid="receipt-rotate"
                value={parseReceiptRotation(values.receipt_rotate_180) === 180 ? "180" : "0"}
                onChange={(e) =>
                  setValue(
                    "receipt_rotate_180",
                    e.target.value === "180" ? "true" : "false"
                  )
                }
                className="input"
              >
                <option value="0">Correct — print as shown</option>
                <option value="180">Rotate 180° (upside-down printer)</option>
              </select>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!receiptDirty || saving === "__receipt__"}
                className="btn btn-primary"
              >
                {saving === "__receipt__" ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}

        {/* Live preview */}
        {!loading && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Preview
            </p>
            <div className="receipt-preview inline-block" ref={previewRef}>
              <ReceiptPaper
                brand={{
                  store_name: values.store_name,
                  store_address: values.store_address,
                  store_phone: values.store_phone,
                  store_email: values.store_email,
                  store_logo: values.store_logo,
                  receipt_footer: values.receipt_footer,
                }}
                meta={{
                  saleId: "PREVIEW",
                  cashier: "Cashier",
                  customer: "Walk-in customer",
                }}
                lines={PREVIEW_LINES}
                totals={PREVIEW_TOTALS}
              />
            </div>
          </div>
        )}
      </div>

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
                  <input
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    className="input"
                  />
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
                          setValue(f.key, newVal);
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
                        onChange={(e) => setValue(f.key, e.target.value)}
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
