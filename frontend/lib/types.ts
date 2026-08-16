export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  category: string;
  cost_price?: number | null;
  sku?: string | null;
  barcode?: string | null;
  model?: string | null;
  image_url?: string | null;
  track_imei?: boolean;
  warranty_months?: number | null;
  min_stock?: number | null;
}

export interface SaleItem {
  product_id: number;
  qty: number;
  price?: number;
  imeis?: string[];
}

export interface SaleInput {
  items: SaleItem[];
  customer_id?: number | null;
  discount_amount?: number;
  tax_amount?: number;
  paid_amount?: number;
  payment_method?: string;
  payments?: SalePaymentInput[];
  loyalty_points_used?: number;
}

export interface SaleItemRecord {
  product_id: number;
  product_name: string;
  qty: number;
  price: number;
  line_total: number;
  sku?: string | null;
  barcode?: string | null;
  model?: string | null;
  returned_qty?: number;
}

export interface Sale {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  status: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  due_amount: number;
  payment_method: string | null;
  loyalty_points_used: number;
  created_by_name?: string | null;
  created_at: string;
  items: SaleItemRecord[];
}

export interface SalePaymentInput {
  amount: number;
  method?: string;
  reference?: string;
  note?: string;
}

export interface SaleReturnItemInput {
  product_id: number;
  qty: number;
}

export interface SaleReturnInput {
  reason?: string;
  items: SaleReturnItemInput[];
}

export interface SaleReturnItem {
  id: number;
  product_id: number;
  product_name: string;
  qty: number;
  price: number;
  line_total: number;
  sku?: string | null;
  barcode?: string | null;
}

export interface SaleReturn {
  id: number;
  return_number: string;
  sale_id: number;
  customer_id: number | null;
  customer_name: string | null;
  return_date: string;
  reason: string | null;
  total: number;
  created_at: string;
  items: SaleReturnItem[];
}

export interface StockSummaryItem {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: "low" | "out";
}

export interface StockReport {
  total_products: number;
  total_units: number;
  total_value: number;
  low_stock: StockSummaryItem[];
  out_of_stock: StockSummaryItem[];
}

export interface SalesReport {
  total_sales: number;
  total_revenue: number;
  top_products: { name: string; units_sold: number; revenue: number }[];
}

export interface CashierPerformanceRow {
  user_id: number;
  name: string;
  orders: number;
  revenue: number;
  avg_order: number;
  discount_given: number;
  items_sold: number;
  share_pct: number;
}

export interface TaxDiscountCollection {
  orders: number;
  revenue: number;
  discount_total: number;
  tax_total: number;
  points_redeemed: number;
  returns: number;
  refunded: number;
}

export interface TrendPoint {
  date: string;
  revenue: number;
}

export interface RecentSale {
  id: number;
  total: number;
  created_at: string;
  items: { product_name: string; qty: number; price: number }[];
}

export interface DashboardReport {
  today_sales: number;
  today_revenue: number;
  week_sales: number;
  week_revenue: number;
  weekly_trend: TrendPoint[];
  low_stock_count: number;
  out_of_stock_count: number;
  low_stock: StockSummaryItem[];
  recent_sales: RecentSale[];
}

export interface AnalyticsOverview {
  orders: number;
  revenue: number;
  avg_order_value: number;
  previous_orders: number;
  previous_revenue: number;
  revenue_change_pct: number;
  orders_change_pct: number;
}

export interface AnalyticsTrendPoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface AnalyticsTopProduct {
  product_id: number;
  name: string;
  units_sold: number;
  revenue: number;
  cogs: number;
}

export interface AnalyticsCategoryRow {
  category: string;
  units: number;
  revenue: number;
}

export interface AnalyticsPaymentRow {
  method: string;
  orders: number;
  amount: number;
}

export interface AnalyticsTopCustomer {
  customer_id: number;
  name: string;
  phone: string | null;
  orders: number;
  spend: number;
}

export interface AnalyticsProfitRow {
  category: string;
  revenue: number;
  cogs: number;
  profit: number;
}

export interface AnalyticsLowStock {
  product_id: number;
  name: string;
  sku: string | null;
  category: string | null;
  stock: number;
  min_stock: number;
  threshold: number;
  suggested_qty: number;
}

export interface AnalyticsDeadStock {
  product_id: number;
  name: string;
  sku: string | null;
  stock: number;
  category: string | null;
}

export interface AnalyticsRecentTxn {
  key: string;
  type: string;
  db_id: number;
  reference: string;
  date: string;
  party_name: string | null;
  total: number;
  status: string;
  item_count: number;
}

