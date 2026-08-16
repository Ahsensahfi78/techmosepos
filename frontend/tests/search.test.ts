import { describe, expect, it } from "vitest";
import {
  bestMatch,
  highlightRanges,
  matchScore,
  normalize,
  smartSearch,
  stripPunctuation,
  type SearchableProduct,
} from "@/lib/search";

function product(overrides: Partial<SearchableProduct> & { id: number }): SearchableProduct {
  return {
    name: "Unnamed",
    price: 100,
    stock: 5,
    category: "General",
    ...overrides,
  };
}

const coke = product({
  id: 1,
  name: "Coca Cola 500ml",
  sku: "SKU-COLA-500",
  barcode: "8901234567890",
});
const colgate = product({ id: 2, name: "Colgate Toothpaste", sku: "SKU-PASTE" });
const milk = product({ id: 3, name: "Anchor Milk", barcode: "0001112223334" });
const products = [coke, colgate, milk];

describe("normalize / stripPunctuation", () => {
  it("lowercases and trims", () => {
    expect(normalize("  Coca Cola  ")).toBe("coca cola");
  });

  it("strips non-alphanumerics", () => {
    expect(stripPunctuation("Coca-Cola! 500ml")).toBe("cocacola500ml");
  });
});

describe("smartSearch ranking", () => {
  it("ranks exact barcode above everything else", () => {
    const results = smartSearch(products, "8901234567890", 10);
    expect(results[0].product.id).toBe(1);
    expect(results[0].field).toBe("barcode");
    expect(results[0].exact).toBe(true);
    expect(results[0].score).toBe(0);
  });

  it("ranks exact SKU second", () => {
    const results = smartSearch(products, "SKU-COLA-500", 10);
    expect(results[0].product.id).toBe(1);
    expect(results[0].field).toBe("sku");
    expect(results[0].score).toBe(1);
  });

  it("ranks exact name above prefix matches", () => {
    const results = smartSearch(products, "Anchor Milk", 10);
    expect(results[0].product.id).toBe(3);
    expect(results[0].field).toBe("name");
    expect(results[0].exact).toBe(true);
  });

  it("matches a word prefix ('col' → Colgate and Coca Cola)", () => {
    const results = smartSearch(products, "col", 10);
    expect(results.length).toBe(2);
    // Colgate starts with "col" (score 30, name prefix) and beats the
    // word-prefix match on "Coca Cola" (score 40).
    expect(results[0].product.name).toBe("Colgate Toothpaste");
    expect(results[1].product.name).toBe("Coca Cola 500ml");
  });

  it("is typo-tolerant when punctuation is stripped", () => {
    const results = smartSearch(products, "cocacola", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].product.id).toBe(1);
    expect(results[0].score).toBe(80);
  });

  it("finds a product whose name contains the query, ranking name over SKU", () => {
    // "paste" hits the name ("Colgate Toothpaste") at score 50 and the SKU
    // ("SKU-PASTE") at score 60 — the name match wins.
    const results = smartSearch(products, "paste", 10);
    expect(results.length).toBe(1);
    expect(results[0].product.id).toBe(2);
    expect(results[0].field).toBe("name");
  });

  it("returns no results for a nonsense query", () => {
    expect(smartSearch(products, "zzzzqqq", 10)).toHaveLength(0);
  });
});

describe("matchScore", () => {
  it("returns null for an empty query", () => {
    expect(matchScore(coke, "  ")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchScore(coke, "xyzzy")).toBeNull();
  });
});

describe("bestMatch", () => {
  it("auto-picks the single match", () => {
    const match = bestMatch(products, "Anchor Milk");
    expect(match?.product.id).toBe(3);
  });

  it("auto-picks a decisive exact barcode match", () => {
    const match = bestMatch(products, "8901234567890");
    expect(match?.product.id).toBe(1);
    expect(match?.exact).toBe(true);
  });

  it("returns null when several products are equally fuzzy", () => {
    // "col" matches both Coca Cola (word-prefix) and Colgate (word-prefix) at
    // the same score tier, so there is no decisive winner.
    expect(bestMatch(products, "col")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(bestMatch(products, "zzzzqqq")).toBeNull();
  });
});

describe("highlightRanges", () => {
  it("returns the range of the first occurrence", () => {
    expect(highlightRanges("Coca Cola 500ml", "coca")).toEqual([
      { start: 0, end: 4 },
    ]);
  });

  it("returns an empty array when the needle is absent", () => {
    expect(highlightRanges("Coca Cola", "pepsi")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(highlightRanges("Coca Cola", "COLA")).toEqual([
      { start: 5, end: 9 },
    ]);
  });
});
