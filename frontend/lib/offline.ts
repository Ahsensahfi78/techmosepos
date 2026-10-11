import type { Product, ProductCreateInput, SaleInput } from "@/lib/types";

export const CATALOG_KEY = "techmos-offline-catalog";
export const QUEUE_KEY = "techmos-offline-queue";
export const PRODUCT_QUEUE_KEY = "techmos-offline-product-queue";

export interface QueuedSale {
  id: string;
  queuedAt: number;
  input: SaleInput;
}

export interface QueuedProduct {
  id: string;
  queuedAt: number;
  attempts: number;
  payload: ProductCreateInput;
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

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `offline-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function enqueueProduct(payload: ProductCreateInput): QueuedProduct {
  const queue = loadProductQueue();
  const entry: QueuedProduct = {
    id: newId(),
    queuedAt: Date.now(),
    attempts: 0,
    payload,
  };
  writeJSON(PRODUCT_QUEUE_KEY, [...queue, entry]);
  return entry;
}

export function loadProductQueue(): QueuedProduct[] {
  const value = readJSON<QueuedProduct[]>(PRODUCT_QUEUE_KEY);
  return Array.isArray(value) ? value : [];
}

export function removeQueuedProducts(ids: string[]): QueuedProduct[] {
  const keep = loadProductQueue().filter((q) => !ids.includes(q.id));
  writeJSON(PRODUCT_QUEUE_KEY, keep);
  return keep;
}

export function updateQueuedProduct(
  id: string,
  changes: Partial<Pick<QueuedProduct, "payload" | "attempts">>
): QueuedProduct[] {
  const keep = loadProductQueue().map((q) =>
    q.id === id ? { ...q, ...changes } : q
  );
  writeJSON(PRODUCT_QUEUE_KEY, keep);
  return keep;
}
