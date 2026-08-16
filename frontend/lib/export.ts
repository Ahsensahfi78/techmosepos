"use client";

import { jsPDF } from "jspdf";
import { formatMoney } from "./constants";
import type { AnalyticsReport } from "./types";

export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function pdfHeader(doc: jsPDF, title: string, subtitle: string) {
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, 14, 25);
  doc.setDrawColor(226, 232, 240);
  doc.line(14, 30, 196, 30);
}

function pdfSectionTitle(doc: jsPDF, y: number, title: string) {
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, y);
  return y + 5;
}

function pdfTable(
  doc: jsPDF,
  y: number,
  headers: string[],
  rows: string[][]
): number {
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const colWidth = (196 - 28) / headers.length;
  const lineH = 7;
  let cursor = y;
  headers.forEach((h, i) => {
    doc.setFillColor(241, 245, 249);
    doc.rect(14 + i * colWidth, cursor, colWidth, lineH, "F");
    doc.setTextColor(15, 23, 42);
    doc.text(h, 14 + i * colWidth + 2, cursor + 5);
  });
  cursor += lineH;
  rows.forEach((row) => {
    if (cursor > 270) {
      doc.addPage();
      cursor = 15;
    }
    row.forEach((cell, i) => {
      doc.setTextColor(51, 65, 85);
      doc.text(cell, 14 + i * colWidth + 2, cursor + 5);
    });
    cursor += lineH;
  });
  return cursor + 4;
}

export function exportDashboardPDF(report: AnalyticsReport, storeName: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const rangeLabel = `${report.range.from} → ${report.range.to}`;
  pdfHeader(doc, `${storeName || "TechMOS"} — Dashboard`, `Period: ${rangeLabel}`);

  let y = 40;
  y = pdfSectionTitle(doc, y, "Overview");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Orders: ${report.overview.orders}   |   Revenue: ${formatMoney(report.overview.revenue)}   |   Avg order value: ${formatMoney(report.overview.avg_order_value)}   |   Δ revenue vs previous: ${report.overview.revenue_change_pct}%`,
    14,
    y
  );
  y += 14;

  y = pdfSectionTitle(doc, y, "Top selling products");
  y = pdfTable(
    doc,
    y,
    ["Product", "Units sold", "Revenue", "COGS"],
    report.top_products.map((p) => [
      p.name,
      String(p.units_sold),
      formatMoney(p.revenue),
      formatMoney(p.cogs),
    ])
  );

  y = pdfSectionTitle(doc, y, "Category breakdown");
  y = pdfTable(
    doc,
    y,
    ["Category", "Units", "Revenue"],
    report.category_breakdown.map((c) => [
      c.category,
      String(c.units),
      formatMoney(c.revenue),
    ])
  );

  y = pdfSectionTitle(doc, y, "Profit & margin");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Gross profit: ${formatMoney(report.profit.gross_profit)}  (${report.profit.margin_pct}% margin on ${formatMoney(report.profit.revenue)} revenue)`,
    14,
    y
  );
  y += 14;

  y = pdfSectionTitle(doc, y, "Low stock alerts");
  y = pdfTable(
    doc,
    y,
    ["Product", "Stock", "Threshold", "Suggested"],
    report.low_stock.map((p) => [
      p.name,
      String(p.stock),
      String(p.threshold),
      String(p.suggested_qty),
    ])
  );

  doc.save("dashboard-report.pdf");
}
