import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_CONFIG,
  LABEL_ROTATIONS,
  barcodeMaxHeightMm,
  buildLabelDocument,
  buildTestLabelHtml,
  buildTspl,
  loadLabelConfig,
  mediaBoxFor,
  mmToDots,
  pageBoxFor,
  rotatedBoxFor,
  safeAreaFor,
  saveLabelConfig,
  sheetTransform,
  toLabelConfig,
  tsplText,
  TSPL_DPI,
} from "@/lib/labelPrint";
import type { LabelConfig } from "@/lib/labelPrint";

const STOCK: LabelConfig = { ...DEFAULT_LABEL_CONFIG };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("38 x 25 mm thermal stock", () => {
  it("is the default the app opens with", () => {
    expect(DEFAULT_LABEL_CONFIG).toMatchObject({
      widthMm: 38,
      heightMm: 25,
      gapMm: 2,
      offsetXmm: 0,
      offsetYmm: 0,
      rotate: 0,
      paddingMm: 2,
    });
  });

  it("leaves a 34 x 21 mm safe area at the default 2 mm inset", () => {
    expect(safeAreaFor(DEFAULT_LABEL_CONFIG)).toEqual({
      widthMm: 34,
      heightMm: 21,
    });
  });

  it("prints the exact media box with zero page margin", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);
    expect(html).toContain("@page { size: 38mm 25mm; margin: 0; }");
    expect(html).toContain("width: 38mm");
    expect(html).toContain("height: 25mm");
  });

  it("puts the safe-area inset on the content box, not the page box", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);
    expect(html).toMatch(/\.sheet \{[^}]*padding: 2mm/);
    // The page box is the media edge and must stay unpadded, or the whole
    // label shifts by the inset and clips on the opposite side.
    expect(html).toMatch(/\.page \{[^}]*width: 38mm/);
  });

  it("is 304 x 200 dots on a 203 dpi head", () => {
    expect(mmToDots(38)).toBe(304);
    expect(mmToDots(25)).toBe(200);
    expect(TSPL_DPI).toBe(203);
  });
});

describe("toLabelConfig", () => {
  it("fills a bare width/height with the stock defaults", () => {
    expect(toLabelConfig({ widthMm: 50, heightMm: 30 })).toEqual({
      widthMm: 50,
      heightMm: 30,
      gapMm: 2,
      offsetXmm: 0,
      offsetYmm: 0,
      rotate: 0,
      paddingMm: 2,
    });
  });

  it("falls back to the stock size for unusable input", () => {
    expect(toLabelConfig(null)).toEqual(DEFAULT_LABEL_CONFIG);
    expect(toLabelConfig(undefined)).toEqual(DEFAULT_LABEL_CONFIG);
    expect(toLabelConfig({ widthMm: 0, heightMm: 0 })).toEqual(DEFAULT_LABEL_CONFIG);
    expect(toLabelConfig({ widthMm: Number.NaN, heightMm: 25 })).toEqual(
      DEFAULT_LABEL_CONFIG,
    );
  });

  it("clamps gap, offset and inset into their ranges", () => {
    const out = toLabelConfig({
      ...STOCK,
      gapMm: 999,
      offsetXmm: -999,
      offsetYmm: 999,
      paddingMm: 999,
    });
    expect(out.gapMm).toBe(20);
    expect(out.offsetXmm).toBe(-50);
    expect(out.offsetYmm).toBe(50);
    expect(out.paddingMm).toBe(10);
  });

  it("rejects a rotation that is not a right angle", () => {
    expect(toLabelConfig({ ...STOCK, rotate: 45 as never }).rotate).toBe(0);
    expect(toLabelConfig({ ...STOCK, rotate: 360 as never }).rotate).toBe(0);
  });
});

