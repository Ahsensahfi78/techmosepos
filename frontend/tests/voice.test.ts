import { describe, expect, it } from "vitest";
import { parseTranscript, type VoiceCommand } from "@/lib/voice";

describe("parseTranscript", () => {
  it("returns the plain term with qty 1 for a bare product name", () => {
    const c: VoiceCommand = parseTranscript("coca cola");
    expect(c.qty).toBe(1);
    expect(c.term).toBe("coca cola");
    expect(c.codeType).toBeNull();
  });

  it("parses a leading quantity word", () => {
    const c = parseTranscript("two coca cola");
    expect(c.qty).toBe(2);
    expect(c.term).toBe("coca cola");
  });

  it("parses a leading numeric quantity", () => {
    const c = parseTranscript("3 charger");
    expect(c.qty).toBe(3);
    expect(c.term).toBe("charger");
  });

  it("parses a trailing numeric quantity", () => {
    const c = parseTranscript("charger 5");
    expect(c.qty).toBe(5);
    expect(c.term).toBe("charger");
  });

  it("parses a trailing quantity word", () => {
    const c = parseTranscript("milk two");
    expect(c.qty).toBe(2);
    expect(c.term).toBe("milk");
  });

  it("strips a lead word like 'search'", () => {
    const c = parseTranscript("search milk");
    expect(c.qty).toBe(1);
    expect(c.term).toBe("milk");
  });

  it("strips 'add' and keeps the quantity phrase", () => {
    const c = parseTranscript("add five bottles");
    expect(c.qty).toBe(5);
    expect(c.term).toBe("bottles");
  });

  it("recognises an explicit SKU prefix", () => {
    const c = parseTranscript("SKU 12345");
    expect(c.codeType).toBe("sku");
    expect(c.term).toBe("12345");
    expect(c.qty).toBe(1);
  });

  it("recognises an explicit barcode prefix", () => {
    const c = parseTranscript("barcode 8901234567890");
    expect(c.codeType).toBe("barcode");
    expect(c.term).toBe("8901234567890");
  });

  it("handles uppercase quantity words", () => {
    const c = parseTranscript("TWO coca cola");
    expect(c.qty).toBe(2);
    expect(c.term).toBe("coca cola");
  });

  it("keeps the trailing punctuation out of the term", () => {
    const c = parseTranscript("coca cola.");
    expect(c.term).toBe("coca cola");
  });

  it("supports more number words", () => {
    expect(parseTranscript("dozen eggs").qty).toBe(1); // 'dozen' is not a known word
    expect(parseTranscript("ten nails").qty).toBe(10);
    expect(parseTranscript("twenty cups").qty).toBe(20);
  });
});
