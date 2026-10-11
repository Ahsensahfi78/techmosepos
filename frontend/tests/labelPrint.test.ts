import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  printLabels,
  buildLabelDocument,
  buildTestLabelHtml,
  labelSizeToPx,
  DEFAULT_LABEL_SIZE,
} from "@/lib/labelPrint";
import type { LabelSize } from "@/lib/labelPrint";

const SIZE: LabelSize = { widthMm: 50, heightMm: 30 };

let queue: Array<(t: number) => void> = [];

function flush(max = 1200): number {
  let steps = 0;
  while (queue.length > 0 && steps < max) {
    const cb = queue.shift()!;
    cb(0);
    steps++;
  }
  return steps;
}

function frame(): HTMLIFrameElement | null {
  return document.getElementById("label-print-frame") as HTMLIFrameElement | null;
}

function frameDoc(): Document | null {
  return frame()?.contentDocument ?? null;
}

function stubFramePrint(mode: "ok" | "throw"): ReturnType<typeof vi.fn> {
  const win = frame()!.contentWindow!;
  const spy = vi.fn();
  Object.defineProperty(win, "print", {
    configurable: true,
    value:
      mode === "ok"
        ? spy
        : () => {
            throw new Error("blocked");
          },
  });
  return spy;
}

function stubFrameFocus(): ReturnType<typeof vi.fn> {
  const win = frame()!.contentWindow!;
  const spy = vi.fn();
  Object.defineProperty(win, "focus", { configurable: true, value: spy });
  return spy;
}

function seedPreview(labels: string[]): void {
  document.body.innerHTML =
    `<div class="card" id="barcode-print-area">` +
    `<div class="barcode-grid" style="display:grid;grid-template-columns:repeat(1, 1fr)">` +
    labels
      .map(
        (txt) =>
          `<div class="barcode-cell label"><div class="barcode-label">` +
          `<div class="barcode-store-name">${txt}</div>` +
          `<div class="barcode-image"><svg></svg></div>` +
          `</div></div>`,
      )
      .join("") +
    `</div></div>`;
}

beforeEach(() => {
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb as (t: number) => void);
    return queue.length;
  });
  document.body.innerHTML = "";
  document.getElementById("label-print-frame")?.remove();
});

afterEach(() => {
  queue = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.getElementById("label-print-frame")?.remove();
});

describe("buildLabelDocument", () => {
  it("sizes the print box to the label with zero margin", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>A</div>"], SIZE);
    expect(html).toContain("@page { size: 50mm 30mm; margin: 0; }");
    expect(html).toContain("width: 50mm");
    expect(html).toContain("height: 30mm");
  });

  it("emits exactly one .page per label", () => {
    const html = buildLabelDocument(
      ["<div class='barcode-label'>1</div>", "<div class='barcode-label'>2</div>"],
      SIZE,
    );
    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html).not.toContain('<section class="page page-sheet">');
  });

  it("never lets the last label push a blank page off the roll", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>1</div>"], SIZE);
    expect(html).toMatch(/\.page \{[^}]*page-break-after: always/);
    expect(html).toMatch(/\.page:last-child \{[^}]*page-break-after: auto/);
    expect(html).toMatch(/\.page:last-child \{[^}]*break-after: auto/);
  });

  it("keeps label text black on an opaque white plate", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>1</div>"], SIZE);
    expect(html).toMatch(/\.barcode-label \{[^}]*color: #000;/);
    expect(html).toMatch(/\.barcode-image svg \{[^}]*background: #fff;/);
    expect(html).toMatch(/print-color-adjust: exact/);
    expect(html).toMatch(/-webkit-print-color-adjust: exact/);
  });

  it("keeps the human readable code at or above 7pt", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>1</div>"], SIZE);
    expect(html).toMatch(/\.barcode-code \{[^}]*font-size: 8pt/);
    expect(html).toMatch(/\.barcode-sku \{[^}]*font-size: 7pt/);
    expect(html).toMatch(/\.barcode-price \{[^}]*font-size: 9pt/);
    expect(html).toMatch(/\.barcode-test-text \{[^}]*font-size: 16pt/);
  });

  it("collapses sheet stock onto a single .page holding the whole grid", () => {
    const grid =
      `<div class="barcode-grid" style="display:grid;` +
      `grid-template-columns:repeat(3, 1fr);gap:4mm 4mm">` +
      `<div class="barcode-cell"><div class="barcode-label">A</div></div>` +
      `</div>`;
    const html = buildLabelDocument(
      ["<div class='barcode-label'>A</div>", "<div class='barcode-label'>B</div>"],
      { widthMm: 210, heightMm: 297 },
      grid,
    );
    expect(html.match(/<section class="page/g)).toHaveLength(1);
    expect(html).toContain('<section class="page page-sheet">');
    expect(html).toContain("@page { size: 210mm 297mm; margin: 0; }");
    expect(html).toContain("grid-template-columns:repeat(3, 1fr)");
    expect(html).toMatch(/\.page-sheet \{[^}]*display: block/);
  });

  it("honours a non-default label size", () => {
    const html = buildLabelDocument(["<div class='barcode-label'>1</div>"], {
      widthMm: 63.5,
      heightMm: 38,
    });
    expect(html).toContain("@page { size: 63.5mm 38mm; margin: 0; }");
  });
});

