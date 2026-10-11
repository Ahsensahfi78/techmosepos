import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseLabelSize,
  loadLabelSize,
  saveLabelSize,
  buildLabelDocument,
  DEFAULT_LABEL_SIZE,
  LABEL_SIZE_MIN_MM,
  LABEL_SIZE_MAX_MM,
} from "@/lib/labelPrint";
import type { LabelSize } from "@/lib/labelPrint";

const SIZE: LabelSize = { widthMm: 50, heightMm: 30 };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("parseLabelSize", () => {
  it("accepts the common label size spellings", () => {
    expect(parseLabelSize("50x30mm")).toEqual({ widthMm: 50, heightMm: 30 });
    expect(parseLabelSize("50 x 30")).toEqual({ widthMm: 50, heightMm: 30 });
    expect(parseLabelSize("50mmx30mm")).toEqual({ widthMm: 50, heightMm: 30 });
    expect(parseLabelSize("50X30")).toEqual({ widthMm: 50, heightMm: 30 });
    expect(parseLabelSize("127x76")).toEqual({ widthMm: 127, heightMm: 76 });
  });

  it("accepts the multiplication sign", () => {
    expect(parseLabelSize("50×30")).toEqual({ widthMm: 50, heightMm: 30 });
  });

  it("converts inch and centimetre sizes to mm", () => {
    expect(parseLabelSize("2x1in")).toEqual({ widthMm: 50.8, heightMm: 25.4 });
    expect(parseLabelSize('2x1"')).toEqual({ widthMm: 50.8, heightMm: 25.4 });
    expect(parseLabelSize("3x4cm")).toEqual({ widthMm: 30, heightMm: 40 });
    expect(parseLabelSize("2inchx1inch")).toEqual({
      widthMm: 50.8,
      heightMm: 25.4,
    });
  });

  it("handles decimals", () => {
    expect(parseLabelSize("63.5x38.1")).toEqual({
      widthMm: 63.5,
      heightMm: 38.1,
    });
  });

  it("rejects sizes that are not usable label stock", () => {
    expect(parseLabelSize("")).toBeNull();
    expect(parseLabelSize("   ")).toBeNull();
    expect(parseLabelSize("abc")).toBeNull();
    expect(parseLabelSize("50")).toBeNull();
    expect(parseLabelSize("x30")).toBeNull();
    expect(parseLabelSize("50x")).toBeNull();
    expect(parseLabelSize("0x0")).toBeNull();
    expect(parseLabelSize("-5x10")).toBeNull();
    expect(parseLabelSize("1000x1000")).toBeNull();
    expect(parseLabelSize("9x9")).toBeNull();
    expect(parseLabelSize("50x3000")).toBeNull();
    expect(parseLabelSize("50 30")).toBeNull();
    expect(parseLabelSize("50;30")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(parseLabelSize(null)).toBeNull();
    expect(parseLabelSize(undefined)).toBeNull();
    expect(parseLabelSize(42)).toBeNull();
    expect(parseLabelSize({ widthMm: 50, heightMm: 30 })).toBeNull();
  });

  it("keeps the accepted range explicit", () => {
    expect(LABEL_SIZE_MIN_MM).toBe(10);
    expect(LABEL_SIZE_MAX_MM).toBe(300);
    expect(parseLabelSize(`${LABEL_SIZE_MIN_MM}x${LABEL_SIZE_MIN_MM}`)).toEqual({
      widthMm: 10,
      heightMm: 10,
    });
    expect(parseLabelSize(`${LABEL_SIZE_MAX_MM}x${LABEL_SIZE_MAX_MM}`)).toEqual({
      widthMm: 300,
      heightMm: 300,
    });
  });
});

describe("saveLabelSize / loadLabelSize", () => {
  it("round-trips through localStorage", () => {
    saveLabelSize({ widthMm: 63, heightMm: 38 });
    expect(loadLabelSize()).toEqual({ widthMm: 63, heightMm: 38 });
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });
    expect(DEFAULT_LABEL_SIZE).toEqual({ widthMm: 50, heightMm: 30 });
  });

  it("accepts a plain '50x30' string already in storage", () => {
    window.localStorage.setItem("pos_label_size", "40x30");
    expect(loadLabelSize()).toEqual({ widthMm: 40, heightMm: 30 });
  });

  it("ignores stored sizes that are out of range", () => {
    window.localStorage.setItem(
      "pos_label_size",
      JSON.stringify({ widthMm: 0, heightMm: 0 }),
    );
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });

    window.localStorage.setItem(
      "pos_label_size",
      JSON.stringify({ widthMm: 9999, heightMm: 9999 }),
    );
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });
  });

  it("ignores stored garbage", () => {
    window.localStorage.setItem("pos_label_size", "not-a-size");
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });

    window.localStorage.setItem("pos_label_size", "[]");
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });

    window.localStorage.setItem(
      "pos_label_size",
      JSON.stringify({ widthMm: "50", heightMm: "n/a" }),
    );
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });
  });

  it("refuses to persist an invalid size", () => {
    saveLabelSize({ widthMm: 0, heightMm: 30 });
    expect(window.localStorage.getItem("pos_label_size")).toBeNull();

    saveLabelSize({ widthMm: 50, heightMm: Number.NaN });
    expect(window.localStorage.getItem("pos_label_size")).toBeNull();

    saveLabelSize(null);
    expect(window.localStorage.getItem("pos_label_size")).toBeNull();

    saveLabelSize(undefined);
    expect(window.localStorage.getItem("pos_label_size")).toBeNull();
  });

  it("survives blocked storage instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadLabelSize()).toEqual({ ...DEFAULT_LABEL_SIZE });

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveLabelSize(SIZE)).not.toThrow();
  });

  it("rounds to two decimals", () => {
    saveLabelSize({ widthMm: 50.8, heightMm: 25.399 });
    expect(loadLabelSize()).toEqual({ widthMm: 50.8, heightMm: 25.4 });
  });
});

describe("buildLabelDocument size wiring", () => {
  it("drives the @page box from the stored label size", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>1</div>"],
      SIZE,
    );
    expect(html).toContain("size: 50mm 30mm");
    expect(html).toContain("size: 50mm 30mm; margin: 0;");
  });

  it("emits one .page per label and nothing else", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>1</div>"],
      SIZE,
    );
    expect(html.match(/<section class="page">/g)).toHaveLength(1);
    expect(html).not.toContain("barcode-print-portal");
  });
});
