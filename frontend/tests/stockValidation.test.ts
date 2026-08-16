import { describe, expect, it } from "vitest";
import {
  checkStock,
  invalidCartLines,
  stockWarningMessage,
} from "@/lib/stockValidation";

describe("checkStock", () => {
  it("accepts a request that fits available stock", () => {
    const issue = checkStock(2, 2);
    expect(issue.ok).toBe(true);
    expect(issue.over).toBe(false);
    expect(issue.out).toBe(false);
    expect(issue.short).toBe(0);
    expect(issue.requested).toBe(2);
    expect(issue.available).toBe(2);
  });

  it("flags a request that exceeds available stock without capping it", () => {
    const issue = checkStock(2, 100);
    expect(issue.ok).toBe(false);
    expect(issue.over).toBe(true);
    expect(issue.out).toBe(false);
    expect(issue.short).toBe(98);
    expect(issue.requested).toBe(100);
    expect(issue.available).toBe(2);
  });

  it("marks zero stock as sold out for any request", () => {
    const issue = checkStock(0, 1);
    expect(issue.out).toBe(true);
    expect(issue.ok).toBe(false);
  });

  it("clamps fractional and negative inputs", () => {
    expect(checkStock(2.9, 1.7)).toMatchObject({ available: 2, requested: 1, ok: true });
    expect(checkStock(-3, -5)).toMatchObject({ available: 0, out: true, ok: false });
  });
});

describe("invalidCartLines", () => {
  const stockOf = (id: number) => (id === 1 ? 2 : id === 2 ? 0 : undefined);

  it("returns lines whose requested quantity exceeds live stock", () => {
    const lines = [
      { product: { id: 1, stock: 2 }, qty: 5 },
      { product: { id: 2, stock: 4 }, qty: 1 },
    ];
    const invalid = invalidCartLines(lines, stockOf);
    expect(invalid).toHaveLength(2);
    expect(invalid[0].issue.over).toBe(true);
    expect(invalid[0].issue.available).toBe(2);
    expect(invalid[1].issue.out).toBe(true);
  });

  it("ignores lines that fit", () => {
    const lines = [{ product: { id: 1, stock: 2 }, qty: 1 }];
    expect(invalidCartLines(lines, stockOf)).toHaveLength(0);
  });

  it("falls back to the line snapshot when live stock is unknown", () => {
    const lines = [{ product: { id: 9, stock: 3 }, qty: 3 }];
    expect(invalidCartLines(lines, (id) => (id === 9 ? undefined : 0))).toHaveLength(0);
    const over = [{ product: { id: 9, stock: 3 }, qty: 4 }];
    expect(invalidCartLines(over, () => undefined)).toHaveLength(1);
  });
});

describe("stockWarningMessage", () => {
  it("explains the available vs requested quantities in plain language", () => {
    expect(stockWarningMessage("Coca Cola", checkStock(2, 100))).toContain(
      "Only 2"
    );
    expect(stockWarningMessage("Coca Cola", checkStock(2, 100))).toContain(
      "You requested 100"
    );
  });

  it("reports sold-out items clearly", () => {
    expect(stockWarningMessage("Bread", checkStock(0, 1))).toContain(
      "out of stock"
    );
  });
});
