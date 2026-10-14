import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPrinterLanguage,
  isWebUsbSupported,
  loadPrinterLanguage,
  savePrinterLanguage,
  tsplToBytes,
} from "@/lib/tsplPrinter";

describe("printer language setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the browser print dialog", () => {
    expect(loadPrinterLanguage()).toBe("browser");
  });

  it("round-trips a saved choice", () => {
    savePrinterLanguage("tspl");
    expect(window.localStorage.getItem("pos_printer_language")).toBe("tspl");
    expect(loadPrinterLanguage()).toBe("tspl");
  });

  it("ignores an unknown stored value", () => {
    window.localStorage.setItem("pos_printer_language", "pcl");
    expect(loadPrinterLanguage()).toBe("browser");
  });

  it("only accepts the two supported languages", () => {
    expect(isPrinterLanguage("tspl")).toBe(true);
    expect(isPrinterLanguage("browser")).toBe(true);
    expect(isPrinterLanguage("pcl")).toBe(false);
    expect(isPrinterLanguage(null)).toBe(false);
  });

  it("survives storage being unavailable", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(loadPrinterLanguage()).toBe("browser");
    spy.mockRestore();
  });
});

describe("tsplToBytes", () => {
  it("emits single-byte ASCII for a plain job", () => {
    expect(Array.from(tsplToBytes("SIZE 38 mm"))).toEqual(
      Array.from("SIZE 38 mm").map((c) => c.charCodeAt(0)),
    );
  });

  it("keeps CR/LF so the printer sees separate commands", () => {
    const bytes = tsplToBytes("CLS\r\nPRINT 1\r\n");
    expect(bytes).toContain(13);
    expect(bytes).toContain(10);
  });

  it("falls back to a space for characters the built-in fonts lack", () => {
    // 0x2603 snowman and a CJK glyph are not in TSPL's ASCII fonts.
    const bytes = tsplToBytes("A☃B漢C");
    expect(bytes.length).toBe(5);
    expect(bytes[0]).toBe(0x41);
    expect(bytes[1]).toBe(0x20);
    expect(bytes[4]).toBe(0x43);
  });

  it("reports WebUSB support without throwing", () => {
    expect(typeof isWebUsbSupported()).toBe("boolean");
  });
});
