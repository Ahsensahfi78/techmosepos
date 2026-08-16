import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  saveTokens,
} from "./auth";
import type {
  AuditLog,
  Cheque,
  ChequeInput,
  Customer,
  CustomerReport,
  DashboardReport,
  FinanceEntry,
  FinanceEntryInput,
  FinanceSummary,
  LedgerEntry,
  LoginSession,
  NamedMaster,
  Paginated,
  PartyCreditNoteInput,
  PartyPaymentInput,
  PaymentRecord,
  Product,
  ProductUnit,
  Purchase,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseReturn,
  Quotation,
  QuotationInput,
  Repair,
  RepairInput,
  ReorderItem,
  Sale,
  SaleInput,
  SaleItem,
  SalePaymentInput,
  SaleReturn,
  SaleReturnInput,
  SalesReport,
  SettingValue,
  SettingsMap,
  PrintSettings,
  StockAdjustment,
  StockAdjustmentInput,
  StockReport,
  Supplier,
  SupplierReport,
  AnalyticsReport,
  CashierPerformanceRow,
  GlobalSearchResult,
  ProductHistorySummary,
  TaxDiscountCollection,
  TokenResponse,
  TransactionDetail,
  TransactionRecord,
  UnitInput,
  User,
  Warehouse,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const PUBLIC_PATHS = ["/auth/login", "/auth/refresh"];

function toQueryString(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") search.set(k, String(v));
  });
  return search.toString();
}