describe("pageBoxFor / sheetTransform", () => {
  it("keeps the media box at 0°", () => {
    expect(pageBoxFor(STOCK)).toEqual({ widthMm: 38, heightMm: 25 });
    expect(sheetTransform(STOCK)).toBe("");
  });

  it("turns the media box on its side for 90° and 270°", () => {
    expect(pageBoxFor({ ...STOCK, rotate: 90 })).toEqual({
      widthMm: 25,
      heightMm: 38,
    });
    expect(pageBoxFor({ ...STOCK, rotate: 270 })).toEqual({
      widthMm: 25,
      heightMm: 38,
    });
  });

  it("keeps the media box but flips the content at 180°", () => {
    expect(pageBoxFor({ ...STOCK, rotate: 180 })).toEqual({
      widthMm: 38,
      heightMm: 25,
    });
  });

  it("never changes the media box for any rotation", () => {
    // The media box is what @page is sized from. If rotation changed it the
    // driver would receive a different page and rescale the whole job.
    for (const rotate of [0, 90, 180, 270] as const) {
      expect(mediaBoxFor({ ...STOCK, rotate })).toEqual({
        widthMm: 38,
        heightMm: 25,
      });
    }
  });

  it("turns the wrapper box on its side only for 90°/270°", () => {
    expect(rotatedBoxFor({ ...STOCK, rotate: 0 })).toEqual({
      widthMm: 38,
      heightMm: 25,
    });
    expect(rotatedBoxFor({ ...STOCK, rotate: 180 })).toEqual({
      widthMm: 38,
      heightMm: 25,
    });
    expect(rotatedBoxFor({ ...STOCK, rotate: 90 })).toEqual({
      widthMm: 25,
      heightMm: 38,
    });
    expect(rotatedBoxFor({ ...STOCK, rotate: 270 })).toEqual({
      widthMm: 25,
      heightMm: 38,
    });
  });

  it("rotates the content about its centre — the page never translates", () => {
    expect(sheetTransform({ ...STOCK, rotate: 90 })).toBe("rotate(90deg)");
    expect(sheetTransform({ ...STOCK, rotate: 180 })).toBe("rotate(180deg)");
    expect(sheetTransform({ ...STOCK, rotate: 270 })).toBe("rotate(270deg)");
  });

  it("applies the offset in page space, before the rotation in the list", () => {
    expect(sheetTransform({ ...STOCK, offsetXmm: 1.5, offsetYmm: -1 })).toBe(
      "translate(1.5mm, -1mm)",
    );
    expect(
      sheetTransform({ ...STOCK, rotate: 90, offsetXmm: 1, offsetYmm: 2 }),
    ).toBe("translate(1mm, 2mm) rotate(90deg)");
  });

  it("keeps @page at the media size and turns only the wrapper", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>A</div>"],
      { ...STOCK, rotate: 90 },
    );
    // The page MUST stay 38x25 — a swapped @page hands the driver a different
    // media box and the whole job gets rescaled onto the wrong stock.
    expect(html).toContain("@page { size: 38mm 25mm; margin: 0; }");
    expect(html).toContain("transform-origin: center center");
    expect(html).toContain("transform: rotate(90deg)");
    // The wrapper is the media box turned on its side, centred inside it.
    expect(html).toMatch(/\.rot \{[^}]*width: 25mm/);
    expect(html).toMatch(/\.rot \{[^}]*height: 38mm/);
    expect(html).toContain('<div class="rot"><div class="sheet">');
  });

  it("never changes the page size for a 180° label", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>A</div>"],
      { ...STOCK, rotate: 180 },
    );
    expect(html).toContain("@page { size: 38mm 25mm; margin: 0; }");
    expect(html).toMatch(/\.rot \{[^}]*width: 38mm/);
    expect(html).toMatch(/\.rot \{[^}]*height: 25mm/);
    expect(html).toContain("transform: rotate(180deg)");
  });

  it("exposes every right angle", () => {
    expect(LABEL_ROTATIONS).toEqual([0, 90, 180, 270]);
  });
});

