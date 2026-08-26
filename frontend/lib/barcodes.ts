import type { Product } from "./types";

export interface BarcodeItem {
  product: Product;
  qty: number;
}

export interface PaperSize {
  id: string;
  label: string;
  width: number;
  height: number;
  unit: "mm" | "in" | "px";
  cols: number;
  rows: number;
  gapX: number;
  gapY: number;
  paddingX: number;
  paddingY: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: "a4", label: "A4 (210 x 297mm)", width: 210, height: 297, unit: "mm", cols: 3, rows: 8, gapX: 4, gapY: 2, paddingX: 5, paddingY: 5 },
  { id: "a5", label: "A5 (148 x 210mm)", width: 148, height: 210, unit: "mm", cols: 2, rows: 5, gapX: 3, gapY: 2, paddingX: 4, paddingY: 4 },
  { id: "58mm", label: "58mm Thermal", width: 58, height: 30, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 2, paddingY: 2 },
  { id: "80mm", label: "80mm Thermal", width: 80, height: 40, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 3, paddingY: 2 },
  { id: "2x1", label: "2 x 1 inch", width: 2, height: 1, unit: "in", cols: 3, rows: 10, gapX: 0.1, gapY: 0.1, paddingX: 0.1, paddingY: 0.1 },
  { id: "3x1", label: "3 x 1 inch", width: 3, height: 1, unit: "in", cols: 2, rows: 10, gapX: 0.1, gapY: 0.1, paddingX: 0.15, paddingY: 0.1 },
  { id: "4x2", label: "4 x 2 inch", width: 4, height: 2, unit: "in", cols: 2, rows: 5, gapX: 0.15, gapY: 0.15, paddingX: 0.2, paddingY: 0.15 },
  { id: "custom", label: "Custom Label", width: 70, height: 40, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 2, paddingY: 2 },
];

export const DEFAULT_PAPER = PAPER_SIZES[0];

export interface BarcodeDisplaySettings {
  showStoreName: boolean;
  showProductName: boolean;
  showPrice: boolean;
  showSku: boolean;
  showBarcode: boolean;
  showCode: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: BarcodeDisplaySettings = {
  showStoreName: true,
  showProductName: true,
  showPrice: true,
  showSku: false,
  showBarcode: true,
  showCode: true,
};

export function getPaperSize(id: string): PaperSize {
  return PAPER_SIZES.find((p) => p.id === id) ?? DEFAULT_PAPER;
}

export function detectBarcodeFormat(code: string): string {
  if (!code) return "CODE128";
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length === 13 && /^\d{13}$/.test(cleaned)) return "EAN13";
  if (cleaned.length === 12 && /^\d{12}$/.test(cleaned)) return "UPC";
  if (cleaned.length === 8 && /^\d{8}$/.test(cleaned)) return "EAN8";
  return "CODE128";
}

export function getTotalLabels(items: BarcodeItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

export function buildPrintLabels(
  items: BarcodeItem[],
  settings: BarcodeDisplaySettings,
  storeName: string,
): Array<{
  product: Product;
  storeName: string;
  settings: BarcodeDisplaySettings;
}> {
  const labels: Array<{
    product: Product;
    storeName: string;
    settings: BarcodeDisplaySettings;
  }> = [];
  for (const item of items) {
    for (let i = 0; i < item.qty; i++) {
      labels.push({ product: item.product, storeName, settings });
    }
  }
  return labels;
}
