import { describe, it, expect } from "vitest";
import type { Customer } from "../lib/types";
import {
  addPrefill,
  customerCode,
  duplicateByPhone,
  filterCustomers,
  isAllDigits,
  normalizePhone,
  phoneError,
  samePhone,
  validateCustomerForm,
} from "../lib/customerSearch";

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: "Nimal Perera",
    phone: "+94 77 123 4567",
    email: null,
    address: null,
    credit_limit: 0,
    loyalty_points: 0,
    due_balance: 0,
    is_active: true,
    created_at: "2026-01-01T00:00:00",
    ...over,
  };
}

const LIST = [
  customer({ id: 1, name: "Nimal Perera", phone: "+94 77 123 4567" }),
  customer({ id: 2, name: "sahfi ahamed", phone: "0771234999", due_balance: 8500 }),
  customer({ id: 3, name: "Kumar", phone: null, email: "kumar@example.com" }),
];

describe("normalizePhone", () => {
  it("strips every non-digit", () => {
    expect(normalizePhone("+94 77 123 4567")).toBe("94771234567");
    expect(normalizePhone("(077) 123-4567")).toBe("0771234567");
  });

  it("treats null / undefined / empty as no digits", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("isAllDigits", () => {
  it("accepts pure digit strings only", () => {
    expect(isAllDigits("0771234567")).toBe(true);
    expect(isAllDigits(" 0771234567 ")).toBe(true);
    expect(isAllDigits("0771 234")).toBe(false);
    expect(isAllDigits("nimal")).toBe(false);
    expect(isAllDigits("")).toBe(false);
  });
});

describe("customerCode", () => {
  it("uses the primary key as the searchable code", () => {
    expect(customerCode(customer({ id: 42 }))).toBe("#42");
  });
});

describe("samePhone / duplicateByPhone", () => {
  it("matches numbers that differ only in formatting", () => {
    expect(samePhone("077 123 4567", "0771234567")).toBe(true);
    expect(samePhone("+94771234567", "94 77 123 4567")).toBe(true);
  });

  it("never matches short or missing numbers", () => {
    expect(samePhone("1234", "1234")).toBe(false);
    expect(samePhone("", "")).toBe(false);
    expect(samePhone(null, null)).toBe(false);
  });

  it("does not match genuinely different customers", () => {
    expect(samePhone("0771234567", "0771234999")).toBe(false);
  });

  it("finds the owning customer in a list", () => {
    expect(duplicateByPhone(LIST, "077 123 4999")?.name).toBe("sahfi ahamed");
    expect(duplicateByPhone(LIST, "0000000")).toBeUndefined();
    expect(duplicateByPhone(LIST, "123")).toBeUndefined();
    expect(duplicateByPhone(LIST, "")).toBeUndefined();
  });

  it("ignores customers without a phone", () => {
    expect(duplicateByPhone([customer({ id: 9, phone: null })], "0771234567")).toBeUndefined();
  });
});

describe("filterCustomers", () => {
  it("returns everything for an empty query", () => {
    expect(filterCustomers(LIST, "")).toHaveLength(3);
    expect(filterCustomers(LIST, "   ")).toHaveLength(3);
  });

  it("matches on name, ignoring case", () => {
    expect(filterCustomers(LIST, "NIMAL").map((c) => c.id)).toEqual([1]);
    expect(filterCustomers(LIST, "perera").map((c) => c.id)).toEqual([1]);
    expect(filterCustomers(LIST, "sahfi").map((c) => c.id)).toEqual([2]);
  });

  it("matches on phone digits regardless of formatting", () => {
    expect(filterCustomers(LIST, "9477123").map((c) => c.id)).toEqual([1]);
    expect(filterCustomers(LIST, "4999").map((c) => c.id)).toEqual([2]);
  });

  it("matches on the #code reference", () => {
    expect(filterCustomers(LIST, "#2").map((c) => c.id)).toEqual([2]);
    expect(filterCustomers(LIST, "#99")).toEqual([]);
  });

  it("matches on email", () => {
    expect(filterCustomers(LIST, "kumar@").map((c) => c.id)).toEqual([3]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterCustomers(LIST, "zzz-no-such-person")).toEqual([]);
  });
});

describe("addPrefill", () => {
  it("puts digit queries into the phone field", () => {
    expect(addPrefill("0771234567")).toEqual({ name: "", phone: "0771234567" });
  });

  it("puts text queries into the name field", () => {
    expect(addPrefill("Nimal Perera")).toEqual({
      name: "Nimal Perera",
      phone: "",
    });
  });

  it("is empty for blank input", () => {
    expect(addPrefill("   ")).toEqual({ name: "", phone: "" });
  });
});

describe("phoneError", () => {
  it("requires a value", () => {
    expect(phoneError("")).toMatch(/required/i);
    expect(phoneError("   ")).toMatch(/required/i);
  });

  it("rejects too few digits", () => {
    expect(phoneError("1234")).toMatch(/at least 7/i);
  });

  it("rejects letters and other junk", () => {
    expect(phoneError("call me")).toMatch(/digits/i);
    expect(phoneError("077abc4567")).toMatch(/digits/i);
  });

  it("rejects too many digits", () => {
    expect(phoneError("1234567890123456")).toMatch(/at most 15/i);
  });

  it("accepts normal local and international numbers", () => {
    expect(phoneError("0771234567")).toBeNull();
    expect(phoneError("+94 77 123 4567")).toBeNull();
    expect(phoneError("(0771) 234-567")).toBeNull();
  });
});

describe("validateCustomerForm", () => {
  it("requires a name", () => {
    expect(validateCustomerForm({ name: "  ", phone: "0771234567", email: "" })).toEqual({
      name: "Name is required",
    });
  });

  it("surfaces both name and phone problems", () => {
    const errors = validateCustomerForm({ name: "", phone: "", email: "" });
    expect(Object.keys(errors).sort()).toEqual(["name", "phone"]);
  });

  it("validates an optional email only when supplied", () => {
    expect(
      validateCustomerForm({ name: "Nimal", phone: "0771234567", email: "" })
    ).toEqual({});
    expect(
      validateCustomerForm({
        name: "Nimal",
        phone: "0771234567",
        email: "nimal@example.com",
      })
    ).toEqual({});
    expect(
      validateCustomerForm({ name: "Nimal", phone: "0771234567", email: "nope" })
    ).toEqual({ email: "Enter a valid email address" });
  });

  it("passes a fully valid form", () => {
    expect(
      validateCustomerForm({
        name: "Kumar",
        phone: "+94 77 123 4567",
        email: "kumar@example.com",
      })
    ).toEqual({});
  });
});