export interface AnalyticsReport {
  range: { from: string; to: string };
  overview: AnalyticsOverview;
  trend: AnalyticsTrendPoint[];
  top_products: AnalyticsTopProduct[];
  category_breakdown: AnalyticsCategoryRow[];
  payment_breakdown: AnalyticsPaymentRow[];
  customer_insights: {
    total_customers: number;
    new_customers: number;
    returning_customers: number;
    active_customers: number;
    top_customers: AnalyticsTopCustomer[];
  };
  profit: {
    revenue: number;
    cogs: number;
    gross_profit: number;
    margin_pct: number;
    by_category: AnalyticsProfitRow[];
  };
  dead_stock: AnalyticsDeadStock[];
  low_stock: AnalyticsLowStock[];
  recent_transactions: AnalyticsRecentTxn[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface LoginSession {
  id: number;
  user_agent: string | null;
  ip_address: string | null;
  revoked: boolean;
  created_at: string;
  expires_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface NamedMaster {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Warehouse {
  id: number;
  name: string;
  location: string | null;
  is_default: boolean;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  due_balance: number;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  loyalty_points: number;
  due_balance: number;
  is_active: boolean;
  created_at: string;
}

export interface LedgerEntry {
  id: number;
  party_type: string;
  party_id: number;
  entry_type: string;
  direction: string;
  amount: number;
  reference: string | null;
  reference_id: number | null;
  note: string | null;
  entry_date: string;
  created_at: string;
}

export interface PaymentRecord {
  id: number;
  party_type: string;
  party_id: number;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  payment_date: string;
  created_at: string;
}

export interface SupplierReport {
  supplier_id: number;
  name: string;
  company: string | null;
  due_balance: number;
  total_purchases: number;
  purchase_count: number;
  total_payments: number;
  payment_count: number;
  total_credit_notes: number;
  products_supplied: number;
  recent_entries: LedgerEntry[];
}

export interface CustomerReport {
  customer_id: number;
  name: string;
  phone: string | null;
  due_balance: number;
  credit_limit: number;
  loyalty_points: number;
  total_sales: number;
  sale_count: number;
  total_payments: number;
  payment_count: number;
  total_returns: number;
  recent_entries: LedgerEntry[];
}

export type PartyPaymentInput = {
  amount: number;
  method?: string;
  reference?: string;
  note?: string;
};

export type PartyCreditNoteInput = {
  amount: number;
  reference?: string;
  note?: string;
};

export interface PurchaseOrderItem {
  id: number;
  product_id: number;
  product_name: string;
  qty_ordered: number;
  qty_received: number;
  cost_price: number;
  line_total: number;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number | null;
  status: string;
  order_date: string;
  expected_date: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  created_at: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseItem {
  id: number;
  product_id: number;
  product_name: string;
  qty: number;
  cost_price: number;
  line_total: number;
}

export interface Purchase {
  id: number;
  purchase_number: string;
  po_id: number | null;
  po_number: string | null;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  purchase_date: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  items: PurchaseItem[];
}

export interface PurchaseReturn {
  id: number;
  return_number: string;
  purchase_id: number;
  purchase_number: string;
  supplier_id: number;
  supplier_name: string;
  return_date: string;
  reason: string | null;
  total: number;
  created_at: string;
  items: PurchaseItem[];
}

export interface PurchaseOrderLineInput {
  product_id: number;
  qty_ordered: number;
  cost_price: number;
}

export interface PurchaseOrderInput {
  supplier_id: number;
  warehouse_id?: number;
  expected_date?: string;
  discount_amount?: number;
  tax_amount?: number;
  notes?: string;
  items: PurchaseOrderLineInput[];
}

// ── Expenses & Income ──────────────────────────────────────────────────
export interface FinanceEntry {
  id: number;
  category: string;
  amount: number;
  note: string | null;
  entry_date: string;
  created_at: string;
  created_by: number | null;
  created_by_name: string | null;
}

export interface FinanceEntryInput {
  category: string;
  amount: number;
  note?: string;
  entry_date?: string;
}

export interface FinanceSummary {
  total_expenses: number;
  total_income: number;
  net: number;
  by_category: Record<string, number>;
}

// ── Cheques ────────────────────────────────────────────────────────────
export interface Cheque {
  id: number;
  direction: string;
  number: string | null;
  bank: string | null;
  account_name: string | null;
  payee: string | null;
  amount: number;
  due_date: string | null;
  status: string;
  notes: string | null;
  created_by: number | null;
  created_by_name: string | null;
  cleared_at: string | null;
  created_at: string;
}

export interface ChequeInput {
  direction: string;
  number?: string;
  bank?: string;
  account_name?: string;
  payee?: string;
  amount: number;
  due_date?: string;
  notes?: string;
}

// ── Settings ───────────────────────────────────────────────────────────
export interface SettingValue {
  key: string;
  value: string | null;
  updated_at: string | null;
}

export interface SettingsMap {
  settings: Record<string, SettingValue>;
}

/** Print-time settings returned by GET /settings/print (no admin permission needed). */
export interface PrintSettings {
  store_name?: string;
  currency?: string;
  receipt_footer?: string;
}

// ── Quotations ─────────────────────────────────────────────────────────
export interface QuotationItemInput {
  product_id: number;
  qty: number;
  price: number;
}

export interface QuotationInput {
  customer_id?: number | null;
  status?: string;
  discount_amount?: number;
  tax_rate?: number;
  notes?: string;
  valid_until?: string;
  items: QuotationItemInput[];
}

export interface QuotationItem {
  id: number;
  product_id: number;
  product_name: string;
  qty: number;
  price: number;
  line_total: number;
}

export interface Quotation {
  id: number;
  quotation_number: string;
  customer_id: number | null;
  customer_name: string | null;
  status: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  valid_until: string | null;
  converted_sale_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
  items: QuotationItem[];
}

// ── Stock adjustments ──────────────────────────────────────────────────
export interface StockAdjustmentItemInput {
  product_id: number;
  qty_delta: number;
}

export interface StockAdjustmentInput {
  warehouse_id?: number | null;
  reason?: string;
  note?: string;
  items: StockAdjustmentItemInput[];
}

export interface StockAdjustmentItem {
  id: number;
  product_id: number;
  product_name: string;
  qty_delta: number;
  previous_stock: number;
  new_stock: number;
}

export interface StockAdjustment {
  id: number;
  reference: string;
  warehouse_id: number | null;
  warehouse_name: string | null;
  reason: string;
  note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  items: StockAdjustmentItem[];
}

// ── Warranty / IMEI units ──────────────────────────────────────────────
export interface ProductUnit {
  id: number;
  product_id: number;
  product_name: string;
  imei: string | null;
  serial_number: string | null;
  status: string;
  sale_item_id: number | null;
  sale_id: number | null;
  customer_name: string | null;
  warranty_months: number | null;
  warranty_start: string | null;
  warranty_expiry: string | null;
  sold_at: string | null;
  created_at: string;
}

export interface UnitInput {
  product_id: number;
  imei?: string;
  serial_number?: string;
  warranty_months?: number;
}

export interface ReorderItem {
  product_id: number;
  name: string;
  stock: number;
  min_stock: number;
  threshold: number;
  suggested_qty: number;
}

// ── Repairs ────────────────────────────────────────────────────────────
export interface Repair {
  id: number;
  repair_number: string;
  customer_id: number | null;
  customer_name: string | null;
  product_name: string;
  imei: string | null;
  issue: string | null;
  status: string;
  service_charge: number;
  parts_cost: number;
  deposit: number;
  paid_amount: number;
  total: number;
  technician: string | null;
  notes: string | null;
  received_by: number | null;
  received_by_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface RepairInput {
  customer_id?: number | null;
  product_name: string;
  imei?: string;
  issue?: string;
  status?: string;
  service_charge?: number;
  parts_cost?: number;
  deposit?: number;
  paid_amount?: number;
  technician?: string;
  notes?: string;
}

// ── Unified Transactions & History ───────────────────────────────────────
export interface TransactionRecord {
  type: "sale" | "purchase" | "sale_return" | "purchase_return";
  db_id: number;
  key: string;
  reference: string;
  date: string;
  party_type: "customer" | "supplier" | null;
  party_id: number | null;
  party_name: string | null;
  party_phone: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  payment_method: string | null;
  status: string;
  item_count: number;
  created_by: string | null;
}

export interface SourcePurchase {
  purchase_id: number;
  purchase_number: string;
  purchase_date: string | null;
  supplier_id: number;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_email: string | null;
  cost_price: number;
  line_total: number;
  qty_purchased: number;
  invoice_number: string | null;
}

export interface TransactionItem {
  product_id: number;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  source_purchase?: SourcePurchase | null;
}

export interface TransactionPayment {
  amount: number;
  method: string;
  reference: string | null;
  date: string;
}

export interface TransactionMovement {
  product_id: number;
  product_name: string;
  change_qty: number;
  previous_stock: number;
  new_stock: number;
  reason: string;
  created_at: string;
}

export interface RelatedTransaction {
  type: string;
  db_id: number;
  key: string;
  reference: string;
  date: string | null;
  total: number;
  status: string;
}

export interface TransactionDetail {
  type: string;
  db_id: number;
  key: string;
  reference: string;
  date: string;
  party_type: "customer" | "supplier" | null;
  party_id: number | null;
  party_name: string | null;
  party_phone: string | null;
  party_email: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  payment_method: string | null;
  status: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  items: TransactionItem[];
  payments: TransactionPayment[];
  movements: TransactionMovement[];
  related_returns: RelatedTransaction[];
  original: RelatedTransaction | null;
}

export interface GlobalSearchHit {
  kind: "customer" | "supplier" | "product";
  id: number;
  title: string;
  subtitle: string | null;
  meta: string | null;
}

export interface GlobalSearchResult {
  customers: GlobalSearchHit[];
  suppliers: GlobalSearchHit[];
  products: GlobalSearchHit[];
  transactions: TransactionRecord[];
}

export interface ProductHistorySummary {
  product_id: number;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  opening_stock: number;
  purchased: number;
  sold: number;
  sale_returns: number;
  purchase_returns: number;
  adjustments: number;
  current_stock: number;
}
