import { parseTranscript } from "./voice";

export type VoiceAction =
  | { kind: "add_product"; term: string; qty: number }
  | { kind: "search_product"; term: string; qty: number }
  | { kind: "remove_product"; term: string }
  | { kind: "quantity_increase"; product?: string; qty: number }
  | { kind: "quantity_decrease"; product?: string; qty: number }
  | { kind: "set_quantity"; qty: number }
  | { kind: "show_cart" }
  | { kind: "clear_cart" }
  | { kind: "set_discount_percent"; percent: number }
  | { kind: "hold_invoice" }
  | { kind: "open_held_invoices" }
  | { kind: "resume_invoice" }
  | { kind: "cancel_invoice" }
  | { kind: "new_invoice" }
  | { kind: "select_customer" }
  | { kind: "find_customer"; term: string }
  | { kind: "checkout"; method: string }
  | { kind: "open_history" }
  | { kind: "find_invoice"; term: string }
  | { kind: "start_return" }
  | { kind: "open_page"; page: string }
  | { kind: "confirm_yes" }
  | { kind: "confirm_no" }
  | { kind: "unknown"; text: string };

const WAKE_PHRASES = [
  "hey pos",
  "ok pos",
  "hello pos",
  "pos assistant",
  "assistant",
  "pos",
];

const UNIT_WORDS = new Set([
  "bottle",
  "bottles",
  "piece",
  "pieces",
  "pcs",
  "unit",
  "units",
  "can",
  "cans",
  "box",
  "boxes",
  "pack",
  "packs",
  "of",
]);

const PAGE_MAP: Record<string, string> = {
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
  repairs: "repairs",
};

