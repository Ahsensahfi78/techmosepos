import { describe, expect, it } from "vitest";
import { understand, splitRequests } from "@/lib/nlp";
import { can, permissionForAction } from "@/lib/nlp/permissions";
import type { NlAction, NlContext } from "@/lib/nlp/types";
import type { Customer, Product } from "@/lib/types";

const PRODUCTS: Product[] = [
  { id: 1, name: "Nokia 105", price: 5000, stock: 12, category: "Phones", sku: "NOK105" },
  { id: 2, name: "Nokia 110", price: 6000, stock: 3, category: "Phones", sku: "NOK110" },
  { id: 3, name: "Charger USB-C", price: 1500, stock: 40, category: "Accessories", sku: "CHG1" },
  { id: 4, name: "Coke 500ml", price: 250, stock: 100, category: "Drinks", sku: "COKE500" },
  { id: 5, name: "Headphones", price: 3000, stock: 8, category: "Accessories", sku: "HP1" },
  { id: 6, name: "Chips", price: 150, stock: 200, category: "Snacks", sku: "CHIPS" },
];

const CUSTOMERS: Customer[] = [
  {
    id: 1,
    name: "Ali Raza",
    phone: "0300-0000000",
    email: null,
    address: null,
    credit_limit: 0,
    loyalty_points: 100,
    due_balance: 0,
    is_active: true,
    created_at: "2026-01-01",
  },
];

function ctx(partial: Partial<NlContext> = {}): NlContext {
  return partial;
}

function opts(overrides: Partial<Parameters<typeof understand>[1]> = {}) {
  return {
    products: PRODUCTS,
    cart: [],
    customers: CUSTOMERS,
    ctx: ctx(),
    ...overrides,
  };
}

const addAction = (a: NlAction | null) =>
  a && a.kind === "add_to_cart" ? a : null;

describe("intent recognition · add to cart", () => {
  it.each([
    "add 3 Nokia 105",
    "add three Nokia 105",
    "put 2 coke",
    "give me a charger",
    "i need one headphones",
    "can i get 2 chargers",
    "take 2 nokia 105",
    "addd 2 coke",
    "add 3 nokia 105 please",
  ])("understands “%s” as an add", (input) => {
    const out = understand(input, opts());
    const action = addAction(out.action);
    expect(action).not.toBeNull();
    expect(action!.lines.length).toBeGreaterThan(0);
    expect(action!.partial).toBe(false);
  });

  it("picks the correct quantity ahead of a trailing model number", () => {
    const out = understand("add 3 Nokia 105", opts());
    const action = addAction(out.action);
    expect(action!.lines[0].qty).toBe(3);
    expect(action!.lines[0].product.id).toBe(1);
  });

  it("handles quantity words", () => {
    const out = understand("add two cokes", opts());
    expect(addAction(out.action)!.lines[0].qty).toBe(2);
  });

  it("adds multiple products in one request", () => {
    const out = understand("add coke and chips", opts());
    const action = addAction(out.action);
    expect(action!.lines.map((l) => l.product.name).sort()).toEqual([
      "Chips",
      "Coke 500ml",
    ]);
  });

  it("adds multiple products with quantities", () => {
    const out = understand("add 2 chargers and one nokia 105", opts());
    const action = addAction(out.action);
    expect(action!.lines).toHaveLength(2);
    expect(action!.lines[0]).toMatchObject({ qty: 2, product: { id: 3 } });
    expect(action!.lines[1]).toMatchObject({ qty: 1, product: { id: 1 } });
  });

  it("asks when the product term is ambiguous", () => {
    const out = understand("add nokia", opts());
    expect(out.action?.kind).toBe("ask_product");
    const ask = out.action as Extract<NlAction, { kind: "ask_product" }>;
    expect(ask.ask.on).toBe("add");
    expect(ask.ask.matches.length).toBeGreaterThan(1);
  });

  it("asks when nothing matches", () => {
    const out = understand("add zzqqx", opts());
    expect(out.action?.kind).toBe("ask_product");
  });
});

