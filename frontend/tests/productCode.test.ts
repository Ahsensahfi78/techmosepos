import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/types";
import {
  findCodeConflict,
  formatProductCode,
  generateLocalProductCode,
  isNetworkError,
  parseProductCode,
} from "@/lib/productCode";

function product(
  id: number,
  sku: string | null,
  barcode: string | null = null,
  name = `Product ${id}`
): Product {
  return { id, name, price: 100, stock: 1, category: "General", sku, barcode };
}

describe("formatProductCode", () => {
  it("pads to six digits", () => {
    expect(formatProductCode(1)).toBe("PRD-000001");
    expect(formatProductCode(42)).toBe("PRD-000042");
    expect(formatProductCode(1234567)).toBe("PRD-1234567");
  });
});

describe("parseProductCode", () => {
  it("parses valid codes case-insensitively", () => {
    expect(parseProductCode("PRD-000007")).toBe(7);
    expect(parseProductCode("prd-42")).toBe(42);
    expect(parseProductCode("  PRD-100000  ")).toBe(100000);
  });

  it("rejects non-codes", () => {
    expect(parseProductCode("GAL-A15-128")).toBeNull();
    expect(parseProductCode("")).toBeNull();
    expect(parseProductCode(null)).toBeNull();
    expect(parseProductCode(undefined)).toBeNull();
    expect(parseProductCode("PRD-ABC")).toBeNull();
    expect(parseProductCode("4006381333931")).toBeNull();
  });
});

describe("generateLocalProductCode", () => {
  it("returns the first code when the catalog is empty", () => {
    expect(generateLocalProductCode([])).toBe("PRD-000001");
  });

  it("starts after the highest generated code", () => {
    const products = [
      product(1, "PRD-000003"),
      product(2, "PRD-000009"),
      product(3, "OTH-1"),
    ];
    expect(generateLocalProductCode(products)).toBe("PRD-000010");
  });

  it("never reuses a deleted number by starting from max+1", () => {
    const products = [product(1, "PRD-000005")];
    expect(generateLocalProductCode(products)).toBe("PRD-000006");
  });

  it("skips numbers occupied by barcode-only conflicts", () => {
    const products = [
      product(1, null, "PRD-000002"),
      product(2, "PRD-000003"),
    ];
    expect(generateLocalProductCode(products)).toBe("PRD-000004");
  });

  it("skips numbers reserved in the extra list", () => {
    const products = [product(1, "PRD-000001")];
    expect(
      generateLocalProductCode(products, ["PRD-000002", "prd-000003"])
    ).toBe("PRD-000004");
  });

  it("is case-insensitive against existing skus", () => {
    const products = [product(1, "prd-000001")];
    expect(generateLocalProductCode(products)).toBe("PRD-000002");
  });
});

describe("findCodeConflict", () => {
  const products = [
    product(1, "PRD-000001", "4006381333931"),
    product(2, "GAL-A15", "prd-000002"),
  ];

  it("finds a match by sku (case-insensitive)", () => {
    expect(findCodeConflict(products, "prd-000001")?.id).toBe(1);
    expect(findCodeConflict(products, "  PRD-000001 ")?.id).toBe(1);
  });

  it("finds a match by barcode", () => {
    expect(findCodeConflict(products, "4006381333931")?.id).toBe(1);
    expect(findCodeConflict(products, "PRD-000002")?.id).toBe(2);
  });

  it("excludes the product being edited", () => {
    expect(findCodeConflict(products, "PRD-000001", 1)).toBeNull();
  });

  it("returns null for blank or unknown codes", () => {
    expect(findCodeConflict(products, "")).toBeNull();
    expect(findCodeConflict(products, null)).toBeNull();
    expect(findCodeConflict(products, "PRD-999999")).toBeNull();
  });
});

describe("isNetworkError", () => {
  it("treats fetch TypeErrors as network failures", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("matches offline-style messages", () => {
    expect(isNetworkError(new Error("NetworkError when attempting to fetch"))).toBe(
      true
    );
    expect(isNetworkError(new Error("You are offline"))).toBe(true);
  });

  it("does not flag server errors", () => {
    expect(isNetworkError(new Error("SKU already exists"))).toBe(false);
    expect(isNetworkError("plain string")).toBe(false);
  });
});
