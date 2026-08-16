import { levenshtein, normalizeText } from "./normalize";
import { QUANTITY_WORDS } from "./quantity";
import { extractInvoiceNo } from "./entities";
import type { IntentKind } from "./types";

export interface ClassifiedIntent {
  intent: IntentKind;
  confidence: "high" | "medium" | "low";
}

interface Rule {
  intent: IntentKind;
  words: string[];
  wordScore: number;
  all?: string[][];
  allScore?: number;
  regex?: RegExp;
  regexScore?: number;
  strong: boolean;
}

const hasQty = (tokens: string[]): boolean =>
  tokens.some((t) => /^\d+$/.test(t) || t in QUANTITY_WORDS);

function wordMatch(token: string, word: string): boolean {
  if (token === word) return true;
  if (token.length >= 4 && word.length >= 4 && Math.abs(token.length - word.length) <= 1)
    return levenshtein(token, word) <= 1;
  return false;
}

const RULES: Rule[] = [
  {
    intent: "add_to_cart",
    words: ["add", "put", "gimme", "give me", "buy", "scan", "ring up", "can i have", "can i get", "want", "need", "get", "another", "plus"],
    wordScore: 2.5,
    all: [
      ["i need", "i want", "i would like", "can i"],
      ["give me", "gimme", "get me", "add"],
    ],
    allScore: 2.5,
    regex: /(^|\s)(add|put|gimme|buy|scan|ring up|give me)\s+(a|an|one|two|\d)|(^|\s)take\s+(a|an|one|two|\d|more|another)|(^|\s)(to|into) (the )?(cart|basket|sale|bill)(\s|$)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "remove_from_cart",
    words: ["remove", "take out", "delete", "get rid of", "take off", "discard", "minus", "out of the cart", "take it out"],
    wordScore: 3,
    regex: /(^|\s)take\s+(out|off|away)(\s|$)|(^|\s)remove\s+the(\s|$)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "decrease_cart_qty",
    words: ["one less", "one fewer", "less", "reduce"],
    wordScore: 2.5,
    regex: /(remove|take|minus|reduce|one)\s*(off|out|away)?\s*(one|1)\b|(one|1)\s*(less|fewer)|minus one/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "set_cart_qty",
    words: ["change", "set", "update", "make it", "change it", "set it", "quantity to", "qty to"],
    wordScore: 2.5,
    regex: /(change|set|update|make it|change it|set it).{0,12}(to|at)\b.{0,12}\d|(quantity|qty)\b.{0,10}\b(to|of)\b/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "show_cart",
    words: ["cart", "basket", "total", "my cart", "my basket", "in the cart", "in my cart", "items in the cart", "bill", "my bill"],
    wordScore: 2,
    regex: /(whats?|what is|which)\b.{0,15}(in|on) (the )?(cart|basket)|(show|see)\b.{0,10}(cart|basket)|what.*total/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "clear_cart",
    words: ["clear the cart", "empty the cart", "reset cart", "clear cart", "empty cart", "reset the cart", "remove everything", "clear the list", "remove all"],
    wordScore: 3,
    all: [
      ["clear", "empty", "reset"],
      ["cart", "basket", "bill", "list", "items"],
    ],
    allScore: 3,
    strong: true,
  },
  {
    intent: "hold_invoice",
    words: ["hold", "park", "pause", "put on hold", "hold this", "hold it", "park this"],
    wordScore: 2.5,
    regex: /(hold|park|pause).{0,20}(transaction|sale|invoice|cart|order|bill)|(hold|park)\s+(this|the)\s+(one|sale|order|bill|cart)/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "open_held",
    words: ["held", "paused", "on hold", "open held", "held invoice", "held order", "held sale", "held carts", "held invoices"],
    wordScore: 2.5,
    regex: /open.{0,10}held|held.{0,15}(invoice|order|sale|cart)|(show|view).{0,10}held/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "resume_invoice",
    words: ["resume", "continue", "resume the", "resume held", "continue the", "back to the invoice", "pick up"],
    wordScore: 3,
    regex: /(resume|continue|pick up).{0,25}(invoice|order|sale|cart|transaction|held|where i left off)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "cancel_invoice",
    words: ["cancel", "void", "discard"],
    wordScore: 2,
    all: [
      ["cancel", "void", "delete", "discard"],
      ["transaction", "sale", "invoice", "order", "cart", "bill", "this"],
    ],
    allScore: 3,
    regex: /(cancel|void|delete|discard).{0,12}(transaction|sale|invoice|order|bill|cart)/i,
    regexScore: 2,
    strong: true,
  },
  {
    intent: "new_invoice",
    words: ["new", "fresh", "start over", "fresh start", "new sale", "new invoice", "new order", "new bill", "blank", "start again"],
    wordScore: 2.5,
    regex: /new\s+(sale|invoice|order|bill)|start\s+(fresh|over|again|a new)|fresh\s+start/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "checkout",
    words: ["checkout", "check out", "pay", "pay now", "settle", "cash out", "complete", "finish", "finalize", "charge", "cash", "pay the"],
    wordScore: 3,
    regex: /(pay|settle|checkout|check out|complete|finish|finalize).{0,15}(sale|bill|order|cart|transaction|now)|(complete|finish|finalize) (the )?(order|sale)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "select_customer",
    words: ["customer", "select customer", "choose customer", "assign customer", "set customer", "pick customer"],
    wordScore: 2.5,
    regex: /(select|choose|assign|set|pick).{0,12}customer|customer.{0,12}(select|choose|assign|set|pick)/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "find_customer",
    words: ["customer", "find customer", "search customer", "look for customer", "looking for customer"],
    wordScore: 2.5,
    regex: /(find|search|look (for|up)|looking for).{0,15}customer|customer.{0,15}(find|search|look)/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "find_invoice",
    words: ["invoice", "receipt", "order"],
    wordScore: 1.5,
    regex: /(invoice|receipt|sale|order|inv|rcpt)\s*#?\s*(\d+)|^(find|search|look up|look for|open|show|get|print|view)\s+(\d+)$/i,
    regexScore: 4,
    strong: true,
  },
  {
    intent: "invoice_customer",
    words: ["customer"],
    wordScore: 2,
    regex: /(customer|who|whose|whos).{0,45}(for|of|on|from).{0,20}(invoice|receipt|sale|order)\s*#?\s*(\d+)/i,
    regexScore: 8,
    strong: true,
  },
  {
    intent: "invoice_items",
    words: ["items", "products", "bought", "purchased", "on it", "on the invoice"],
    wordScore: 2,
    regex: /(items|products|bought|purchased).{0,40}(invoice|order|sale|receipt)|show (me )?(the )?(items|products).{0,20}(invoice|order)/i,
    regexScore: 9,
    strong: true,
  },
  {
    intent: "print_invoice",
    words: ["print", "reprint", "print again", "print the"],
    wordScore: 3,
    regex: /(print|reprint)\s+(the\s+)?(invoice|receipt|sale|order)\s*#?\s*(\d+)|print\s+(it|that|this|the|again|a copy)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "today_sales",
    words: ["today", "todays", "sales", "sold today", "todays sales", "today's sales"],
    wordScore: 2.5,
    regex: /(today|todays).{0,20}(sale|sold|sales|sell)|(sale|sold|sales|sell).{0,20}today/i,
    regexScore: 4,
    strong: true,
  },
  {
    intent: "stock_report",
    words: ["low stock", "out of stock", "below", "reorder", "reorder level", "running low", "almost out", "stock report", "low inventory", "below reorder"],
    wordScore: 3,
    regex: /(low|out of|below|under|less than).{0,15}(stock|level|reorder|inventory)|(stock|inventory).{0,15}(low|below|out|report)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "product_stock",
    words: ["how many", "how much", "in stock", "left", "remaining", "available", "stock of", "stock level", "quantity of", "do you have", "is there", "left in stock", "qty of", "how much stock"],
    wordScore: 2.5,
    regex: /how (many|much)\b.{0,30}(left|remaining|available|in stock)|(left|remaining|available|in stock).{0,20}$|(stock|quantity|qty)\s+(of|left)/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "create_return",
    words: ["returned", "returning", "bring back", "brought back", "gave back", "came back", "come back", "a return", "the return", "returned the", "return for"],
    wordScore: 3,
    regex: /(return|bring|brought|came|come|gave|give).{0,25}back|(customer|customers?).{0,20}(return|bring|brought|returning)|return.{0,30}(from|for).{0,10}(invoice|order|sale)|return.{0,15}(items?|products?|an item|the item|this item)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "start_return",
    words: ["start a return", "process a return", "make a return", "create a return", "start return", "new return", "open a return", "do a return", "a refund", "refund", "exchange", "return an item", "return the item"],
    wordScore: 2.5,
    regex: /(start|process|make|create|open|do|begin)\s+(a |the )?(return|refund|exchange)|return\s+(an|the|this)\s+(item|product)/i,
    regexScore: 3,
    strong: true,
  },
  {
    intent: "open_page",
    words: ["go to products", "open products", "show products", "go to inventory", "open settings", "show reports"],
    wordScore: 4,
    regex: /^(open|go to|go|navigate to|show me|show|view|take me to|take me)\s+(the\s+)?(products|product list|inventory|stock|customers|customer list|reports|analytics|settings|dashboard|home|purchases|purchase orders|users|quotations|quotes|repairs|suppliers|transactions|history|returns|expenses|income|cheques|warranty)$/i,
    regexScore: 4,
    strong: true,
  },
  {
    intent: "open_history",
    words: ["history", "transactions", "sales history", "all sales", "list", "records", "log", "recent", "list invoices", "view sales", "sales record", "invoice history"],
    wordScore: 2.5,
    regex: /(open|view|show|list)\b.{0,12}(history|transactions|all sales|invoices|sales record)|(history|transactions|sales records|invoice list|recent sales)/i,
    regexScore: 2.5,
    strong: true,
  },
  {
    intent: "plain_search",
    words: ["search", "find", "look for", "looking for", "look up", "find me", "find the", "show me", "show", "is there a", "do you have a", "got"],
    wordScore: 2.5,
    strong: false,
  },
];

