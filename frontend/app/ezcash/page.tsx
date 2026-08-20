"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { validatePhone } from "@/lib/ezcash";
import type { EzCashReload } from "@/lib/types";
import PageHeader from "@/components/ui/PageHeader";
import EzCashReloadModal from "@/components/EzCashReloadModal";

const DENOMINATIONS = [100, 250, 500, 1000];

export default function EzCashPage() {
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [amount, setAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [step, setStep] = useState<"phone" | "amount">("phone");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhone, setModalPhone] = useState("");
  const [lastResult, setLastResult] = useState<EzCashReload | null>(null);

  function handlePhoneSubmit() {
    const v = validatePhone(phone);
    if (!v.valid) {
      setPhoneError(v.error!);
      return;
    }
    setPhoneError("");
    setStep("amount");
  }

  function handleQuickReload(amt: number) {
    const v = validatePhone(phone);
    if (!v.valid) {
      setPhoneError(v.error!);
      return;
    }
    setAmount(amt);
    setModalPhone(phone);
    setModalOpen(true);
  }

  function handleCustomSubmit() {
    const amt = parseFloat(customAmount);
    if (!amt || amt <= 0) return;
    setAmount(amt);
    setModalPhone(phone);
    setModalOpen(true);
  }

  return (
    <div>
      <PageHeader title="EZ Cash Reload" subtitle="Mobile top-up / reload service" />

      {step === "phone" && (
        <div className="mx-auto max-w-md">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <label className="label">Customer Mobile Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handlePhoneSubmit()}
              placeholder="07XXXXXXXX or +947XXXXXXXX"
              className="input text-lg"
              autoFocus
            />
            {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
            <p className="mt-2 text-xs text-slate-400">
              Sri Lankan mobile numbers (07x, +947x, 947x)
            </p>
            <button onClick={handlePhoneSubmit} className="btn btn-primary mt-4 w-full">
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "amount" && (
        <div className="mx-auto max-w-md">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="mb-1 text-sm text-slate-500">Reloading to</p>
            <p className="mb-4 text-lg font-bold">{phone}</p>

            <div className="grid grid-cols-2 gap-3">
              {DENOMINATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => handleQuickReload(d)}
                  className="rounded-xl border-2 border-slate-200 px-4 py-4 text-center transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                  <span className="text-2xl font-bold text-slate-800">{formatMoney(d)}</span>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <label className="label">Custom Amount (Rs)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
                  placeholder="Enter amount"
                  className="input flex-1"
                />
                <button
                  onClick={handleCustomSubmit}
                  disabled={!customAmount || parseFloat(customAmount) <= 0}
                  className="btn btn-primary"
                >
                  Go
                </button>
              </div>
            </div>

            <button
              onClick={() => setStep("phone")}
              className="btn btn-secondary mt-4 w-full"
            >
              Change Number
            </button>
          </div>

          {lastResult && (
            <div
              className={`mt-4 rounded-xl border-2 p-4 ${
                lastResult.status === "successful"
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <p className="text-sm font-semibold">
                Last: {lastResult.reference_number} — {formatMoney(lastResult.amount)} —{" "}
                <span
                  className={
                    lastResult.status === "successful" ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {lastResult.status}
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      <EzCashReloadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onDone={(r) => {
          setLastResult(r);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
