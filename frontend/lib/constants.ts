export const CURRENCY = "Rs";
export const LOW_STOCK_THRESHOLD = 5;

export const CATEGORY_ICONS: Record<string, string> = {
  Drinks: "☕",
  Bakery: "🥐",
  Food: "🥪",
};

export const DEFAULT_ICON = "🛍️";

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? DEFAULT_ICON;
}

export function formatMoney(value: number): string {
  return `${CURRENCY} ${value.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-LK", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
