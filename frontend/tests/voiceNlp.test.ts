import { describe, expect, it } from "vitest";
import { understand } from "@/lib/nlp";
import { permissionForAction } from "@/lib/nlp/permissions";
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

function opts(ctx: Partial<NlContext> = {}) {
  return { products: PRODUCTS, cart: [], customers: CUSTOMERS, ctx };
}

/**
 * The mic button feeds raw speech transcripts straight into `understand()`.
 * These tests lock in the natural (unprompted) phrasings a cashier is likely
 * to say — no wake word, no command list.
 */
describe("spoken commands through the NL pipeline", () => {
  it.each([
    ["add two chargers", 3, 2],
    ["put three Nokia 105 in the cart", 1, 3],
    ["i need three chargers", 3, 3],
    ["give me two cokes", 4, 2],
  ])("understands “%s” as an add", (input, productId, qty) => {
    const action = understand(input, opts()).action;
    expect(action?.kind).toBe("add_to_cart");
    if (action?.kind === "add_to_cart") {
      expect(action.partial).toBe(false);
      expect(action.lines).toHaveLength(1);
      expect(action.lines[0]).toMatchObject({
        qty,
        product: { id: productId },
      });
    }
  });

  it("resolves context follow-ups without repeating the product", () => {
    const base = opts({ lastProductId: 3, lastProductName: "Charger USB-C" });
    expect(understand("remove one", base).action).toMatchObject({
      kind: "decrease_cart_qty",
      product: { id: 3 },
    });
    expect(understand("make it three", base).action).toMatchObject({
      kind: "set_cart_qty",
      product: { id: 3 },
      qty: 3,
    });
    expect(understand("add one more", base).action).toMatchObject({
      kind: "add_to_cart",
      lines: [{ product: { id: 3 }, qty: 1 }],
    });
  });

  it("handles cart and checkout operations", () => {
    expect(understand("clear the cart", opts()).action?.kind).toBe("clear_cart");
    expect(understand("hold this order", opts()).action?.kind).toBe("hold_invoice");
    expect(understand("show the cart", opts()).action?.kind).toBe("show_cart");
    expect(understand("checkout", opts()).action?.kind).toBe("checkout");
  });

  it("looks up invoices by number", () => {
    expect(understand("show invoice 1025", opts()).action).toMatchObject({
      kind: "find_invoice",
      invoiceNo: "1025",
    });
  });

  it("uses conversation memory for 'print it'", () => {
    const out = understand("print it", opts({ lastInvoiceNo: "1025" }));
    expect(out.action).toMatchObject({
      kind: "print_invoice",
      invoiceNo: "1025",
      last: true,
    });
  });

  it("reports today's sales and stock", () => {
    expect(understand("show today's sales", opts()).action?.kind).toBe("today_sales");
    expect(understand("how many chargers are in stock", opts()).action).toMatchObject({
      kind: "product_stock",
      product: { id: 3 },
    });
  });

  it("navigates by voice", () => {
    expect(understand("open returns", opts()).action).toMatchObject({
      kind: "open_page",
      page: "returns",
    });
    expect(understand("show my transaction history", opts()).action?.kind).toBe(
      "open_history"
    );
  });

  it("finds and selects customers", () => {
    expect(understand("find customer ali raza", opts()).action).toMatchObject({
      kind: "find_customer",
      term: "ali raza",
    });
    expect(understand("select customer Ali Raza", opts()).action).toMatchObject({
      kind: "select_customer",
      customer: { id: 1 },
    });
  });

  it("creates a return, with or without an invoice number", () => {
    expect(
      understand("process the return for invoice 1025", opts()).action
    ).toMatchObject({ kind: "create_return", invoiceNo: "1025" });
    expect(understand("customer returned 2 chargers", opts()).action).toMatchObject({
      kind: "create_return",
      product: { id: 3 },
      qty: 2,
    });
  });

  it("never crashes on speech artifacts and degrades to a plain search", () => {
    for (const input of ["um", "uh hmm", "mm"]) {
      const out = understand(input, opts());
      expect(out.action).not.toBeNull();
      expect(out.confidence).toBe("low");
      expect(out.action?.kind).toBe("plain_search");
    }
  });

  it("maps every spoken action to a permission so the POS gate can apply", () => {
    const inputs = [
      "add two chargers",
      "clear the cart",
      "hold this order",
      "checkout",
      "show invoice 1025",
      "print it",
      "show today's sales",
      "how many chargers are in stock",
      "open returns",
      "process the return for invoice 1025",
      "find customer ali raza",
    ];
    const base = opts({ lastInvoiceNo: "1025", lastProductId: 3 });
    for (const input of inputs) {
      const out = understand(input, base);
      expect(out.action).not.toBeNull();
      const perm = permissionForAction(out.action as NlAction);
      expect(perm.length).toBeGreaterThan(0);
    }
  });
});

describe("bare product names over voice add to the cart", () => {
  it("a bare name degrades to plain_search (what the voice boundary sees)", () => {
    const out = understand("chargers", opts());
    expect(out.action).toMatchObject({ kind: "plain_search", term: "chargers" });
  });

  it("re-riding the bare name as an add resolves to the product (page fallback)", () => {
    const out = understand("chargers", opts());
    if (out.action?.kind !== "plain_search") {
      throw new Error("expected plain_search");
    }
    const add = understand(`add ${out.action.term}`, opts());
    expect(add.action).toMatchObject({
      kind: "add_to_cart",
      lines: [{ qty: 1, product: { id: 3 } }],
    });
  });

  it("keeps explicit search verbs as a plain search", () => {
    expect(understand("search milk", opts()).action?.kind).toBe("plain_search");
    expect(understand("show chargers", opts()).action?.kind).toBe("plain_search");
  });

  it("already-adds phrases with a verb and quantity straight through", () => {
    expect(understand("add two chargers", opts()).action?.kind).toBe("add_to_cart");
    expect(understand("two cokes", opts()).action?.kind).toBe("add_to_cart");
  });
});
