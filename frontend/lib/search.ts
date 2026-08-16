/**
 * Smart, ranked product search.
 *
 * Priority order (best first):
 *   0  exact barcode
 *   1  exact SKU
 *   2  exact product name
 *   3  barcode prefix
 *   4  SKU prefix
 *   5  name prefix
 *   6  name word prefix ("coc" matches "Coca Cola")
 *   7  name substring
 *   8  SKU substring
 *   9  barcode substring
 *  10  typo-tolerant match (punctuation stripped, e.g. "cocacola" matches "Coca Cola")
 *
 * Lower score wins. Exact barcode/SKU always beat fuzzy name matches.
 */

export interface SearchableProduct {
  id: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  model?: string | null;
  price: number;
  stock: number;
  category?: string;
}

export type MatchField = "barcode" | "sku" | "name" | "model";

export interface ProductMatch {
  product: SearchableProduct;
  field: MatchField;
  exact: boolean;
  /** Lower is better. */
  score: number;
  /** Highlight ranges within the matched field's value. */
  ranges: { start: number; end: number }[];
}

export function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function stripPunctuation(s: string | null | undefined): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

/** Highlight ranges of the first occurrence of `needle` in `haystack` (0-indexed). */
export function highlightRanges(
  haystack: string | null | undefined,
  needle: string
): { start: number; end: number }[] {
  const text = haystack ?? "";
  const idx = normalize(text).indexOf(normalize(needle));
  if (idx === -1) return [];
  return [{ start: idx, end: idx + needle.length }];
}

export function matchScore(
  p: SearchableProduct,
  query: string
): ProductMatch | null {
  const q = normalize(query);
  if (!q) return null;
  const qClean = stripPunctuation(q);

  const barcode = normalize(p.barcode);
  const sku = normalize(p.sku);
  const name = normalize(p.name);
  const model = normalize(p.model);

  const ranges = (field: MatchField, value: string) =>
    highlightRanges(value, field === "name" || field === "model" ? q : q);

  if (barcode && barcode === q)
    return { product: p, field: "barcode", exact: true, score: 0, ranges: [{ start: 0, end: q.length }] };
  if (sku && sku === q)
    return { product: p, field: "sku", exact: true, score: 1, ranges: [{ start: 0, end: q.length }] };
  if (name === q)
    return { product: p, field: "name", exact: true, score: 2, ranges: [{ start: 0, end: q.length }] };
  if (model && model === q)
    return { product: p, field: "model", exact: true, score: 3, ranges: [{ start: 0, end: q.length }] };

  if (barcode && barcode.startsWith(q))
    return { product: p, field: "barcode", exact: false, score: 10, ranges: ranges("barcode", barcode) };
  if (sku && sku.startsWith(q))
    return { product: p, field: "sku", exact: false, score: 20, ranges: ranges("sku", sku) };
  if (name.startsWith(q))
    return { product: p, field: "name", exact: false, score: 30, ranges: ranges("name", name) };
  if (model && model.startsWith(q))
    return { product: p, field: "model", exact: false, score: 32, ranges: ranges("model", model) };

  if (name.split(/\s+/).some((w) => w.startsWith(q)))
    return { product: p, field: "name", exact: false, score: 40, ranges: ranges("name", name) };

  if (name.includes(q))
    return { product: p, field: "name", exact: false, score: 50, ranges: ranges("name", name) };
  if (sku && sku.includes(q))
    return { product: p, field: "sku", exact: false, score: 60, ranges: ranges("sku", sku) };
  if (barcode && barcode.includes(q))
    return { product: p, field: "barcode", exact: false, score: 70, ranges: ranges("barcode", barcode) };
  if (model && model.includes(q))
    return { product: p, field: "model", exact: false, score: 72, ranges: ranges("model", model) };

  // Typo-tolerant: compare stripped strings ("coca cola" ~ "cocacola").
  const nameClean = stripPunctuation(name);
  const skuClean = stripPunctuation(sku);
  const barcodeClean = stripPunctuation(barcode);
  const modelClean = stripPunctuation(model);
  if (qClean.length >= 3) {
    if (nameClean.includes(qClean))
      return { product: p, field: "name", exact: false, score: 80, ranges: ranges("name", name) };
    if (skuClean && skuClean.includes(qClean))
      return { product: p, field: "sku", exact: false, score: 90, ranges: ranges("sku", sku) };
    if (barcodeClean && barcodeClean.includes(qClean))
      return { product: p, field: "barcode", exact: false, score: 95, ranges: ranges("barcode", barcode) };
    if (modelClean && modelClean.includes(qClean))
      return { product: p, field: "model", exact: false, score: 85, ranges: ranges("model", model) };
  }

  return null;
}

export function smartSearch<T extends SearchableProduct>(
  products: T[],
  query: string,
  limit = 12
): ProductMatch[] {
  const q = normalize(query);
  if (!q) return [];
  const results: ProductMatch[] = [];
  for (const p of products) {
    const m = matchScore(p, q);
    if (m) results.push(m);
  }
  return results
    .sort(
      (a, b) =>
        a.score - b.score ||
        normalize(a.product.name).localeCompare(normalize(b.product.name))
    )
    .slice(0, limit);
}

/** The single best match, or null when there are multiple distinct products. */
export function bestMatch<T extends SearchableProduct>(
  products: T[],
  query: string
): ProductMatch | null {
  const matches = smartSearch(products, query, 2);
  if (matches.length === 0) return null;
  // Only auto-pick when the top match is decisively better (exact) or unique.
  if (matches.length === 1) return matches[0];
  if (matches[0].exact && matches[0].score < matches[1].score) return matches[0];
  return null;
}
