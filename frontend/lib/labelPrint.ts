import JsBarcode from "jsbarcode";

/**
 * Physical label stock. The browser cannot read the printer's real paper size,
 * so the size is chosen in the app and persisted in localStorage.
 */
export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

/**
 * Everything the printer needs to place one label correctly.
 *
 * `widthMm`/`heightMm` are the *media* size — the exact box the driver is
 * configured for (38 x 25 mm on the XP-365B stock). `paddingMm` is the safe
 * area inset, so a 38 x 25 label with the default 2 mm inset keeps all
 * content inside 34 x 21 mm.
 */
export interface LabelConfig extends LabelSize {
  /** Gap between labels on the roll, fed in the direction of travel. */
  gapMm: number;
  /** Shift of the whole label box, in mm, applied after rotation. */
  offsetXmm: number;
  offsetYmm: number;
  /** Content rotation inside the fixed media box. */
  rotate: LabelRotation;
  /** Safe-area inset on every side. Content never crosses it. */
  paddingMm: number;
}

export type LabelRotation = 0 | 90 | 180 | 270;

export const LABEL_ROTATIONS: LabelRotation[] = [0, 90, 180, 270];

export const DEFAULT_LABEL_SIZE: LabelSize = { widthMm: 50, heightMm: 30 };
export const LABEL_SIZE_MIN_MM = 10;
export const LABEL_SIZE_MAX_MM = 300;

export const LABEL_GAP_MIN_MM = 0;
export const LABEL_GAP_MAX_MM = 20;
export const LABEL_OFFSET_MIN_MM = -50;
export const LABEL_OFFSET_MAX_MM = 50;
export const LABEL_PADDING_MIN_MM = 0;
export const LABEL_PADDING_MAX_MM = 10;

/**
 * The 38 x 25 mm thermal stock the shop actually runs: 203 dpi puts that at
 * roughly 304 x 200 dots, with a 2 mm gap the printer measures itself.
 *
 * The 2 mm inset leaves a 34 x 21 mm safe area, which is what the layout
 * below is budgeted against.
 */
export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  widthMm: 38,
  heightMm: 25,
  gapMm: 2,
  offsetXmm: 0,
  offsetYmm: 0,
  rotate: 0,
  paddingMm: 2,
};

/** Bars on a small thermal label top out near 9 mm so they stay scannable. */
const SMALL_LABEL_MAX_MM = 30;
const SMALL_LABEL_BARCODE_MM = 9;
const LARGE_LABEL_BARCODE_MM = 20;

const STORAGE_KEY = "pos_label_size";
const CONFIG_STORAGE_KEY = "pos_label_config";
const IFRAME_ID = "label-print-frame";
const CSS_PX_PER_MM = 96 / 25.4;

function isValidDimension(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= LABEL_SIZE_MIN_MM &&
    value <= LABEL_SIZE_MAX_MM
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Accepts "50x30mm", "50 x 30", "2x1in", "50mmx30mm", "127x76" (mm default).
 * Returns null for anything that is not a usable label size.
 */
export function parseLabelSize(input: unknown): LabelSize | null {
  if (typeof input !== "string") return null;
  const match = input
    .trim()
    .replace(/\s+/g, "")
    .match(
      /^(\d+(?:\.\d+)?)(mm|cm|in|inch|")?[x×](\d+(?:\.\d+)?)(mm|cm|in|inch|")?$/i,
    );
  if (!match) return null;

  const unit = (match[4] || match[2] || "mm").toLowerCase();
  let widthMm = parseFloat(match[1]);
  let heightMm = parseFloat(match[3]);

  if (unit === "in" || unit === "inch" || unit === '"') {
    widthMm *= 25.4;
    heightMm *= 25.4;
  } else if (unit === "cm") {
    widthMm *= 10;
    heightMm *= 10;
  }

  if (!isValidDimension(widthMm) || !isValidDimension(heightMm)) return null;
  return { widthMm: round2(widthMm), heightMm: round2(heightMm) };
}

export function loadLabelSize(): LabelSize {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const direct = parseLabelSize(raw);
      if (direct) return direct;
      try {
        const parsed = JSON.parse(raw) as Partial<LabelSize>;
        const widthMm = Number(parsed?.widthMm);
        const heightMm = Number(parsed?.heightMm);
        if (isValidDimension(widthMm) && isValidDimension(heightMm)) {
          return { widthMm: round2(widthMm), heightMm: round2(heightMm) };
        }
      } catch {
        /* not JSON — fall through to the default */
      }
    }
  } catch {
    /* storage unavailable (private mode / blocked) */
  }
  return { ...DEFAULT_LABEL_SIZE };
}

