import { useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/constants";
import { checkStock } from "@/lib/stockValidation";

export interface CartLine {
  product: {
    id: number;
    name: string;
    price: number;
    stock: number;
    track_imei?: boolean;
    sku?: string | null;
    barcode?: string | null;
    category?: string;
  };
  qty: number;
  /** Optional per-unit price override (Rs). */
  unitPrice?: number;
  /** Optional line-level discount (Rs). */
  lineDiscount?: number;
}

export function lineUnitPrice(l: CartLine): number {
  return l.unitPrice ?? l.product.price;
}

export function lineSubtotal(l: CartLine): number {
  return lineUnitPrice(l) * l.qty;
}

export function lineTotal(l: CartLine): number {
  return Math.max(0, lineSubtotal(l) - (l.lineDiscount ?? 0));
}

interface CartPanelProps {
  lines: CartLine[];
  total: number;
  itemCount: number;
  connected: boolean;
  busy: boolean;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onSetQty?: (id: number, qty: number) => void;
  onQuickAdd?: (id: number, n: number) => void;
  onLineChange?: (
    id: number,
    patch: { unitPrice?: number; lineDiscount?: number }
  ) => void;
  onClear: () => void;
  onCheckout: () => void;
  onQuickCash?: () => void;
  quickCashEnabled?: boolean;
  onHold?: () => void;
  parkedCount?: number;
  onParked?: () => void;
  /** Live stock per product id — used to validate quantities in real time. */
  stockById?: Record<number, number>;
  /** Optional fixed summary (subtotal / discounts / tax) shown above the total. */
  summary?: ReactNode;
  /** Set a line's quantity to the currently available stock. */
  onSetToAvailable?: (id: number) => void;
  /** Remove a line from the cart entirely. */
  onRemoveLine?: (id: number) => void;
}

const QUICK_ADDS = [1, 5, 10, 20];

export default function CartPanel({
  lines,
  total,
  itemCount,
  connected,
  busy,
  onAdd,
  onRemove,
  onSetQty,
  onQuickAdd,
  onLineChange,
  onClear,
  onCheckout,
  onQuickCash,
  quickCashEnabled = false,
  onHold,
  parkedCount = 0,
  onParked,
  stockById,
  onSetToAvailable,
  onRemoveLine,
  summary,
}: CartPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-base font-bold">Current order</h2>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-emerald-500" : "animate-pulse bg-red-400"
              }`}
            />
            {connected ? "live" : "offline"}
          </span>
          {lines.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs font-semibold text-red-500 hover:text-red-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {itemCount > 0 && (
        <p className="mt-2 shrink-0 text-xs font-medium text-slate-400">
          {itemCount} item{itemCount > 1 ? "s" : ""}
        </p>
      )}

      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-gutter:stable]">
        {lines.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="text-3xl">🛒</span>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Cart is empty
            </p>
            <p className="text-xs text-slate-400">
              Tap a product to add it
            </p>
          </div>
        )}
        {lines.map((l) => {
          const unit = lineUnitPrice(l);
          const overridden = l.unitPrice !== undefined && l.unitPrice !== l.product.price;
          const lineDisc = l.lineDiscount ?? 0;
          const avail = stockById?.[l.product.id] ?? l.product.stock;
          const check = checkStock(avail, l.qty);
          const over = !check.ok;
          const isCollapsed = collapsed[l.product.id];
          return (
            <div
              key={l.product.id}
              className={`rounded-xl bg-slate-50 px-3 py-2.5 ${
                over
                  ? check.out
                    ? "ring-1 ring-red-300"
                    : "ring-1 ring-amber-300"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {l.product.name}
                  </p>
                  {(l.product.sku || l.product.barcode) && (
                    <p className="truncate font-mono text-[10px] text-slate-400">
                      {l.product.sku ?? ""}
                      {l.product.sku && l.product.barcode ? " · " : ""}
                      {l.product.barcode ?? ""}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    {formatMoney(unit)}
                    {overridden && (
                      <span className="ml-1 text-[10px] text-amber-600">
                        (was {formatMoney(l.product.price)})
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onRemove(l.product.id)}
                    aria-label="Decrease quantity"
                    className="grid h-8 w-8 place-items-center rounded-lg bg-white text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 active:scale-90"
                  >
                    −
                  </button>
                  {onSetQty ? (
                    <input
                      value={l.qty}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) onSetQty(l.product.id, v);
                      }}
                      onBlur={(e) => {
                        if (e.target.value === "" || parseInt(e.target.value, 10) <= 0) {
                          onSetQty(l.product.id, 1);
                        }
                      }}
                      inputMode="numeric"
                      aria-label="Quantity"
                      className="h-8 w-12 rounded-lg border-0 bg-white text-center text-sm font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  ) : (
                    <span className="w-4 text-center text-sm font-bold">
                      {l.qty}
                    </span>
                  )}
                  <button
                    onClick={() => onAdd(l.product.id)}
                    disabled={l.qty >= avail}
                    aria-label="Increase quantity"
                    className="grid h-8 w-8 place-items-center rounded-lg bg-white text-sm font-bold text-emerald-600 shadow-sm ring-1 ring-slate-200 active:scale-90 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              {over && (
                <div
                  className={`mt-2 rounded-lg border px-2.5 py-2 text-xs ${
                    check.out
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {isCollapsed ? (
                    <button
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [l.product.id]: false }))
                      }
                      className="flex w-full items-center gap-1.5 font-bold"
                    >
                      ⚠ {check.out
                        ? "Out of stock"
                        : `Over stock — ${check.requested} requested · ${check.available} available`}
                      <span className="ml-auto text-[10px] font-semibold opacity-70">
                        tap to fix
                      </span>
                    </button>
                  ) : (
                    <>
                      <p className="font-semibold">
                        {check.out
                          ? `“${l.product.name}” is out of stock.`
                          : `Only ${check.available} of “${l.product.name}” are available. You requested ${check.requested}.`}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {!check.out && onSetToAvailable && (
                          <button
                            onClick={() => onSetToAvailable(l.product.id)}
                            disabled={l.qty === check.available}
                            className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                          >
                            Set to {check.available}
                          </button>
                        )}
                        {onRemoveLine && (
                          <button
                            onClick={() => onRemoveLine(l.product.id)}
                            className="rounded-md bg-white px-2 py-1 text-[11px] font-bold text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 active:scale-95"
                          >
                            Remove
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setCollapsed((prev) => ({ ...prev, [l.product.id]: true }))
                          }
                          className="ml-auto rounded-md px-2 py-1 text-[11px] font-bold opacity-70 transition hover:opacity-100"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] font-medium opacity-70">
                        Edit the quantity above to fix this before checkout.
                      </p>
                    </>
                  )}
                </div>
              )}

              {onQuickAdd && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Add
                  </span>
                  {QUICK_ADDS.map((n) => (
                    <button
                      key={n}
                      onClick={() => onQuickAdd(l.product.id, n)}
                      disabled={l.qty + n > avail}
                      className="rounded-md bg-white px-2 py-1 text-[11px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 disabled:opacity-40"
                    >
                      +{n}
                    </button>
                  ))}
                </div>
              )}

              {onLineChange && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                    Price
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={l.unitPrice ?? ""}
                      onChange={(e) =>
                        onLineChange(l.product.id, {
                          unitPrice: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      onBlur={(e) => {
                        if (e.target.value === "" || Number(e.target.value) <= 0) {
                          onLineChange(l.product.id, { unitPrice: undefined });
                        }
                      }}
                      placeholder={String(l.product.price)}
                      className="h-7 w-20 rounded-lg border-0 bg-white px-1.5 text-right text-[11px] font-semibold shadow-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                    Disc
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={l.lineDiscount ?? ""}
                      onChange={(e) =>
                        onLineChange(l.product.id, {
                          lineDiscount:
                            e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      onBlur={(e) => {
                        if (e.target.value === "" || Number(e.target.value) <= 0) {
                          onLineChange(l.product.id, { lineDiscount: undefined });
                        }
                      }}
                      placeholder="0"
                      className="h-7 w-16 rounded-lg border-0 bg-white px-1.5 text-right text-[11px] font-semibold shadow-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </label>
                  {lineDisc > 0 && (
                    <span className="ml-auto text-[11px] font-bold text-emerald-600">
                      −{formatMoney(lineDisc)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 shrink-0 border-t border-slate-100 pt-3">
        {summary && <div className="mb-3">{summary}</div>}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">Total</span>
          <span className="text-xl font-bold text-emerald-600">
            {formatMoney(total)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {onHold && (
            <button
              onClick={onHold}
              disabled={lines.length === 0 || busy}
              className="btn btn-secondary"
              title="Save this order and start a new sale. Resume it later from the Parked list."
            >
              ⏸ Hold
            </button>
          )}
          {onParked && (
            <button
              onClick={onParked}
              className="btn btn-secondary"
              title="Resume a parked order"
            >
              🗂 Parked{parkedCount > 0 ? ` (${parkedCount})` : ""}
            </button>
          )}
        </div>
        {onQuickCash && (
          <button
            onClick={onQuickCash}
            disabled={!quickCashEnabled || busy}
            className="btn btn-secondary mt-2 w-full"
            title="Charge the exact total in cash and finish immediately"
          >
            ⚡ Quick Cash
          </button>
        )}
        <button
          onClick={onCheckout}
          disabled={lines.length === 0 || busy}
          className="btn btn-primary mt-2 w-full"
        >
          {busy ? "Processing…" : "Charge & Checkout"}
        </button>
      </div>
    </div>
  );
}
