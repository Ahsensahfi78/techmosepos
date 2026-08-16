import type { Customer, Product } from "@/lib/types";
import type { ProductMatch } from "@/lib/search";

export type Confidence = "high" | "medium" | "low";

/** Broad intent labels used by the classifier. */
export type IntentKind =
  | "add_to_cart"
  | "remove_from_cart"
  | "set_cart_qty"
  | "decrease_cart_qty"
  | "show_cart"
  | "clear_cart"
  | "hold_invoice"
  | "open_held"
  | "resume_invoice"
  | "cancel_invoice"
  | "new_invoice"
  | "checkout"
  | "select_customer"
  | "find_customer"
  | "find_invoice"
  | "invoice_customer"
  | "invoice_items"
  | "print_invoice"
  | "today_sales"
  | "stock_report"
  | "product_stock"
  | "create_return"
  | "start_return"
  | "open_page"
  | "open_history"
  | "plain_search"
  | "unknown";

/** Raised when a product term is ambiguous and the cashier must pick one. */
export interface NlAskProduct {
  term: string;
  qty: number;
  matches: ProductMatch[];
  on: "add" | "stock" | "remove" | "return" | "qty";
}

/** A structured action the POS layer turns into real work. */
export type NlAction =
  | { kind: "multi"; steps: NlAction[] }
  | { kind: "ask"; message: string }
  | { kind: "plain_search"; term: string }
  | { kind: "add_to_cart"; lines: { product: Product; qty: number }[]; partial: boolean; term: string; ask?: NlAskProduct }
  | { kind: "ask_product"; ask: NlAskProduct }
  | { kind: "remove_from_cart"; product: Product | null; term: string }
  | { kind: "set_cart_qty"; product: Product | null; qty: number }
  | { kind: "decrease_cart_qty"; product: Product | null }
  | { kind: "show_cart" }
  | { kind: "clear_cart" }
  | { kind: "hold_invoice" }
  | { kind: "open_held" }
  | { kind: "resume_invoice" }
  | { kind: "cancel_invoice" }
  | { kind: "new_invoice" }
  | { kind: "checkout"; method: string }
  | { kind: "select_customer"; customer: Customer; term: string }
  | { kind: "find_customer"; term: string }
  | { kind: "find_invoice"; invoiceNo: string | null }
  | { kind: "invoice_customer"; invoiceNo: string | null }
  | { kind: "invoice_items"; invoiceNo: string | null }
  | { kind: "print_invoice"; invoiceNo: string | null; last: boolean }
  | { kind: "today_sales" }
  | { kind: "stock_report" }
  | { kind: "product_stock"; product: Product | null; term: string }
  | { kind: "create_return"; invoiceNo: string | null; product: Product | null; qty: number; term: string }
  | { kind: "open_page"; page: string }
  | { kind: "open_history" }
  | { kind: "start_return" }
  | { kind: "unknown"; text: string };

/** Conversation memory carried between turns. */
export interface NlContext {
  lastProductId?: number;
  lastProductName?: string;
  lastInvoiceNo?: string;
  lastCustomerId?: number;
  lastCustomerName?: string;
  lastKind?: string;
}

export interface NlOutcome {
  action: NlAction | null;
  confidence: Confidence;
  ctx: NlContext;
}

export interface UnderstandOpts {
  products: Product[];
  /** Current cart contents (reserved; not currently read). */
  cart?: unknown;
  customers: Customer[];
  ctx: NlContext;
}
