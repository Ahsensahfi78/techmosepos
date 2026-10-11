export const RECEIPT_WIDTH_MIN_MM = 58;
export const RECEIPT_WIDTH_MAX_MM = 80;
export const RECEIPT_WIDTH_DEFAULT_MM = 80;

/**
 * Page height used before the receipt has been measured. Generous enough that
 * a real receipt never paginates on its own; fitReceiptPage() replaces it with
 * the exact height just before printing.
 */
export const RECEIPT_PAGE_DEFAULT_HEIGHT_MM = 300;
export const RECEIPT_PAGE_MIN_HEIGHT_MM = 30;
export const RECEIPT_PAGE_MAX_HEIGHT_MM = 2000;

/** Slack so sub-pixel rounding can never spill the footer onto page 2. */
export const RECEIPT_PAGE_TRIM_MM = 1;

export const PX_PER_INCH = 96;
export const MM_PER_INCH = 25.4;

/** id of the <style> element that owns the runtime `@page` rule. */
export const RECEIPT_PAGE_STYLE_ID = "receipt-page-style";

/**
 * Parse a configured roll width and clamp it to what the hardware supports.
 * Anything unparsable falls back to 80mm.
 */
export function parseReceiptWidth(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return RECEIPT_WIDTH_DEFAULT_MM;
  return Math.min(RECEIPT_WIDTH_MAX_MM, Math.max(RECEIPT_WIDTH_MIN_MM, Math.trunc(n)));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function pxToMm(px: number): number {
  return (px / PX_PER_INCH) * MM_PER_INCH;
}

/**
 * Write the `@page` rule.
 *
 * Chrome refuses CSS custom properties inside `@page`, so the media size has
 * to be written as a literal rule at runtime. Appending the style element last
 * means it lands after globals.css in the cascade and wins over the static
 * fallback there.
 *
 * Both dimensions must be lengths: Chrome (154) silently discards
 * `size: 80mm auto` as invalid, which is what made every receipt fall back to
 * A4 and print with a huge blank tail. `size` only accepts `<length>{1,2}` —
 * a single length means a square page, and `auto` cannot be paired with one.
 * So the height is always measured and supplied explicitly.
 *
 * Labels are unaffected: they print from their own iframe document built in
 * lib/labelPrint.ts, which never sees this rule.
 */
export function applyReceiptPageSize(
  widthMm: string | number | null | undefined,
  heightMm: string | number | null | undefined
): { widthMm: number; heightMm: number } {
  const width = clamp(parseReceiptWidth(widthMm), RECEIPT_WIDTH_MIN_MM, RECEIPT_WIDTH_MAX_MM);
  // Number(null) and Number("") are 0, which would silently clamp to the
  // minimum page height instead of falling back to the default.
  const rawHeight =
    heightMm === null || heightMm === undefined ? "" : String(heightMm).trim();
  const parsedHeight = rawHeight === "" ? Number.NaN : Number(rawHeight);
  const height = clamp(
    Number.isFinite(parsedHeight) ? Math.ceil(parsedHeight) : RECEIPT_PAGE_DEFAULT_HEIGHT_MM,
    RECEIPT_PAGE_MIN_HEIGHT_MM,
    RECEIPT_PAGE_MAX_HEIGHT_MM
  );

  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--receipt-width", `${width}mm`);

    let style = document.getElementById(RECEIPT_PAGE_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = RECEIPT_PAGE_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
  }

  return { widthMm: width, heightMm: height };
}

/**
 * Set the roll width, keeping a safe default page height until the receipt
 * itself has been measured.
 */
export function applyReceiptWidth(
  mm: string | number | null | undefined,
  heightMm: string | number | null | undefined = RECEIPT_PAGE_DEFAULT_HEIGHT_MM
): number {
  return applyReceiptPageSize(mm ?? RECEIPT_WIDTH_DEFAULT_MM, heightMm).widthMm;
}

/** Measure a rendered receipt (in CSS px) and convert to millimetres. */
export function measureReceiptHeightMm(el: Element | null | undefined): number {
  if (!el) return RECEIPT_PAGE_DEFAULT_HEIGHT_MM;
  const rect = el.getBoundingClientRect();
  const px = rect.height || el.scrollHeight || 0;
  if (!px) return RECEIPT_PAGE_DEFAULT_HEIGHT_MM;
  return pxToMm(px);
}
/**
 * Size the printed page to the receipt that is actually on screen, so the
 * output stops right after the footer instead of running to the bottom of an
 * A4 sheet.
 *
 * Pass the on-screen preview (the hidden print portal has no box while
 * `display: none`, so it cannot be measured).
 */
export function fitReceiptPage(
  el: Element | null | undefined,
  widthMm: string | number | null | undefined
): { widthMm: number; heightMm: number } {
  const height = measureReceiptHeightMm(el) + RECEIPT_PAGE_TRIM_MM;
  return applyReceiptPageSize(widthMm ?? RECEIPT_WIDTH_DEFAULT_MM, height);
}

/* ── Upside-down printers ──────────────────────────────────────────────── */

/** Settings key holding the 180° rotation toggle. */
export const RECEIPT_ROTATE_KEY = "receipt_rotate_180";

/** CSS custom property the print rules read. */
export const RECEIPT_ROTATE_VAR = "--receipt-rotate";

export type ReceiptRotation = 0 | 180;

/**
 * Parse the `receipt_rotate_180` setting.
 *
 * Every truthy spelling collapses to 180; anything else falls back to upright
 * so an unknown value can never produce a sideways receipt.
 */
export function parseReceiptRotation(raw: unknown): ReceiptRotation {
  if (raw === true || raw === 1) return 180;
  if (raw === false || raw === 0 || raw === null || raw === undefined) return 0;
  if (typeof raw !== "string" && typeof raw !== "number") return 0;
  const value = String(raw).trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on"
    ? 180
    : 0;
}

/**
 * Publish the rotation to the print stylesheet.
 *
 * The rule in globals.css only exists inside `@media print`, so the on-screen
 * preview in Settings and in the receipt modal stays upright no matter what
 * this returns. Writing the custom property here (rather than a literal in
 * the CSS) is what lets a saved setting reach a stylesheet that React never
 * re-renders.
 */
export function applyReceiptRotation(raw: unknown): ReceiptRotation {
  const degrees = parseReceiptRotation(raw);
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(
      RECEIPT_ROTATE_VAR,
      `${degrees}deg`
    );
  }
  return degrees;
}
