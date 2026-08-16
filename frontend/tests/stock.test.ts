import { describe, expect, it } from "vitest";
import {
  isLowStock,
  sortByStockPriority,
  stockStatus,
  stockTone,
} from "@/lib/stock";

describe("stockStatus", () => {
  it("marks zero stock as sold out", () => {
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(0, null)).toBe("out");
  });

  it("flags stock below the per-product minimum as low", () => {
    expect(stockStatus(3, 5)).toBe("low");
    expect(stockStatus(5, 5)).toBe("ok");
  });

  it("falls back to a floor of 1 when no minimum is set", () => {
    expect(stockStatus(1, null)).toBe("ok");
    expect(stockStatus(0, null)).toBe("out");
  });
});

describe("stockTone", () => {
  it("returns a sold-out badge at zero", () => {
    expect(stockTone(0).badge).toBe("bg-red-500 text-white");
  });

  it("returns an amber low-stock badge below the minimum", () => {
    expect(stockTone(2, 5).badge).toBe("bg-amber-500 text-white");
  });

  it("returns a green in-stock badge otherwise", () => {
    expect(stockTone(50, 5).badge).toBe("bg-emerald-100 text-emerald-700");
  });
});

describe("isLowStock", () => {
  it("is true for out and low states, false for in stock", () => {
    expect(isLowStock(0, 1)).toBe(true);
    expect(isLowStock(2, 5)).toBe(true);
    expect(isLowStock(9, 5)).toBe(false);
  });
});

describe("sortByStockPriority", () => {
  it("sorts out first, then low, then in-stock", () => {
    const items = [
      { id: 1, stock: 50, min_stock: 5 },
      { id: 2, stock: 0, min_stock: 5 },
      { id: 3, stock: 3, min_stock: 5 },
    ];
    const sorted = sortByStockPriority(items);
    expect(sorted.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the input array", () => {
    const items = [
      { id: 1, stock: 5 },
      { id: 2, stock: 1 },
    ];
    sortByStockPriority(items);
    expect(items.map((i) => i.id)).toEqual([1, 2]);
  });
});
