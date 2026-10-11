import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyReceiptPageSize,
  applyReceiptRotation,
  applyReceiptWidth,
  fitReceiptPage,
  measureReceiptHeightMm,
  parseReceiptRotation,
  parseReceiptWidth,
  pxToMm,
  RECEIPT_PAGE_DEFAULT_HEIGHT_MM,
  RECEIPT_PAGE_MAX_HEIGHT_MM,
  RECEIPT_PAGE_MIN_HEIGHT_MM,
  RECEIPT_PAGE_STYLE_ID,
  RECEIPT_PAGE_TRIM_MM,
  RECEIPT_ROTATE_VAR,
  RECEIPT_WIDTH_DEFAULT_MM,
  RECEIPT_WIDTH_MAX_MM,
  RECEIPT_WIDTH_MIN_MM,
} from "../lib/receiptTheme";

function pageRule(): string | null {
  const el = document.getElementById(RECEIPT_PAGE_STYLE_ID);
  return el ? el.textContent : null;
}

describe("parseReceiptWidth", () => {
  it("keeps values inside the supported roll range", () => {
    expect(parseReceiptWidth("58")).toBe(58);
    expect(parseReceiptWidth("72")).toBe(72);
    expect(parseReceiptWidth("80")).toBe(80);
  });

  it("clamps out-of-range values", () => {
    expect(parseReceiptWidth("40")).toBe(RECEIPT_WIDTH_MIN_MM);
    expect(parseReceiptWidth("120")).toBe(RECEIPT_WIDTH_MAX_MM);
    expect(parseReceiptWidth(-5)).toBe(RECEIPT_WIDTH_MIN_MM);
  });

  it("falls back to the default for junk", () => {
    expect(parseReceiptWidth("")).toBe(RECEIPT_WIDTH_DEFAULT_MM);
    expect(parseReceiptWidth("wide")).toBe(RECEIPT_WIDTH_DEFAULT_MM);
    expect(parseReceiptWidth(null)).toBe(RECEIPT_WIDTH_DEFAULT_MM);
    expect(parseReceiptWidth(undefined)).toBe(RECEIPT_WIDTH_DEFAULT_MM);
    expect(parseReceiptWidth("  65  ")).toBe(65);
    expect(parseReceiptWidth("65.7")).toBe(65);
  });
});

describe("pxToMm", () => {
  it("converts CSS pixels at 96dpi", () => {
    expect(pxToMm(96)).toBeCloseTo(25.4, 5);
    expect(pxToMm(0)).toBe(0);
  });
});

describe("applyReceiptWidth", () => {
  afterEach(() => {
    document.getElementById(RECEIPT_PAGE_STYLE_ID)?.remove();
    document.documentElement.style.removeProperty("--receipt-width");
  });

  it("writes the box width and an @page rule Chrome accepts", () => {
    expect(applyReceiptWidth("58")).toBe(58);

    expect(
      document.documentElement.style.getPropertyValue("--receipt-width")
    ).toBe("58mm");

    // Two explicit lengths: `size: 58mm auto` is invalid and gets dropped.
    expect(pageRule()).toContain("@page");
    expect(pageRule()).toContain(`size: 58mm ${RECEIPT_PAGE_DEFAULT_HEIGHT_MM}mm`);
    expect(pageRule()).toContain("margin: 0");
    expect(pageRule()).not.toContain("auto");
  });

  it("reuses one style element across calls", () => {
    applyReceiptWidth(58);
    applyReceiptWidth(80);
    expect(
      document.querySelectorAll(`#${RECEIPT_PAGE_STYLE_ID}`).length
    ).toBe(1);
    expect(pageRule()).toContain("size: 80mm");
  });

  it("clamps an invalid width instead of emitting a broken @page", () => {
    expect(applyReceiptWidth("9999")).toBe(RECEIPT_WIDTH_MAX_MM);
    expect(pageRule()).not.toContain("9999");
  });
});

describe("applyReceiptPageSize", () => {
  afterEach(() => {
    document.getElementById(RECEIPT_PAGE_STYLE_ID)?.remove();
  });

  it("emits the exact media box", () => {
    const out = applyReceiptPageSize(80, 120);
    expect(out).toEqual({ widthMm: 80, heightMm: 120 });
    expect(pageRule()).toContain("size: 80mm 120mm");
  });

  it("clamps and rounds the height", () => {
    expect(applyReceiptPageSize(80, 1.2).heightMm).toBe(RECEIPT_PAGE_MIN_HEIGHT_MM);
    expect(applyReceiptPageSize(80, 99999).heightMm).toBe(RECEIPT_PAGE_MAX_HEIGHT_MM);
    expect(applyReceiptPageSize(80, 51.4).heightMm).toBe(52);
  });

  it("falls back to the default height for junk", () => {
    expect(applyReceiptPageSize(80, "tall").heightMm).toBe(
      RECEIPT_PAGE_DEFAULT_HEIGHT_MM
    );
    expect(applyReceiptPageSize(80, null).heightMm).toBe(
      RECEIPT_PAGE_DEFAULT_HEIGHT_MM
    );
  });

  it("clamps the width too", () => {
    expect(applyReceiptPageSize(200, 100).widthMm).toBe(RECEIPT_WIDTH_MAX_MM);
  });
});