describe("barcodeMaxHeightMm", () => {
  it("caps bars at 9 mm on small thermal stock", () => {
    expect(barcodeMaxHeightMm(DEFAULT_LABEL_CONFIG)).toBe(9);
    expect(barcodeMaxHeightMm({ widthMm: 50, heightMm: 30 })).toBe(9);
  });

  it("lets sheet stock use a taller symbol", () => {
    expect(barcodeMaxHeightMm({ widthMm: 210, heightMm: 297 })).toBe(20);
  });

  it("is emitted into the stylesheet the iframe uses", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);
    expect(html).toContain("--barcode-max-h: 9mm");
    expect(html).toMatch(/\.barcode-image svg \{[^}]*max-height: var\(--barcode-max-h/);
    expect(html).toMatch(/\.barcode-image svg \{[^}]*width: 100%/);
  });

  it("locks html/body to the label width so nothing floats on an A4 page", () => {
    // This is the fix for "Chrome shows a large page with the label floating
    // in the middle". The document is the label's own width, so even if
    // @page were dropped the content could never stretch to A4.
    const html = buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);
    expect(html).toMatch(/html, body \{[^}]*width: 38mm;/);
    expect(html).toMatch(/html, body \{[^}]*margin: 0;/);
    expect(html).toMatch(/html, body \{[^}]*padding: 0;/);
  });

  it("never clamps body height, or later labels would be clipped away", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>1</div>", "<div class='barcode-label'>2</div>"],
      STOCK,
    );
    // Height must stay auto: .page is one label tall and carries the page
    // break, so 2 labels become 2 pages and 1 label becomes exactly 1 page.
    expect(html).toMatch(/html, body \{[^}]*height: auto;/);
    expect(html).not.toMatch(/html, body \{[^}]*overflow: hidden/);
    expect(html).toMatch(/\.page \{[^}]*height: 25mm;/);
  });

  it("pins the media box and never lets the document grow past it", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);
    expect(html).toMatch(/@page \{ size: 38mm 25mm; margin: 0; \}/);
    expect(html).toMatch(/\.page \{[^}]*width: 38mm;[^}]*height: 25mm;/);
  });
});

describe("label content rules", () => {
  const html = () =>
    buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);

  it("truncates a long product name to one line", () => {
    expect(html()).toMatch(/\.barcode-product-name \{[^}]*text-overflow: ellipsis/);
    expect(html()).toMatch(/\.barcode-product-name \{[^}]*white-space: nowrap/);
  });

  it("clips the page box so nothing reaches the next label", () => {
    expect(html()).toMatch(/\.page \{[^}]*overflow: hidden/);
    expect(html()).toMatch(/\.sheet \{[^}]*overflow: hidden/);
  });

  it("carries one page per label with no trailing blank", () => {
    const doc = buildLabelDocument(
      ["<div class='barcode-label'>1</div>", "<div class='barcode-label'>2</div>"],
      STOCK,
    );
    expect(doc.match(/<section class="page">/g)).toHaveLength(2);
    expect(doc).toContain('<div class="sheet">');
  });

  it("wraps every label in a rotation box inside the page", () => {
    const doc = buildLabelDocument(["<div class='barcode-label'>A</div>"], STOCK);
    expect(doc).toContain('<div class="rot"><div class="sheet">');
    expect(doc).toMatch(/\.rot \{[^}]*transform-origin: center center/);
  });
});