describe("intent recognition · cart ops", () => {
  it("removes a product from the cart", () => {
    const out = understand("remove the headphones", opts());
    expect(out.action).toMatchObject({
      kind: "remove_from_cart",
      product: { id: 5 },
    });
  });

  it("understands delete/take out as removal", () => {
    expect(understand("delete the charger", opts()).action?.kind).toBe("remove_from_cart");
    expect(understand("take out the coke", opts()).action?.kind).toBe("remove_from_cart");
  });

  it("decreases quantity by one against context", () => {
    const out = understand("remove one", opts({ ctx: ctx({ lastProductId: 4 }) }));
    expect(out.action).toMatchObject({ kind: "decrease_cart_qty", product: { id: 4 } });
  });

  it("sets quantity from context", () => {
    const out = understand("make it two", opts({ ctx: ctx({ lastProductId: 4 }) }));
    expect(out.action).toMatchObject({ kind: "set_cart_qty", qty: 2, product: { id: 4 } });
  });

  it("asks when a follow-up has no context", () => {
    const out = understand("remove one", opts());
    expect(out.action?.kind).toBe("ask");
    expect(out.confidence).toBe("low");
  });

  it("shows the cart", () => {
    for (const input of ["show cart", "what's in my cart", "whats the total"]) {
      expect(understand(input, opts()).action?.kind).toBe("show_cart");
    }
  });

  it("clears the cart", () => {
    expect(understand("clear the cart", opts()).action?.kind).toBe("clear_cart");
  });

  it("holds the invoice", () => {
    for (const input of ["hold this transaction", "park this invoice", "hold"]) {
      expect(understand(input, opts()).action?.kind).toBe("hold_invoice");
    }
  });

  it("opens held invoices", () => {
    expect(understand("open held invoices", opts()).action?.kind).toBe("open_held");
  });

  it("resumes an invoice", () => {
    expect(understand("resume the invoice", opts()).action?.kind).toBe("resume_invoice");
  });

  it("cancels the transaction", () => {
    expect(understand("cancel this transaction", opts()).action?.kind).toBe("cancel_invoice");
    expect(understand("delete the invoice", opts()).action?.kind).toBe("cancel_invoice");
  });

  it("starts a new invoice", () => {
    expect(understand("new invoice", opts()).action?.kind).toBe("new_invoice");
    expect(understand("start fresh", opts()).action?.kind).toBe("new_invoice");
  });

  it("checks out", () => {
    const out = understand("checkout", opts());
    expect(out.action).toMatchObject({ kind: "checkout" });
  });

  it("detects the payment method", () => {
    expect(understand("pay in cash", opts()).action).toMatchObject({
      kind: "checkout",
      method: "cash",
    });
    expect(understand("pay by card", opts()).action).toMatchObject({
      kind: "checkout",
      method: "card",
    });
  });
});

