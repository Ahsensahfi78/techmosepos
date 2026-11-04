"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "./ui/Modal";
import { formatMoney } from "@/lib/constants";
import { api } from "@/lib/api";
import { measureReceiptHeightMm } from "@/lib/receiptTheme";
import type { PrintSettings, Repair } from "@/lib/types";

interface RepairPrintModalProps {
  open: boolean;
  repair: Repair | null;
  onClose: () => void;
}

export default function RepairPrintModal({
  open,
  repair,
  onClose,
}: RepairPrintModalProps) {
  const [printSize, setPrintSize] = useState<"a4" | "80mm">("a4");
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      api.settings
        .print()
        .then((s) => {
          setSettings(s);
          if (s?.receipt_width_mm === "80" && !printSize) {
            setPrintSize("80mm");
          }
        })
        .catch(() => {});
    }
  }, [open]);

  if (!open || !repair) return null;

  const storeName = settings?.store_name || "TechMOS Repair & Service Centre";
  const storeAddress = settings?.store_address || "123 Main Street, Tech City";
  const storePhone = settings?.store_phone || "0752246378";
  const storeEmail = settings?.store_email || "repairs@techmos.com";

  const totalAmount = repair.total || (Number(repair.service_charge || 0) + Number(repair.parts_cost || 0));
  const advance = Number(repair.deposit || 0) + Number(repair.paid_amount || 0);
  const balance = Math.max(0, totalAmount - advance);

  function handlePrint() {
    document.getElementById("repair-page-style")?.remove();
    document.getElementById("quotation-page-style")?.remove();
    document.getElementById("receipt-page-style")?.remove();

    const style = document.createElement("style");
    style.id = "repair-page-style";

    if (printSize === "80mm") {
      const height = Math.max(81, Math.ceil(measureReceiptHeightMm(printAreaRef.current) + 6));
      style.textContent = `@page { size: 80mm ${height}mm; margin: 0; }`;
      document.documentElement.style.setProperty("--repair-page-width", "80mm");
    } else {
      style.textContent = `@page { size: A4 portrait; margin: 8mm; }`;
      document.documentElement.style.setProperty("--repair-page-width", "210mm");
    }
    document.head.appendChild(style);

    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);

    window.print();
  }

  async function handleDownloadPdf() {
    if (!repair) return;
    setIsExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: printSize === "80mm" ? [80, 220] : "a4",
      });

      if (printSize === "a4") {
        doc.setFontSize(18);
        doc.text(storeName, 14, 18);
        doc.setFontSize(9);
        doc.text(`${storeAddress} | Tel: ${storePhone} | Email: ${storeEmail}`, 14, 24);

        doc.setFontSize(15);
        doc.setFont("helvetica", "bold");
        doc.text("REPAIR JOB SHEET", 135, 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(`Job No: ${repair.repair_number}`, 135, 24);
        doc.text(`Date: ${new Date(repair.created_at).toLocaleDateString()}`, 135, 29);
        doc.text(`Status: ${repair.status.toUpperCase()}`, 135, 34);

        doc.line(14, 38, 196, 38);

        // Customer & Device Box
        doc.setFont("helvetica", "bold");
        doc.text("CUSTOMER INFORMATION", 14, 44);
        doc.setFont("helvetica", "normal");
        doc.text(`Name: ${repair.customer_name || "Walk-in Customer"}`, 14, 49);
        doc.text(`Customer Type: ${repair.customer_type || "Retail"}`, 14, 54);
        if (repair.customer_phone) doc.text(`Phone: ${repair.customer_phone}`, 14, 59);
        if (repair.customer_address) doc.text(`Address: ${repair.customer_address}`, 14, 64);

        doc.setFont("helvetica", "bold");
        doc.text("DEVICE / ITEM DETAILS", 110, 44);
        doc.setFont("helvetica", "normal");
        doc.text(`Device: ${repair.product_name}`, 110, 49);
        doc.text(`IMEI / Serial: ${repair.imei || "N/A"}`, 110, 54);
        doc.text(`Technician: ${repair.technician || "Unassigned"}`, 110, 59);

        // Issue box
        let y = 72;
        doc.setFillColor(248, 248, 250);
        doc.rect(14, y, 182, 14, "F");
        doc.setFont("helvetica", "bold");
        doc.text("Reported Issue / Fault:", 16, y + 5);
        doc.setFont("helvetica", "normal");
        doc.text((repair.issue || "No issue description provided.").slice(0, 95), 16, y + 10);

        // Costs & Totals
        y = 96;
        doc.line(14, y, 196, y);
        y += 8;
        doc.text(`Parts Cost: ${formatMoney(repair.parts_cost || 0)}`, 135, y);
        y += 6;
        doc.text(`Service Charges: ${formatMoney(repair.service_charge || 0)}`, 135, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text(`Total Amount: ${formatMoney(totalAmount)}`, 135, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.text(`Deposit / Paid: -${formatMoney(advance)}`, 135, y);
        y += 7;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(`Balance Due: ${formatMoney(balance)}`, 135, y);

        // Terms
        y += 18;
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text("Terms & Conditions:", 14, y);
        y += 4;
        doc.text(
          "1. Present this slip for device collection. 2. Hardware not claimed in 30 days may be auctioned.",
          14,
          y
        );

        // Signatures
        y = Math.max(y + 25, 250);
        doc.line(20, y, 70, y);
        doc.text("Customer Handover Signature", 22, y + 4);

        doc.line(135, y, 185, y);
        doc.text("Service Technician Signature", 140, y + 4);
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
        doc.text(`CLAIM TICKET: ${repair.repair_number}`, 40, 24, { align: "center" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(`Date: ${new Date(repair.created_at).toLocaleDateString()}`, 6, 30);
        doc.text(`Customer: ${repair.customer_name || "Walk-in"}`, 6, 34);
        doc.text(`Device: ${repair.product_name}`, 6, 38);
        doc.text(`Issue: ${(repair.issue || "N/A").slice(0, 35)}`, 6, 42);

        doc.text("------------------------------------------------", 40, 46, { align: "center" });

        let y = 50;
        doc.text(`Total: ${formatMoney(totalAmount)}`, 6, y);
        y += 4;
        doc.text(`Advance: ${formatMoney(advance)}`, 6, y);
        y += 4;
        doc.setFont("helvetica", "bold");
        doc.text(`Balance Due: ${formatMoney(balance)}`, 6, y);
        y += 6;
        doc.setFontSize(6);
        doc.setFont("helvetica", "normal");
        doc.text("Please bring this ticket for device collection.", 40, y, { align: "center" });
      }

      doc.save(`Repair-${repair.repair_number}.pdf`);
    } catch {
      handlePrint();
    } finally {
      setIsExportingPdf(false);
    }
  }

  const renderDocContent = () => {
    if (printSize === "a4") {
      return (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b border-slate-200 pb-5">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">{storeName}</h1>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">{storeAddress}</p>
              <p className="text-xs text-slate-700 font-semibold mt-0.5">
                📞 {storePhone} • ✉️ {storeEmail}
              </p>
            </div>
            <div className="text-right">
              <span className="inline-block rounded-md bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 uppercase tracking-wider">
                Repair Job Sheet
              </span>
              <div className="mt-2 font-mono font-bold text-lg text-slate-900">
                {repair.repair_number}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Received: {new Date(repair.created_at).toLocaleDateString()}
              </div>
              <div className="mt-1">
                <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 uppercase">
                  Status: {repair.status}
                </span>
              </div>
            </div>
          </div>

          {/* Customer & Device Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Customer Information
              </div>
              <div className="font-bold text-base text-slate-900">
                {repair.customer_name || "Walk-in Customer"}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                <span className="font-medium text-slate-700">Type:</span> {repair.customer_type || "Retail"}
              </div>
              {repair.customer_phone && (
                <div className="text-xs text-slate-600 mt-0.5">📞 {repair.customer_phone}</div>
              )}
              {repair.customer_address && (
                <div className="text-xs text-slate-600 mt-0.5">📍 {repair.customer_address}</div>
              )}
            </div>

            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Device Details
              </div>
              <div className="font-bold text-base text-slate-900">{repair.product_name}</div>
              {repair.imei && (
                <div className="text-xs text-slate-600 mt-1">
                  <span className="font-medium text-slate-700">IMEI / Serial:</span> {repair.imei}
                </div>
              )}
              <div className="text-xs text-slate-600 mt-0.5">
                <span className="font-medium text-slate-700">Assigned Technician:</span>{" "}
                {repair.technician || "Unassigned"}
              </div>
            </div>
          </div>

          {/* Issue Description */}
          <div className="rounded-xl border border-slate-200 p-4 bg-white">
            <div className="text-xs font-bold text-slate-700 mb-1">Reported Issue / Fault:</div>
            <p className="text-xs text-slate-600 whitespace-pre-wrap">
              {repair.issue || "No issue details provided."}
            </p>
          </div>

          {/* Parts / Service Cost Summary */}
          <div className="flex justify-end pt-2">
            <div className="w-72 space-y-2 text-xs">
              {(Number(repair.parts_cost || 0) > 0 || Number(repair.service_charge || 0) > 0) && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>Parts Cost:</span>
                    <span className="font-mono">{formatMoney(repair.parts_cost || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Service Charges:</span>
                    <span className="font-mono">{formatMoney(repair.service_charge || 0)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-slate-600">
                <span>Total Amount:</span>
                <span className="font-mono font-semibold">{formatMoney(totalAmount)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Advance / Deposit Paid:</span>
                <span className="font-mono font-semibold">-{formatMoney(advance)}</span>
              </div>
              <div className="border-t border-slate-300 pt-1.5 flex justify-between font-bold text-sm text-slate-900">
                <span>Balance Due:</span>
                <span className="font-mono text-base text-red-600">{formatMoney(balance)}</span>
              </div>
            </div>
          </div>

          {/* Terms & Warranty Condition */}
          <div className="border-t border-slate-200 pt-3 text-[11px] text-slate-600 space-y-1">
            <div className="font-bold text-slate-700">Terms & Conditions:</div>
            <p className="whitespace-pre-wrap">
              {repair.terms ||
                "1. Please produce this job sheet when collecting your device. 2. Any hardware not collected within 30 days will be disposed of. 3. Warranty applies exclusively to components replaced by our service technicians."}
            </p>
          </div>

          {/* Signatures */}
          <div className="border-t border-slate-200 pt-10 grid grid-cols-2 gap-8 text-center text-xs">
            <div>
              <div className="w-48 mx-auto border-t border-slate-400 pt-1 font-medium text-slate-600">
                Customer Signature
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">Device handed over in condition stated</p>
            </div>
            <div>
              <div className="w-48 mx-auto border-t border-slate-400 pt-1 font-medium text-slate-600">
                Technician / Receiver
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">For {storeName}</p>
            </div>
          </div>
        </div>
      );
    }

    // 80mm Thermal Receipt Layout
    return (
      <div className="space-y-3 font-mono text-[11px] leading-tight text-slate-900">
        <div className="text-center space-y-1">
          <h2 className="font-bold text-sm uppercase">{storeName}</h2>
          <p className="text-[10px] text-slate-600">{storeAddress}</p>
          <p className="text-[10px] text-slate-800 font-bold">📞 {storePhone}</p>
          <div className="border-b border-dashed border-slate-400 my-1.5" />
          <div className="font-bold text-xs">REPAIR CLAIM TICKET</div>
          <div className="text-[10px] text-slate-700">#{repair.repair_number}</div>
          <div className="text-[10px] text-slate-600">
            {new Date(repair.created_at).toLocaleDateString()}
          </div>
        </div>

        <div className="border-b border-dashed border-slate-400 my-1.5" />

        <div className="text-[11px] space-y-0.5">
          <div>Customer: {repair.customer_name || "Walk-in"}</div>
          {repair.customer_phone && <div>Tel: {repair.customer_phone}</div>}
          <div className="font-semibold pt-1">Device: {repair.product_name}</div>
          {repair.imei && <div>IMEI: {repair.imei}</div>}
          <div className="text-slate-600 pt-0.5">Issue: {repair.issue || "N/A"}</div>
        </div>

        <div className="border-b border-dashed border-slate-400 my-1.5" />

        <div className="space-y-1 text-xs">
          {repair.estimated_cost > 0 && (
            <div className="flex justify-between">
              <span>Estimated:</span>
              <span>{formatMoney(repair.estimated_cost)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Total:</span>
            <span>{formatMoney(totalAmount)}</span>
          </div>
          <div className="flex justify-between text-emerald-700">
            <span>Advance:</span>
            <span>{formatMoney(advance)}</span>
          </div>
          <div className="flex justify-between font-bold text-sm pt-1 border-t border-slate-400 text-red-600">
            <span>BALANCE DUE:</span>
            <span>{formatMoney(balance)}</span>
          </div>
        </div>

        <div className="border-b border-dashed border-slate-400 my-1.5" />

        <div className="text-center text-[10px] text-slate-600 space-y-1">
          <div>Present this ticket when collecting device.</div>
          <div className="text-[9px] text-slate-500">Thank you for trusting us!</div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Repair Job Sheet Print & Preview" maxWidth="max-w-4xl">
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
              id="repair-print-content"
              ref={printAreaRef}
              className={`bg-white shadow-lg text-slate-900 ${
                printSize === "80mm"
                  ? "w-[300px] p-4 font-mono text-xs space-y-3"
                  : "w-full max-w-[210mm] p-8 space-y-6 text-sm"
              }`}
            >
              {renderDocContent()}
            </div>
          </div>
        </div>
      </Modal>

      {/* Direct document.body portal for reliable print output */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id="print-repair"
            aria-hidden="true"
            className={
              printSize === "80mm"
                ? "w-[80mm] max-w-[80mm] p-3 bg-white text-black font-mono text-xs"
                : "w-full max-w-[210mm] p-8 bg-white text-slate-900 text-sm"
            }
          >
            {renderDocContent()}
          </div>,
          document.body
        )}
    </>
  );
}
