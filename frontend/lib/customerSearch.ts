import type { Customer } from "@/lib/types";

/**
 * Helpers behind the POS customer combobox.
 *
 * Kept separate from the component so the matching, duplicate-phone and
 * form-validation rules are unit-testable without a DOM.
 */

/** Digits only — lets "+94 77 123 4567" and "0771234567" be compared. */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

export function isAllDigits(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^\d+$/.test(trimmed);
}

/**
 * There is no `code` column on `customers`, so the stable reference we show
 * and search on is the primary key (`#12`).
 */
export function customerCode(customer: Customer): string {
  return `#${customer.id}`;
}

/** True only when both numbers are present and their digits match exactly. */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return left.length >= 7 && left === right;
}

export function duplicateByPhone(
  list: Customer[],
  phone: string | null | undefined
): Customer | undefined {
  const target = normalizePhone(phone);
  if (target.length < 7) return undefined;
  return list.find((c) => normalizePhone(c.phone) === target);
}

/** Live filter used by the combobox popover: name, phone, email or code. */
export function filterCustomers(list: Customer[], query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;

  // A leading "#" means "look this up by code" and nothing else, so "#99"
  // does not accidentally match every phone number containing 99.
  if (q.startsWith("#")) {
    return list.filter((c) => customerCode(c).toLowerCase().startsWith(q));
  }

  const digits = q.replace(/\D/g, "");
  const wantDigits = digits.length >= 2 ? digits : "";

  return list.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if ((c.email ?? "").toLowerCase().includes(q)) return true;
    if (wantDigits && normalizePhone(c.phone).includes(wantDigits)) return true;
    return false;
  });
}

/**
 * Pre-fills the quick-add form from whatever was typed in the search box:
 * all digits land in Phone, anything else lands in Name.
 */
export function addPrefill(query: string): { name: string; phone: string } {
  const trimmed = query.trim();
  if (!trimmed) return { name: "", phone: "" };
  return isAllDigits(trimmed)
    ? { name: "", phone: trimmed }
    : { name: trimmed, phone: "" };
}

/** Basic phone validation. Returns an error message, or null when valid. */
export function phoneError(phone: string): string | null {
  const value = phone.trim();
  if (!value) return "Phone number is required";
  if (value.length > 50) return "Phone number is too long";
  if (!/^[+\d(][\d\s\-().]*$/.test(value)) {
    return "Use digits, spaces and + - ( ) only";
  }
  const digits = normalizePhone(value);
  if (digits.length < 7) return "Enter at least 7 digits";
  if (digits.length > 15) return "Enter at most 15 digits";
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCustomerForm(input: {
  name: string;
  phone: string;
  email: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) errors.name = "Name is required";
  else if (name.length > 150) errors.name = "Name is too long";

  const phoneProblem = phoneError(input.phone);
  if (phoneProblem) errors.phone = phoneProblem;

  const email = input.email.trim();
  if (email && !EMAIL_RE.test(email)) errors.email = "Enter a valid email address";

  return errors;
}
