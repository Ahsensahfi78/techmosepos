import { describe, expect, it } from "vitest";
import {
  parseVoiceCommand,
  stripWakePhrase,
} from "@/lib/voiceCommands";

describe("stripWakePhrase", () => {
  it("removes a leading wake phrase", () => {
    expect(stripWakePhrase("Hey POS clear the cart")).toBe("clear the cart");
    expect(stripWakePhrase("pos add 3 pepsi")).toBe("add 3 pepsi");
    expect(stripWakePhrase("Assistant, show cart")).toBe("show cart");
  });

  it("leaves ordinary speech untouched", () => {
    expect(stripWakePhrase("add 2 cola")).toBe("add 2 cola");
    expect(stripWakePhrase("position the box")).toBe("position the box");
  });

  it("removes a wake phrase followed by punctuation", () => {
    expect(stripWakePhrase("Hey POS, clear the cart")).toBe("clear the cart");
    expect(stripWakePhrase("ok pos: add 3 pepsi")).toBe("add 3 pepsi");
  });

  it("returns empty when only the wake phrase was said", () => {
    expect(stripWakePhrase("hey pos")).toBe("");
    expect(stripWakePhrase("assistant")).toBe("");
  });
});

describe("parseVoiceCommand · products", () => {
  it("parses quantity + term from an add command", () => {
    expect(parseVoiceCommand("add 100 coca cola")).toMatchObject({
      kind: "add_product",
      term: "coca cola",
      qty: 100,
    });
  });

  it("keeps the current behavior for bare product phrases", () => {
    expect(parseVoiceCommand("coca cola")).toMatchObject({
      kind: "add_product",
      term: "coca cola",
      qty: 1,
    });
    expect(parseVoiceCommand("two coca cola")).toMatchObject({
      kind: "add_product",
      term: "coca cola",
      qty: 2,
    });
  });

  it("parses sku / barcode phrases", () => {
    expect(parseVoiceCommand("barcode 8901234567890")).toMatchObject({
      kind: "add_product",
      term: "8901234567890",
    });
    expect(parseVoiceCommand("sku 12345")).toMatchObject({
      kind: "add_product",
      term: "12345",
    });
  });

  it("turns unit-only adds into a quantity increase", () => {
    expect(parseVoiceCommand("add 20 bottles")).toMatchObject({
      kind: "quantity_increase",
      qty: 20,
    });
    expect(parseVoiceCommand("add five bottles")).toMatchObject({
      kind: "quantity_increase",
      qty: 5,
    });
  });

  it("turns 'add N more' into a quantity increase of the last item", () => {
    expect(parseVoiceCommand("add 5 more")).toMatchObject({
      kind: "quantity_increase",
      qty: 5,
    });
    expect(parseVoiceCommand("add 5 more of milk")).toMatchObject({
      kind: "quantity_increase",
      product: "milk",
      qty: 5,
    });
  });

  it("parses search commands", () => {
    expect(parseVoiceCommand("search milk")).toMatchObject({
      kind: "search_product",
      term: "milk",
    });
  });

  it("parses remove commands", () => {
    expect(parseVoiceCommand("remove coca cola")).toMatchObject({
      kind: "remove_product",
      term: "coca cola",
    });
    expect(parseVoiceCommand("remove this item")).toMatchObject({
      kind: "remove_product",
      term: "",
    });
  });
});

describe("parseVoiceCommand · cart & invoice", () => {
  it("parses cart actions", () => {
    expect(parseVoiceCommand("show cart")).toEqual({ kind: "show_cart" });
    expect(parseVoiceCommand("clear the cart")).toEqual({ kind: "clear_cart" });
    expect(parseVoiceCommand("set quantity to 10")).toEqual({
      kind: "set_quantity",
      qty: 10,
    });
    expect(parseVoiceCommand("20 percent discount")).toEqual({
      kind: "set_discount_percent",
      percent: 20,
    });
  });

  it("does NOT clear the cart from unrelated speech that only contains the words", () => {
    expect(parseVoiceCommand("maybe clear the cart")).not.toEqual({
      kind: "clear_cart",
    });
  });

  it("parses invoice actions", () => {
    expect(parseVoiceCommand("hold invoice")).toEqual({ kind: "hold_invoice" });
    expect(parseVoiceCommand("open held invoices")).toEqual({
      kind: "open_held_invoices",
    });
    expect(parseVoiceCommand("resume invoice")).toEqual({
      kind: "resume_invoice",
    });
    expect(parseVoiceCommand("cancel invoice")).toEqual({
      kind: "cancel_invoice",
    });
    expect(parseVoiceCommand("new invoice")).toEqual({
      kind: "new_invoice",
    });
  });

  it("parses quantity adjust commands", () => {
    expect(parseVoiceCommand("increase quantity")).toEqual({
      kind: "quantity_increase",
      qty: 1,
    });
    expect(parseVoiceCommand("increase quantity of milk")).toEqual({
      kind: "quantity_increase",
      product: "milk",
      qty: 1,
    });
    expect(parseVoiceCommand("decrease quantity")).toEqual({
      kind: "quantity_decrease",
      qty: 1,
    });
  });
});

describe("parseVoiceCommand · payment & navigation", () => {
  it("parses payment commands", () => {
    expect(parseVoiceCommand("checkout")).toEqual({
      kind: "checkout",
      method: "cash",
    });
    expect(parseVoiceCommand("pay card")).toEqual({
      kind: "checkout",
      method: "card",
    });
    expect(parseVoiceCommand("pay 5000")).toEqual({
      kind: "checkout",
      method: "cash",
    });
    expect(parseVoiceCommand("complete the sale")).toEqual({
      kind: "checkout",
      method: "cash",
    });
  });

  it("parses history and return navigation", () => {
    expect(parseVoiceCommand("open history")).toEqual({ kind: "open_history" });
    expect(parseVoiceCommand("transaction history")).toEqual({
      kind: "open_history",
    });
    expect(parseVoiceCommand("start sales return")).toEqual({
      kind: "start_return",
    });
  });

  it("parses page navigation and lookups", () => {
    expect(parseVoiceCommand("open customers")).toEqual({
      kind: "open_page",
      page: "customers",
    });
    expect(parseVoiceCommand("find invoice 12345")).toEqual({
      kind: "find_invoice",
      term: "12345",
    });
    expect(parseVoiceCommand("find customer john")).toEqual({
      kind: "find_customer",
      term: "john",
    });
  });
});

describe("parseVoiceCommand · confirmations", () => {
  it("parses yes / no replies", () => {
    expect(parseVoiceCommand("yes")).toEqual({ kind: "confirm_yes" });
    expect(parseVoiceCommand("no")).toEqual({ kind: "confirm_no" });
    expect(parseVoiceCommand("hey pos yes")).toEqual({ kind: "confirm_yes" });
  });

  it("recognizes the same command with a wake phrase prefix", () => {
    expect(parseVoiceCommand("hey pos add 2 cola")).toMatchObject({
      kind: "add_product",
      term: "cola",
      qty: 2,
    });
    expect(parseVoiceCommand("ok pos, hold the invoice")).toEqual({
      kind: "hold_invoice",
    });
    expect(parseVoiceCommand("hey pos, show cart")).toEqual({
      kind: "show_cart",
    });
  });

  it("returns unknown for a bare wake phrase with no command", () => {
    expect(parseVoiceCommand("hey pos")).toEqual({ kind: "unknown", text: "hey pos" });
  });
});
