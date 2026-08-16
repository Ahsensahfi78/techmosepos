import { beforeEach, describe, expect, it } from "vitest";
import {
  addParked,
  createParkedOrder,
  nextHoldNumber,
  removeParked,
  restoreParked,
  updateParkedNote,
} from "@/lib/park";

const line = {
  product_id: 1,
  name: "iPhone 15",
  price: 350000,
  qty: 2,
  imeis: ["123", "456"],
};

const minimal = () => ({
  lines: [line],
  discount: 0,
  tax: 0,
  customerId: null,
  customerName: null,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("nextHoldNumber", () => {
  it("starts at H-0001 and increments sequentially", () => {
    expect(nextHoldNumber()).toBe("H-0001");
    expect(nextHoldNumber()).toBe("H-0002");
    expect(nextHoldNumber()).toBe("H-0003");
  });

  it("keeps a fresh counter after storage is cleared", () => {
    nextHoldNumber();
    window.localStorage.clear();
    expect(nextHoldNumber()).toBe("H-0001");
  });
});

describe("createParkedOrder", () => {
  it("generates an id, timestamp and a default label", () => {
    const order = createParkedOrder({
      ...minimal(),
      customerId: 3,
      customerName: "John",
    });
    expect(order.id).toBeTruthy();
    expect(order.createdAt).toBeGreaterThan(0);
    expect(order.label).toContain("Order");
    expect(order.lines).toHaveLength(1);
    expect(order.customerId).toBe(3);
  });

  it("uses a custom label when provided", () => {
    const order = createParkedOrder({
      ...minimal(),
      label: "Hold for repair pickup",
    });
    expect(order.label).toBe("Hold for repair pickup");
  });

  it("stores the cashier name and note", () => {
    const order = createParkedOrder({
      ...minimal(),
      cashier: "Priya",
      note: "Customer will collect on Friday",
    });
    expect(order.cashier).toBe("Priya");
    expect(order.note).toBe("Customer will collect on Friday");
  });

  it("assigns a sequential hold number when none is provided", () => {
    const a = createParkedOrder(minimal());
    const b = createParkedOrder(minimal());
    expect(a.holdNumber).toBe("H-0001");
    expect(b.holdNumber).toBe("H-0002");
  });

  it("keeps an explicitly provided hold number", () => {
    const order = createParkedOrder({ ...minimal(), holdNumber: "H-0100" });
    expect(order.holdNumber).toBe("H-0100");
  });
});

describe("addParked / removeParked", () => {
  it("prepends new orders", () => {
    const a = createParkedOrder(minimal());
    const b = createParkedOrder(minimal());
    const orders = addParked([a], b);
    expect(orders[0].id).toBe(b.id);
  });

  it("removes an order by id without touching the rest", () => {
    const a = createParkedOrder(minimal());
    const b = createParkedOrder(minimal());
    const orders = removeParked([a, b], a.id);
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(b.id);
  });
});

describe("updateParkedNote", () => {
  it("updates the note on the matching order", () => {
    const a = createParkedOrder(minimal());
    const b = createParkedOrder(minimal());
    const orders = updateParkedNote([a, b], a.id, "Needs delivery");
    expect(orders[0].note).toBe("Needs delivery");
    expect(orders[1].note).toBeNull();
  });

  it("clears the note when given an empty string", () => {
    const a = createParkedOrder({ ...minimal(), note: "old note" });
    const orders = updateParkedNote([a], a.id, "");
    expect(orders[0].note).toBeNull();
  });

  it("does not touch other orders", () => {
    const a = createParkedOrder(minimal());
    const b = createParkedOrder({ ...minimal(), note: "keep me" });
    updateParkedNote([a, b], a.id, "changed");
    expect(b.note).toBe("keep me");
  });
});

describe("restoreParked", () => {
  it("returns the cart fields needed to resume a sale", () => {
    const order = createParkedOrder({
      lines: [line],
      discount: 10,
      tax: 5,
      customerId: 7,
      customerName: "Jane",
    });
    const restored = restoreParked(order);
    expect(restored.lines[0].qty).toBe(2);
    expect(restored.discount).toBe(10);
    expect(restored.tax).toBe(5);
    expect(restored.customerId).toBe(7);
    expect(restored.customerName).toBe("Jane");
  });
});
