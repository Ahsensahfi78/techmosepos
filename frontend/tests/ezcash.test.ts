import { describe, expect, it } from "vitest";
import { validatePhone } from "@/lib/ezcash";

describe("validatePhone", () => {
  it("accepts 07XXXXXXXX format", () => {
    const r = validatePhone("0771234567");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("+94771234567");
  });

  it("accepts +947XXXXXXXX format", () => {
    const r = validatePhone("+94771234567");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("+94771234567");
  });

  it("accepts 947XXXXXXXX format (no plus)", () => {
    const r = validatePhone("94771234567");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("+94771234567");
  });

  it("accepts 7XXXXXXXX format (9 digits)", () => {
    const r = validatePhone("771234567");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("+94771234567");
  });

  it("strips spaces and dashes", () => {
    const r = validatePhone("077-123 4567");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("+94771234567");
  });

  it("rejects too short input", () => {
    const r = validatePhone("077");
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("rejects landline starting with 01", () => {
    const r = validatePhone("0112345678");
    expect(r.valid).toBe(false);
  });

  it("rejects empty input", () => {
    const r = validatePhone("");
    expect(r.valid).toBe(false);
  });

  it("rejects alphabetic input", () => {
    const r = validatePhone("abcdefghij");
    expect(r.valid).toBe(false);
  });

  it("normalizes various valid inputs to the same number", () => {
    const inputs = ["0771234567", "+94771234567", "94771234567", "771234567"];
    for (const input of inputs) {
      const r = validatePhone(input);
      expect(r.valid).toBe(true);
      expect(r.normalized).toBe("+94771234567");
    }
  });
});
