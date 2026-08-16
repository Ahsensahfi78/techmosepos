import { classifyIntent } from "./intents";
import { normalizeText } from "./normalize";
import {
  cleanProductTerm,
  extractInvoiceNo,
  extractQty,
  isDecisiveMatch,
  PAGE_MAP,
  searchProducts,
  splitProductPairs,
} from "./entities";
import { emptyContext, updateContextFromAction } from "./context";
import type {
  Confidence,
  NlAction,
  NlAskProduct,
  NlContext,
  NlOutcome,
  UnderstandOpts,
} from "./types";

/**
 * Split a request into independent steps. "then", "also", "after that" and
 * commas always split; "and" splits only when the next clause starts with an
 * action verb ("find invoice 1025 and print it"), otherwise it stays a
 * product conjunction ("add 2 chargers and one nokia 105").
 */
export function splitRequests(text: string): string[] {
  const segments = text
    .split(/(\band\b|\bthen\b|\band then\b|\bafter that\b|\balso\b|,|;)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const requests: string[] = [];
  let current = "";
  let lastSep: string | null = null;
  const startsAction = (s: string) =>
    /^(add|put|give|gimme|buy|scan|remove|take|delete|print|reprint|show|find|search|look|checkout|pay|hold|park|resume|cancel|clear|open|select|go|new|start|create|process|close|list|ring|what|how|who|whose|which|make|set|change|decrease|increase|return|view|settle|finish|complete|empty|discard|pause|continue)\b/i.test(
      s
    );
  for (const seg of segments) {
    if (/^(and|then|and then|after that|also|,|;)$/i.test(seg)) {
      lastSep = seg.toLowerCase();
      continue;
    }
    const hard = /^(then|and then|after that|also|,|;)$/.test(lastSep ?? "");
    const andSep = /^and$/.test(lastSep ?? "");
    if (!current) {
      current = seg;
    } else if (hard || (andSep && startsAction(seg))) {
      requests.push(current);
      current = seg;
    } else if (andSep) {
      current = current + " and " + seg;
    } else {
      current = current + " " + seg;
    }
    lastSep = null;
  }
  if (current) requests.push(current);
  return requests;
}

const GENERIC_STOCK_TERMS = new Set(["product", "products", "item", "items", "stock", "inventory", "list", "products are", "items are"]);

function ask(message: string, confidence: Confidence = "medium"): NlOutcome {
  return { action: { kind: "ask", message }, confidence, ctx: {} };
}

function findProductById(products: UnderstandOpts["products"], id?: number) {
  if (!id) return null;
  return products.find((p) => p.id === id) ?? null;
}

function findBestCustomer(customers: UnderstandOpts["customers"], name: string) {
  const n = name.trim().toLowerCase();
  if (!n) return { best: null, matches: [] };
  const scored = customers
    .map((c) => {
      const cn = (c.name ?? "").toLowerCase();
      let score = 0;
      if (cn === n) score = 100;
      else if (cn.startsWith(n)) score = 80;
      else if (cn.includes(n)) score = 50;
      else if (n.split(" ").some((w) => w.length > 2 && cn.includes(w))) score = 30;
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { best: null, matches: [] };
  const best = scored[0];
  if (best.score >= 100) return { best: best.c, matches: [best.c] };
  const near = scored.filter((s) => best.score - s.score < 25);
  if (near.length === 1 && best.score >= 50)
    return { best: best.c, matches: [best.c] };
  return { best: best.c, matches: scored.map((s) => s.c) };
}

function extractCustomerName(text: string): string {
  return (
    text
      .replace(/^(select|choose|assign|set|pick|find|search|look for|looking for|add|put)\b/, "")
      .replace(/^(the|a|an)\b/, "")
      .replace(/\b(as|for|of|the|this|named|called|with name|customer)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function resolveProduct(products: UnderstandOpts["products"], term: string) {
  if (!term) return null;
  const matches = searchProducts(products, term);
  if (isDecisiveMatch(matches)) {
    const full = products.find((p) => p.id === matches[0].product.id) ?? null;
    return { product: full, matches };
  }
  return { product: null, matches };
}

function checkoutMethod(text: string): string {
  if (/\bcash\b/i.test(text)) return "cash";
  if (/\b(card|credit|debit|visa|mastercard|mobicash|jazzcash|bank)\b/i.test(text))
    return "card";
  return "";
}

function pageFromText(text: string): string {
  const m = /(products|inventory|customers|reports|settings|dashboard|purchases|users|quotations|repairs|suppliers|history|returns|expenses|income|cheques|warranty)$/.exec(text);
  if (m) return PAGE_MAP[m[1]] ?? m[1];
  return PAGE_MAP[text] ?? text;
}

function handleAdd(text: string, opts: UnderstandOpts): NlOutcome {
  const pairs = splitProductPairs(text);
  const lines: { product: UnderstandOpts["products"][number]; qty: number }[] = [];
  let askInfo: NlAskProduct | null = null;

  if (pairs.length >= 2) {
    for (const pair of pairs) {
      const resolved = resolveProduct(opts.products, pair.term);
      if (resolved?.product) {
        lines.push({ product: resolved.product, qty: pair.qty });
      } else {
        askInfo = {
          term: pair.term,
          qty: pair.qty,
          matches: resolved?.matches ?? [],
          on: "add",
        };
        break;
      }
    }
    if (askInfo) {
      return {
        action: { kind: "add_to_cart", lines, partial: true, term: text, ask: askInfo },
        confidence: "medium",
        ctx: {},
      };
    }
    return {
      action: { kind: "add_to_cart", lines, partial: false, term: text },
      confidence: "high",
      ctx: {},
    };
  }

  const term = pairs[0]?.term ?? cleanProductTerm(text);
  if (!term) return ask("What would you like to add?", "medium");
  const resolved = resolveProduct(opts.products, term);
  const qty = pairs[0]?.qty ?? extractQty(text.replace(term, " "));
  if (resolved?.product) {
    return {
      action: {
        kind: "add_to_cart",
        lines: [{ product: resolved.product, qty }],
        partial: false,
        term,
      },
      confidence: "high",
      ctx: {},
    };
  }
  return {
    action: {
      kind: "ask_product",
      ask: { term, qty, matches: resolved?.matches ?? [], on: "add" },
    },
    confidence: "medium",
    ctx: {},
  };
}

function handleRemove(text: string, opts: UnderstandOpts): NlOutcome {
  const term = cleanProductTerm(text);
  if (!term) return ask("Which product should I remove?", "medium");
  const resolved = resolveProduct(opts.products, term);
  if (resolved?.product) {
    return {
      action: { kind: "remove_from_cart", product: resolved.product, term },
      confidence: "high",
      ctx: {},
    };
  }
  return {
    action: {
      kind: "ask_product",
      ask: { term, qty: 1, matches: resolved?.matches ?? [], on: "remove" },
    },
    confidence: "medium",
    ctx: {},
  };
}

function handleSetQty(text: string, opts: UnderstandOpts, ctx: NlContext): NlOutcome {
  const qty = extractQty(text);
  const term = cleanProductTerm(text);
  let product = term ? resolveProduct(opts.products, term)?.product ?? null : null;
  if (!product && ctx.lastProductId) product = findProductById(opts.products, ctx.lastProductId);
  if (!product) return ask("Which product's quantity should I change?", "low");
  return {
    action: { kind: "set_cart_qty", product, qty },
    confidence: "high",
    ctx: {},
  };
}

function handleDecrease(text: string, opts: UnderstandOpts, ctx: NlContext): NlOutcome {
  const term = cleanProductTerm(text);
  let product = term ? resolveProduct(opts.products, term)?.product ?? null : null;
  if (!product && ctx.lastProductId) product = findProductById(opts.products, ctx.lastProductId);
  if (!product) return ask("Which product should I remove from the cart?", "low");
  return {
    action: { kind: "decrease_cart_qty", product },
    confidence: "high",
    ctx: {},
  };
}

function handleCustomer(
  text: string,
  opts: UnderstandOpts,
  ctx: NlContext,
  intent: "select_customer" | "find_customer"
): NlOutcome {
  const name = extractCustomerName(text);
  if (!name) {
    if (ctx.lastInvoiceNo) {
      return {
        action: { kind: "invoice_customer", invoiceNo: ctx.lastInvoiceNo },
        confidence: "high",
        ctx: {},
      };
    }
    return ask("Which customer?", "medium");
  }
  const { best, matches } = findBestCustomer(opts.customers, name);
  if (intent === "find_customer") {
    return {
      action: { kind: "find_customer", term: name },
      confidence: best ? "high" : "medium",
      ctx: {},
    };
  }
  if (best && matches.length === 1) {
    return {
      action: { kind: "select_customer", customer: best, term: name },
      confidence: "high",
      ctx: {},
    };
  }
  if (matches.length > 1) {
    return ask(`I found a few customers matching "${name}". Which one do you mean?`, "low");
  }
  return ask(`I couldn't find a customer named "${name}".`, "low");
}

function handleInvoice(
  text: string,
  opts: UnderstandOpts,
  ctx: NlContext,
  intent: "find_invoice" | "invoice_customer" | "invoice_items" | "print_invoice"
): NlOutcome {
  const invoiceNo = extractInvoiceNo(text);
  if (intent === "print_invoice") {
    if (invoiceNo) {
      return { action: { kind: "print_invoice", invoiceNo, last: false }, confidence: "high", ctx: {} };
    }
    if (/\b(last|latest|previous|most recent)\b/.test(text) || ctx.lastInvoiceNo) {
      return {
        action: { kind: "print_invoice", invoiceNo: ctx.lastInvoiceNo ?? null, last: true },
        confidence: "high",
        ctx: {},
      };
    }
    return ask("Which invoice should I print?", "medium");
  }
  if (!invoiceNo) {
    if (ctx.lastInvoiceNo) {
      return {
        action: { kind: intent, invoiceNo: ctx.lastInvoiceNo },
        confidence: "high",
        ctx: {},
      };
    }
    return ask("Which invoice do you mean?", "medium");
  }
  return { action: { kind: intent, invoiceNo }, confidence: "high", ctx: {} };
}

function handleStock(text: string, opts: UnderstandOpts): NlOutcome {
  const term = cleanProductTerm(text);
  if (!term || GENERIC_STOCK_TERMS.has(term)) {
    return { action: { kind: "stock_report" }, confidence: "high", ctx: {} };
  }
  const resolved = resolveProduct(opts.products, term);
  if (resolved?.product) {
    return {
      action: { kind: "product_stock", product: resolved.product, term },
      confidence: "high",
      ctx: {},
    };
  }
  return {
    action: {
      kind: "ask_product",
      ask: { term, qty: 1, matches: resolved?.matches ?? [], on: "stock" },
    },
    confidence: "medium",
    ctx: {},
  };
}

function handleReturn(text: string, opts: UnderstandOpts): NlOutcome {
  const invoiceNo = extractInvoiceNo(text);
  const term = cleanProductTerm(text);
  const qty = extractQty(term ? text.replace(term, " ") : text);
  let product: UnderstandOpts["products"][number] | null = null;
  if (term && !GENERIC_STOCK_TERMS.has(term)) {
    const resolved = resolveProduct(opts.products, term);
    if (resolved?.product) product = resolved.product;
    else if (!invoiceNo && resolved) {
      return {
        action: {
          kind: "ask_product",
          ask: { term, qty, matches: resolved.matches, on: "return" },
        },
        confidence: "medium",
        ctx: {},
      };
    }
  }
  if (!product && !invoiceNo) {
    return ask("What should I return?", "medium");
  }
  return {
    action: { kind: "create_return", invoiceNo, product, qty, term },
    confidence: "medium",
    ctx: {},
  };
}

/** Resolve pronoun-heavy follow-ups against conversation memory. */
function resolveFollowUp(text: string, opts: UnderstandOpts, ctx: NlContext): NlOutcome | null {
  const product = ctx.lastProductId ? findProductById(opts.products, ctx.lastProductId) : null;
  if (/^(print it|print that|print this|reprint|print the invoice|print the receipt|print the last invoice)$/.test(text)) {
    if (!ctx.lastInvoiceNo) return ask("Which invoice should I print?", "medium");
    return {
      action: { kind: "print_invoice", invoiceNo: ctx.lastInvoiceNo, last: true },
      confidence: "high",
      ctx: {},
    };
  }
  if (/^(open it|show it|view it|go back to it|the invoice)$/.test(text) && ctx.lastInvoiceNo) {
    return {
      action: { kind: "find_invoice", invoiceNo: ctx.lastInvoiceNo },
      confidence: "high",
      ctx: {},
    };
  }
  if (/^(who was (the|that) customer|which customer|show (me )?the customer|show customer|the customer|whose (was )?it|for whom)$/.test(text)) {
    if (!ctx.lastInvoiceNo) return ask("Which invoice do you mean?", "medium");
    return {
      action: { kind: "invoice_customer", invoiceNo: ctx.lastInvoiceNo },
      confidence: "high",
      ctx: {},
    };
  }
  if (/^(show (me )?the items|show (me )?the products|what was on (it|the invoice)|whats on (it|the invoice)|list the items|the items|the products|what did (they|we) buy|what did (they|we) get)$/.test(text)) {
    if (!ctx.lastInvoiceNo) return ask("Which invoice do you mean?", "medium");
    return {
      action: { kind: "invoice_items", invoiceNo: ctx.lastInvoiceNo },
      confidence: "high",
      ctx: {},
    };
  }
  if (/^(make it|make that|make this|set it|set that|set this|change it|change that|change this|make it to|set it to|make it a|quantity to)\b/.test(text)) {
    if (!product) return ask("Which product's quantity should I change?", "low");
    return {
      action: { kind: "set_cart_qty", product, qty: extractQty(text) },
      confidence: "high",
      ctx: {},
    };
  }
  if (/^(remove one|take one (off|out|away)|minus one|one less|one fewer|take one of (them|it)|remove one of (them|it)|reduce by one)$/.test(text)) {
    if (!product) return ask("Which product should I remove from the cart?", "low");
    return {
      action: { kind: "decrease_cart_qty", product },
      confidence: "high",
      ctx: {},
    };
  }
  if (/^(another one|one more|add one more|another|add another|one more of the same|one more please)$/.test(text)) {
    if (!product) return ask("What would you like to add?", "medium");
    return {
      action: {
        kind: "add_to_cart",
        lines: [{ product, qty: 1 }],
        partial: false,
        term: product.name,
      },
      confidence: "high",
      ctx: {},
    };
  }
  return null;
}

export function understand(input: string, opts: UnderstandOpts): NlOutcome {
  const text = normalizeText(input);
  const ctx = opts.ctx ?? emptyContext();
  if (!text) return ask("What would you like to do?", "low");

  const parts = splitRequests(text);
  if (parts.length > 1) {
    const steps: NlAction[] = [];
    let runningCtx = ctx;
    let allHigh = true;
    for (const part of parts) {
      const sub = understand(part, { ...opts, ctx: runningCtx });
      if (!sub.action) {
        return { action: sub.action, confidence: sub.confidence, ctx: runningCtx };
      }
      steps.push(sub.action);
      runningCtx = updateContextFromAction(sub.action, runningCtx);
      if (sub.confidence !== "high") allHigh = false;
    }
    return {
      action: { kind: "multi", steps },
      confidence: allHigh ? "high" : "medium",
      ctx: runningCtx,
    };
  }

  const followUp = resolveFollowUp(text, opts, ctx);
  if (followUp) return followUp;

  const classified = classifyIntent(text);
  const conf = classified.confidence;

  switch (classified.intent) {
    case "add_to_cart":
      return handleAdd(text, opts);
    case "remove_from_cart":
      return handleRemove(text, opts);
    case "decrease_cart_qty":
      return handleDecrease(text, opts, ctx);
    case "set_cart_qty":
      return handleSetQty(text, opts, ctx);
    case "show_cart":
      return { action: { kind: "show_cart" }, confidence: conf, ctx: {} };
    case "clear_cart":
      return { action: { kind: "clear_cart" }, confidence: conf, ctx: {} };
    case "hold_invoice":
      return { action: { kind: "hold_invoice" }, confidence: conf, ctx: {} };
    case "open_held":
      return { action: { kind: "open_held" }, confidence: conf, ctx: {} };
    case "resume_invoice":
      return { action: { kind: "resume_invoice" }, confidence: conf, ctx: {} };
    case "cancel_invoice":
      return { action: { kind: "cancel_invoice" }, confidence: conf, ctx: {} };
    case "new_invoice":
      return { action: { kind: "new_invoice" }, confidence: conf, ctx: {} };
    case "checkout":
      return {
        action: { kind: "checkout", method: checkoutMethod(text) },
        confidence: conf,
        ctx: {},
      };
    case "select_customer":
      return handleCustomer(text, opts, ctx, "select_customer");
    case "find_customer":
      return handleCustomer(text, opts, ctx, "find_customer");
    case "find_invoice":
      return handleInvoice(text, opts, ctx, "find_invoice");
    case "invoice_customer":
      return handleInvoice(text, opts, ctx, "invoice_customer");
    case "invoice_items":
      return handleInvoice(text, opts, ctx, "invoice_items");
    case "print_invoice":
      return handleInvoice(text, opts, ctx, "print_invoice");
    case "today_sales":
      return { action: { kind: "today_sales" }, confidence: conf, ctx: {} };
    case "stock_report":
      return { action: { kind: "stock_report" }, confidence: conf, ctx: {} };
    case "product_stock":
      return handleStock(text, opts);
    case "create_return":
      return handleReturn(text, opts);
    case "start_return":
      return { action: { kind: "start_return" }, confidence: conf, ctx: {} };
    case "open_page":
      return {
        action: { kind: "open_page", page: pageFromText(text) },
        confidence: conf,
        ctx: {},
      };
    case "open_history":
      return { action: { kind: "open_history" }, confidence: conf, ctx: {} };
    case "plain_search": {
      const term = cleanProductTerm(text);
      if (!term) return ask("What would you like to search for?", "medium");
      return { action: { kind: "plain_search", term }, confidence: conf, ctx: {} };
    }
    case "unknown":
      return { action: { kind: "plain_search", term: text }, confidence: "low", ctx: {} };
  }
}
