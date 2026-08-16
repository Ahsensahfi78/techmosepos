import type { Product, SaleInput } from "@/lib/types";

export const CATALOG_KEY = "techmos-offline-catalog";
export const QUEUE_KEY = "techmos-offline-queue";

export interface QueuedSale {
  id: string;
  queuedAt: number;
  input: SaleInput;
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / unavailable — ignore
  }
}

export function saveCatalog(products: Product[]): void {
  writeJSON(CATALOG_KEY, products);
}

export function loadCatalog(): Product[] | null {
  const value = readJSON<Product[]>(CATALOG_KEY);
  return Array.isArray(value) ? value : null;
}

export function clearCatalog(): void {
  try {
    window.localStorage.removeItem(CATALOG_KEY);
  } catch {
    // ignore
  }
}

export function enqueueSale(input: SaleInput): QueuedSale {
  const queue = loadQueue();
  const entry: QueuedSale = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `offline-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    queuedAt: Date.now(),
    input,
  };
  writeJSON(QUEUE_KEY, [...queue, entry]);
  return entry;
}

export function loadQueue(): QueuedSale[] {
  const value = readJSON<QueuedSale[]>(QUEUE_KEY);
  return Array.isArray(value) ? value : [];
}

export function removeQueued(ids: string[]): QueuedSale[] {
  const keep = loadQueue().filter((q) => !ids.includes(q.id));
  writeJSON(QUEUE_KEY, keep);
  return keep;
}

export function clearQueue(): void {
  try {
    window.localStorage.removeItem(QUEUE_KEY);
  } catch {
    // ignore
  }
}
