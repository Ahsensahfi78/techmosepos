/**
 * Auto-save / recovery for the POS draft cart.
 *
 * The active (unpaid) cart is persisted locally so a browser refresh or an
 * accidental navigation can never wipe a customer's order. On reload the
 * POS restores the draft and clearly shows it was recovered.
 *
 * Safety: a draft is only restored when the current cart is empty, and a
 * newer save never silently overwrites an older draft (timestamps are kept).
 */

import type { ParkedCartLine } from "./park";

export const DRAFT_KEY = "techmos-pos-draft";

export interface DraftOrder {
  savedAt: number;
  lines: ParkedCartLine[];
  discount: number;
  tax: number;
  customerId: number | null;
  customerName: string | null;
  pointsUsed: number;
  method: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / unavailable — ignore
  }
}

export function saveDraft(draft: Omit<DraftOrder, "savedAt">): DraftOrder {
  const entry: DraftOrder = { ...draft, savedAt: Date.now() };
  write(DRAFT_KEY, entry);
  return entry;
}

export function loadDraft(): DraftOrder | null {
  const draft = read<DraftOrder>(DRAFT_KEY);
  if (!draft || !Array.isArray(draft.lines)) return null;
  return draft;
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/**
 * True when `candidate` is newer than `existing` (used to avoid silently
 * overwriting a fresher draft with a stale one).
 */
export function isNewer(candidate: DraftOrder, existing: DraftOrder | null): boolean {
  if (!existing) return true;
  return candidate.savedAt >= existing.savedAt;
}
