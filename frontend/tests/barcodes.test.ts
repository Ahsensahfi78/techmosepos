import { describe, expect, it } from "vitest";
import {
  PAPER_SIZES,
  DEFAULT_PAPER,
  CUSTOM_MIN_MM,
  CUSTOM_MAX_MM,
  clampMm,
  getPaperSize,
  getTotalLabels,
} from "@/lib/barcodes";
import type { BarcodeItem } from "@/lib/barcodes";

describe("label paper sizes", () => {
  it("defaults to a 50 x 30mm label", () => {
    expect(DEFAULT_PAPER.id).toBe("50x30");
    expect(DEFAULT_PAPER).toMatchObject({ width: 50, height: 30, unit: "mm" });
  });

  it("names the default stock a 50 x 30 mm label", () => {
    expect(DEFAULT_PAPER.label).toBe("50 x 30 mm label (thermal)");
  });

  it("offers the common thermal label stocks", () => {
    const ids = PAPER_SIZES.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["50x30", "40x30", "58x40", "custom"]),
    );
  });

  it("keeps a custom size inside the printable range", () => {
    expect(clampMm(0, 70)).toBe(CUSTOM_MIN_MM);
    expect(clampMm(9999, 40)).toBe(CUSTOM_MAX_MM);
    expect(clampMm(Number.NaN, 40)).toBe(40);
    expect(clampMm(63.5, 70)).toBe(63.5);
  });

  it("applies custom dimensions on top of the custom stock", () => {
    expect(getPaperSize("custom", { width: 63, height: 38 })).toMatchObject({
      width: 63,
      height: 38,
      cols: 1,
      rows: 1,
    });
  });

  it("falls back to the default when the id is unknown", () => {
    expect(getPaperSize("nope")).toEqual(DEFAULT_PAPER);
  });

  it("lays the default stock out as a single label per page", () => {
    expect(DEFAULT_PAPER.cols).toBe(1);
    expect(DEFAULT_PAPER.rows).toBe(1);
    expect(DEFAULT_PAPER.gapX).toBe(0);
    expect(DEFAULT_PAPER.gapY).toBe(0);
  });
});

describe("label counting", () => {
  const item = (qty: number): BarcodeItem => ({
    product: {
      id: 1,
      name: "Test product",
      price: 500,
      stock: 5,
      category: "Test",
      sku: "SKU-1",
      barcode: "PRD-000001",
    },
    qty,
  });

  it("counts one label per unit", () => {
    expect(getTotalLabels([item(1), item(3)])).toBe(4);
    expect(getTotalLabels([])).toBe(0);
  });
});
