import type { NlAction } from "./types";

/**
 * Frontend mirror of the backend role → permission registry
 * (backend/app/permissions.py). The backend remains the source of truth;
 * this only lets the NL layer answer early and kindly instead of a raw 403.
 */
export const ALL_PERMISSIONS = [
  "dashboard.view",
  "pos.access",
  "sales.create",
  "sales.view",
  "sales.return",
  "quotation.manage",
  "quotation.view",
  "purchase.manage",
  "purchase.view",
  "product.manage",
  "product.view",
  "inventory.manage",
  "inventory.view",
  "supplier.manage",
  "supplier.view",
  "customer.manage",
  "customer.view",
  "expense.manage",
  "expense.view",
  "income.manage",
  "income.view",
  "warehouse.manage",
  "warehouse.view",
  "report.view",
  "finance.view",
  "user.manage",
  "settings.manage",
  "cheque.manage",
  "audit.view",
  "warranty.manage",
  "warranty.view",
  "repair.manage",
  "repair.view",
  "backup.manage",
  "export.view",
] as const;

const MANAGER_EXCLUDED = new Set(["user.manage", "settings.manage", "audit.view", "backup.manage"]);
const MANAGER_PERMISSIONS = new Set<string>(
  ALL_PERMISSIONS.filter((p) => !MANAGER_EXCLUDED.has(p))
);

const ACCOUNTANT_PERMISSIONS = new Set<string>([
  "dashboard.view",
  "sales.view",
  "purchase.view",
  "product.view",
  "inventory.view",
  "supplier.view",
  "customer.view",
  "expense.manage",
  "expense.view",
  "income.manage",
  "income.view",
  "warehouse.view",
  "report.view",
  "finance.view",
  "cheque.manage",
  "audit.view",
  "warranty.view",
  "repair.view",
  "export.view",
]);

const CASHIER_PERMISSIONS = new Set<string>([
  "dashboard.view",
  "pos.access",
  "sales.create",
  "sales.view",
  "product.view",
  "inventory.view",
  "customer.manage",
  "customer.view",
  "warehouse.view",
  "warranty.view",
  "repair.view",
]);

export const ROLE_PERMISSIONS: Record<string, ReadonlySet<string>> = {
  super_admin: new Set(ALL_PERMISSIONS),
  admin: new Set(ALL_PERMISSIONS),
  manager: MANAGER_PERMISSIONS,
  accountant: ACCOUNTANT_PERMISSIONS,
  cashier: CASHIER_PERMISSIONS,
};

export function can(role: string | null | undefined, permission: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

const PAGE_PERMISSIONS: Record<string, string> = {
  products: "product.view",
  inventory: "inventory.view",
  customers: "customer.view",
  reports: "report.view",
  settings: "settings.manage",
  dashboard: "dashboard.view",
  purchases: "purchase.view",
  users: "user.manage",
  quotations: "quotation.view",
  repairs: "repair.view",
  suppliers: "supplier.view",
  history: "sales.view",
  returns: "sales.return",
  expenses: "expense.view",
  income: "income.view",
  cheques: "cheque.manage",
  warranty: "warranty.view",
};

const ASK_PERMISSIONS: Record<string, string> = {
  add: "pos.access",
  stock: "product.view",
  remove: "pos.access",
  return: "sales.return",
};

/** The backend permission name required to perform an action. */
export function permissionForAction(action: NlAction): string {
  switch (action.kind) {
    case "add_to_cart":
    case "remove_from_cart":
    case "set_cart_qty":
    case "decrease_cart_qty":
    case "show_cart":
    case "clear_cart":
    case "hold_invoice":
    case "open_held":
    case "resume_invoice":
      return "pos.access";
    case "cancel_invoice":
    case "new_invoice":
    case "checkout":
      return "sales.create";
    case "select_customer":
    case "find_customer":
      return "customer.view";
    case "find_invoice":
    case "invoice_customer":
    case "invoice_items":
    case "print_invoice":
    case "open_history":
      return "sales.view";
    case "today_sales":
      return "dashboard.view";
    case "product_stock":
      return "product.view";
    case "stock_report":
      return "inventory.view";
    case "create_return":
    case "start_return":
      return "sales.return";
    case "open_page":
      return PAGE_PERMISSIONS[action.page] ?? "pos.access";
    case "ask_product":
      return ASK_PERMISSIONS[action.ask.on] ?? "pos.access";
    case "unknown":
      return "pos.access";
  }
  return "pos.access";
}

export const DENIED_MESSAGE =
  "You don't have permission to do that. Ask a manager or admin.";
