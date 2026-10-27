import { describe, expect, it } from "vitest";
import {
  PAPER_SIZES,
  DEFAULT_PAPER,
  RECOMMENDED_PAPER,
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

  it("opens new sessions on the 38 x 25 mm / 3 mm gap roll the shop runs", () => {
    // The printer's driver was pointed at a stale 76x100 preset, but the
    // physical roll is 38 x 25 mm with a 3 mm gap, so the app starts there.
    expect(RECOMMENDED_PAPER).toMatchObject({
      id: "38x25",
      width: 38,
      height: 25,
      unit: "mm",
      gapMm: 3,
    });
  });

  it("offers the common thermal label stocks", () => {
    const ids = PAPER_SIZES.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["50x30", "40x30", "58x40", "custom"]),
    );
  });

  it("still offers the larger 76 mm label presets", () => {
    expect(getPaperSize("76x100")).toMatchObject({
      width: 76,
      height: 100,
      unit: "mm",
      cols: 1,
      rows: 1,
    });
    expect(getPaperSize("76x50")).toMatchObject({ width: 76, height: 50 });
  });

  it("carries each roll's own gap so the picker cannot report the wrong pitch", () => {
    expect(getPaperSize("76x100").gapMm).toBe(3);
    expect(getPaperSize("76x50").gapMm).toBe(3);
    expect(getPaperSize("38x25").gapMm).toBe(3);
  });

  it("never puts a roll gap on sheet stock", () => {
    expect(getPaperSize("a4").gapMm).toBeUndefined();
    expect(getPaperSize("a5").gapMm).toBeUndefined();
    expect(DEFAULT_PAPER.gapMm).toBeUndefined();
  });

  it("keeps the 76mm stock inside the printable range", () => {
    const stock = getPaperSize("76x100");
    expect(clampMm(stock.width, 0)).toBe(76);
    expect(clampMm(stock.height, 0)).toBe(100);
    expect(stock.width).toBeGreaterThanOrEqual(CUSTOM_MIN_MM);
    expect(stock.height).toBeLessThanOrEqual(CUSTOM_MAX_MM);
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
