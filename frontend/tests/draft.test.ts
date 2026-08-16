import { beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_KEY,
  clearDraft,
  isNewer,
  loadDraft,
  saveDraft,
  type DraftOrder,
} from "@/lib/draft";

const base = {
  lines: [
    {
      product_id: 1,
      name: "Charger",
      price: 1800,
      qty: 2,
      sku: "CHG-100",
      barcode: null,
    },
  ],
  discount: 0,
  tax: 0,
  customerId: null,
  customerName: null,
  pointsUsed: 0,
  method: "cash",
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("saveDraft / loadDraft", () => {
  it("persists the draft and stamps a savedAt timestamp", () => {
    const entry = saveDraft(base);
    expect(entry.savedAt).toBeGreaterThan(0);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeTruthy();
    const loaded = loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.lines[0].product_id).toBe(1);
    expect(loaded?.method).toBe("cash");
  });

  it("returns null when nothing is stored", () => {
    expect(loadDraft()).toBeNull();
  });

  it("returns null when the stored value is corrupted", () => {
    window.localStorage.setItem(DRAFT_KEY, "not json");
    expect(loadDraft()).toBeNull();
  });

  it("returns null when the stored value has no lines array", () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 1 }));
    expect(loadDraft()).toBeNull();
  });
});

describe("clearDraft", () => {
  it("removes the draft from storage", () => {
    saveDraft(base);
    clearDraft();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(loadDraft()).toBeNull();
  });
});

describe("isNewer", () => {
  it("treats a draft as new when nothing exists", () => {
    expect(isNewer(saveDraft(base), null)).toBe(true);
  });

  it("compares savedAt timestamps", () => {
    const old: DraftOrder = { ...base, savedAt: 100 };
    const fresh: DraftOrder = { ...base, savedAt: 200 };
    expect(isNewer(fresh, old)).toBe(true);
    expect(isNewer(old, fresh)).toBe(false);
  });

  it("does not let an equal timestamp clobber a fresher draft", () => {
    const a: DraftOrder = { ...base, savedAt: 150 };
    const b: DraftOrder = { ...base, savedAt: 150 };
    expect(isNewer(b, a)).toBe(true);
  });
});