export function saveLabelSize(size: LabelSize | null | undefined): void {
  if (!size || !isValidDimension(size.widthMm) || !isValidDimension(size.heightMm)) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        widthMm: round2(size.widthMm),
        heightMm: round2(size.heightMm),
      }),
    );
  } catch {
    /* storage unavailable */
  }
}

/* ── Full label configuration ─────────────────────────────────────────── */

function clampNumber(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}

export function isLabelRotation(value: unknown): value is LabelRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/**
 * Normalise anything the caller (or storage) hands us into a complete config.
 * A bare `{ widthMm, heightMm }` — the shape every older caller still uses —
 * keeps working and picks up the safe-area and roll defaults.
 */
export function toLabelConfig(
  input: LabelConfig | LabelSize | null | undefined,
): LabelConfig {
  const base = { ...DEFAULT_LABEL_CONFIG, ...(input ?? {}) };
  const widthMm = isValidDimension(base.widthMm)
    ? round2(base.widthMm)
    : DEFAULT_LABEL_CONFIG.widthMm;
  const heightMm = isValidDimension(base.heightMm)
    ? round2(base.heightMm)
    : DEFAULT_LABEL_CONFIG.heightMm;
  return {
    widthMm,
    heightMm,
    gapMm: round2(
      clampNumber(base.gapMm, LABEL_GAP_MIN_MM, LABEL_GAP_MAX_MM, DEFAULT_LABEL_CONFIG.gapMm),
    ),
    offsetXmm: round2(
      clampNumber(
        base.offsetXmm,
        LABEL_OFFSET_MIN_MM,
        LABEL_OFFSET_MAX_MM,
        DEFAULT_LABEL_CONFIG.offsetXmm,
      ),
    ),
    offsetYmm: round2(
      clampNumber(
        base.offsetYmm,
        LABEL_OFFSET_MIN_MM,
        LABEL_OFFSET_MAX_MM,
        DEFAULT_LABEL_CONFIG.offsetYmm,
      ),
    ),
    rotate: isLabelRotation(base.rotate) ? base.rotate : 0,
    paddingMm: round2(
      clampNumber(
        base.paddingMm,
        LABEL_PADDING_MIN_MM,
        LABEL_PADDING_MAX_MM,
        DEFAULT_LABEL_CONFIG.paddingMm,
      ),
    ),
  };
}

/** 90° and 270° turn the media box on its side, so the page is swapped. */
export function pageBoxFor(config: LabelConfig | LabelSize): LabelSize {
  const c = toLabelConfig(config);
  const swapped = c.rotate === 90 || c.rotate === 270;
  return {
    widthMm: swapped ? c.heightMm : c.widthMm,
    heightMm: swapped ? c.widthMm : c.heightMm,
  };
}

/**
 * The media box — the physical label stock. This is what `@page` is sized to
 * and it NEVER changes with rotation: turning the content 180° (or 90°) must
 * not hand the printer a different page, or the driver rescales the whole job
 * and the barcode lands off the edge of the label.
 */
export function mediaBoxFor(config: LabelConfig | LabelSize): LabelSize {
  const c = toLabelConfig(config);
  return { widthMm: c.widthMm, heightMm: c.heightMm };
}