describe("intent recognition · invoices & history", () => {
  it("finds an invoice by number", () => {
    for (const input of ["find invoice 1025", "open invoice 1025", "show invoice #1025"]) {
      expect(understand(input, opts()).action).toMatchObject({
        kind: "find_invoice",
        invoiceNo: "1025",
      });
    }
  });

  it("finds the customer of an invoice", () => {
    expect(understand("who was the customer for invoice 1025", opts()).action).toMatchObject({
      kind: "invoice_customer",
      invoiceNo: "1025",
    });
  });

  it("lists the items of an invoice", () => {
    expect(understand("show the items on invoice 1025", opts()).action).toMatchObject({
      kind: "invoice_items",
      invoiceNo: "1025",
    });
  });

  it("prints an invoice by number", () => {
    expect(understand("print invoice 1025", opts()).action).toMatchObject({
      kind: "print_invoice",
      invoiceNo: "1025",
      last: false,
    });
  });

  it("prints the most recent invoice from context", () => {
    const out = understand("print it", opts({ ctx: ctx({ lastInvoiceNo: "77" }) }));
    expect(out.action).toMatchObject({ kind: "print_invoice", invoiceNo: "77", last: true });
  });

  it("prints the last invoice from context", () => {
    const out = understand("print the last invoice", opts({ ctx: ctx({ lastInvoiceNo: "77" }) }));
    expect(out.action).toMatchObject({ kind: "print_invoice", invoiceNo: "77" });
  });

  it("asks which invoice when there is no context", () => {
    expect(understand("print it", opts()).action?.kind).toBe("ask");
  });

  it("resolves follow-ups against context", () => {
    const base = opts({ ctx: ctx({ lastInvoiceNo: "88" }) });
    expect(understand("who was the customer", base).action).toMatchObject({
      kind: "invoice_customer",
      invoiceNo: "88",
    });
    expect(understand("show the items", base).action).toMatchObject({
      kind: "invoice_items",
      invoiceNo: "88",
    });
    expect(understand("print it", base).action).toMatchObject({
      kind: "print_invoice",
      invoiceNo: "88",
    });
  });

  it("opens the transaction history", () => {
    for (const input of ["open history", "transaction history", "show transactions", "open the history"]) {
      expect(understand(input, opts()).action?.kind).toBe("open_history");
    }
  });
});

describe("intent recognition · customers", () => {
  it("selects a customer by name", () => {
    expect(understand("select customer Ali Raza", opts()).action).toMatchObject({
      kind: "select_customer",
      customer: { id: 1 },
    });
  });

  it("selects a customer with casual phrasing", () => {
    expect(understand("set ali as customer", opts()).action).toMatchObject({
      kind: "select_customer",
    });
  });

  it("finds a customer", () => {
    expect(understand("find customer Ali", opts()).action).toMatchObject({
      kind: "find_customer",
      term: "ali",
    });
  });

  it("asks when the customer is unknown", () => {
    const out = understand("select customer Zzzz", opts());
    expect(out.action?.kind).toBe("ask");
  });

  it("asks which customer when several match", () => {
    const extra: Customer[] = [
      ...CUSTOMERS,
      {
        id: 2,
        name: "Ali Khan",
        phone: null,
        email: null,
        address: null,
        credit_limit: 0,
        loyalty_points: 0,
        due_balance: 0,
        is_active: true,
        created_at: "2026-01-01",
      },
    ];
    const out = understand("select customer Ali", opts({ customers: extra }));
    expect(out.action?.kind).toBe("ask");
  });
});

describe("intent recognition · stock", () => {
  it("reports low stock", () => {
    for (const input of ["show low stock products", "what products are low in stock"]) {
      expect(understand(input, opts()).action?.kind).toBe("stock_report");
    }
  });

  it("reports stock of a specific product", () => {
    expect(understand("how many chargers are left", opts()).action).toMatchObject({
      kind: "product_stock",
      product: { id: 3 },
    });
  });

  it("asks which product when several could match", () => {
    const out = understand("how many nokia phones are left", opts());
    expect(out.action?.kind).toBe("ask_product");
  });

  it("falls back to a stock report for generic questions", () => {
    expect(understand("how many products in stock", opts()).action?.kind).toBe("stock_report");
  });
});

describe("intent recognition · returns", () => {
  it("recognises a returned item", () => {
    const out = understand("customer returned the charger", opts());
    expect(out.action).toMatchObject({
      kind: "create_return",
      product: { id: 3 },
    });
    expect(out.confidence).toBe("medium");
  });

  it("recognises a return with quantity", () => {
    expect(understand("customer returned 2 chargers", opts()).action).toMatchObject({
      kind: "create_return",
      qty: 2,
    });
  });

  it("creates a return for an invoice", () => {
    expect(understand("return the items from invoice 1025", opts()).action).toMatchObject({
      kind: "create_return",
      invoiceNo: "1025",
    });
  });

  it("starts the return flow", () => {
    for (const input of ["start a return", "process a refund", "make a return"]) {
      expect(understand(input, opts()).action?.kind).toBe("start_return");
    }
  });
});

