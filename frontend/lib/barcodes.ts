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
  /**
   * Roll gap the printer measures itself, in mm. Only set on single-label
   * roll stock. Selecting the preset applies this to the job's `GAP` value —
   * without it the picker would report the right size while the printer
   * still advanced whatever gap the previous stock used.
   */
  gapMm?: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: "50x30", label: "50 x 30 mm label (thermal)", width: 50, height: 30, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 2, paddingY: 2 },
  { id: "38x25", label: "38 x 25 mm label (thermal, 3mm gap)", width: 38, height: 25, unit: "mm", cols: 1, rows: 1, gapX: 3, gapY: 0, paddingX: 2, paddingY: 2, gapMm: 3 },
  { id: "76x100", label: "76 x 100 mm label (3mm gap)", width: 76, height: 100, unit: "mm", cols: 1, rows: 1, gapX: 3, gapY: 0, paddingX: 3, paddingY: 3, gapMm: 3 },
  { id: "76x50", label: "76 x 50 mm label (3mm gap)", width: 76, height: 50, unit: "mm", cols: 1, rows: 1, gapX: 3, gapY: 0, paddingX: 3, paddingY: 3, gapMm: 3 },
  { id: "40x30", label: "Label 40 x 30mm", width: 40, height: 30, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 1.5, paddingY: 1.5 },
  { id: "58x40", label: "Label 58 x 40mm", width: 58, height: 40, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 2, paddingY: 2 },
  { id: "a4", label: "A4 (210 x 297mm)", width: 210, height: 297, unit: "mm", cols: 3, rows: 8, gapX: 4, gapY: 2, paddingX: 5, paddingY: 5 },
  { id: "a5", label: "A5 (148 x 210mm)", width: 148, height: 210, unit: "mm", cols: 2, rows: 5, gapX: 3, gapY: 2, paddingX: 4, paddingY: 4 },
  { id: "58mm", label: "58mm Thermal", width: 58, height: 30, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 2, paddingY: 2 },
  { id: "80mm", label: "80mm Thermal", width: 80, height: 40, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 3, paddingY: 2 },
  { id: "2x1", label: "2 x 1 inch", width: 2, height: 1, unit: "in", cols: 3, rows: 10, gapX: 0.1, gapY: 0.1, paddingX: 0.1, paddingY: 0.1 },
  { id: "3x1", label: "3 x 1 inch", width: 3, height: 1, unit: "in", cols: 2, rows: 10, gapX: 0.1, gapY: 0.1, paddingX: 0.15, paddingY: 0.1 },
  { id: "4x2", label: "4 x 2 inch", width: 4, height: 2, unit: "in", cols: 2, rows: 5, gapX: 0.15, gapY: 0.15, paddingX: 0.2, paddingY: 0.15 },
  { id: "custom", label: "Custom (mm)", width: 38, height: 25, unit: "mm", cols: 1, rows: 1, gapX: 0, gapY: 0, paddingX: 2, paddingY: 2 },
];

export const DEFAULT_PAPER = PAPER_SIZES[0];

/**
 * The stock the shop actually runs: 38 x 25 mm thermal labels on a 3 mm gap.
 * New sessions start here; everything else stays in the picker.
 */
export const RECOMMENDED_PAPER: PaperSize =
  PAPER_SIZES.find((p) => p.id === "38x25") ?? DEFAULT_PAPER;

export const CUSTOM_MIN_MM = 10;
export const CUSTOM_MAX_MM = 300;

export function clampMm(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(CUSTOM_MAX_MM, Math.max(CUSTOM_MIN_MM, value));
}

export interface BarcodeDisplaySettings {
  showStoreName: boolean;
  showProductName: boolean;
  showPrice: boolean;
  showSku: boolean;
  showBarcode: boolean;
  showCode: boolean;
}

/**
 * What a label carries by default.
 *
 * Store name is off by default: the four rows that actually need to be
 * scanned — name, barcode, barcode number, price — are what the shop's
 * 38 x 25 mm roll carries. Toggle it back on for a fuller label or A4/A5
 * sheets.
 */
export const DEFAULT_DISPLAY_SETTINGS: BarcodeDisplaySettings = {
  showStoreName: false,
  showProductName: true,
  showPrice: true,
  showSku: false,
  showBarcode: true,
  showCode: true,
};

export function getPaperSize(id: string, overrides?: Partial<PaperSize>): PaperSize {
  const base = PAPER_SIZES.find((p) => p.id === id) ?? DEFAULT_PAPER;
  return overrides ? { ...base, ...overrides } : base;
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