let refreshing: Promise<boolean> | null = null;

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path.startsWith(p));
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as TokenResponse;
        saveTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function redirectToLogin(): void {
  clearTokens();
  if (typeof window === "undefined") return;
  const next = encodeURIComponent(
    window.location.pathname + window.location.search
  );
  window.location.assign(`/login?next=${next}`);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<T> {
  const doFetch = (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };

  let res = await doFetch(getAccessToken());

  if (res.status === 401 && !isPublic(path) && !retried) {
    if (await tryRefresh()) {
      res = await doFetch(getAccessToken());
    } else {
      redirectToLogin();
      throw new Error("Session expired. Please sign in again.");
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const doFetch = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
  let res = await doFetch(getAccessToken());
  if (res.status === 401) {
    if (await tryRefresh()) {
      res = await doFetch(getAccessToken());
    } else {
      redirectToLogin();
      throw new Error("Session expired. Please sign in again.");
    }
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function download(path: string, fallbackName: string): Promise<void> {
  const doFetch = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  let res = await doFetch(getAccessToken());
  if (res.status === 401) {
    if (await tryRefresh()) {
      res = await doFetch(getAccessToken());
    } else {
      redirectToLogin();
      throw new Error("Session expired. Please sign in again.");
    }
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<TokenResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    me: () => request<User>("/auth/me"),
    logout: async (): Promise<void> => {
      const access = getAccessToken();
      const refresh = getRefreshToken();
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (access) headers.Authorization = `Bearer ${access}`;
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers,
          body: JSON.stringify({ refresh_token: refresh ?? undefined }),
        });
      } catch {
        // ignore — always clear locally
      } finally {
        clearTokens();
      }
    },
  },
  products: {
    list: () => request<Product[]>("/products"),
    create: (data: Omit<Product, "id">) =>
      request<Product>("/products", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<Omit<Product, "id">>) =>
      request<Product>(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (id: number) =>
      request<void>(`/products/${id}`, { method: "DELETE" }),
  },
  sales: {
    create: (data: SaleInput) =>
      request<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    list: (params: { limit?: number; status?: string; customer_id?: number } = {}) =>
      request<Sale[]>(`/sales?${toQueryString(params)}`),
    get: (id: number) => request<Sale>(`/sales/${id}`),
    pay: (id: number, data: SalePaymentInput) =>
      request<PaymentRecord>(`/sales/${id}/payments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    listReturns: (params: { limit?: number; sale_id?: number; customer_id?: number } = {}) =>
      request<SaleReturn[]>(`/sales/returns?${toQueryString(params)}`),
    createReturn: (id: number, data: SaleReturnInput) =>
      request<SaleReturn>(`/sales/${id}/returns`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  reports: {
    stock: () => request<StockReport>("/reports/stock"),
    sales: (days?: number) =>
      request<SalesReport>(`/reports/sales${days ? `?days=${days}` : ""}`),
    dashboard: () => request<DashboardReport>("/reports/dashboard"),
    analytics: (params: {
      date_from?: string;
      date_to?: string;
      trend_days?: number;
    } = {}) =>
      request<AnalyticsReport>(
        `/reports/analytics?${toQueryString(params)}`
      ),
    supplier: (id: number) =>
      request<SupplierReport>(`/reports/suppliers/${id}`),
    customer: (id: number) =>
      request<CustomerReport>(`/reports/customers/${id}`),
    cashiers: (days?: number) =>
      request<{ cashiers: CashierPerformanceRow[] }>(
        `/reports/cashiers${days ? `?days=${days}` : ""}`
      ),
    taxesDiscounts: (days?: number) =>
      request<TaxDiscountCollection>(
        `/reports/taxes-discounts${days ? `?days=${days}` : ""}`
      ),
  },
  ledger: {
    supplierEntries: (id: number, params: { page?: number; page_size?: number; entry_type?: string } = {}) =>
      request<Paginated<LedgerEntry>>(
        `/suppliers/${id}/ledger?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
          ) as Record<string, string>
        ).toString()}`
      ),
    supplierPayment: (id: number, data: PartyPaymentInput) =>
      request<PaymentRecord>(`/suppliers/${id}/payments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    supplierCreditNote: (id: number, data: PartyCreditNoteInput) =>
      request<LedgerEntry>(`/suppliers/${id}/credit-notes`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    supplierOpeningBalance: (id: number, data: PartyCreditNoteInput) =>
      request<LedgerEntry>(`/suppliers/${id}/opening-balance`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    customerEntries: (id: number, params: { page?: number; page_size?: number; entry_type?: string } = {}) =>
      request<Paginated<LedgerEntry>>(
        `/customers/${id}/ledger?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
          ) as Record<string, string>
        ).toString()}`
      ),
    customerPayment: (id: number, data: PartyPaymentInput) =>
      request<PaymentRecord>(`/customers/${id}/payments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    customerCreditNote: (id: number, data: PartyCreditNoteInput) =>
      request<LedgerEntry>(`/customers/${id}/credit-notes`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    customerOpeningBalance: (id: number, data: PartyCreditNoteInput) =>
      request<LedgerEntry>(`/customers/${id}/opening-balance`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    customerLoyalty: (id: number, pointsDelta: number) =>
      request<Customer>(`/customers/${id}/loyalty`, {
        method: "POST",
        body: JSON.stringify({ points_delta: pointsDelta }),
      }),
  },
  users: {
    list: (params: {
      page?: number;
      page_size?: number;
      search?: string;
      role?: string;
    } = {}) =>
      request<Paginated<User>>(
        `/users?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
          ) as Record<string, string>
        ).toString()}`
      ),
    create: (data: {
      username: string;
      email: string;
      full_name: string;
      password: string;
      role: string;
      is_active?: boolean;
    }) =>
      request<User>("/users", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (
      id: number,
      data: Partial<{
        username: string;
        email: string;
        full_name: string;
        role: string;
        password: string;
        is_active: boolean;
      }>
    ) =>
      request<User>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (id: number) =>
      request<void>(`/users/${id}`, { method: "DELETE" }),
    mySessions: () => request<LoginSession[]>("/users/me/sessions"),
    sessions: (id: number) =>
      request<LoginSession[]>(`/users/${id}/sessions`),
    activity: (id: number) =>
      request<Paginated<AuditLog>>(`/users/${id}/activity`),
  },
  audit: {
    list: (params: {
      page?: number;
      page_size?: number;
      search?: string;
      entity_type?: string;
      user_id?: number;
    } = {}) =>
      request<Paginated<AuditLog>>(
        `/audit-logs?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
          ) as Record<string, string>
        ).toString()}`
      ),
  },
  purchases: {
    orders: (params: {
      page?: number;
      page_size?: number;
      status?: string;
      supplier_id?: number;
      search?: string;
    } = {}) =>
      request<Paginated<PurchaseOrder>>(
        `/purchase-orders?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
          ) as Record<string, string>
        ).toString()}`
      ),
    createOrder: (data: PurchaseOrderInput) =>
      request<PurchaseOrder>("/purchase-orders", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    order: (id: number) => request<PurchaseOrder>(`/purchase-orders/${id}`),
    receiveOrder: (
      id: number,
      data: {
        qty: { product_id: number; qty: number }[];
        invoice_number?: string;
        invoice_date?: string;
        notes?: string;
      }
    ) =>
      request<Purchase>(`/purchase-orders/${id}/receive`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    cancelOrder: (id: number) =>
      request<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {
        method: "POST",
      }),
    list: (params: {
      page?: number;
      page_size?: number;
      status?: string;
      supplier_id?: number;
      search?: string;
    } = {}) =>
      request<Paginated<Purchase>>(
        `/purchases?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
          ) as Record<string, string>
        ).toString()}`
      ),
    get: (id: number) => request<Purchase>(`/purchases/${id}`),
    pay: (id: number, data: PartyPaymentInput) =>
      request<PaymentRecord>(`/purchases/${id}/payments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    returnGoods: (
      id: number,
      data: {
        reason?: string;
        items: { product_id: number; qty: number }[];
      }
    ) =>
      request<PurchaseReturn>(`/purchases/${id}/returns`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    returns: (params: { page?: number; page_size?: number } = {}) =>
      request<Paginated<PurchaseReturn>>(
        `/purchase-returns?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined)
          ) as unknown as Record<string, string>
        ).toString()}`
      ),
  },
  finance: {
    summary: (days?: number) =>
      request<FinanceSummary>(`/finance/summary${days ? `?days=${days}` : ""}`),
    expenses: (params: { page?: number; page_size?: number } = {}) =>
      request<Paginated<FinanceEntry>>(`/finance/expenses?${toQueryString(params)}`),
    createExpense: (data: FinanceEntryInput) =>
      request<FinanceEntry>("/finance/expenses", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteExpense: (id: number) =>
      request<FinanceEntry>(`/finance/expenses/${id}`, { method: "DELETE" }),
    income: (params: { page?: number; page_size?: number } = {}) =>
      request<Paginated<FinanceEntry>>(`/finance/income?${toQueryString(params)}`),
    createIncome: (data: FinanceEntryInput) =>
      request<FinanceEntry>("/finance/income", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteIncome: (id: number) =>
      request<FinanceEntry>(`/finance/income/${id}`, { method: "DELETE" }),
  },
  cheques: {
    list: (params: { direction?: string; status?: string; page?: number; page_size?: number } = {}) =>
      request<Paginated<Cheque>>(`/cheques?${toQueryString(params)}`),
    create: (data: ChequeInput) =>
      request<Cheque>("/cheques", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateStatus: (id: number, status: string) =>
      request<Cheque>(`/cheques/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    remove: (id: number) =>
      request<Cheque>(`/cheques/${id}`, { method: "DELETE" }),
  },
  settings: {
    get: () => request<SettingsMap>("/settings"),
    print: () => request<PrintSettings>("/settings/print"),
    update: (key: string, value: string) =>
      request<SettingValue>("/settings/" + encodeURIComponent(key), {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
  },
  quotations: {
    list: (params: { status?: string; page?: number; page_size?: number } = {}) =>
      request<Paginated<Quotation>>(`/quotations?${toQueryString(params)}`),
    create: (data: QuotationInput) =>
      request<Quotation>("/quotations", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    get: (id: number) => request<Quotation>(`/quotations/${id}`),
    updateStatus: (id: number, status: string) =>
      request<Quotation>(`/quotations/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    convert: (id: number, data: { payment_method?: string; paid?: number }) =>
      request<Sale>(`/quotations/${id}/convert`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    remove: (id: number) =>
      request<Quotation>(`/quotations/${id}`, { method: "DELETE" }),
  },
  inventory: {
    adjustments: (params: { page?: number; page_size?: number } = {}) =>
      request<Paginated<StockAdjustment>>(`/inventory/adjustments?${toQueryString(params)}`),
    createAdjustment: (data: StockAdjustmentInput) =>
      request<StockAdjustment>("/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  warranty: {
    units: (params: {
      page?: number;
      page_size?: number;
      product_id?: number;
      status?: string;
      q?: string;
      expiring_days?: number;
    } = {}) =>
      request<Paginated<ProductUnit>>(`/warranty/units?${toQueryString(params)}`),
    unit: (id: number) => request<ProductUnit>(`/warranty/units/${id}`),
    createUnit: (data: UnitInput) =>
      request<ProductUnit>("/warranty/units", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateStatus: (id: number, status: string) =>
      request<ProductUnit>(`/warranty/units/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    expiring: (days = 30) =>
      request<ProductUnit[]>(`/warranty/expiring?days=${days}`),
  },
  repairs: {
    list: (params: { status?: string; q?: string; page?: number; page_size?: number } = {}) =>
      request<Paginated<Repair>>(`/repairs?${toQueryString(params)}`),
    get: (id: number) => request<Repair>(`/repairs/${id}`),
    create: (data: RepairInput) =>
      request<Repair>("/repairs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<RepairInput>) =>
      request<Repair>(`/repairs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    updateStatus: (id: number, status: string) =>
      request<Repair>(`/repairs/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    payment: (id: number, amount: number) =>
      request<Repair>(`/repairs/${id}/payment`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      }),
    remove: (id: number) =>
      request<Repair>(`/repairs/${id}`, { method: "DELETE" }),
  },
  reorder: {
    list: () => request<ReorderItem[]>("/reports/reorder"),
  },
  backup: {
    download: () => download("/backup/download", "pos-backup.db"),
    restore: (file: File) => upload<{ success: boolean; message: string }>("/backup/restore", file),
    exportProducts: () => download("/backup/export/products", "products-export.csv"),
    importProducts: (file: File) =>
      upload<{ success: boolean; created: number; updated: number }>(
        "/backup/import/products",
        file
      ),
  },
  transactions: {
    feed: (params: TransactionFeedParams = {}) =>
      request<Paginated<TransactionRecord>>(
        `/transactions?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== 0)
          ) as Record<string, string>
        ).toString()}`
      ),
    detail: (type: string, id: number) =>
      request<TransactionDetail>(`/transactions/${type}/${id}`),
    globalSearch: (q: string) =>
      request<GlobalSearchResult>(
        `/transactions/global-search?q=${encodeURIComponent(q)}`
      ),
    productSummary: (id: number) =>
      request<ProductHistorySummary>(`/transactions/products/${id}/summary`),
  },
};

type MasterEntity<T> = {
  list: (params?: {
    page?: number;
    page_size?: number;
    search?: string;
  }) => Promise<Paginated<T>>;
  create: (data: Partial<T>) => Promise<T>;
  update: (id: number, data: Partial<T>) => Promise<T>;
  remove: (id: number) => Promise<void>;
};

function masterCrud<T>(base: string): MasterEntity<T> {
  const list = (params: { page?: number; page_size?: number; search?: string } = {}) =>
    request<Paginated<T>>(
      `${base}?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
        ) as Record<string, string>
      ).toString()}`
    );
  const create = (data: Partial<T>) =>
    request<T>(base, { method: "POST", body: JSON.stringify(data) });
  const update = (id: number, data: Partial<T>) =>
    request<T>(`${base}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  const remove = (id: number) =>
    request<void>(`${base}/${id}`, { method: "DELETE" });
  return { list, create, update, remove };
}

export const master = {
  categories: masterCrud<NamedMaster>("/categories"),
  brands: masterCrud<NamedMaster>("/brands"),
  departments: masterCrud<NamedMaster>("/departments"),
  warehouses: masterCrud<Warehouse>("/warehouses"),
  suppliers: masterCrud<Supplier>("/suppliers"),
  customers: masterCrud<Customer>("/customers"),
};

export type TransactionFeedParams = {
  q?: string;
  type?: string;
  party_type?: string;
  party_id?: number;
  product_id?: number;
  method?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  created_by?: number;
  page?: number;
  page_size?: number;
};