describe("intent recognition · sales reports", () => {
  it("shows today's sales", () => {
    for (const input of ["show today's sales", "what did we sell today", "todays sales"]) {
      expect(understand(input, opts()).action?.kind).toBe("today_sales");
    }
  });
});

describe("intent recognition · navigation", () => {
  it("navigates to a page", () => {
    expect(understand("go to products", opts()).action).toMatchObject({
      kind: "open_page",
      page: "products",
    });
    expect(understand("products", opts()).action).toMatchObject({
      kind: "open_page",
      page: "products",
    });
    expect(understand("open settings", opts()).action).toMatchObject({
      kind: "open_page",
      page: "settings",
    });
  });
});

describe("intent recognition · plain search & unknowns", () => {
  it("searches by product name", () => {
    expect(understand("find nokia 105", opts()).action).toMatchObject({
      kind: "plain_search",
      term: "nokia 105",
    });
  });

  it("keeps barcode-style input as a plain search", () => {
    expect(understand("123456789012", opts()).action).toMatchObject({
      kind: "plain_search",
      term: "123456789012",
    });
  });

  it("handles misspelled commands", () => {
    expect(understand("seach nokia", opts()).action?.kind).toBe("plain_search");
    expect(understand("addd coke", opts()).action?.kind).toBe("add_to_cart");
    expect(understand("find invice 1025", opts()).action).toMatchObject({
      kind: "find_invoice",
      invoiceNo: "1025",
    });
  });

  it("asks for empty input", () => {
    const out = understand("   ", opts());
    expect(out.action?.kind).toBe("ask");
    expect(out.confidence).toBe("low");
  });
});

describe("multi-request splitting", () => {
  it("splits add + checkout", () => {
    const out = understand("add 2 chargers and one nokia 105, then checkout", opts());
    expect(out.action?.kind).toBe("multi");
    const multi = out.action as Extract<NlAction, { kind: "multi" }>;
    expect(multi.steps).toHaveLength(2);
    expect(multi.steps[0].kind).toBe("add_to_cart");
    expect(multi.steps[1].kind).toBe("checkout");
  });

  it("keeps and-connected products in one add", () => {
    const out = understand("add coke and chips", opts());
    expect(out.action?.kind).toBe("add_to_cart");
  });

  it("splits invoice lookup + print with context flow", () => {
    const out = understand("find invoice 1025 and print it", opts());
    expect(out.action?.kind).toBe("multi");
    const multi = out.action as Extract<NlAction, { kind: "multi" }>;
    expect(multi.steps[0]).toMatchObject({ kind: "find_invoice", invoiceNo: "1025" });
    expect(multi.steps[1]).toMatchObject({ kind: "print_invoice", invoiceNo: "1025", last: true });
  });

  it("does not treat a bare product 'and' as two requests", () => {
    expect(splitRequests("add coke and chips")).toEqual(["add coke and chips"]);
    expect(splitRequests("find invoice 1025 and print it")).toEqual([
      "find invoice 1025",
      "print it",
    ]);
  });
});

describe("permissions", () => {
  it("grants cashier POS operations", () => {
    expect(can("cashier", "pos.access")).toBe(true);
    expect(can("cashier", "sales.create")).toBe(true);
  });

  it("denies returns to a cashier", () => {
    expect(can("cashier", "sales.return")).toBe(false);
    expect(permissionForAction({ kind: "create_return", invoiceNo: null, product: null, qty: 1, term: "" })).toBe("sales.return");
  });

  it("mirrors manager and admin roles", () => {
    expect(can("manager", "user.manage")).toBe(false);
    expect(can("manager", "product.manage")).toBe(true);
    expect(can("admin", "backup.manage")).toBe(true);
    expect(can("admin", "settings.manage")).toBe(true);
  });

  it("denies an unknown role", () => {
    expect(can("somerole", "pos.access")).toBe(false);
    expect(can(null, "pos.access")).toBe(false);
  });
});