const PAGE_ALIASES: Record<string, string> = {
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

export function classifyIntent(input: string): ClassifiedIntent {
  const text = normalizeText(input);
  if (!text) return { intent: "unknown", confidence: "low" };

  const tokens = text.split(" ");

  if (text in PAGE_ALIASES)
    return { intent: "open_page", confidence: "high" };
  if (text === "cart" || text === "basket")
    return { intent: "show_cart", confidence: "high" };
  if (text === "checkout" || text === "pay")
    return { intent: "checkout", confidence: "high" };
  if (text === "history" || text === "transactions")
    return { intent: "open_history", confidence: "high" };
  if (/^\d+$/.test(text))
    return { intent: "plain_search", confidence: "medium" };

  let best: { intent: IntentKind; score: number; strong: boolean } | null = null;
  let second = 0;

  for (const rule of RULES) {
    let score = 0;
    for (const word of rule.words) {
      if (tokens.some((tok) => wordMatch(tok, word))) score += rule.wordScore;
    }
    if (rule.all) {
      let groupsOk = 0;
      for (const group of rule.all) {
        if (group.some((w) => tokens.some((tok) => wordMatch(tok, w)))) groupsOk++;
      }
      if (groupsOk === rule.all.length) score += rule.allScore ?? 0;
    }
    if (rule.regex) {
      if (rule.regex.test(text)) {
        score += rule.regexScore ?? 0;
      }
    }
    if (rule.intent === "add_to_cart" && hasQty(tokens)) score += 0.5;
    if (rule.intent === "find_invoice" && extractInvoiceNo(text)) score += 3;
    if (rule.intent === "print_invoice" && extractInvoiceNo(text)) score += 3;
    if (rule.intent === "create_return" && extractInvoiceNo(text)) score += 2;
    if (
      rule.intent === "create_return" &&
      /return.{0,20}(from|for).{0,10}(invoice|order|sale)/i.test(text)
    )
      score += 7;
    if (score === 0) continue;
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { intent: rule.intent, score, strong: rule.strong };
    } else if (score > second) {
      second = score;
    }
  }

  if (!best) return { intent: "unknown", confidence: "low" };

  const gap = best.score - second;
  let confidence: ClassifiedIntent["confidence"] = "low";
  if (best.strong && best.score >= 3) {
    confidence = gap >= 0.5 ? "high" : "medium";
  } else if (best.score >= 1.5) {
    confidence = "medium";
  }

  if (confidence === "low" && best.score >= 1.5) confidence = "medium";

  return { intent: best.intent, confidence };
}
