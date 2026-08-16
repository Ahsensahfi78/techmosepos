import { stockTone } from "@/lib/stock";

export { stockTone } from "@/lib/stock";

export function StockBadge({ stock, min }: { stock: number; min?: number | null }) {
  const tone = stockTone(stock, min);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}
