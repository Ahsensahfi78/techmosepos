"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { validatePhone } from "@/lib/ezcash";
import type { EzCashReload } from "@/lib/types";
import Modal from "./ui/Modal";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onDone?: (reload: EzCashReload) => void;
}

export default function EzCashReloadModal({ open, onClose, onDone }: Props) {
  const [step, setStep] = useState<"phone" | "amount" | "confirm" | "processing" | "result">("phone");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [normalized, setNormalized] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EzCashReload | null>(null);
  const [error, setError] = useState("");

  const denominations = [100, 250, 500, 1000];

  useEffect(() => {
    if (open) {
      setStep("phone");
      setPhone("");
      setPhoneError("");
      setNormalized("");
      setAmount(0);
      setCustomAmount("");
      setMethod("cash");
      setBusy(false);
      setResult(null);
      setError("");
    }
  }, [open]);

  function handlePhoneNext() {
    const v = validatePhone(phone);
    if (!v.valid) {
      setPhoneError(v.error!);
      return;
    }
    setPhoneError("");
    setNormalized(v.normalized);
    setStep("amount");
  }

  function handleAmountNext() {
    const finalAmount = customAmount ? parseFloat(customAmount) : amount;
    if (!finalAmount || finalAmount <= 0) return;
    setAmount(finalAmount);
    setStep("confirm");
  }

  async function handleConfirm() {
    setStep("processing");
    setBusy(true);
    setError("");
    try {
      const reload = await api.ezcash.reload({
        phone_number: phone,
        amount,
        payment_method: method,
        idempotency_key: `ezc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      setResult(reload);
      setStep("result");
      onDone?.(reload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reload failed");
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  }

  const title =
    step === "phone"
      ? "EZ Cash Reload"
      : step === "amount"
        ? "Select Amount"
        : step === "confirm"
          ? "Confirm Reload"
          : step === "processing"
            ? "Processing..."
            : result?.status === "successful"
              ? "Reload Successful"
              : "Reload Failed";

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} maxWidth="max-w-md">
      {step === "phone" && (
        <div>
          <label className="label">Mobile Number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handlePhoneNext()}
            placeholder="07XXXXXXXX or +947XXXXXXXX"
            className="input"
            autoFocus
          />
          {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
          <p className="mt-2 text-xs text-slate-400">
            Sri Lankan mobile numbers only (07x, +947x)
          </p>
          <button onClick={handlePhoneNext} className="btn btn-primary mt-4 w-full">
            Next
          </button>
        </div>
      )}

      {step === "amount" && (
        <div>
          <p className="mb-3 text-sm text-slate-500">
            To: <b>{normalized}</b>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {denominations.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setAmount(d);
                  setCustomAmount("");
                }}
                className={`rounded-xl border-2 px-4 py-3 text-lg font-bold transition ${
                  amount === d && !customAmount
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                {formatMoney(d)}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <label className="label">Custom Amount (Rs)</label>
            <input
              type="number"
              min="1"
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setAmount(0);
              }}
              placeholder="Enter amount"
              className="input"
            />
          </div>
          <div className="mt-3">
            <label className="label">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="select"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep("phone")} className="btn btn-secondary flex-1">
              Back
            </button>
            <button
              onClick={handleAmountNext}
              disabled={!amount && !customAmount}
              className="btn btn-primary flex-1"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Phone</span>
              <span className="font-semibold">{normalized}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-slate-500">Amount</span>
              <span className="text-2xl font-bold text-emerald-600">{formatMoney(amount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-slate-500">Payment</span>
              <span className="font-semibold capitalize">{method}</span>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep("amount")} className="btn btn-secondary flex-1">
              Back
            </button>
            <button onClick={handleConfirm} className="btn btn-primary flex-1">
              Confirm Reload
            </button>
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="py-8 text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500" />
          <p className="text-sm text-slate-500">Processing reload...</p>
        </div>
      )}

      {step === "result" && result && (
        <div>
          <div
            className={`rounded-xl border-2 p-4 text-center ${
              result.status === "successful"
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <div
              className={`mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full text-white ${
                result.status === "successful" ? "bg-emerald-500" : "bg-red-500"
              }`}
            >
              {result.status === "successful" ? (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <p
              className={`text-lg font-bold ${
                result.status === "successful" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {result.status === "successful" ? "Reload Successful" : "Reload Failed"}
            </p>
          </div>
          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Reference</span>
              <span className="font-mono font-semibold">{result.reference_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Phone</span>
              <span>{result.phone_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Amount</span>
              <span className="font-bold">{formatMoney(result.amount)}</span>
            </div>
            {result.provider_reference && (
              <div className="flex justify-between">
                <span className="text-slate-500">Provider Ref</span>
                <span className="font-mono">{result.provider_reference}</span>
              </div>
            )}
            {result.failure_reason && (
              <div className="flex justify-between">
                <span className="text-slate-500">Reason</span>
                <span className="text-red-600">{result.failure_reason}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn btn-primary mt-4 w-full">
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}