describe("test print edge marker", () => {
  it("marks the media edge only on a test label", () => {
    const testDoc = buildLabelDocument(["<div>x</div>"], STOCK, null, true);
    expect(testDoc).toContain('<body class="test-edge">');
    expect(testDoc).toMatch(/\.test-edge \.page::after \{[^}]*dashed #000/);

    const realDoc = buildLabelDocument(["<div>x</div>"], STOCK);
    // The stylesheet always carries the rule; only the body class turns it on.
    expect(realDoc).toMatch(/<body>/);
    expect(realDoc).not.toMatch(/<body class=/);
  });

  it("draws the dashed edge fully inside the page so all four sides print", () => {
    const doc = buildLabelDocument(["<div>x</div>"], STOCK, null, true);
    const rule = doc.match(/\.test-edge \.page::after \{[^}]*\}/)?.[0] ?? "";
    // A border on an inset box is painted inside the element, so .page's
    // overflow:hidden can never clip the top/bottom/left/right edge.
    expect(rule).toContain("border: 0.35mm dashed #000");
    expect(rule).toMatch(/inset: 0\.35mm/);
    expect(rule).not.toContain("outline");
    // Half the border thickness inside the box keeps the stroke on-page.
    expect(rule).toMatch(/inset: ([\d.]+)mm/);
    expect(parseFloat(rule.match(/inset: ([\d.]+)mm/)![1])).toBeGreaterThan(0);
  });

  it("prints the test label as exactly one page", () => {
    const doc = buildLabelDocument([buildTestLabelHtml()], STOCK, null, true);
    expect(doc.match(/<section class="page">/g)).toHaveLength(1);
    expect(doc).toContain("page-break-after: always");
    // The last page releases the break, so no blank label follows it.
    expect(doc).toContain(".page:last-child");
  });

  it("draws the safe area as a solid box on the test label", () => {
    const doc = buildLabelDocument(["<div class='barcode-label barcode-test'>x</div>"], STOCK, null, true);
    expect(doc).toMatch(/\.barcode-label\.barcode-test \{[^}]*border: 0\.5mm solid #000/);
  });
});

describe("loadLabelConfig / saveLabelConfig", () => {
  it("round-trips the whole geometry", () => {
    saveLabelConfig({ ...STOCK, gapMm: 3, offsetXmm: 1.5, rotate: 180, paddingMm: 1 });
    expect(loadLabelConfig()).toEqual({
      widthMm: 38,
      heightMm: 25,
      gapMm: 3,
      offsetXmm: 1.5,
      offsetYmm: 0,
      rotate: 180,
      paddingMm: 1,
    });
  });

  it("defaults to the 38 x 25 stock when nothing is stored", () => {
    expect(loadLabelConfig()).toEqual(DEFAULT_LABEL_CONFIG);
  });

  it("keeps the legacy size key in step", () => {
    saveLabelConfig({ ...STOCK, widthMm: 50, heightMm: 40 });
    expect(JSON.parse(window.localStorage.getItem("pos_label_size")!)).toEqual({
      widthMm: 50,
      heightMm: 40,
    });
  });

  it("upgrades a legacy size-only record", () => {
    window.localStorage.setItem("pos_label_size", JSON.stringify({ widthMm: 63, heightMm: 38 }));
    expect(loadLabelConfig()).toEqual({
      widthMm: 63,
      heightMm: 38,
      gapMm: 2,
      offsetXmm: 0,
      offsetYmm: 0,
      rotate: 0,
      paddingMm: 2,
    });
  });

  it("ignores stored garbage instead of throwing", () => {
    window.localStorage.setItem("pos_label_config", "{not json");
    expect(loadLabelConfig()).toEqual(DEFAULT_LABEL_CONFIG);

    window.localStorage.setItem(
      "pos_label_config",
      JSON.stringify({ widthMm: 38, heightMm: 25, rotate: 45 }),
    );
    expect(loadLabelConfig().rotate).toBe(0);
  });

  it("survives blocked storage", () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("denied");
    };
    try {
      expect(() => saveLabelConfig(STOCK)).not.toThrow();
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});

describe("buildTspl", () => {
  const labels = [
    { name: "25W Fast Charger", barcode: "123456789012", price: "Rs 1,800.00" },
  ];

  it("emits the stock header the printer expects", () => {
    const tspl = buildTspl(labels, STOCK);
    expect(tspl).toContain("SIZE 38 mm, 25 mm");
    expect(tspl).toContain("GAP 2 mm, 0 mm");
    expect(tspl).toContain("DENSITY 8");
    // Default is DIRECTION 0; DIRECTION 1 is what "Rotate 180" maps to.
    expect(tspl).toContain("DIRECTION 0");
    expect(tspl).toContain("CLS");
    expect(tspl.trimEnd().endsWith("PRINT 1")).toBe(true);
  });

  it("sizes the barcode at 9 mm, which is 72 dots at 203 dpi", () => {
    expect(mmToDots(9)).toBe(72);
    expect(buildTspl(labels, STOCK)).toContain(
      'BARCODE 16,40,"128",72,1,0,2,2,"123456789012"',
    );
  });

  it("keeps every element inside the 34 x 21 mm safe area", () => {
    const tspl = buildTspl(labels, STOCK);
    const pageDots = { w: mmToDots(38), h: mmToDots(25) };
    const coords = Array.from(
      tspl.matchAll(/(TEXT|BARCODE) (\d+),(\d+),/g),
    ).map((m) => ({ cmd: m[1], x: Number(m[2]), y: Number(m[3]) }));
    expect(coords.length).toBe(4);
    for (const c of coords) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(pageDots.w);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(pageDots.h);
    }

    // Last row is the price; it must clear the bottom safe-area line.
    const price = coords[coords.length - 1];
    expect(price.y + 24).toBeLessThanOrEqual(pageDots.h - mmToDots(2));
  });

  it("reverses the feed for a printer that hands the label back inverted", () => {
    expect(buildTspl(labels, { ...STOCK, rotate: 180 })).toContain("DIRECTION 1");
  });

  it("notes that a sideways label cannot be expressed in TSPL", () => {
    const tspl = buildTspl(labels, { ...STOCK, rotate: 90 });
    expect(tspl).toContain("90 degree rotation is not expressible in TSPL");
    expect(tspl).toContain("Windows driver");
  });

  it("honours a non-default gap and inset", () => {
    const tspl = buildTspl(labels, { ...STOCK, gapMm: 3, paddingMm: 1 });
    expect(tspl).toContain("GAP 3 mm, 0 mm");
    // 1mm inset = 8 dots; the name sits 4 dots below the 8-dot top margin.
    expect(tspl).toContain('TEXT 8,12,"2",0,1,1,"25W Fast Charger"');
  });

  it("pins the content to the band the printer can actually reach", () => {
    const tspl = buildTspl(labels, STOCK);
    // 38x25mm @203dpi = 304x200 dots; the safe band is x 16-288, y 8-192.
    const coords = Array.from(tspl.matchAll(/(TEXT|BARCODE) (\d+),(\d+),/g)).map(
      (m) => ({ x: Number(m[2]), y: Number(m[3]) }),
    );
    for (const c of coords) {
      expect(c.x).toBeGreaterThanOrEqual(16);
      expect(c.x).toBeLessThanOrEqual(288);
      expect(c.y).toBeGreaterThanOrEqual(8);
      expect(c.y).toBeLessThanOrEqual(192);
    }
  });

  it("strips quotes and non-ASCII from the built-in fonts", () => {
    expect(tsplText('He said "hi"')).toBe("He said 'hi'");
    expect(tsplText("Samsung Galaxy™")).toBe("Samsung Galaxy");
    expect(tsplText("a\n  b")).toBe("a b");
  });

  it("emits one PRINT per label", () => {
    const tspl = buildTspl(
      [
        { name: "A", barcode: "1" },
        { name: "B", barcode: "2" },
        { name: "C", barcode: "3" },
      ],
      STOCK,
    );
    expect(tspl.match(/PRINT 1/g)).toHaveLength(3);
  });

  it("never writes more than one label per job block", () => {
    const tspl = buildTspl([{ name: "TEST", barcode: "TEST-0001" }], STOCK);
    expect(tspl.match(/SIZE /g)).toHaveLength(1);
    expect(tspl.match(/CLS/g)).toHaveLength(1);
  });
});
