/** Quantity words and helpers for parsing "add two chargers" / "3 nokia". */
export const QUANTITY_WORDS: Record<string, number> = {
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  couple: 2,
  few: 3,
  dozen: 12,
};

export function isQuantityToken(w: string): boolean {
  return w in QUANTITY_WORDS;
}

export function wordToNumber(w: string): number | null {
  const v = QUANTITY_WORDS[w];
  return v === undefined ? null : v;
}

/**
 * Best-effort quantity from tokens: leading number, trailing number, then
 * leading/trailing quantity words. Returns null when there is no quantity.
 */
export function parseQtyFromTokens(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  const first = tokens[0];
  if (first && /^\d+$/.test(first)) {
    const n = Number(first);
    if (n > 0) return n;
  }
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last && /^\d+$/.test(last)) {
      const n = Number(last);
      if (n > 0) return n;
    }
  }
  if (first && first in QUANTITY_WORDS) return QUANTITY_WORDS[first];
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last && last in QUANTITY_WORDS) return QUANTITY_WORDS[last];
  }
  return null;
}