describe("measureReceiptHeightMm / fitReceiptPage", () => {
  afterEach(() => {
    document.getElementById(RECEIPT_PAGE_STYLE_ID)?.remove();
  });

  it("measures a rendered element", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ height: 190.5, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const mm = measureReceiptHeightMm(el);
    expect(mm).toBeCloseTo(50.4, 1);
  });

  it("falls back to the default when there is nothing to measure", () => {
    expect(measureReceiptHeightMm(null)).toBe(RECEIPT_PAGE_DEFAULT_HEIGHT_MM);
    expect(measureReceiptHeightMm(document.createElement("div"))).toBe(
      RECEIPT_PAGE_DEFAULT_HEIGHT_MM
    );
  });

  it("sizes the page to the receipt plus rounding slack", () => {
    const out = fitReceiptPage(null, 58);
    expect(out.widthMm).toBe(58);
    expect(out.heightMm).toBe(RECEIPT_PAGE_DEFAULT_HEIGHT_MM + RECEIPT_PAGE_TRIM_MM);
    expect(pageRule()).toContain("size: 58mm 301mm");
  });

  it("measures a real element into the media box", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ height: 190.5, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const out = fitReceiptPage(el, 80);
    expect(out.heightMm).toBe(52); // ceil(50.403 + 1)
    expect(pageRule()).toContain("size: 80mm 52mm");
  });
});

describe("range constants", () => {
  it("match the 58-80mm hardware spec", () => {
    expect(RECEIPT_WIDTH_MIN_MM).toBe(58);
    expect(RECEIPT_WIDTH_MAX_MM).toBe(80);
    expect(RECEIPT_WIDTH_DEFAULT_MM).toBe(80);
  });
});

describe("parseReceiptRotation", () => {
  it("defaults to upright", () => {
    expect(parseReceiptRotation(undefined)).toBe(0);
    expect(parseReceiptRotation(null)).toBe(0);
    expect(parseReceiptRotation("")).toBe(0);
    expect(parseReceiptRotation("   ")).toBe(0);
    expect(parseReceiptRotation(false)).toBe(0);
    expect(parseReceiptRotation(0)).toBe(0);
  });

  it("recognises every truthy spelling the settings API can return", () => {
    expect(parseReceiptRotation("true")).toBe(180);
    expect(parseReceiptRotation("TRUE")).toBe(180);
    expect(parseReceiptRotation(" True ")).toBe(180);
    expect(parseReceiptRotation("1")).toBe(180);
    expect(parseReceiptRotation(1)).toBe(180);
    expect(parseReceiptRotation(true)).toBe(180);
    expect(parseReceiptRotation("yes")).toBe(180);
    expect(parseReceiptRotation("on")).toBe(180);
  });

  it("never lets garbage produce a sideways receipt", () => {
    expect(parseReceiptRotation("maybe")).toBe(0);
    expect(parseReceiptRotation("rotate")).toBe(0);
    expect(parseReceiptRotation(-180)).toBe(0);
    expect(parseReceiptRotation(Number.NaN)).toBe(0);
    expect(parseReceiptRotation({})).toBe(0);
  });

  it("is the only value the printer can actually use — 0 or 180", () => {
    for (const raw of ["true", "false", "1", "0", "yes", "no", "", "garbage"]) {
      expect([0, 180]).toContain(parseReceiptRotation(raw));
    }
  });
});

describe("applyReceiptRotation", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(RECEIPT_ROTATE_VAR);
  });

  it("publishes an upright receipt by default", () => {
    expect(applyReceiptRotation(undefined)).toBe(0);
    expect(
      document.documentElement.style.getPropertyValue(RECEIPT_ROTATE_VAR),
    ).toBe("0deg");
  });

  it("publishes the 180 correction when the setting is on", () => {
    expect(applyReceiptRotation("true")).toBe(180);
    expect(
      document.documentElement.style.getPropertyValue(RECEIPT_ROTATE_VAR),
    ).toBe("180deg");
  });

  it("round-trips through the setting value", () => {
    applyReceiptRotation("true");
    expect(applyReceiptRotation("false")).toBe(0);
    expect(
      document.documentElement.style.getPropertyValue(RECEIPT_ROTATE_VAR),
    ).toBe("0deg");
  });
});

describe("receipt print stylesheet rotation", () => {
  it("applies the rotation only inside the print rule", () => {
    const css = readFileSync(resolve(process.cwd(), "app", "globals.css"), "utf8");

    // The variable exists so a saved setting can reach a stylesheet React
    // never re-renders.
    expect(css).toContain("--receipt-rotate: 0deg");

    const printBlock = css.slice(css.indexOf("@media print"));
    const receiptRule = printBlock.slice(
      printBlock.indexOf("body:has(#print-receipt) #print-receipt .receipt"),
    );
    expect(receiptRule).toContain("rotate(var(--receipt-rotate, 0deg))");
    expect(receiptRule).toContain("transform-origin: center center");

    // The screen rules must not mention it, or the preview would flip too.
    const screenRules = css.slice(0, css.indexOf("@media print"));
    expect(screenRules).not.toContain("rotate(var(--receipt-rotate");
  });
});
