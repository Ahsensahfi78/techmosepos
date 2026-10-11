import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_CONFIG,
  LABEL_ROTATIONS,
  barcodeMaxHeightMm,
  buildLabelDocument,
  buildTspl,
  loadLabelConfig,
  mmToDots,
  pageBoxFor,
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

  it("counter-translates a 90° label so it lands inside the swapped box", () => {
    expect(sheetTransform({ ...STOCK, rotate: 90 })).toBe(
      "translateX(25mm) rotate(90deg)",
    );
    expect(sheetTransform({ ...STOCK, rotate: 180 })).toBe(
      "translate(38mm, 25mm) rotate(180deg)",
    );
    expect(sheetTransform({ ...STOCK, rotate: 270 })).toBe(
      "translateY(38mm) rotate(270deg)",
    );
  });

  it("applies the offset in page space, after the rotation", () => {
    expect(sheetTransform({ ...STOCK, offsetXmm: 1.5, offsetYmm: -1 })).toBe(
      "translate(1.5mm, -1mm)",
    );
    expect(
      sheetTransform({ ...STOCK, rotate: 90, offsetXmm: 1, offsetYmm: 2 }),
    ).toBe("translate(1mm, 2mm) translateX(25mm) rotate(90deg)");
  });

  it("emits a swapped @page when the label is turned sideways", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>A</div>"],
      { ...STOCK, rotate: 90 },
    );
    expect(html).toContain("@page { size: 25mm 38mm; margin: 0; }");
    expect(html).toContain("transform-origin: 0 0");
    expect(html).toContain("transform: translateX(25mm) rotate(90deg)");
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
    expect(html).toMatch(/\.barcode-image svg \{[^}]*max-width: 100%/);
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
    expect(tspl).toContain("DIRECTION 1");
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
    expect(buildTspl(labels, { ...STOCK, rotate: 180 })).toContain("DIRECTION 0");
  });

  it("notes that a sideways label cannot be expressed in TSPL", () => {
    const tspl = buildTspl(labels, { ...STOCK, rotate: 90 });
    expect(tspl).toContain("90 degree rotation is not expressible in TSPL");
    expect(tspl).toContain("Windows driver");
  });

  it("honours a non-default gap and inset", () => {
    const tspl = buildTspl(labels, { ...STOCK, gapMm: 3, paddingMm: 1 });
    expect(tspl).toContain("GAP 3 mm, 0 mm");
    expect(tspl).toContain('TEXT 8,8,"2",0,1,1,"25W Fast Charger"');
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
