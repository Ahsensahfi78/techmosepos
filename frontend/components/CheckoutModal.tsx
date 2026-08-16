"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/constants";
import type { Customer } from "@/lib/types";
import Modal from "./ui/Modal";

interface ImeiLine {
  product_id: number;
  name: string;
  qty: number;
}

export interface SplitLine {
  method: string;
  amount: number;
}

interface CheckoutModalProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  subtotal: number;
  discount: number;
  tax: number;
  pointsUsed: number;
  total: number;
  customer: Customer | null;
  customers: Customer[];
  method: string;
  imeiLines: ImeiLine[];
  imeis: Record<number, string[]>;
  onImeiChange: (productId: number, values: string[]) => void;
  onCustomerChange: (c: Customer | null) => void;
  onDiscountChange: (n: number) => void;
  onTaxChange: (n: number) => void;
  onPointsChange: (n: number) => void;
  onMethodChange: (m: string) => void;
  onConfirm: (paid: number, payments?: SplitLine[]) => void;
}

const quickAmounts = [1000, 2000, 5000, 10000];
const methods = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank", label: "Bank transfer" },
];
const methodName = (m: string) => methods.find((x) => x.value === m)?.label ?? m;

export default function CheckoutModal({
  open,
  busy,
  onClose,
  subtotal,
  discount,
  tax,
  pointsUsed,
  total,
  customer,
  customers,
  method,
  imeiLines,
  imeis,
  onImeiChange,
  onCustomerChange,
  onDiscountChange,
  onTaxChange,
  onPointsChange,
  onMethodChange,
  onConfirm,
}: CheckoutModalProps) {
  const [paidStr, setPaidStr] = useState("");
  const [discountStr, setDiscountStr] = useState(discount ? String(discount) : "");
  const [taxStr, setTaxStr] = useState(tax ? String(tax) : "");
  const [pointsStr, setPointsStr] = useState(pointsUsed ? String(pointsUsed) : "");
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRows, setSplitRows] = useState<{ method: string; amount: string }[]>([
    { method: "cash", amount: "" },
    { method: "card", amount: "" },
  ]);

  useEffect(() => {
    if (open) {
      setPaidStr("");
      setDiscountStr(discount ? String(discount) : "");
      setTaxStr(tax ? String(tax) : "");
      setPointsStr(pointsUsed ? String(pointsUsed) : "");
      setSplitOpen(false);
      setSplitRows([
        { method: "cash", amount: "" },
        { method: "card", amount: "" },
      ]);
    }
  }, [open]);

  const pointsCap = customer?.loyalty_points ?? 0;

  const isWalkIn = !customer;
  const paidValue = Math.max(0, parseFloat(paidStr) || 0);
  const splitTotal = splitRows.reduce(
    (s, r) => s + Math.max(0, parseFloat(r.amount) || 0),
    0
  );
  const change = isWalkIn ? Math.max(0, (splitOpen ? splitTotal : paidValue) - total) : 0;
  const imeiComplete = imeiLines.every(
    (l) => (imeis[l.product_id] ?? []).filter((v) => v.trim()).length >= l.qty
  );
  const canConfirm =
    total > 0 &&
    !busy &&
    imeiComplete &&
    (isWalkIn
      ? (splitOpen ? splitTotal : paidValue) >= total
      : (splitOpen ? splitTotal : paidValue) <= total);

  function syncDiscount(v: string) {
    setDiscountStr(v);
    onDiscountChange(Math.max(0, parseFloat(v) || 0));
  }
  function syncTax(v: string) {
    setTaxStr(v);
    onTaxChange(Math.max(0, parseFloat(v) || 0));
  }
  function syncPoints(v: string) {
    setPointsStr(v);
    onPointsChange(
      Math.min(Math.max(0, Math.floor(parseFloat(v) || 0)), pointsCap)
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Checkout"
      maxWidth="max-w-lg"
      footer={
        <button
          onClick={() => {
            if (splitOpen) {
              const payments = splitRows
                .map((r) => ({
                  method: r.method,
                  amount: Math.max(0, parseFloat(r.amount) || 0),
                }))
                .filter((p) => p.amount > 0);
              onConfirm(splitTotal, payments);
            } else {
              onConfirm(paidValue);
            }
          }}
          disabled={!canConfirm}
          className="btn btn-primary w-full"
        >
          {busy
            ? "Processing…"
            : isWalkIn
              ? "Confirm payment"
              : "Complete sale"}
        </button>
      }
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Amount due
          </p>
          <p className="mt-0.5 text-3xl font-bold text-slate-900">
            {formatMoney(total)}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-slate-500">
            Subtotal <b>{formatMoney(subtotal)}</b>
          </p>
          {discount > 0 && (
            <p className="text-emerald-600">
              Discount −{formatMoney(discount)}
            </p>
          )}
          {tax > 0 && <p className="text-slate-500">Tax +{formatMoney(tax)}</p>}
          {pointsUsed > 0 && (
            <p className="text-amber-600">Loyalty −{formatMoney(pointsUsed)}</p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <label className="label">Customer</label>
        <select
          value={customer?.id ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onCustomerChange(
              id ? customers.find((c) => c.id === id) ?? null : null
            );
            if (!id) {
              onPointsChange(0);
              setPointsStr("");
            }
          }}
          className="select"
        >
          <option value="">Walk-in customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — due {formatMoney(c.due_balance)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Discount (Rs)</label>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={discountStr}
            onChange={(e) => syncDiscount(e.target.value)}
            placeholder="0"
            className="input"
          />
        </div>
        <div>
          <label className="label">Tax (Rs)</label>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={taxStr}
            onChange={(e) => syncTax(e.target.value)}
            placeholder="0"
            className="input"
          />
        </div>
      </div>

      {imeiLines.length > 0 && (
        <div className="mt-5">
          <label className="label">IMEI numbers (required for tracked items)</label>
          {imeiLines.map((l) => (
            <div
              key={l.product_id}
              className="mt-2 rounded-xl border border-slate-200 p-3"
            >
              <p className="mb-2 text-xs font-bold text-slate-700">
                {l.name}{" "}
                <span className="font-medium text-slate-400">× {l.qty}</span>
              </p>
              <div className="grid gap-2">
                {Array.from({ length: l.qty }).map((_, i) => {
                  const values = imeis[l.product_id] ?? [];
                  return (
                    <input
                      key={i}
                      value={values[i] ?? ""}
                      onChange={(e) => {
                        const arr = [...values];
                        arr[i] = e.target.value;
                        onImeiChange(l.product_id, arr);
                      }}
                      placeholder={`IMEI ${i + 1}`}
                      className="input font-mono"
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {!imeiComplete && (
            <p className="mt-1 text-xs font-semibold text-red-600">
              Enter an IMEI for every unit before confirming.
            </p>
          )}
        </div>
      )}

      {customer && (
        <div className="mt-5">
          <label className="label">Redeem loyalty points</label>
          <div className="mt-1.5 flex items-center gap-3">
            <input
              type="number"
              min="0"
              max={pointsCap}
              inputMode="numeric"
              value={pointsStr}
              onChange={(e) => syncPoints(e.target.value)}
              placeholder="0"
              className="input"
            />
            <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700">
              {pointsCap} pts · 1 pt = Rs 1
            </span>
          </div>
          {pointsUsed > 0 && (
            <p className="mt-1 text-xs font-medium text-amber-600">
              Applying {pointsUsed} pts → −{formatMoney(pointsUsed)}
            </p>
          )}
        </div>
      )}

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <label className="label mb-0">Payment method</label>
          <button
            type="button"
            onClick={() => setSplitOpen((o) => !o)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
              splitOpen
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            ⇄ Split payment
          </button>
        </div>
        {!splitOpen ? (
          <>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {methods.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => onMethodChange(m.value)}
                  className={`rounded-lg border py-2 text-xs font-bold transition ${
                    method === m.value
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <label className="label">{isWalkIn ? "Cash received" : "Amount paid"}</label>
              <input
                autoFocus
                type="number"
                min="0"
                inputMode="numeric"
                value={paidStr}
                onChange={(e) => setPaidStr(e.target.value)}
                placeholder={isWalkIn ? "0" : String(total)}
                className="input text-xl font-bold"
              />
            </div>
          </>
        ) : (
          <div className="mt-2 space-y-2">
            {splitRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.method}
                  onChange={(e) =>
                    setSplitRows((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, method: e.target.value } : r
                      )
                    )
                  }
                  className="select w-40 shrink-0"
                >
                  {methods.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={row.amount}
                  onChange={(e) =>
                    setSplitRows((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, amount: e.target.value } : r
                      )
                    )
                  }
                  placeholder="0"
                  className="input font-bold"
                />
                <span className="w-16 shrink-0 text-right text-sm font-semibold text-slate-500">
                  {formatMoney(Math.max(0, parseFloat(row.amount) || 0))}
                </span>
              </div>
            ))}
            <p className="text-xs font-medium text-slate-500">
              Total tendered:{" "}
              <span className="font-bold text-slate-800">{formatMoney(splitTotal)}</span>
              {" · "}due:{" "}
              <span className="font-bold">{formatMoney(Math.max(0, total - splitTotal))}</span>
            </p>
          </div>
        )}
      </div>

      {!splitOpen && isWalkIn && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={() => setPaidStr(String(total))}
              className="rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
            >
              Exact
            </button>
            {quickAmounts.map((amt) => (
              <button
                key={amt}
                onClick={() => setPaidStr(String(amt))}
                className="rounded-lg border border-slate-200 bg-white py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Rs {amt.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium text-slate-500">Change</span>
            <span
              className={`text-lg font-bold ${
                change > 0 ? "text-emerald-600" : "text-slate-400"
              }`}
            >
              {formatMoney(change)}
            </span>
          </div>
        </>
      )}

      {!splitOpen && !isWalkIn && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
          <span className="text-sm font-medium text-amber-700">
            {paidValue >= total ? "Fully paid" : "Credit balance"}
          </span>
          <span className="text-lg font-bold text-amber-700">
            {formatMoney(Math.max(0, total - paidValue))}
          </span>
        </div>
      )}

    </Modal>
  );
}
