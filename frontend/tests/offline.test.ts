import { beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_KEY,
  QUEUE_KEY,
  clearQueue,
  enqueueSale,
  loadCatalog,
  loadQueue,
  removeQueued,
  saveCatalog,
} from "@/lib/offline";

beforeEach(() => {
  window.localStorage.clear();
});

describe("offline catalog", () => {
  it("persists and reloads a product snapshot", () => {
    const products = [
      { id: 1, name: "Charger", price: 1800, stock: 5 } as never,
    ];
    saveCatalog(products);
    expect(window.localStorage.getItem(CATALOG_KEY)).toBeTruthy();
    expect(loadCatalog()).toHaveLength(1);
  });

  it("returns null when no catalog is stored", () => {
    expect(loadCatalog()).toBeNull();
  });
});

describe("offline queue", () => {
  const input = {
    items: [{ product_id: 1, qty: 1 }],
    customer_id: null,
    paid_amount: 100,
    payment_method: "cash",
  };

  it("enqueues a sale and reloads it", () => {
    const entry = enqueueSale(input);
    expect(entry.id).toBeTruthy();
    const queue = loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].input.items[0].product_id).toBe(1);
  });

  it("keeps FIFO ordering", () => {
    enqueueSale({ ...input, paid_amount: 1 });
    enqueueSale({ ...input, paid_amount: 2 });
    const queue = loadQueue();
    expect(queue.map((q) => q.input.paid_amount)).toEqual([1, 2]);
  });

  it("removes only the requested queued sales", () => {
    const first = enqueueSale({ ...input, paid_amount: 1 });
    enqueueSale({ ...input, paid_amount: 2 });
    removeQueued([first.id]);
    const queue = loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].input.paid_amount).toBe(2);
  });

  it("clears the queue", () => {
    enqueueSale(input);
    clearQueue();
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(loadQueue()).toHaveLength(0);
  });
});
