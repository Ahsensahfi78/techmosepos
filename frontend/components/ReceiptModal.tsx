"use client";

import { createPortal } from "react-dom";
import { formatMoney } from "@/lib/constants";
import Modal from "./ui/Modal";
import { lineUnitPrice, lineTotal, type CartLine } from "./CartPanel";
import type { SplitLine } from "./CheckoutModal";

interface ReceiptModalProps {
  open: boolean;
  saleId: string | number;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  tax: number;
  pointsUsed: number;
  total: number;
  paid: number;
  due: number;
  change: number;
  method: string;
  payments?: SplitLine[];
  offline?: boolean;
  customer: string | null;
  cashier?: string | null;
  /** Custom footer text from store settings (line breaks preserved). */
  receiptFooter?: string;
  onClose: () => void;
}

const DEFAULT_RECEIPT_FOOTER =
  "Thank you for your purchase!\nReturn policy: Items eligible for return within 3 days with receipt.";

const methodLabel: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  bank: "Bank transfer",
};

export default function ReceiptModal({
  open,
  saleId,
  lines,
  subtotal,
  discount,
  tax,
  pointsUsed,
  total,
  paid,
  due,
  change,
  method,
  payments,
  offline,
  customer,
  cashier,
  receiptFooter,
  onClose,
}: ReceiptModalProps) {
  const now = new Date();
  const methodName = methodLabel[method] ?? method;
  const payLines = payments && payments.length > 0 ? payments : null;
  const footerText =
    receiptFooter && receiptFooter.trim() ? receiptFooter : DEFAULT_RECEIPT_FOOTER;
  const footerLines = footerText.split("\n");

  const receiptBody = (
    <div className="receipt">
      <div className="r-head">
        <p className="r-title">TechMOS</p>
        <p className="r-sub">Mobile Shop POS System</p>
      </div>
      <div className="r-divider" />
      <p className="r-line">
        <span>Receipt</span>
        <span>#{saleId}</span>
      </p>
      <p className="r-line">
        <span>Date</span>
        <span>
          {now.toLocaleDateString()} {now.toLocaleTimeString()}
        </span>
      </p>
      {cashier && (
        <p className="r-line">
          <span>Cashier</span>
          <span>{cashier}</span>
        </p>
      )}
      {customer && (
        <p className="r-line">
          <span>Customer</span>
          <span>{customer}</span>
        </p>
      )}
      <div className="r-divider" />
      <div className="r-col r-th">
        <span className="r-name">ITEM</span>
        <span className="r-qty">QTY</span>
        <span className="r-amt">TOTAL</span>
      </div>
      {lines.map((l) => {
        const unit = lineUnitPrice(l);
        const disc = l.lineDiscount ?? 0;
        const codeParts: string[] = [];
        if (l.product.sku) codeParts.push(l.product.sku);
        if (l.product.barcode) codeParts.push(l.product.barcode);
        const code = codeParts.join(" · ");
        return (
          <div key={l.product.id} className="r-item">
            <div className="r-col">
              <span className="r-name">
                <span className="n">{l.product.name}</span>
                {code && <span className="r-code">{code}</span>}
              </span>
              <span className="r-qty">{l.qty}</span>
              <span className="r-amt">{formatMoney(lineTotal(l))}</span>
            </div>
            <p className="r-unit">
              @ {formatMoney(unit)} each
              {disc > 0 ? ` · −${formatMoney(disc)}` : ""}
            </p>
          </div>
        );
      })}
      <div className="r-divider" />
      <p className="r-row">
        <span>Subtotal</span>
        <span>{formatMoney(subtotal)}</span>
      </p>
      {discount > 0 && (
        <p className="r-row">
          <span>Discount</span>
          <span>-{formatMoney(discount)}</span>
        </p>
      )}
      {tax > 0 && (
        <p className="r-row">
          <span>Tax</span>
          <span>+{formatMoney(tax)}</span>
        </p>
      )}
      {pointsUsed > 0 && (
        <p className="r-row">
          <span>Loyalty</span>
          <span>-{formatMoney(pointsUsed)}</span>
        </p>
      )}
      <p className="r-row r-total">
        <span>TOTAL</span>
        <span>{formatMoney(total)}</span>
      </p>
      {payLines ? (
        <>
          <p className="r-row">
            <span>Paid (split)</span>
            <span>{formatMoney(paid)}</span>
          </p>
          {payLines.map((p, i) => (
            <p key={i} className="r-row r-subrow">
              <span>· {methodLabel[p.method] ?? p.method}</span>
              <span>{formatMoney(p.amount)}</span>
            </p>
          ))}
        </>
      ) : (
        <p className="r-row">
          <span>Paid ({methodName})</span>
          <span>{formatMoney(paid)}</span>
        </p>
      )}
      {due > 0 ? (
        <p className="r-row r-due">
          <span>Due</span>
          <span>{formatMoney(due)}</span>
        </p>
      ) : (
        <p className="r-row">
          <span>Change</span>
          <span>{formatMoney(change)}</span>
        </p>
      )}
      <div className="r-divider" />
      <div className="r-foot">
        {footerLines.map((line, i) => (
          <p key={i}>{line || "\u00A0"}</p>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Receipt"
        maxWidth="max-w-md"
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <button
              onClick={() => window.print()}
              className="btn btn-primary"
            >
              🖨 Print receipt
            </button>
            <button
              onClick={onClose}
              className="btn bg-slate-900 text-white hover:bg-slate-700"
            >
              New sale
            </button>
          </div>
        }
      >
        <div className="text-center">
          <span
            className={`mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl ${
              offline
                ? "bg-amber-100 text-amber-600"
                : "bg-emerald-100 text-emerald-600"
            }`}
          >
            {offline ? "⏳" : "✓"}
          </span>
          <p className="mt-3 text-lg font-bold">
            {offline ? "Sale saved offline" : "Payment successful"}
          </p>
          <p className="text-xs text-slate-400">Receipt #{saleId}</p>
          {offline && (
            <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              You're offline — this sale is queued and will sync automatically
              when the connection returns.
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="receipt-preview">{receiptBody}</div>
        </div>
      </Modal>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div id="print-receipt" aria-hidden="true">
            {receiptBody}
          </div>,
          document.body
        )}
    </>
  );
}