/**
 * The rotation wrapper's own box.
 *
 * For 0°/180° it is the media box. For 90°/270° it is the media box turned on
 * its side, so rotating it about its centre lands it exactly back inside the
 * media box instead of hanging off the edge.
 */
export function rotatedBoxFor(config: LabelConfig | LabelSize): LabelSize {
  return pageBoxFor(config);
}


/** The box content may occupy — media size minus the safe-area inset. */
export function safeAreaFor(config: LabelConfig | LabelSize): LabelSize {
  const c = toLabelConfig(config);
  return {
    widthMm: round2(Math.max(0, c.widthMm - 2 * c.paddingMm)),
    heightMm: round2(Math.max(0, c.heightMm - 2 * c.paddingMm)),
  };
}

/**
 * Transform applied to the rotation wrapper.
 *
 * The wrapper is centred inside the media box, so a plain
 * `transform: rotate(Ndeg)` with `transform-origin: center` is enough — the
 * page itself never moves. The offset is prepended, which means it is applied
 * *after* the rotation and therefore shifts the content in page space without
 * changing the page size.
 */
export function sheetTransform(config: LabelConfig | LabelSize): string {
  const c = toLabelConfig(config);
  const parts: string[] = [];
  if (c.offsetXmm !== 0 || c.offsetYmm !== 0) {
    parts.push(`translate(${c.offsetXmm}mm, ${c.offsetYmm}mm)`);
  }
  if (c.rotate !== 0) {
    parts.push(`rotate(${c.rotate}deg)`);
  }
  return parts.join(" ");
}


/** Bar height cap: ~9 mm on small thermal stock, larger on sheet stock. */
export function barcodeMaxHeightMm(config: LabelConfig | LabelSize): number {
  const c = toLabelConfig(config);
  if (c.heightMm <= SMALL_LABEL_MAX_MM) return SMALL_LABEL_BARCODE_MM;
  return round2(Math.min(LARGE_LABEL_BARCODE_MM, c.heightMm * 0.38));
}

export function loadLabelConfig(): LabelConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LabelConfig>;
      if (parsed && typeof parsed === "object") {
        return toLabelConfig({
          widthMm: Number(parsed.widthMm),
          heightMm: Number(parsed.heightMm),
          gapMm: Number(parsed.gapMm ?? DEFAULT_LABEL_CONFIG.gapMm),
          offsetXmm: Number(parsed.offsetXmm ?? DEFAULT_LABEL_CONFIG.offsetXmm),
          offsetYmm: Number(parsed.offsetYmm ?? DEFAULT_LABEL_CONFIG.offsetYmm),
          rotate: isLabelRotation(parsed.rotate) ? parsed.rotate : 0,
          paddingMm: Number(parsed.paddingMm ?? DEFAULT_LABEL_CONFIG.paddingMm),
        });
      }
    }
    // Older installs only ever stored the two dimensions.
    const legacy = loadLabelSize();
    if (
      legacy.widthMm !== DEFAULT_LABEL_SIZE.widthMm ||
      legacy.heightMm !== DEFAULT_LABEL_SIZE.heightMm
    ) {
      return toLabelConfig(legacy);
    }
  } catch {
    /* storage unavailable (private mode / blocked) */
  }
  return { ...DEFAULT_LABEL_CONFIG };
}

export function saveLabelConfig(config: LabelConfig | null | undefined): void {
  if (!config) return;
  const next = toLabelConfig(config);
  if (!isValidDimension(next.widthMm) || !isValidDimension(next.heightMm)) return;
  try {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    // Keep the legacy two-dimension key in step so anything still reading it
    // (the printer-size selector, older tabs) never disagrees with this page.
    saveLabelSize(next);
  } catch {
    /* storage unavailable */
  }
}

/** The frame is sized in CSS px so `1fr`/`100%` lay out at paper width. */
export function labelSizeToPx(size: LabelSize): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(size.widthMm * CSS_PX_PER_MM)),
    height: Math.max(1, Math.round(size.heightMm * CSS_PX_PER_MM)),
  };
}

