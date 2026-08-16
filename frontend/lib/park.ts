export interface ParkedCartLine {
  product_id: number;
  name: string;
  price: number;
  qty: number;
  imeis?: string[];
  /** Optional per-unit price override applied at hold time. */
  unitPrice?: number;
  /** Optional line-level discount (Rs) applied at hold time. */
  lineDiscount?: number;
  sku?: string | null;
  barcode?: string | null;
}

export interface ParkedOrder {
  id: string;
  label: string;
  /** Human-friendly hold reference, e.g. "H-0007". */
  holdNumber: string;
  lines: ParkedCartLine[];
  discount: number;
  tax: number;
  customerId: number | null;
  customerName: string | null;
  cashier: string | null;
  note: string | null;
  createdAt: number;
}

const HOLD_COUNTER_KEY = "techmos-hold-counter";

function readCounter(): number {
  try {
    const raw = window.localStorage.getItem(HOLD_COUNTER_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCounter(n: number): void {
  try {
    window.localStorage.setItem(HOLD_COUNTER_KEY, String(n));
  } catch {
    // ignore
  }
}

/** Generates the next sequential hold reference (H-0001, H-0002, ...). */
export function nextHoldNumber(): string {
  const next = readCounter() + 1;
  writeCounter(next);
  return `H-${String(next).padStart(4, "0")}`;
}

export function createParkedOrder(input: {
  label?: string;
  holdNumber?: string;
  lines: ParkedCartLine[];
  discount: number;
  tax: number;
  customerId: number | null;
  customerName: string | null;
  cashier?: string | null;
  note?: string | null;
  createdAt?: number;
}): ParkedOrder {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `park-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    label: input.label?.trim() || `Order ${new Date().toLocaleTimeString()}`,
    holdNumber: input.holdNumber ?? nextHoldNumber(),
    lines: input.lines,
    discount: input.discount,
    tax: input.tax,
    customerId: input.customerId,
    customerName: input.customerName,
    cashier: input.cashier ?? null,
    note: input.note ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function addParked(orders: ParkedOrder[], order: ParkedOrder): ParkedOrder[] {
  return [order, ...orders];
}

export function removeParked(orders: ParkedOrder[], id: string): ParkedOrder[] {
  return orders.filter((o) => o.id !== id);
}

/** Line total for a parked line, honoring a price override and line discount. */
export function parkedLineTotal(l: ParkedCartLine): number {
  const unit = l.unitPrice ?? l.price;
  return Math.max(0, unit * l.qty - (l.lineDiscount ?? 0));
}

export function updateParkedNote(
  orders: ParkedOrder[],
  id: string,
  note: string
): ParkedOrder[] {
  return orders.map((o) => (o.id === id ? { ...o, note: note || null } : o));
}

export function restoreParked<T extends ParkedOrder>(order: ParkedOrder): {
  lines: T["lines"];
  discount: number;
  tax: number;
  customerId: number | null;
  customerName: string | null;
} {
  return {
    lines: order.lines,
    discount: order.discount,
    tax: order.tax,
    customerId: order.customerId,
    customerName: order.customerName,
  };
}
