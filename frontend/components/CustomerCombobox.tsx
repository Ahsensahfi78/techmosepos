"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { master } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import type { Customer } from "@/lib/types";
import {
  addPrefill,
  duplicateByPhone,
  filterCustomers,
  validateCustomerForm,
} from "@/lib/customerSearch";

export interface CustomerComboboxHandle {
  /** Programmatic open — bound to F4 / Ctrl+K in the POS page. */
  open: () => void;
}

interface CustomerComboboxProps {
  customers: Customer[];
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  /** Called with a freshly created customer so the caller can store it. */
  onCreated: (c: Customer) => void;
  className?: string;
}

type Option =
  | { kind: "walkin" }
  | { kind: "customer"; customer: Customer }
  | { kind: "add" };

type PopPos = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const ROW = "flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition";

const CustomerCombobox = forwardRef<CustomerComboboxHandle, CustomerComboboxProps>(
  function CustomerCombobox(
    { customers, value, onChange, onCreated, className },
    ref
  ) {
    const { toast } = useToast();

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState<PopPos | null>(null);

    const [addOpen, setAddOpen] = useState(false);
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState("");
    const [email, setEmail] = useState("");
    const [notes, setNotes] = useState("");
    const [moreOpen, setMoreOpen] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    const triggerRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const matches = filterCustomers(customers, query);
    const duplicate = duplicateByPhone(customers, phone);

    const options: Option[] = [{ kind: "walkin" }];
    for (const c of matches) options.push({ kind: "customer", customer: c });
    options.push({ kind: "add" });
    const activeIndex = Math.min(active, options.length - 1);
    const addIndex = options.length - 1;

    const addLabel =
      matches.length === 0 && query.trim()
        ? `Add '${query.trim()}' as new customer`
        : "Add new customer";

    useImperativeHandle(
      ref,
      () => ({
        open: () => {
          setPos(computePos());
          setOpen(true);
        },
      }),
      []
    );

    function closePicker() {
      setOpen(false);
      setQuery("");
      setActive(0);
    }

    /**
     * Measured from the trigger. Called *before* the popover mounts so the
     * very first render already has coordinates — otherwise the portal would
     * appear a tick late and the autofocus could miss the search box.
     */
    function computePos(): PopPos {
      const rect = triggerRef.current?.getBoundingClientRect();
      const margin = 8;
      if (!rect) {
        return { left: margin, width: 320, maxHeight: 320, top: margin + 44 };
      }
      const width = Math.max(280, Math.min(rect.width, 380));
      let left = rect.left;
      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin);
      }
      const below = window.innerHeight - rect.bottom - margin - 8;
      const above = rect.top - margin - 8;
      if (below < 200 && above > below) {
        return {
          left,
          width,
          maxHeight: Math.max(180, above),
          bottom: window.innerHeight - rect.top + 6,
        };
      }
      return { left, width, maxHeight: Math.max(180, below), top: rect.bottom + 6 };
    }

    // ── Position: portal into <body> so product cards can never clip it ──
    useLayoutEffect(() => {
      if (!open) return;
      const update = () => setPos(computePos());
      update();

      const onScroll = (e: Event) => {
        if (popRef.current?.contains(e.target as Node)) return;
        closePicker();
      };
      window.addEventListener("resize", update);
      document.addEventListener("scroll", onScroll, true);
      return () => {
        window.removeEventListener("resize", update);
        document.removeEventListener("scroll", onScroll, true);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // ── Close on outside pointer-down ──
    useEffect(() => {
      if (!open) return;
      const onDown = (e: PointerEvent) => {
        const target = e.target as Node;
        if (popRef.current?.contains(target)) return;
        if (triggerRef.current?.contains(target)) return;
        closePicker();
      };
      document.addEventListener("pointerdown", onDown);
      return () => document.removeEventListener("pointerdown", onDown);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // ── Autofocus the search box ──
    useEffect(() => {
      if (!open) return;
      searchRef.current?.focus();
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }, [open]);

    // ── Keep the highlighted row in view ──
    useEffect(() => {
      if (!open) return;
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open]);

    function activate(option: Option | undefined) {
      if (!option) return;
      if (option.kind === "add") {
        openAdd();
        return;
      }
      onChange(option.kind === "walkin" ? null : option.customer);
      closePicker();
      triggerRef.current?.focus();
    }

    function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, addIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        activate(options[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePicker();
        triggerRef.current?.focus();
      }
    }

    // ── Quick-add drawer ───────────────────────────────────────────────
    function openAdd() {
      const prefill = addPrefill(query);
      setName(prefill.name);
      setPhone(prefill.phone);
      setAddress("");
      setEmail("");
      setNotes("");
      setMoreOpen(false);
      setErrors({});
      setSaving(false);
      setAddOpen(true);
      setOpen(false);
    }

    function cancelAdd() {
      setAddOpen(false);
      setErrors({});
      setSaving(false);
      setPos(computePos());
      setOpen(true);
    }

    function useExisting(c: Customer) {
      onChange(c);
      setAddOpen(false);
      closePicker();
      toast(`${c.name} selected`, "success");
    }

    async function save(e: FormEvent) {
      e.preventDefault();
      if (saving) return;
      const found = validateCustomerForm({ name, phone, email });
      setErrors(found);
      if (Object.keys(found).length > 0) return;
      if (duplicateByPhone(customers, phone)) return;

      setSaving(true);
      try {
        const created = await master.customers.create({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        });
        onCreated(created);
        onChange(created);
        setAddOpen(false);
        closePicker();
        toast(`Customer created: ${created.name}`, "success");
      } catch (err) {
        setErrors({
          name:
            err instanceof Error
              ? err.message
              : "Could not save the customer — try again",
        });
      } finally {
        setSaving(false);
      }
    }

    return (
      <div className={className}>
        <button
          ref={triggerRef}
          type="button"
          data-testid="customer-trigger"
          onClick={() => {
            if (open) {
              closePicker();
              return;
            }
            setPos(computePos());
            setOpen(true);
          }}
          title="Select customer (F4 / Ctrl+K)"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex min-h-[44px] max-w-[240px] items-center gap-2 rounded-full bg-white px-3.5 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          <span aria-hidden="true">👤</span>
          <span className="truncate">{value ? value.name : "Walk-in customer"}</span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.5 7.5 10 12l4.5-4.5z" />
          </svg>
        </button>

        {open &&
          typeof document !== "undefined" &&
          pos &&
          createPortal(
            <div
              ref={popRef}
              data-testid="customer-popover"
              role="listbox"
              aria-label="Customers"
              className="fixed z-[65] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop"
              style={{
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                ...(pos.bottom !== undefined
                  ? { bottom: pos.bottom }
                  : { top: pos.top }),
              }}
            >
              <div className="shrink-0 border-b border-slate-100 p-2">
                <input
                  ref={searchRef}
                  data-testid="customer-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search name, phone or #code…"
                  aria-label="Search customers"
                  autoComplete="off"
                  className="input h-11"
                />
              </div>

              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                <li>
                  <button
                    ref={(el) => {
                      optionRefs.current[0] = el;
                    }}
                    type="button"
                    data-testid="customer-option"
                    data-value="walkin"
                    onClick={() => activate({ kind: "walkin" })}
                    onMouseEnter={() => setActive(0)}
                    className={`${ROW} ${
                      activeIndex === 0
                        ? "bg-primary-50"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-sm"
                      aria-hidden="true"
                    >
                      🚶
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        Walk-in customer
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        No name printed on the receipt
                      </span>
                    </span>
                    {!value && (
                      <span className="text-xs font-bold text-primary-600">✓</span>
                    )}
                  </button>
                </li>

                {query.trim() && matches.length === 0 && (
                  <li className="px-3 py-2 text-xs text-slate-400">
                    No customer matches &ldquo;{query.trim()}&rdquo;.
                  </li>
                )}

                {matches.map((c, i) => {
                  const index = i + 1;
                  const due = Number(c.due_balance ?? 0);
                  return (
                    <li key={c.id}>
                      <button
                        ref={(el) => {
                          optionRefs.current[index] = el;
                        }}
                        type="button"
                        data-testid="customer-option"
                        data-value={String(c.id)}
                        onClick={() => activate({ kind: "customer", customer: c })}
                        onMouseEnter={() => setActive(index)}
                        className={`${ROW} ${
                          activeIndex === index
                            ? "bg-primary-50"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {c.name}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {c.phone || "No phone"}
                          </span>
                        </span>
                        {due > 0 ? (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            {formatMoney(due)} due
                          </span>
                        ) : null}
                        {value?.id === c.id && (
                          <span className="text-xs font-bold text-primary-600">✓</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="shrink-0 border-t border-slate-100 p-2">
                <button
                  ref={(el) => {
                    optionRefs.current[addIndex] = el;
                  }}
                  type="button"
                  data-testid="customer-add"
                  onClick={openAdd}
                  onMouseEnter={() => setActive(addIndex)}
                  className={`flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition ${
                    activeIndex === addIndex
                      ? "bg-primary-50 text-primary-700 ring-1 ring-primary-200"
                      : "text-primary-600 hover:bg-primary-50"
                  }`}
                >
                  <span aria-hidden="true">+</span>
                  <span className="truncate">{addLabel}</span>
                </button>
              </div>
            </div>,
            document.body
          )}

        <Modal
          open={addOpen}
          onClose={cancelAdd}
          title="New customer"
          maxWidth="max-w-md"
        >
          <form onSubmit={save} noValidate>
            {duplicate && (
              <div
                data-testid="customer-duplicate"
                className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3"
              >
                <p className="text-sm font-semibold text-amber-800">
                  Customer already exists: use {duplicate.name}
                </p>
                <p className="mt-0.5 text-xs text-amber-700">
                  {duplicate.phone} already belongs to this customer, so nothing new
                  will be created.
                </p>
                <button
                  type="button"
                  onClick={() => useExisting(duplicate)}
                  className="btn btn-sm btn-secondary mt-2"
                >
                  Use {duplicate.name}
                </button>
              </div>
            )}

            <label className="label" htmlFor="cust-name">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="cust-name"
              data-testid="customer-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              autoComplete="off"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="hint text-red-500" role="alert">
                {errors.name}
              </p>
            )}

            <label className="label mt-4" htmlFor="cust-phone">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              id="cust-phone"
              data-testid="customer-phone-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
              inputMode="tel"
              autoComplete="off"
              aria-invalid={!!errors.phone}
            />
            {errors.phone && (
              <p className="hint text-red-500" role="alert">
                {errors.phone}
              </p>
            )}

            <details
              open={moreOpen}
              onToggle={(e) =>
                setMoreOpen((e.currentTarget as HTMLDetailsElement).open)
              }
              className="mt-4 overflow-hidden rounded-xl border border-slate-200"
            >
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-600">
                More details
              </summary>
              <div className="space-y-3 px-4 pb-4">
                <div>
                  <label className="label" htmlFor="cust-address">
                    Address
                  </label>
                  <input
                    id="cust-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="input"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="cust-email">
                    Email
                  </label>
                  <input
                    id="cust-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    inputMode="email"
                    autoComplete="off"
                    aria-invalid={!!errors.email}
                  />
                  {errors.email && (
                    <p className="hint text-red-500" role="alert">
                      {errors.email}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="cust-notes">
                    Notes
                  </label>
                  <textarea
                    id="cust-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="textarea"
                    rows={3}
                  />
                </div>
              </div>
            </details>

            <div className="sticky bottom-0 -mx-6 -mb-5 mt-5 flex gap-3 border-t border-slate-100 bg-white px-6 py-4">
              <button
                type="button"
                onClick={cancelAdd}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="customer-save"
                disabled={saving || !!duplicate}
                className="btn btn-primary flex-1"
              >
                {saving ? "Saving…" : "Save & select"}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }
);

export default CustomerCombobox;
