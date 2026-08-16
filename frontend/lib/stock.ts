export type StockStatus = "out" | "low" | "ok";

export interface StockTone {
  label: string;
  badge: string;
  dot: string;
  status: StockStatus;
}

export function stockStatus(stock: number, min?: number | null): StockStatus {
  if (stock <= 0) return "out";
  const threshold = Math.max(1, min && min > 0 ? min : 1);
  return stock < threshold ? "low" : "ok";
}

export function stockTone(stock: number, min?: number | null): StockTone {
  const status = stockStatus(stock, min);
  if (status === "out")
    return {
      label: "Sold out",
      badge: "bg-red-500 text-white",
      dot: "bg-red-500",
      status,
    };
  if (status === "low")
    return {
      label: `${stock} left`,
      badge: "bg-amber-500 text-white",
      dot: "bg-amber-500",
      status,
    };
  return {
    label: `In stock · ${stock}`,
    badge: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
    status,
  };
}

export function isLowStock(stock: number, min?: number | null): boolean {
  return stockStatus(stock, min) !== "ok";
}

/** Sort so sold-out items come first, then low-stock, then well-stocked. */
export function sortByStockPriority<T extends { stock: number; min_stock?: number | null }>(
  items: T[]
): T[] {
  const rank = (s: StockStatus) => (s === "out" ? 0 : s === "low" ? 1 : 2);
  return [...items].sort(
    (a, b) =>
      rank(stockStatus(a.stock, a.min_stock)) - rank(stockStatus(b.stock, b.min_stock)) ||
      a.stock - b.stock ||
      String(a.stock).localeCompare(String(b.stock))
  );
}
