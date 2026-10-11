"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Modal from "./ui/Modal";
import type { CartLine } from "./CartPanel";
import type { SplitLine } from "./CheckoutModal";
import ReceiptPaper from "./ReceiptPaper";
import { applyReceiptRotation, fitReceiptPage } from "@/lib/receiptTheme";
import type { ReceiptBrand } from "@/lib/types";

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
  /** Shop name, address, phone, email, logo, footer and roll width from settings. */
  brand?: ReceiptBrand;
  onClose: () => void;
}

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
  brand,
  onClose,
}: ReceiptModalProps) {
  const receiptBody = (
    <ReceiptPaper
      brand={brand ?? {}}
      meta={{ saleId, date: new Date(), cashier, customer, offline }}
      lines={lines}
      totals={{
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
      }}
    />
  );

  const previewRef = useRef<HTMLDivElement>(null);

  // Publish the 180° correction while the modal is open so a print from here
  // uses the saved orientation. The rule only applies inside @media print, so
  // the preview above stays upright either way.
  useEffect(() => {
    if (!open) return;
    applyReceiptRotation(brand?.receipt_rotate_180);
  }, [open, brand?.receipt_rotate_180]);

  function handlePrint() {
    document.getElementById("barcode-dynamic-page")?.remove();
    // Chrome cannot express `size: <width> auto`, so the page box has to be
    // measured from the preview that is actually on screen. Without this the
    // receipt falls back to the paper size the browser last used.
    applyReceiptRotation(brand?.receipt_rotate_180);
    fitReceiptPage(previewRef.current, brand?.receipt_width_mm);
    window.print();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Receipt"
        maxWidth="max-w-md"
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <button onClick={handlePrint} className="btn btn-primary">
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
          <div className="receipt-preview" ref={previewRef}>
            {receiptBody}
          </div>
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
