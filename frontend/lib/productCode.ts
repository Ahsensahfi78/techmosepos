import type { Product } from "./types";

export const PRODUCT_CODE_PREFIX = "PRD";
const PRODUCT_CODE_RE = /^PRD-(\d+)$/i;

export function formatProductCode(number: number): string {
  return `${PRODUCT_CODE_PREFIX}-${String(number).padStart(6, "0")}`;
}

export function parseProductCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const match = PRODUCT_CODE_RE.exec(code.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function usedCodes(
  products: Product[],
  extra: (string | null | undefined)[] = []
): Set<string> {
  const used = new Set<string>();
  for (const product of products) {
    for (const value of [product.sku, product.barcode]) {
      const normalized = (value ?? "").trim().toLowerCase();
      if (normalized) used.add(normalized);
    }
  }
  for (const value of extra) {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized) used.add(normalized);
  }
  return used;
}

/** Offline fallback: next free PRD-NNNNNN based on the cached catalog. */
export function generateLocalProductCode(
  products: Product[],
  extra: (string | null | undefined)[] = []
): string {
  const used = usedCodes(products, extra);
  let highest = 0;
  for (const product of products) {
    for (const value of [product.sku, product.barcode]) {
      const parsed = parseProductCode(value);
      if (parsed !== null) highest = Math.max(highest, parsed);
    }
  }
  let candidate = highest + 1;
  while (used.has(formatProductCode(candidate).toLowerCase())) {
    candidate += 1;
  }
  return formatProductCode(candidate);
}

/** Returns another product already using `code` as sku or barcode (case-insensitive). */
export function findCodeConflict(
  products: Product[],
  code: string | null | undefined,
  excludeId?: number
): Product | null {
  const needle = (code ?? "").trim().toLowerCase();
  if (!needle) return null;
  return (
    products.find(
      (p) =>
        p.id !== excludeId &&
        ((p.sku ?? "").trim().toLowerCase() === needle ||
          (p.barcode ?? "").trim().toLowerCase() === needle)
    ) ?? null
  );
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|offline|load failed|failed to load/i.test(message);
}
