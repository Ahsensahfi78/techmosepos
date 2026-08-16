import type { NlAction, NlContext } from "./types";

/**
 * Short conversational follow-ups ("print it", "make it two", "who was the
 * customer?") resolve against conversation memory instead of being treated
 * as brand-new requests.
 */
export function looksLikeFollowUp(text: string, ctx: NlContext): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const hasInvoice = !!ctx.lastInvoiceNo;
  const hasProduct = !!ctx.lastProductId;
  if (/^(print it|print that|print this|reprint|print the invoice|print invoice)$/.test(t))
    return true;
  if (
    /^(who was (the|that) customer|which customer|show (me )?the customer|show customer|the customer|whose (was )?it|for whom|the customer name|customer name)$/.test(
      t
    )
  )
    return true;
  if (
    /^(show (me )?the items|show (me )?the products|what was on (it|the invoice)|whats on (it|the invoice)|list the items|the items|the products|what did (they|we) buy|what did (they|we) get)$/.test(
      t
    )
  )
    return true;
  if (
    /^(make it|make that|make this|set it|set that|set this|change it|change that|change this|make it to|set it to|make it a)\b/.test(
      t
    )
  )
    return true;
  if (
    /^(remove one|take one (off|out|away)|minus one|one less|take one of (them|it)|remove one of (them|it)|reduce by one)$/.test(
      t
    )
  )
    return true;
  if (/^(another one|one more|add one more|another|add another)$/.test(t)) return true;
  if (hasInvoice && /^(open it|show it|view it|go back to it|the invoice)$/.test(t))
    return true;
  if (hasProduct && /^(add it|put it|add another)$/.test(t)) return true;
  return false;
}

export function emptyContext(): NlContext {
  return {};
}

export function mergeContext(
  base: NlContext,
  patch: Partial<NlContext>
): NlContext {
  return { ...base, ...patch };
}

/** Update conversation memory from the action that just ran. */
export function updateContextFromAction(
  action: NlAction,
  ctx: NlContext
): NlContext {
  const next = { ...ctx };
  switch (action.kind) {
    case "add_to_cart": {
      const last = action.lines[action.lines.length - 1];
      if (last) {
        next.lastProductId = last.product.id;
        next.lastProductName = last.product.name;
      }
      next.lastKind = "product";
      break;
    }
    case "remove_from_cart":
      if (action.product) {
        next.lastProductId = action.product.id;
        next.lastProductName = action.product.name;
      }
      next.lastKind = "product";
      break;
    case "set_cart_qty":
    case "decrease_cart_qty":
      if (action.product) {
        next.lastProductId = action.product.id;
        next.lastProductName = action.product.name;
      }
      next.lastKind = "product";
      break;
    case "product_stock":
      if (action.product) {
        next.lastProductId = action.product.id;
        next.lastProductName = action.product.name;
      }
      next.lastKind = "product";
      break;
    case "select_customer":
      next.lastCustomerId = action.customer.id;
      next.lastCustomerName = action.customer.name;
      next.lastKind = "customer";
      break;
    case "find_invoice":
    case "invoice_customer":
    case "invoice_items":
    case "print_invoice":
    case "create_return":
      if (action.kind === "create_return" ? action.invoiceNo : action.invoiceNo) {
        next.lastInvoiceNo = action.invoiceNo!;
        next.lastKind = "invoice";
      }
      break;
    default:
      break;
  }
  return next;
}