describe("labelSizeToPx", () => {
  it("converts mm to CSS px at 96dpi", () => {
    expect(labelSizeToPx(SIZE)).toEqual({ width: 189, height: 113 });
    expect(labelSizeToPx(DEFAULT_LABEL_SIZE)).toEqual({ width: 189, height: 113 });
  });

  it("never returns a zero-sized frame", () => {
    expect(labelSizeToPx({ widthMm: 10, heightMm: 10 })).toEqual({
      width: 38,
      height: 38,
    });
  });
});

describe("printLabels — test fallback", () => {
  it("builds a framed label and calls print() once it is rendered", () => {
    const onError = vi.fn();
    expect(printLabels(SIZE, onError)).toBe(true);

    const f = frame();
    expect(f).not.toBeNull();
    expect(f!.getAttribute("aria-hidden")).toBe("true");

    const doc = frameDoc()!;
    expect(doc.querySelectorAll(".page")).toHaveLength(1);
    expect(doc.querySelector(".barcode-test")).not.toBeNull();
    expect(doc.querySelector(".barcode-test-text")?.textContent).toBe("TEST");
    expect(doc.querySelector(".barcode-code")?.textContent).toBe("TEST-0001");
    // JsBarcode ran in the frame: white backing plate + black bars.
    const bars = doc.querySelectorAll(".test-barcode rect");
    expect(bars.length).toBeGreaterThan(2);
    expect(doc.querySelector(".test-barcode rect")?.getAttribute("fill")).toBe(
      "#ffffff",
    );

    const focus = stubFrameFocus();
    const spy = stubFramePrint("ok");
    flush();
    expect(onError).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives the frame the printable box of the label", () => {
    printLabels(SIZE, vi.fn());
    const el = frame()!;
    expect(el.style.width).toBe("189px");
    expect(el.style.height).toBe("113px");
    flush();
  });

  it("keeps the frame off-screen but rendered", () => {
    printLabels(SIZE, vi.fn());
    const el = frame()!;
    expect(el.style.left).toBe("-10000px");
    expect(el.style.display).not.toBe("none");
    expect(el.style.visibility).not.toBe("hidden");
    expect(el.style.opacity).not.toBe("0");
    flush();
  });

  it("surfaces a print() failure instead of failing silently", () => {
    const onError = vi.fn();
    expect(printLabels(SIZE, onError)).toBe(true);
    stubFramePrint("throw");
    flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("blocked");
  });

  it("never issues print() on the application document", () => {
    const original = window.print;
    const appPrint = vi.fn();
    Object.defineProperty(window, "print", { configurable: true, value: appPrint });
    try {
      printLabels(SIZE, vi.fn());
      stubFramePrint("ok");
      flush();
      expect(appPrint).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "print", { configurable: true, value: original });
    }
  });
});

describe("printLabels — generated preview", () => {
  it("prints one page per label with no test fallback", () => {
    seedPreview(["A", "B", "C"]);
    const onError = vi.fn();
    expect(printLabels(SIZE, onError)).toBe(true);

    const doc = frameDoc()!;
    expect(doc.querySelectorAll(".page")).toHaveLength(3);
    expect(doc.querySelector(".barcode-test")).toBeNull();
    expect(
      Array.from(doc.querySelectorAll(".barcode-store-name")).map(
        (n) => n.textContent,
      ),
    ).toEqual(["A", "B", "C"]);

    const spy = stubFramePrint("ok");
    flush();
    expect(onError).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous frame instead of stacking them", () => {
    seedPreview(["A"]);
    printLabels(SIZE, vi.fn());
    stubFramePrint("ok");
    flush();

    printLabels(SIZE, vi.fn());
    expect(document.querySelectorAll("#label-print-frame")).toHaveLength(1);
    stubFramePrint("ok");
    flush();
  });

  it("falls back to the test label when no preview has been generated", () => {
    document.body.innerHTML = "";
    const onError = vi.fn();
    expect(printLabels(SIZE, onError)).toBe(true);
    expect(frameDoc()!.querySelector(".barcode-test")).not.toBeNull();
    const spy = stubFramePrint("ok");
    flush();
    expect(onError).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores labels outside the print area", () => {
    document.body.innerHTML = `<div class="barcode-label">STRAY</div>`;
    printLabels(SIZE, vi.fn());
    const doc = frameDoc()!;
    expect(doc.querySelectorAll(".page")).toHaveLength(1);
    expect(doc.querySelector(".barcode-test")).not.toBeNull();
    flush();
  });
});

describe("buildTestLabelHtml", () => {
  it("carries the bordered TEST marker and a barcode slot", () => {
    const html = buildTestLabelHtml();
    expect(html).toContain("barcode-label barcode-test");
    expect(html).toContain(">TEST<");
    expect(html).toContain("TEST-0001");
    expect(html).toContain('class="test-barcode"');
  });
});