export function normalizeCommand(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,;:!?'"`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes a leading wake phrase ("hey pos …") from a normalized utterance. */
export function stripWakePhrase(raw: string): string {
  const text = normalizeCommand(raw);
  if (!text) return "";
  for (const wake of WAKE_PHRASES) {
    if (text === wake) return "";
    if (text.startsWith(wake + " ")) return text.slice(wake.length).trim();
    if (text.startsWith(wake + ",")) return text.slice(wake.length + 1).trim();
  }
  return text;
}

export function parseVoiceCommand(raw: string): VoiceAction {
  const text = stripWakePhrase(raw);
  if (!text) return { kind: "unknown", text: raw };

  // yes / no confirmations
  if (/^(yes|yeah|yep|sure|confirm|confirm that|go ahead|do it|proceed)$/.test(text))
    return { kind: "confirm_yes" };
  if (/^(no|nope|cancel|stop|don't|do not|never mind|dismiss|back)$/.test(text))
    return { kind: "confirm_no" };

  // navigation: "open / go to <page>"
  let m = /^(open|go to|goto|navigate to|show me)\s+(.+)$/.exec(text);
  if (m) {
    const target = m[2].trim();
    if (/(transaction history|history|transactions)/.test(target))
      return { kind: "open_history" };
    if (/(sales returns|returns)/.test(target)) return { kind: "start_return" };
    const page = PAGE_MAP[target];
    if (page) return { kind: "open_page", page };
    if (target === "cart" || target === "shopping cart")
      return { kind: "show_cart" };
    if (
      target === "held invoices" ||
      target === "parked invoices" ||
      target === "held" ||
      target === "parked"
    )
      return { kind: "open_held_invoices" };
    if (target === "checkout" || target === "payment")
      return { kind: "checkout", method: "cash" };
  }

  // direct references
  if (/^(transaction history|transactions|history)$/.test(text))
    return { kind: "open_history" };
  if (
    /^(returns|sales return|start sales return|start return|return this item)$/.test(
      text
    ) ||
    text === "open returns"
  )
    return { kind: "start_return" };

  // find invoice / customer
  m = /^(find|search|look up|look for)\s+(the\s+)?invoice\s+(.+)$/.exec(text);
  if (m) return { kind: "find_invoice", term: m[3].trim() };
  m = /^(find|search|look up|look for)\s+(the\s+)?customer\s+(.+)$/.exec(text);
  if (m) return { kind: "find_customer", term: m[3].trim() };

  // payment
  if (
    /^(checkout|complete (the )?(invoice|sale|order|payment)|confirm payment|charge)$/.test(
      text
    )
  )
    return { kind: "checkout", method: "cash" };
  if (/^pay cash$|^pay by cash$|^cash$/.test(text))
    return { kind: "checkout", method: "cash" };
  if (/^pay card$|^pay by card$/.test(text))
    return { kind: "checkout", method: "card" };
  if (/^pay bank$|^pay by bank$|^pay (by )?bank transfer$/.test(text))
    return { kind: "checkout", method: "bank" };
  if (/^pay\s+\d+/.test(text)) return { kind: "checkout", method: "cash" };

  // invoice actions
  if (/^hold (the )?(invoice|order)$/.test(text) || text === "hold" || text === "hold this")
    return { kind: "hold_invoice" };
  if (/^(open\s+)?(held invoices|parked invoices|held|parked)$/.test(text))
    return { kind: "open_held_invoices" };
  if (/^resume (the )?invoice$/.test(text)) return { kind: "resume_invoice" };
  if (/^(new invoice|start (a )?new invoice|new sale|start (a )?new sale)$/.test(text))
    return { kind: "new_invoice" };
  if (/^cancel (the )?invoice$|^cancel (the )?order$/.test(text))
    return { kind: "cancel_invoice" };

  // cart
  if (/^(show|open) (the )?cart$/.test(text) || text === "cart" || text === "shopping cart")
    return { kind: "show_cart" };
  if (/^clear (the )?cart$|^empty (the )?cart$/.test(text))
    return { kind: "clear_cart" };

  // quantity / discount
  m = /^set (the )?quantity to (\d+)$/.exec(text) ?? /^set quantity (\d+)$/.exec(text);
  if (m) return { kind: "set_quantity", qty: Number(m[2]) };
  m = /^apply a (\d+) percent discount$/.exec(text);
  if (m) return { kind: "set_discount_percent", percent: Number(m[1]) };
  m = /^set (the )?discount to (\d+) percent$/.exec(text);
  if (m) return { kind: "set_discount_percent", percent: Number(m[2]) };
  m = /^(\d+) percent discount$/.exec(text);
  if (m) return { kind: "set_discount_percent", percent: Number(m[1]) };

  // quantity adjust
  m = /^increase (the )?quantity of (.+)$/.exec(text);
  if (m) return { kind: "quantity_increase", product: m[2].trim(), qty: 1 };
  if (/^increase (the )?quantity$/.test(text))
    return { kind: "quantity_increase", qty: 1 };
  m = /^decrease (the )?quantity of (.+)$/.exec(text);
  if (m) return { kind: "quantity_decrease", product: m[2].trim(), qty: 1 };
  if (/^decrease (the )?quantity$/.test(text))
    return { kind: "quantity_decrease", qty: 1 };

  // remove product
  if (/^remove (this|the last) item$/.test(text))
    return { kind: "remove_product", term: "" };
  m = /^remove (.+)$/.exec(text);
  if (m) return { kind: "remove_product", term: m[1].trim() };

  // add products ("add 100 coca cola", "add 20 bottles")
  if (/^add\s+/.test(text)) {
    const c = parseTranscript(text);
    const term = c.term.replace(/[.!?]+$/g, "").trim().toLowerCase();
    const moreMatch =
      /^more of (.+)$/.exec(term) || /^more (.+)$/.exec(term);
    if (moreMatch)
      return { kind: "quantity_increase", product: moreMatch[1].trim(), qty: c.qty };
    if (!term || UNIT_WORDS.has(term) || term === "more")
      return { kind: "quantity_increase", qty: c.qty };
    return { kind: "add_product", term: c.term, qty: c.qty };
  }
  m = /^(search|find|look for|looking for)\s+(.+)$/.exec(text);
  if (m) return { kind: "search_product", term: m[2].trim(), qty: 1 };

  // bare product phrase ("coca cola", "two coca cola", "sku 12345")
  const c = parseTranscript(text);
  return { kind: "add_product", term: c.term, qty: c.qty };
}
