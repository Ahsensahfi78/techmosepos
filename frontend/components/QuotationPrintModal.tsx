"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./ui/Modal";
import { formatMoney } from "@/lib/constants";
import { api } from "@/lib/api";
import type { PrintSettings, Quotation } from "@/lib/types";

interface QuotationPrintModalProps {
  open: boolean;
  quotation: Quotation | null;
  onClose: () => void;
}

export default function QuotationPrintModal({
  open,
  quotation,
  onClose,
}: QuotationPrintModalProps) {
  const [printSize, setPrintSize] = useState<"a4" | "80mm">("a4");
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      api.settings
        .print()
        .then(setSettings)
        .catch(() => {});
    }
  }, [open]);

  if (!open || !quotation) return null;

  const storeName = settings?.store_name || "TechMOS Store & Services";
  const storeAddress = settings?.store_address || "123 Main Street, Tech City";
  const storePhone = settings?.store_phone || "+94 11 234 5678";
  const storeEmail = settings?.store_email || "info@techmos.com";

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!quotation) return;
    setIsExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: printSize === "80mm" ? [80, 200] : "a4",
      });

      if (printSize === "a4") {
        doc.setFontSize(18);
        doc.text(storeName, 14, 18);
        doc.setFontSize(9);
        doc.text(`${storeAddress} | Tel: ${storePhone} | Email: ${storeEmail}`, 14, 24);

        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text("QUOTATION", 140, 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(`Quote No: ${quotation.quotation_number}`, 140, 24);
        doc.text(`Date: ${new Date(quotation.created_at).toLocaleDateString()}`, 140, 29);
        if (quotation.valid_until) {
          doc.text(`Valid Until: ${new Date(quotation.valid_until).toLocaleDateString()}`, 140, 34);
        }

        doc.line(14, 38, 196, 38);

        // Customer details
        doc.setFont("helvetica", "bold");
        doc.text("CUSTOMER DETAILS", 14, 44);
        doc.setFont("helvetica", "normal");
        doc.text(`Name: ${quotation.customer_name || "Walk-in Customer"}`, 14, 49);
        doc.text(`Type: ${quotation.customer_type || "Retail"}`, 14, 54);
        if (quotation.customer_phone) doc.text(`Phone: ${quotation.customer_phone}`, 14, 59);
        if (quotation.customer_address) doc.text(`Address: ${quotation.customer_address}`, 14, 64);

        // Table Header
        let y = 72;
        doc.setFillColor(245, 245, 245);
        doc.rect(14, y, 182, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.text("#", 16, y + 5);
        doc.text("Item / Description", 24, y + 5);
        doc.text("Type", 95, y + 5);
        doc.text("Qty", 115, y + 5);
        doc.text("Price", 135, y + 5);
        doc.text("Disc", 155, y + 5);
        doc.text("Total", 175, y + 5);

        // Table Rows
        doc.setFont("helvetica", "normal");
        y += 8;
        quotation.items.forEach((item, index) => {
          doc.text(String(index + 1), 16, y + 4);
          doc.text(item.product_name.slice(0, 32), 24, y + 4);
          doc.text(item.product_type || "Goods", 95, y + 4);
          doc.text(`${item.qty} ${item.unit || "pcs"}`, 115, y + 4);
          doc.text(formatMoney(item.price), 135, y + 4);
          doc.text(formatMoney(item.discount || 0), 155, y + 4);
          doc.text(formatMoney(item.line_total), 175, y + 4);
          y += 6;
        });

        // Totals
        y += 4;
        doc.line(14, y, 196, y);
        y += 6;
        doc.text(`Subtotal: ${formatMoney(quotation.subtotal)}`, 140, y);
        y += 5;
        doc.text(`Discount: -${formatMoney(quotation.discount_amount)}`, 140, y);
        y += 5;
        doc.text(`Tax: +${formatMoney(quotation.tax_amount)}`, 140, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(`Grand Total: ${formatMoney(quotation.total)}`, 140, y);

        // Notes and terms
        y += 10;
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        if (quotation.notes) {
          doc.text(`Notes: ${quotation.notes}`, 14, y);
          y += 5;
        }
        if (quotation.terms) {
          doc.text(`Terms: ${quotation.terms}`, 14, y);
          y += 8;
        }

        // Signatures
        y = Math.max(y + 15, 250);
        doc.line(20, y, 70, y);
        doc.text("Customer Acceptance", 25, y + 4);

        doc.line(135, y, 185, y);
        doc.text("Authorized Signature", 140, y + 4);
      } else {
        // 80mm format
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(storeName, 40, 10, { align: "center" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(`${storePhone} | ${storeEmail}`, 40, 15, { align: "center" });
        doc.text("------------------------------------------------", 40, 19, { align: "center" });

        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`QUOTATION: ${quotation.quotation_number}`, 40, 24, { align: "center" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(`Date: ${new Date(quotation.created_at).toLocaleDateString()}`, 6, 30);
        doc.text(`Customer: ${quotation.customer_name || "Walk-in"} (${quotation.customer_type || "Retail"})`, 6, 34);
        doc.text("------------------------------------------------", 40, 38, { align: "center" });

        let y = 43;
        quotation.items.forEach((item) => {
          doc.text(item.product_name.slice(0, 25), 6, y);
          y += 4;
          doc.text(`${item.qty} x ${formatMoney(item.price)} = ${formatMoney(item.line_total)}`, 6, y);
          y += 5;
        });

        doc.text("------------------------------------------------", 40, y, { align: "center" });
        y += 4;
        doc.setFont("helvetica", "bold");
        doc.text(`TOTAL: ${formatMoney(quotation.total)}`, 74, y, { align: "right" });
      }

      doc.save(`Quotation-${quotation.quotation_number}.pdf`);
    } catch {
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  }

  return (
    <>
      {/* Print stylesheet for clean output */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #quotation-print-content,
          #quotation-print-content * {
            visibility: visible;
          }
          #quotation-print-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: ${printSize === "a4" ? "20mm" : "5mm"};
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: ${printSize === "80mm" ? "80mm auto" : "A4 portrait"};
            margin: 0;
          }
        }
      `}</style>

      <Modal open={open} onClose={onClose} title="Quotation Print & Export Preview" maxWidth="max-w-4xl">
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
            {/* Size Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Print Layout:</span>
              <div className="flex rounded-lg bg-slate-200/80 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPrintSize("a4")}
                  className={`rounded-md px-3 py-1 transition ${
                    printSize === "a4"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📄 A4 Document
                </button>
                <button
                  type="button"
                  onClick={() => setPrintSize("80mm")}
                  className={`rounded-md px-3 py-1 transition ${
                    printSize === "80mm"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  🧾 80mm Thermal
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isExportingPdf}
                onClick={handleDownloadPdf}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition"
              >
                <span>📥</span>
                <span>{isExportingPdf ? "Exporting..." : "Download PDF"}</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="btn btn-primary btn-sm"
              >
                <span>🖨️</span>
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Printable Preview Container */}
          <div className="max-h-[68vh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-4 flex justify-center">
            <div
              id="quotation-print-content"
              ref={printAreaRef}
              className={`bg-white shadow-lg text-slate-900 ${
                printSize === "80mm"
                  ? "w-[300px] p-4 font-mono text-xs space-y-3"
                  : "w-full max-w-[210mm] p-8 space-y-6 text-sm"
              }`}
            >
              {printSize === "a4" ? (
                /* A4 Standard Layout */
                <>
                  {/* Header */}
                  <div className="flex justify-between items-start border-b border-slate-200 pb-5">
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tight">{storeName}</h1>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm">{storeAddress}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        📞 {storePhone} • ✉️ {storeEmail}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-block rounded-md bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-700 uppercase tracking-wider">
                        Quotation
                      </span>
                      <div className="mt-2 font-mono font-bold text-lg text-slate-900">
                        {quotation.quotation_number}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Date: {new Date(quotation.created_at).toLocaleDateString()}
                      </div>
                      {quotation.valid_until && (
                        <div className="text-xs text-slate-500">
                          Valid Until: {new Date(quotation.valid_until).toLocaleDateString()}
                        </div>
                      )}
                      <div className="mt-1">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 uppercase">
                          Status: {quotation.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Customer Information */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Quotation For
                    </div>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-base text-slate-900">
                          {quotation.customer_name || "Walk-in Customer"}
                        </div>
                        {quotation.customer_phone && (
                          <div className="text-xs text-slate-600 mt-0.5">📞 {quotation.customer_phone}</div>
                        )}
                        {quotation.customer_address && (
                          <div className="text-xs text-slate-600 mt-0.5">📍 {quotation.customer_address}</div>
                        )}
                      </div>
                      <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                        Type: {quotation.customer_type || "Retail"}
                      </span>
                    </div>
                  </div>

                  {/* Items Table */}
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                          <th className="py-2.5 px-3 w-10 text-center">#</th>
                          <th className="py-2.5 px-3">Item / Description</th>
                          <th className="py-2.5 px-3 w-24">Type</th>
                          <th className="py-2.5 px-3 w-16 text-right">Qty</th>
                          <th className="py-2.5 px-3 w-24 text-right">Unit Price</th>
                          <th className="py-2.5 px-3 w-20 text-right">Discount</th>
                          <th className="py-2.5 px-3 w-28 text-right font-bold">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {quotation.items.map((item, index) => (
                          <tr key={item.id || index}>
                            <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                              {index + 1}
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-semibold text-slate-900">{item.product_name}</div>
                              {item.description && (
                                <div className="text-[11px] text-slate-500 mt-0.5">{item.description}</div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{item.product_type || "Goods"}</td>
                            <td className="py-2 px-3 text-right text-slate-800">
                              {item.qty} {item.unit || "pcs"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{formatMoney(item.price)}</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-500">
                              {item.discount ? formatMoney(item.discount) : "-"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                              {formatMoney(item.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Financial Totals */}
                  <div className="flex justify-end">
                    <div className="w-72 space-y-1.5 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Subtotal:</span>
                        <span className="font-mono">{formatMoney(quotation.subtotal)}</span>
                      </div>
                      {quotation.discount_amount > 0 && (
                        <div className="flex justify-between text-emerald-600">
                          <span>Total Discount:</span>
                          <span className="font-mono">-{formatMoney(quotation.discount_amount)}</span>
                        </div>
                      )}
                      {quotation.tax_amount > 0 && (
                        <div className="flex justify-between text-slate-600">
                          <span>Tax ({quotation.tax_rate || 0}%):</span>
                          <span className="font-mono">+{formatMoney(quotation.tax_amount)}</span>
                        </div>
                      )}
                      <div className="border-t border-slate-300 pt-2 flex justify-between font-bold text-sm text-slate-900">
                        <span>Grand Total:</span>
                        <span className="font-mono text-base text-primary-700">
                          {formatMoney(quotation.total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes & Terms */}
                  {(quotation.notes || quotation.terms) && (
                    <div className="border-t border-slate-200 pt-4 grid grid-cols-2 gap-4 text-xs">
                      {quotation.notes && (
                        <div>
                          <div className="font-bold text-slate-700 mb-1">Notes:</div>
                          <p className="text-slate-600 whitespace-pre-wrap">{quotation.notes}</p>
                        </div>
                      )}
                      {quotation.terms && (
                        <div>
                          <div className="font-bold text-slate-700 mb-1">Terms & Conditions:</div>
                          <p className="text-slate-600 whitespace-pre-wrap">{quotation.terms}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Signatures */}
                  <div className="border-t border-slate-200 pt-12 grid grid-cols-2 gap-8 text-center text-xs">
                    <div>
                      <div className="w-48 mx-auto border-t border-slate-400 pt-1 font-medium text-slate-600">
                        Customer Acceptance
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">Signature & Date</p>
                    </div>
                    <div>
                      <div className="w-48 mx-auto border-t border-slate-400 pt-1 font-medium text-slate-600">
                        Authorized Signature
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">For {storeName}</p>
                    </div>
                  </div>
                </>
              ) : (
                /* 80mm Thermal Receipt Layout */
                <>
                  <div className="text-center space-y-1">
                    <h2 className="font-bold text-sm uppercase">{storeName}</h2>
                    <p className="text-[10px] text-slate-500">{storePhone}</p>
                    <div className="border-b border-dashed border-slate-300 my-2" />
                    <div className="font-bold text-xs">QUOTATION</div>
                    <div className="text-[10px] text-slate-600">#{quotation.quotation_number}</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(quotation.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="border-b border-dashed border-slate-300 my-2" />

                  <div className="text-[11px] space-y-0.5">
                    <div>Customer: {quotation.customer_name || "Walk-in"}</div>
                    {quotation.customer_phone && <div>Tel: {quotation.customer_phone}</div>}
                    <div>Type: {quotation.customer_type || "Retail"}</div>
                  </div>

                  <div className="border-b border-dashed border-slate-300 my-2" />

                  <div className="space-y-2 text-[11px]">
                    {quotation.items.map((item, i) => (
                      <div key={i} className="flex justify-between">
                        <div>
                          <div className="font-semibold">{item.product_name}</div>
                          <div className="text-[10px] text-slate-500">
                            {item.qty} {item.unit || "pcs"} x {formatMoney(item.price)}
                          </div>
                        </div>
                        <div className="font-bold">{formatMoney(item.line_total)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="border-b border-dashed border-slate-300 my-2" />

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>{formatMoney(quotation.subtotal)}</span>
                    </div>
                    {quotation.discount_amount > 0 && (
                      <div className="flex justify-between">
                        <span>Discount:</span>
                        <span>-{formatMoney(quotation.discount_amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-sm pt-1 border-t border-slate-200">
                      <span>TOTAL:</span>
                      <span>{formatMoney(quotation.total)}</span>
                    </div>
                  </div>

                  {quotation.terms && (
                    <div className="text-[10px] text-slate-500 border-t border-dashed border-slate-300 pt-2">
                      {quotation.terms}
                    </div>
                  )}

                  <div className="text-center text-[10px] text-slate-400 pt-3">
                    Thank you for your business!
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
