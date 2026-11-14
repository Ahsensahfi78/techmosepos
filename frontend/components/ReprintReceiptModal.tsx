"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "./ui/Modal";
import ReceiptPaper from "./ReceiptPaper";
import { applyReceiptRotation, fitReceiptPage } from "@/lib/receiptTheme";
import { api } from "@/lib/api";
import type { CartLine } from "./CartPanel";
import type { ReceiptBrand } from "@/lib/types";

interface ReprintReceiptModalProps {
  open: boolean;
  saleId: number;
  onClose: () => void;
}

export default function ReprintReceiptModal({
  open,
  saleId,
  onClose,
}: ReprintReceiptModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    id: number;
    reference: string;
    date: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    cashier_name?: string | null;
    items: Array<{
      product_id?: number | null;
      product_name: string;
      qty: number;
      price: number;
      line_total: number;
      sku?: string | null;
      barcode?: string | null;
    }>;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total: number;
    paid_amount: number;
    due_amount: number;
    change_amount: number;
    payment_method?: string | null;
    loyalty_points_used: number;
    store_name: string;
    store_address: string;
    store_phone: string;
    store_email: string;
    store_logo: string;
    currency: string;
    receipt_footer: string;
    receipt_width_mm: string;
    receipt_rotate_180: string;
  } | null>(null);
  const [brand, setBrand] = useState<ReceiptBrand>({});
  const previewRef = useRef<HTMLDivElement>(null);

  const methodLabel: Record<string, string> = {
    cash: "Cash",
    card: "Card",
    cheque: "Cheque",
    bank: "Bank transfer",
  };

  // Fetch receipt data and print settings whenever the modal opens with a sale id
  useEffect(() => {
    if (!open || !saleId) return;
    setLoading(true);
    setError(null);
    setReceipt(null);
    setBrand({});

    Promise.all([
      api.sales.receipt(saleId),
      api.settings.print(),
    ])
      .then(([data, settings]) => {
        setReceipt(data);
        setBrand({
          store_name: settings.store_name || undefined,
          store_address: settings.store_address || undefined,
          store_phone: settings.store_phone || undefined,
          store_email: settings.store_email || undefined,
          store_logo: settings.store_logo || undefined,
          receipt_footer: settings.receipt_footer || undefined,
          receipt_width_mm: settings.receipt_width_mm || undefined,
          receipt_rotate_180: settings.receipt_rotate_180 || undefined,
          currency: settings.currency || undefined,
        });
      })
      .catch(() => {
        setError("Failed to load receipt data.");
      })
      .finally(() => setLoading(false));
  }, [open, saleId]);

  // Publish rotation while modal is open so print uses saved orientation
  useEffect(() => {
    if (!open) return;
    applyReceiptRotation(brand.receipt_rotate_180);
  }, [open, brand?.receipt_rotate_180]);

  if (!open) return null;

  const now = new Date();
  const change = Math.max(0, (receipt?.paid_amount ?? 0) - (receipt?.total ?? 0));
  const methodName = methodLabel[receipt?.payment_method ?? ""] ?? receipt?.payment_method ?? "";

  const cartLines: CartLine[] = (receipt?.items ?? []).map((it) => ({
    product: {
      id: it.product_id ?? -1,
      name: it.product_name,
      price: it.price,
      stock: 0,
      sku: it.sku ?? undefined,
      barcode: it.barcode ?? undefined,
    },
    qty: it.qty,
    unitPrice: it.price,
    lineDiscount: 0,
  }));

  const totals = {
    subtotal: receipt?.subtotal ?? 0,
    discount: receipt?.discount_amount ?? 0,
    tax: receipt?.tax_amount ?? 0,
    pointsUsed: receipt?.loyalty_points_used ?? 0,
    total: receipt?.total ?? 0,
    paid: receipt?.paid_amount ?? 0,
    due: receipt?.due_amount ?? 0,
    change,
    method: receipt?.payment_method ?? "",
    payments: undefined,
  };

  const meta = {
    saleId: receipt?.reference ?? `#${receipt?.id}`,
    date: now,
    cashier: receipt?.cashier_name ?? null,
    customer: receipt?.customer_name ?? null,
    offline: false,
  };

  function handlePrint() {
    if (!receipt) return;
    document.getElementById("barcode-dynamic-page")?.remove();
    applyReceiptRotation(brand.receipt_rotate_180);
    fitReceiptPage(previewRef.current, brand.receipt_width_mm);
    window.print();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Receipt ${receipt?.reference ?? ""}`}
        maxWidth="max-w-md"
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            {loading ? (
              <button className="btn btn-secondary" disabled>
                Loading…
              </button>
            ) : (
              <button
                onClick={handlePrint}
                disabled={!receipt || error != null}
                className={`btn btn-primary ${!receipt || error ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                🖨 Print receipt
              </button>
            )}
            <button
              onClick={onClose}
              className="btn bg-slate-900 text-white hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        }
      >
        {loading && !receipt ? (
          <div className="grid place-items-center py-20 text-sm text-slate-400">
            Loading receipt…
          </div>
        ) : error && !receipt ? (
          <div className="grid place-items-center py-20 text-sm text-rose-600">
            {error}
          </div>
        ) : receipt ? (
          <>
            <div className="text-center">
              <span
                className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600 text-2xl"
              >
                ✓
              </span>
              <p className="mt-3 text-lg font-bold">Receipt ready</p>
              <p className="text-xs text-slate-400">Receipt #{receipt.reference}</p>
            </div>
            <div className="mt-4">
              <div className="receipt-preview" ref={previewRef}>
                <ReceiptPaper
                  brand={brand}
                  meta={meta}
                  lines={cartLines}
                  totals={totals}
                />
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      {open && receipt && typeof document !== "undefined" && (
        createPortal(
          <div id="print-receipt" aria-hidden="true">
            <ReceiptPaper
              brand={brand}
              meta={meta}
              lines={cartLines}
              totals={totals}
            />
          </div>,
          document.body
        )
      )}
    </>
  );
}
