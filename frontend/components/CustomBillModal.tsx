"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./ui/Modal";
import { formatMoney } from "@/lib/constants";
import { useToast } from "./ui/Toast";

export interface CustomBillItemData {
  name: string;
  qty: number;
  price: number;
  discount: number;
}

interface CustomBillModalProps {
  open: boolean;
  onClose: () => void;
  onAddItem: (item: CustomBillItemData) => void;
}

const QUICK_PRESETS = [
  "Service Charge",
  "Repair Work",
  "Labor Charge",
  "Delivery Fee",
  "Custom Item",
  "Diagnostic Fee",
  "Maintenance",
  "Spare Part",
];

const QUICK_AMOUNTS = [100, 250, 500, 1000, 2500, 5000];

export default function CustomBillModal({
  open,
  onClose,
  onAddItem,
}: CustomBillModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [priceStr, setPriceStr] = useState("");
  const [discountStr, setDiscountStr] = useState("");
  const [activeField, setActiveField] = useState<"price" | "discount">("price");
  const [sessionAddedCount, setSessionAddedCount] = useState(0);

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setQty(1);
      setPriceStr("");
      setDiscountStr("");
      setActiveField("price");
      setSessionAddedCount(0);
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  const price = parseFloat(priceStr) || 0;
  const discount = parseFloat(discountStr) || 0;
  const subtotal = qty * price;
  const lineTotal = Math.max(0, subtotal - discount);

  function handleKeypadPress(val: string) {
    const isPrice = activeField === "price";
    const currentVal = isPrice ? priceStr : discountStr;
    const setter = isPrice ? setPriceStr : setDiscountStr;

    if (val === "C") {
      setter("");
      return;
    }
    if (val === "DEL") {
      setter(currentVal.slice(0, -1));
      return;
    }
    if (val === ".") {
      if (currentVal.includes(".")) return;
      setter(currentVal ? currentVal + "." : "0.");
      return;
    }
    // Prevent multiple leading zeroes
    if (val === "0" || val === "00") {
      if (!currentVal || currentVal === "0") {
        setter("0");
        return;
      }
    }
    // Max 2 decimal digits if dot already exists
    if (currentVal.includes(".")) {
      const parts = currentVal.split(".");
      if (parts[1]?.length >= 2) return;
    }

    setter(currentVal + val);
  }

  function handleQuickAddAmount(amount: number) {
    const current = parseFloat(priceStr) || 0;
    setPriceStr((current + amount).toFixed(2).replace(/\.00$/, ""));
    setActiveField("price");
  }

  function validateAndBuild(): CustomBillItemData | null {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast("Please enter an item description", "error");
      nameInputRef.current?.focus();
      return null;
    }
    if (qty <= 0) {
      toast("Quantity must be greater than 0", "error");
      return null;
    }
    if (price <= 0) {
      toast("Unit price must be greater than 0", "error");
      return null;
    }
    if (discount < 0) {
      toast("Discount cannot be negative", "error");
      return null;
    }

    return {
      name: trimmedName,
      qty,
      price,
      discount,
    };
  }

  function handleAdd(keepOpen: boolean) {
    const item = validateAndBuild();
    if (!item) return;

    onAddItem(item);
    setSessionAddedCount((prev) => prev + 1);

    if (keepOpen) {
      toast(`Added "${item.name}" (${formatMoney(lineTotal)}) to cart`, "success");
      // Reset for next item
      setName("");
      setQty(1);
      setPriceStr("");
      setDiscountStr("");
      setActiveField("price");
      nameInputRef.current?.focus();
    } else {
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="⚡ Bill Without Product (Custom Item)"
      maxWidth="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        {sessionAddedCount > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <span>
              ✓ {sessionAddedCount} custom item{sessionAddedCount > 1 ? "s" : ""} added to the current cart!
            </span>
            <span className="text-[11px] text-emerald-600 font-normal">
              You can add another or click Close to checkout
            </span>
          </div>
        )}

        {/* Item Description */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
            Item Description / Service Name <span className="text-red-500">*</span>
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd(false);
              }
            }}
            placeholder="e.g. Service Charge, Repair Work, Labor Fee…"
            className="input text-base font-medium"
          />

          {/* Quick presets */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setName(preset);
                  nameInputRef.current?.focus();
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  name === preset
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                + {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity, Unit Price & Discount row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Quantity */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
              Quantity
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-lg font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="input h-10 text-center font-bold text-base"
              />
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-lg font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
              >
                +
              </button>
            </div>
            {/* Quick Qty pills */}
            <div className="mt-2 flex justify-between gap-1">
              {[1, 2, 5, 10].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQty(q)}
                  className={`flex-1 rounded py-1 text-[11px] font-bold transition ${
                    qty === q
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Unit Price */}
          <div
            onClick={() => setActiveField("price")}
            className={`cursor-pointer rounded-xl border p-3 transition ${
              activeField === "price"
                ? "border-emerald-500 bg-emerald-50/30 ring-2 ring-emerald-500/20"
                : "border-slate-200 bg-slate-50/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                Unit Price (Rs.) <span className="text-red-500">*</span>
              </label>
              {activeField === "price" && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800">
                  Keypad Active
                </span>
              )}
            </div>
            <input
              type="number"
              step="any"
              value={priceStr}
              onFocus={() => setActiveField("price")}
              onChange={(e) => setPriceStr(e.target.value)}
              placeholder="0.00"
              className="input h-10 font-mono text-lg font-bold text-slate-900"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Each unit amount in LKR
            </p>
          </div>

          {/* Line Discount */}
          <div
            onClick={() => setActiveField("discount")}
            className={`cursor-pointer rounded-xl border p-3 transition ${
              activeField === "discount"
                ? "border-amber-500 bg-amber-50/30 ring-2 ring-amber-500/20"
                : "border-slate-200 bg-slate-50/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                Discount (Rs.)
              </label>
              {activeField === "discount" && (
                <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                  Keypad Active
                </span>
              )}
            </div>
            <input
              type="number"
              step="any"
              value={discountStr}
              onFocus={() => setActiveField("discount")}
              onChange={(e) => setDiscountStr(e.target.value)}
              placeholder="0.00"
              className="input h-10 font-mono text-lg font-bold text-slate-900"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Optional line discount
            </p>
          </div>
        </div>

        {/* Touch Keypad and Quick Amount section */}
        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50/40 p-3 sm:grid-cols-2">
          {/* Quick preset amount increments */}
          <div>
            <p className="mb-2 text-xs font-bold text-slate-600 uppercase tracking-wider">
              Quick Price Buttons
            </p>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handleQuickAddAmount(amt)}
                  className="rounded-xl border border-slate-200 bg-white py-2.5 text-center text-xs font-bold text-slate-800 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300 active:scale-95"
                >
                  +{amt}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Tap to add directly to unit price
            </p>
          </div>

          {/* On-screen Numeric Keypad */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Touch Numeric Keypad
              </p>
              <span className="text-[11px] font-semibold text-slate-500">
                Editing: {activeField === "price" ? "Unit Price" : "Discount"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {["7", "8", "9", "DEL"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeypadPress(k)}
                  className={`rounded-xl py-2.5 text-sm font-bold shadow-sm transition active:scale-95 ${
                    k === "DEL"
                      ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                      : "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {k === "DEL" ? "⌫" : k}
                </button>
              ))}
              {["4", "5", "6", "C"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeypadPress(k)}
                  className={`rounded-xl py-2.5 text-sm font-bold shadow-sm transition active:scale-95 ${
                    k === "C"
                      ? "bg-red-100 text-red-900 hover:bg-red-200"
                      : "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {k}
                </button>
              ))}
              {["1", "2", "3", "00"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeypadPress(k)}
                  className="rounded-xl bg-white py-2.5 text-sm font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
                >
                  {k}
                </button>
              ))}
              {["0", ".", "±", "✓"].map((k) => {
                if (k === "±") {
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() =>
                        setActiveField((f) => (f === "price" ? "discount" : "price"))
                      }
                      title="Switch Price / Discount"
                      className="rounded-xl bg-slate-200 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-300 active:scale-95"
                    >
                      Tab ⇋
                    </button>
                  );
                }
                if (k === "✓") {
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => handleAdd(false)}
                      className="rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95"
                    >
                      Done
                    </button>
                  );
                }
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKeypadPress(k)}
                    className="rounded-xl bg-white py-2.5 text-sm font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live Calculation Summary Banner */}
        <div className="flex flex-col items-center justify-between gap-2 rounded-2xl bg-slate-900 p-4 text-white sm:flex-row">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Line Total Preview
            </span>
            <div className="text-xs text-slate-300">
              {qty} × {formatMoney(price)}
              {discount > 0 ? ` - ${formatMoney(discount)} disc` : ""}
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black text-emerald-400">
              {formatMoney(lineTotal)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary px-5 py-3 text-sm font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleAdd(true)}
            className="rounded-xl bg-slate-800 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700 active:scale-95"
          >
            + Add & Add Another
          </button>
          <button
            type="button"
            onClick={() => handleAdd(false)}
            className="btn btn-primary px-6 py-3 text-sm font-bold shadow-md shadow-emerald-500/20 active:scale-95"
          >
            ✓ Add to Cart & Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
