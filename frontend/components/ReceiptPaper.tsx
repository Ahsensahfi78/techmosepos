"use client";

import { formatMoney } from "@/lib/constants";
import type { ReceiptBrand } from "@/lib/types";
import { lineTotal, lineUnitPrice, type CartLine } from "./CartPanel";
import type { SplitLine } from "./CheckoutModal";

const methodLabel: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  bank: "Bank transfer",
};

export interface ReceiptMeta {
  saleId?: string | number;
  date?: Date;
  cashier?: string | null;
  customer?: string | null;
  offline?: boolean;
}

export interface ReceiptTotals {
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
}

export interface ReceiptPaperProps {
  brand: ReceiptBrand;
  meta: ReceiptMeta;
  lines: CartLine[];
  totals: ReceiptTotals;
}

function text(value?: string): string {
  return (value ?? "").trim();
}

function lines(value?: string): string[] {
  return text(value)
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The printed paper itself. Shared by the POS receipt modal and the live
 * preview in Settings so what you configure is exactly what you print.
 *
 * Empty brand fields render nothing — no placeholder, no blank gap.
 */
export default function ReceiptPaper({
  brand,
  meta,
  lines: cartLines,
  totals,
}: ReceiptPaperProps) {
  const now = meta.date ?? new Date();
  const methodName = methodLabel[totals.method] ?? totals.method;
  const payLines =
    totals.payments && totals.payments.length > 0 ? totals.payments : null;

  const shopName = text(brand.store_name);
  const addressLines = lines(brand.store_address);
  const phone = text(brand.store_phone);
  const email = text(brand.store_email);
  const logo = text(brand.store_logo);
  const footerLines = lines(brand.receipt_footer);

  const hasHeader = Boolean(
    logo || shopName || addressLines.length || phone || email
  );

  return (
    <div className="receipt">
      {hasHeader && (
        <>
          <div className="r-head">
            {logo && <img className="r-logo" src={logo} alt="" />}
            {shopName && <p className="r-title">{shopName}</p>}
            {addressLines.map((line, i) => (
              <p className="r-sub" key={`addr-${i}`}>
                {line}
              </p>
            ))}
            {phone && <p className="r-sub">{phone}</p>}
            {email && <p className="r-sub">{email}</p>}
          </div>
          <div className="r-divider" />
        </>
      )}
      <p className="r-line">
        <span>Receipt</span>
        <span>{meta.saleId != null ? `#${meta.saleId}` : ""}</span>
      </p>
      <p className="r-line">
        <span>Date</span>
        <span>
          {now.toLocaleDateString()} {now.toLocaleTimeString()}
        </span>
      </p>
      {meta.cashier && (
        <p className="r-line">
          <span>Cashier</span>
          <span>{meta.cashier}</span>
        </p>
      )}
      {meta.customer && (
        <p className="r-line">
          <span>Customer</span>
          <span>{meta.customer}</span>
        </p>
      )}
      <div className="r-divider" />
      <div className="r-col r-th">
        <span className="r-name">ITEM</span>
        <span className="r-qty">QTY</span>
        <span className="r-amt">TOTAL</span>
      </div>
      {cartLines.map((l) => {
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
      <div className="r-totals">
        <p className="r-row">
          <span>Subtotal</span>
          <span>{formatMoney(totals.subtotal)}</span>
        </p>
        {totals.discount > 0 && (
          <p className="r-row">
            <span>Discount</span>
            <span>-{formatMoney(totals.discount)}</span>
          </p>
        )}
        {totals.tax > 0 && (
          <p className="r-row">
            <span>Tax</span>
            <span>+{formatMoney(totals.tax)}</span>
          </p>
        )}
        {totals.pointsUsed > 0 && (
          <p className="r-row">
            <span>Loyalty</span>
            <span>-{formatMoney(totals.pointsUsed)}</span>
          </p>
        )}
        <p className="r-row r-total">
          <span>TOTAL</span>
          <span>{formatMoney(totals.total)}</span>
        </p>
        {payLines ? (
          <>
            <p className="r-row">
              <span>Paid (split)</span>
              <span>{formatMoney(totals.paid)}</span>
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
            <span>{formatMoney(totals.paid)}</span>
          </p>
        )}
        {totals.due > 0 ? (
          <p className="r-row r-due">
            <span>Due</span>
            <span>{formatMoney(totals.due)}</span>
          </p>
        ) : (
          <p className="r-row">
            <span>Change</span>
            <span>{formatMoney(totals.change)}</span>
          </p>
        )}
      </div>
      {footerLines.length > 0 && (
        <>
          <div className="r-divider" />
          <div className="r-foot">
            {footerLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