function labelStyles(config: LabelConfig): string {
  const media = mediaBoxFor(config);
  const rot = rotatedBoxFor(config);
  const mw = `${media.widthMm}mm`;
  const mh = `${media.heightMm}mm`;
  const halfW = round2(rot.widthMm / 2);
  const halfH = round2(rot.heightMm / 2);
  const transform = sheetTransform(config);
  const barcodeMax = barcodeMaxHeightMm(config);
  return `
/* The page IS the label stock. It is sized from the media box only — never
   from the rotation — so the printer always receives 38x25mm (or whatever the
   roll is) no matter which way the content is turned. margin:0 is what stops
   Chrome falling back to its A4/Letter default. */
@page { size: ${mw} ${mh}; margin: 0; }

html, body {
  margin: 0;
  padding: 0;
  width: ${mw};
  /* Deliberately auto, NOT the label height. Each .page below is exactly one
     label tall and releases its page break when it is the last one, so a
     single label is exactly one page and N labels are exactly N pages.
     Clamping body height to one label (or clipping it with overflow:hidden)
     is what silently drops every label after the first. */
  height: auto;
  overflow: visible;
  background: #fff;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* .page IS the media box: exactly one label per page, never tiled onto the
   next one, never leaving a blank label behind. It clips, so content that
   somehow escaped the safe area still cannot spill onto the neighbouring
   label on the roll. */
.page {
  box-sizing: border-box;
  position: relative;
  width: ${mw};
  height: ${mh};
  overflow: hidden;
  background: #fff;
  color: #000;
  display: block;
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: page;
  page-break-after: always;
}

.page:last-child {
  break-after: auto;
  page-break-after: auto;
}

/* The rotation wrapper. It is centred inside the media box, so a plain
   rotate() about its own centre keeps it inside the label. For 90/270 it is
   the media box turned on its side (height x width) — that swap is what
   makes a quarter-turn still fit inside 38x25mm instead of overflowing. */
.rot {
  box-sizing: border-box;
  position: absolute;
  left: 50%;
  top: 50%;
  width: ${rot.widthMm === media.widthMm ? mw : `${rot.widthMm}mm`};
  height: ${rot.heightMm === media.heightMm ? mh : `${rot.heightMm}mm`};
  margin-left: -${halfW}mm;
  margin-top: -${halfH}mm;
  transform-origin: center center;
  ${transform ? `transform: ${transform};` : ""}
  overflow: hidden;
  background: #fff;
  color: #000;
}

/* The content box: the wrapper minus the safe-area inset. */
.sheet {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: ${config.paddingMm}mm;
  margin: 0;
  overflow: hidden;
  background: #fff;
  color: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}


/* Sheet stock (A4 / A5 / inch labels): one .page holds the whole pre-rendered
   grid, so a sheet still prints as exactly one sheet. */
.page.page-sheet {
  display: block;
  padding: 2mm;
  overflow: visible;
}

.page-sheet .barcode-grid {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.page-sheet .barcode-cell {
  border: 0.3mm solid #000 !important;
  border-radius: 0 !important;
}

/* Dashed outline of the media edge, printed only on a test label so you can
   see whether the content really sits inside the label. It is inset by half
   its own thickness so all four sides are painted inside the page box and
   nothing gets clipped by .page's overflow:hidden. */
.test-edge .page::after {
  content: "";
  position: absolute;
  inset: 0.35mm;
  border: 0.35mm dashed #000;
  box-sizing: border-box;
  pointer-events: none;
}


/* The iframe carries no Tailwind, so every label class is styled here.
   All sizes are in pt (1pt = 1.33px) to stay readable on a 203 dpi head. */
.barcode-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #000;
  background: #fff;
  font-family: Arial, Helvetica, "Liberation Sans", sans-serif;
  line-height: 1.15;
  overflow: hidden;
  box-sizing: border-box;
  --barcode-max-h: ${barcodeMax}mm;
}

/* One line only: a long product name is ellipsised rather than pushing the
   barcode off the bottom of a 25 mm label. */
.barcode-product-name {
  font-size: 8pt;
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.barcode-store-name {
  font-size: 8pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Bars keep their aspect ratio and are capped at ~9 mm on thermal stock, so
   a short Code128 symbol can never grow tall enough to collide with the
   price line. max-width keeps them inside the safe area. */
.barcode-image {
  width: 100%;
  margin: 0.6mm 0;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.barcode-image svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: var(--barcode-max-h, 9mm);
  background: #fff;
  shape-rendering: crispEdges;
}


.barcode-code {
  font-family: "Courier New", Courier, monospace;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.06em;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.barcode-sku {
  font-size: 7pt;
}

.barcode-price {
  font-size: 9pt;
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

/* Test label: the solid box marks the safe area, the dashed outline drawn by
   .test-edge marks the media edge. If content touches the dashed line the
   inset is too small. */
.barcode-label.barcode-test {
  border: 0.5mm solid #000;
  border-radius: 0;
}

.barcode-test-text {
  font-size: 16pt;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: #000;
}
`;
}

