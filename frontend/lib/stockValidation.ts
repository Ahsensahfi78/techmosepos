export interface StockIssue {
  /** The requested quantity. */
  requested: number;
  /** Units currently available to sell. */
  available: number;
  /** True when there is nothing left to sell. */
  out: boolean;
  /** True when the request exceeds available stock (and stock > 0). */
  over: boolean;
  /** True when the requested quantity is sellable. */
  ok: boolean;
  /** How many units are missing when over, otherwise 0. */
  short: number;
}

export function checkStock(available: number, requested: number): StockIssue {
  const avail = Math.max(0, Math.floor(available || 0));
  const req = Math.max(0, Math.floor(requested || 0));
  const out = avail <= 0;
  const over = !out && req > avail;
  return {
    requested: req,
    available: avail,
    out,
    over,
    ok: !out && !over,
    short: over ? req - avail : 0,
  };
}

export interface StockValidationLine {
  product: { id: number; stock?: number };
  qty: number;
}

export interface InvalidLine<T extends StockValidationLine> {
  line: T;
  issue: StockIssue;
}

/**
 * Returns every cart line whose requested quantity cannot be fulfilled
 * against live stock. `stockOf` provides the current available units per
 * product id; falls back to the line's snapshot stock when unknown.
 */
export function invalidCartLines<T extends StockValidationLine>(
  lines: T[],
  stockOf: (id: number) => number | undefined
): Array<InvalidLine<T>> {
  const invalid: Array<InvalidLine<T>> = [];
  for (const line of lines) {
    const available = stockOf(line.product.id) ?? line.product.stock ?? 0;
    const issue = checkStock(available, line.qty);
    if (!issue.ok) invalid.push({ line, issue });
  }
  return invalid;
}

export function stockWarningMessage(name: string, issue: StockIssue): string {
  if (issue.out) return `"${name}" is out of stock`;
  return `Only ${issue.available} of "${name}" are available. You requested ${issue.requested}.`;
}
