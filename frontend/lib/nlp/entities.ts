import { parseQtyFromTokens, QUANTITY_WORDS } from "./quantity";
import type { Product } from "@/lib/types";
import { smartSearch, type ProductMatch } from "@/lib/search";

export const UNIT_WORDS = new Set([
  "bottle",
  "bottles",
  "piece",
  "pieces",
  "pcs",
  "pc",
  "unit",
  "units",
  "can",
  "cans",
  "box",
  "boxes",
  "pack",
  "packs",
  "carton",
  "cartons",
  "of",
  "set",
  "sets",
]);

export const PAGE_MAP: Record<string, string> = {
  products: "products",
  "product list": "products",
  inventory: "inventory",
  stock: "inventory",
  customers: "customers",
  "customer list": "customers",
  reports: "reports",
  analytics: "reports",
  settings: "settings",
  dashboard: "dashboard",
  home: "dashboard",
  purchases: "purchases",
  "purchase orders": "purchases",
  users: "users",
  quotations: "quotations",
  quotes: "quotations",
  repairs: "repairs",
  suppliers: "suppliers",
  transactions: "history",
  history: "history",
  returns: "returns",
  expenses: "expenses",
  income: "income",
  cheques: "cheques",
  warranty: "warranty",
};

const INVOICE_RE = /(?:invoice|receipt|sale|order|inv|rcpt)\s*#?\s*(\d+)/i;

/** Extract an invoice/receipt number from an utterance, or null. */
export function extractInvoiceNo(text: string): string | null {
  const m = INVOICE_RE.exec(text);
  if (m) return m[1];
  // "find 1025", "open 1025", "print 1025"
  const digits = /^(?:find|search|look up|look for|open|show|get|print)\s+(\d+)$/.exec(text);
  if (digits) return digits[1];
  return null;
}

export function extractQty(text: string): number {
  const n = parseQtyFromTokens(text.split(/\s+/).filter(Boolean));
  return n ?? 1;
}

const LEAD_STRIPS: RegExp[] = [
  /^can you add\b/,
  /^give me\b/,
  /^i need\b/,
  /^i want\b/,
  /^can i have\b/,
  /^can i get\b/,
  /^ring up\b/,
  /^get rid of\b/,
  /^take out\b/,
  /^looking for\b/,
  /^look for\b/,
  /^stock of\b/,
  /^quantity of\b/,
  /^whats? the (?:stock|quantity|amount) of\b/,
  /^do you have\b/,
  /^is there\b/,
  /^returning the\b/,
  /^returned the\b/,
  /^return the\b/,
  /^return this\b/,
  /^return an\b/,
  /^return a\b/,
  /^brought back\b/,
  /^gave back\b/,
  /^came back\b/,
  /^(?:the )?customer (?:returned|returning|brought back|came back|came in to return)\b/,
  /^the customer\b/,
  /^add\b/,
  /^put\b/,
  /^give\b/,
  /^get\b/,
  /^buy\b/,
  /^scan\b/,
  /^take\b/,
  /^remove\b/,
  /^delete\b/,
  /^search\b/,
  /^find\b/,
  /^show\b/,
  /^how many\b/,
  /^how much\b/,
  /^how\b/,
  /^left\b/,
  /^out\b/,
  /^me\b/,
  /^my\b/,
  /^the\b/,
  /^a\b/,
  /^an\b/,
  /^returned\b/,
  /^returning\b/,
  /^customer\b/,
];

const TAIL_STRIPS: RegExp[] = [
  /\s+(?:in stock|left|available|remaining|in the cart|to the cart|on the shelf|are left|is left|still left|are there|are available|in inventory|in the store|in store|please)$/,
  /\s+(?:phones?|units?|pieces?|items?|products?|bottles?|cans?|boxes?|packs?|cartons?|sets?)$/,
  /\s+(?:are|is|do we have|we have|have|got)$/,
  /\s+from (?:the )?(?:invoice|receipt|sale|order)\s*#?\s*\d+$/,
  /\s+for (?:the )?(?:invoice|receipt|sale|order)\s*#?\s*\d+$/,
  /\s+(?:invoice|receipt|sale|order)\s*#?\s*\d+$/,
];

/** Clean a raw product term: "add 2 cokes to the cart" → "cokes". */
export function cleanProductTerm(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const re of LEAD_STRIPS) {
      const next = s.replace(re, " ").trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
    for (const re of TAIL_STRIPS) {
      const next = s.replace(re, "").trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  s = s.replace(/[?]+$/g, "").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const first = tokens[0];
    if ((first && /^\d+$/.test(first)) || (first && first in QUANTITY_WORDS)) {
      s = tokens.slice(1).join(" ");
    }
  }
  return s.trim();
}

const ADD_VERB_RE =
  /^(?:add|put|give me|give|i need|i want|can i have|can i get|can you add|get|buy|scan|ring up|take|enter|please)\s+/i;

/** Split "add 2 chargers and one nokia 105" into quantity/product pairs. */
export function splitProductPairs(
  text: string
): { qty: number; term: string }[] {
  const stripped = text.replace(ADD_VERB_RE, "").trim();
  const parts = stripped
    .split(/\s+and\s+|\s*\+\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const pairs: { qty: number; term: string }[] = [];
  for (const part of parts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    let qty: number | null = null;
    let rest = tokens;
    if (tokens.length > 0) {
      const first = tokens[0];
      const last = tokens[tokens.length - 1];
      if (/^\d+$/.test(first) || first in QUANTITY_WORDS) {
        qty = tokens.length > 1 ? (QUANTITY_WORDS[first] ?? Number(first)) : 1;
        rest = tokens.slice(1);
      } else if (/^\d+$/.test(last) || last in QUANTITY_WORDS) {
        qty = QUANTITY_WORDS[last] ?? Number(last);
        rest = tokens.slice(0, -1);
      }
    }
    pairs.push({ qty: qty ?? 1, term: cleanProductTerm(rest.join(" ")) });
  }
  return pairs;
}

/** Singularize a common plural product term: "chargers" → "charger". */
export function singularizeTerm(term: string): string {
  const t = term.trim();
  if (!t) return t;
  if (/ies$/i.test(t)) return t.slice(0, -3) + "y";
  if (/ses$/i.test(t)) return t.slice(0, -2);
  if (/(ss|us|is)$/i.test(t)) return t;
  if (/s$/i.test(t)) return t.slice(0, -1);
  return t;
}

export function isDecisiveMatch(matches: ProductMatch[]): boolean {
  if (matches.length === 1) return true;
  if (matches.length > 1 && matches[0].exact && matches[0].score < matches[1].score)
    return true;
  return false;
}

/** Product search that tolerates plurals ("chargers" matches "Charger"). */
export function searchProducts(
  products: Product[],
  term: string,
  limit = 8
): ProductMatch[] {
  let matches = smartSearch(products, term, limit);
  if (!isDecisiveMatch(matches)) {
    const singular = singularizeTerm(term);
    if (singular !== term) {
      const retry = smartSearch(products, singular, limit);
      if (retry.length > 0 && retry[0].score < (matches[0]?.score ?? 999))
        matches = retry;
    }
  }
  return matches;
}