/**
 * A standalone, Tailwind-free HTML document for the label iframe.
 *
 * - Roll / single-label stock: `labelHtml` holds one entry per label and each
 *   entry becomes its own `.page`, so the printed page count equals the label
 *   count with no blank page at the end.
 * - Sheet stock: pass `sheetHtml` (the pre-rendered `.barcode-grid`) instead
 *   and the whole grid becomes a single `.page`.
 */
export function buildLabelDocument(
  labelHtml: string[],
  input: LabelConfig | LabelSize,
  sheetHtml?: string | null,
  testMode?: boolean,
): string {
  const config = toLabelConfig(input);
  const pages = sheetHtml
    ? `<section class="page page-sheet">${sheetHtml}</section>`
    : labelHtml
        .map(
          (html) =>
            `<section class="page"><div class="rot"><div class="sheet">${html}</div></div></section>`,
        )
        .join("\n");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${labelStyles(config)}</style></head>` +
    `<body${testMode ? ' class="test-edge"' : ""}>` +
    pages +
    `</body></html>`
  );
}

/** Fallback used by "Test Print" when no barcode preview has been built. */
export function buildTestLabelHtml(): string {
  return (
    `<div class="barcode-label barcode-test">` +
    `<div class="barcode-test-text">TEST</div>` +
    `<div class="barcode-image"><svg class="test-barcode"></svg></div>` +
    `<div class="barcode-code">TEST-0001</div>` +
    `</div>`
  );
}

/* ── TSPL (native label-printer language) ─────────────────────────────── */

/**
 * Xprinter / TSC printers speak TSPL. Sending TSPL straight to the raw port
 * skips the Windows driver entirely, which is the only way to get the
 * printer's own gap sensing and the exact 38 x 25 mm box — the driver
 * rewrites the DEVMODE and can silently rescale the page.
 *
 * A browser cannot open a raw port, so this builds the job and hands it over
 * as a .tspl file. Send it with the printer's own tool, or with the
 * `raw.ps1` helper shipped in backend/app/services/printing/scripts/.
 */
export const TSPL_DPI = 203;

export interface TsplLabel {
  name: string;
  barcode: string;
  /** Pre-formatted, e.g. "Rs 4,900.00". Omit to leave the price off. */
  price?: string;
}

export interface TsplOptions {
  /** Dots per inch. 203 is the XP-365B / XP-80 head. */
  dpi?: number;
  /** 0–15. Higher = darker. */
  density?: number;
  copies?: number;
}

/** mm → dots on a 203 dpi head (1 dot ≈ 0.125 mm). */
export function mmToDots(mm: number, dpi: number = TSPL_DPI): number {
  return Math.round((mm * dpi) / 25.4);
}

/**
 * TSPL strings are not escaped; embedded quotes and commas have to go.
 * Non-ASCII is dropped too — the built-in TSPL fonts are ASCII only.
 */
export function tsplText(value: string, maxChars?: number): string {
  let text = String(value ?? "")
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (maxChars && maxChars > 0) text = text.slice(0, maxChars);
  return text;
}

/**
 * Build a complete TSPL job: one block per label.
 *
 * Coordinates are dots from the top-left of the media. TSPL's BARCODE
 * command draws its own quiet zone, so the x position is the media edge
 * (plus the safe-area inset), not the inset minus a quiet zone.
 *
 * `DIRECTION 1` feeds forward, which is the right way up on every printer
 * that is *not* mounted upside down; `DIRECTION 0` reverses the feed, which
 * is the TSPL-level fix for a printer that hands the receipt back inverted.
 * 90°/270° cannot be expressed in TSPL at all, so those fall back to the
 * Windows-driver path and are noted in the header comment.
 */
export function buildTspl(
  labels: TsplLabel[],
  input: LabelConfig | LabelSize,
  options: TsplOptions = {},
): string {
  const config = toLabelConfig(input);
  const dpi = options.dpi ?? TSPL_DPI;
  const density = Math.min(15, Math.max(0, Math.round(options.density ?? 8)));
  const copies = Math.max(1, Math.round(options.copies ?? 1));

  const padX = mmToDots(config.paddingMm, dpi);
  const barcodeH = mmToDots(barcodeMaxHeightMm(config), dpi);

  // Media box in dots. 38 x 25 mm @ 203 dpi = 304 x 200 dots.
  const mediaW = mmToDots(config.widthMm, dpi);
  const mediaH = mmToDots(config.heightMm, dpi);
  // The printable band every element has to stay inside. On the shop's stock
  // that is x 16-288, y 8-192 — anything outside it falls off the label or
  // into the printer's own non-printable margin.
  const minX = mmToDots(config.paddingMm, dpi);
  const maxX = Math.max(minX, mediaW - minX);
  const minY = 8;
  const maxY = Math.max(minY, mediaH - 8);
  const clampY = (y: number, height: number) =>
    Math.min(Math.max(y, minY), Math.max(minY, maxY - height));

  // TSPL built-in fonts: "1" = 8x12, "2" = 12x20, "3" = 16x24 dots.
  const NAME_FONT = { id: "2", h: 20 };
  const CODE_FONT = { id: "1", h: 12 };
  const PRICE_FONT = { id: "3", h: 24 };

  const lines: string[] = [
    `SIZE ${round2(config.widthMm)} mm, ${round2(config.heightMm)} mm`,
    `GAP ${round2(config.gapMm)} mm, 0 mm`,
    `DENSITY ${density}`,
    // TSPL has no "rotate the content" command — the feed direction is the
    // only lever. DIRECTION 0 feeds one way; DIRECTION 1 reverses it, which
    // is how a 180 degree turn is expressed on a roll.
    config.rotate === 180 ? `DIRECTION 1` : `DIRECTION 0`,
    // TSPL rejects a negative reference point, so an offset that nudges the
    // label backwards is expressed as a positive shift of the media instead.
    `REFERENCE ${Math.max(0, mmToDots(config.offsetYmm, dpi))},${Math.max(0, mmToDots(config.offsetXmm, dpi))}`,
  ];
  if (config.rotate === 90 || config.rotate === 270) {
    lines.push(`; ${config.rotate} degree rotation is not expressible in TSPL.`);
    lines.push(`; Print this job through the Windows driver instead.`);
  }
  lines.push(`CLS`);

  for (const label of labels) {
    const name = tsplText(label.name);
    const code = tsplText(label.barcode);
    const price = label.price ? tsplText(label.price) : "";

    // Name at the top, bars under it, code under the bars, price at the
    // bottom — the same order the browser layout uses, pinned to the safe
    // band so a long name or a tall symbol cannot push the price off.
    let y = clampY(minY + 4, NAME_FONT.h);
    if (name) {
      lines.push(`TEXT ${padX},${y},"${NAME_FONT.id}",0,1,1,"${name}"`);
      y += NAME_FONT.h + 4;
    }
    let codeY = 0;
    if (code) {
      codeY = clampY(Math.max(y + 4, Math.round(mediaH * 0.16)), barcodeH);
      lines.push(
        `BARCODE ${padX},${codeY},"128",${barcodeH},1,0,2,2,"${code}"`,
      );
      y = codeY + barcodeH + 4;
      const codeYText = clampY(y, CODE_FONT.h);
      lines.push(
        `TEXT ${padX},${codeYText},"${CODE_FONT.id}",0,1,1,"${code}"`,
      );
      y = codeYText + CODE_FONT.h + 4;
    }
    if (price) {
      const priceY = clampY(
        Math.min(Math.round(mediaH * 0.72), Math.max(y, mediaH - 8 - PRICE_FONT.h)),
        PRICE_FONT.h,
      );
      lines.push(`TEXT ${padX},${priceY},"${PRICE_FONT.id}",0,1,1,"${price}"`);
    }
    lines.push(`PRINT ${copies}`);
  }

  // Guarantee the header never advertises a box the printer cannot hold.
  if (minX > maxX || minY > maxY) {
    throw new Error("label config leaves no printable area");
  }
  void minX;
  void maxX;

  return `${lines.join("\r\n")}\r\n`;
}


/** Save a generated TSPL job as a file the user can send to the printer. */
export function downloadTspl(
  labels: TsplLabel[],
  input: LabelConfig | LabelSize,
  options: TsplOptions & { filename?: string } = {},
): void {
  const body = buildTspl(labels, input, options);
  const name = options.filename || `labels-${round2(toLabelConfig(input).widthMm)}x${round2(toLabelConfig(input).heightMm)}.tspl`;
  if (typeof document === "undefined") return;
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function waitForRender(
  doc: Document,
  framesLeft: number,
  done: () => void,
): void {
  const svgs = Array.from(doc.querySelectorAll("svg"));
  const ready =
    doc.readyState === "complete" &&
    svgs.every((svg) => svg.childElementCount > 0);
  if (ready || framesLeft <= 0) {
    done();
    return;
  }
  requestAnimationFrame(() => waitForRender(doc, framesLeft - 1, done));
}
/**
 * Open a real top-level window for the print job.
 *
 * This is the fix for "Chrome shows an A4 page with the label floating in the
 * middle". Chrome sizes the print dialog from the *top-level* browsing
 * context, so a document parked in a hidden iframe inherits the app's page
 * setup (A4/Letter) and the iframe's own `@page { size: 38mm 25mm }` gets
 * ignored. A popup is its own top-level context, so `@page` is honoured and
 * the dialog opens on the label stock directly.
 *
 * Returns null when the popup is blocked (no user gesture, strict settings);
 * the caller then falls back to the iframe, which still carries the correct
 * `@page` plus an html/body sized to the label so nothing can float.
 */
function openPrintWindow(box: { width: number; height: number }): Window | null {
  if (typeof window === "undefined") return null;
  const features =
    `width=${box.width + 60},height=${box.height + 60},` +
    `menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=no`;
  try {
    const win = window.open("", "_blank", features);
    if (!win || win.closed || typeof win.document === "undefined") return null;
    win.document.title = "Label print";
    return win;
  } catch {
    return null;
  }
}

function printLabelDocument(
  documentHtml: string,
  input: LabelConfig | LabelSize,
  options: { onError?: (m: string) => void; onRender?: (doc: Document) => void } = {},
): boolean {
  const { onError, onRender } = options;
  const fail = (message: string): boolean => {
    if (onError) onError(message);
    else console.error(`[labelPrint] ${message}`);
    return false;
  };

  document.getElementById(IFRAME_ID)?.remove();

  // Always the MEDIA box (38x25mm on the shop's stock). Rotation is applied
  // to the inner .rot wrapper, so the frame and @page never disagree.
  const box = labelSizeToPx(mediaBoxFor(input));

  let target: Window | null = null;
  let doc: Document | null = null;
  let cleanup: (() => void) | null = null;
  let mode: "popup" | "iframe" = "popup";

  const popup = openPrintWindow(box);
  if (popup) {
    target = popup;
    doc = popup.document;
  } else {
    mode = "iframe";
    const iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.title = "Label print";
    iframe.setAttribute("aria-hidden", "true");
    // Off-screen rather than display:none — a display:none frame does not print.
    iframe.style.cssText =
      `position:fixed;left:-10000px;top:0;border:0;` +
      `width:${box.width}px;height:${box.height}px;`;
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentDocument;
    if (!frameDoc) {
      iframe.remove();
      return fail("print frame unavailable");
    }
    target = iframe.contentWindow;
    doc = frameDoc;
    cleanup = () => {
      window.removeEventListener("afterprint", cleanup as () => void);
      iframe.contentWindow?.removeEventListener("afterprint", cleanup as () => void);
      setTimeout(() => iframe.remove(), 2000);
    };
  }

  if (!doc) {
    if (cleanup) cleanup();
    else if (popup) popup.close();
    return fail("print document unavailable");
  }

  doc.open();
  doc.write(documentHtml);
  doc.close();

  try {
    onRender?.(doc);
  } catch (err) {
    console.warn("[labelPrint] label render failed", err);
  }

  if (mode === "popup") {
    cleanup = () => {
      window.removeEventListener("afterprint", cleanup as () => void);
      target?.removeEventListener("afterprint", cleanup as () => void);
      setTimeout(() => {
        try {
          if (target && !target.closed) target.close();
        } catch {
          /* already gone */
        }
      }, 2000);
    };
  }

  const submit = () => {
    waitForRender(doc as Document, 240, () => {
      requestAnimationFrame(() => {
        if (!target) {
          fail("print window unavailable");
          return;
        }
        try {
          target.focus();
          target.print();
        } catch (err) {
          fail(`Could not open the print dialog: ${String(err)}`);
        } finally {
          window.addEventListener("afterprint", cleanup as () => void);
          target.addEventListener("afterprint", cleanup as () => void);
          setTimeout(cleanup as () => void, 60000);
        }
      });
    });
  };

  requestAnimationFrame(() => requestAnimationFrame(submit));
  return true;
}

/**
 * Print the generated labels on label-sized paper, fully isolated from the
 * app layout and from the receipt `@page` rule in globals.css.
 *
 * Never touches `window.print()` on the app document — the job is submitted
 * from a hidden iframe whose document carries its own label-sized `@page`.
 *
 * `sheetHtml` (sheet stock only) collapses every label onto one sheet page.
 * Falls back to a bordered TEST label when no preview exists, so the
 * "Test Print" button always produces exactly one test label.
 */
export function printLabels(
  input: LabelConfig | LabelSize,
  onError?: (m: string) => void,
  sheetHtml?: string | null,
): boolean {
  const config = toLabelConfig(input);
  const nodes = Array.from(
    document.querySelectorAll("#barcode-print-area .barcode-label"),
  );
  const isTestFallback = nodes.length === 0;
  const labelHtml = isTestFallback
    ? [buildTestLabelHtml()]
    : nodes.map((node) => node.outerHTML);

  return printLabelDocument(
    buildLabelDocument(labelHtml, config, isTestFallback ? null : sheetHtml, isTestFallback),
    config,
    {
      onError,
      onRender: isTestFallback
        ? (doc) => {
            const svg = doc.querySelector<SVGSVGElement>(".test-barcode");
            if (!svg) return;
            JsBarcode(svg, "TEST-0001", {
              format: "CODE128",
              width: 2,
              height: 40,
              displayValue: false,
              margin: 0,
              background: "#ffffff",
              lineColor: "#000000",
            });
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          }
        : undefined,
    },
  );
}
