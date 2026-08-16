"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import type { GlobalSearchHit } from "@/lib/types";

const KIND_META: Record<string, { label: string; icon: string; tone: string }> = {
  customer: { label: "Customer", icon: "🧑", tone: "bg-emerald-100 text-emerald-700" },
  supplier: { label: "Supplier", icon: "🚚", tone: "bg-sky-100 text-sky-700" },
  product: { label: "Product", icon: "📱", tone: "bg-violet-100 text-violet-700" },
};

function hitUrl(h: GlobalSearchHit) {
  if (h.kind === "customer") return "/customers";
  if (h.kind === "supplier") return "/suppliers";
  return "/products";
}

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{
    customers: GlobalSearchHit[];
    suppliers: GlobalSearchHit[];
    products: GlobalSearchHit[];
    transactions: { key: string; type: string; db_id: number; reference: string; date: string; party_name: string | null; total: number }[];
  }>({ customers: [], suppliers: [], products: [], transactions: [] });
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => {
      const term = q.trim();
      if (!term) {
        setResults({ customers: [], suppliers: [], products: [], transactions: [] });
        setLoading(false);
        return;
      }
      setLoading(true);
      api.transactions
        .globalSearch(term)
        .then((r) =>
          setResults({
            customers: r.customers,
            suppliers: r.suppliers,
            products: r.products,
            transactions: r.transactions,
          })
        )
        .catch(() =>
          setResults({ customers: [], suppliers: [], products: [], transactions: [] })
        )
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  const totalHits =
    results.customers.length +
    results.suppliers.length +
    results.products.length +
    results.transactions.length;

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  function openTxn(type: string, dbId: number) {
    const t = results.transactions.find(
      (r) => r.type === type && r.db_id === dbId
    );
    setOpen(false);
    setQ("");
    router.push(`/transactions?q=${encodeURIComponent(t?.reference ?? type)}`);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Search"
        title="Search (Ctrl+K)"
        className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl sm:w-[26rem]">
          <div className="relative border-b border-slate-100">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search customers, suppliers, products, invoices…"
              className="w-full bg-transparent py-3 pl-11 pr-4 text-sm outline-none"
              autoComplete="off"
            />
          </div>

          <div className="max-h-80 overflow-y-auto overscroll-contain p-2">
            {!q.trim() && (
              <p className="px-3 py-6 text-center text-xs text-slate-400">
                Type to search across customers, suppliers, products and transactions
              </p>
            )}
            {q.trim() && loading && (
              <div className="space-y-2 p-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            )}
            {q.trim() && !loading && totalHits === 0 && (
              <p className="px-3 py-6 text-center text-xs text-slate-400">
                No results for “{q.trim()}”
              </p>
            )}

            {results.customers.length > 0 && (
              <Group
                label={`Customers (${results.customers.length})`}
                hits={results.customers}
                onHit={(h) => go(hitUrl(h))}
              />
            )}
            {results.suppliers.length > 0 && (
              <Group
                label={`Suppliers (${results.suppliers.length})`}
                hits={results.suppliers}
                onHit={(h) => go(hitUrl(h))}
              />
            )}
            {results.products.length > 0 && (
              <Group
                label={`Products (${results.products.length})`}
                hits={results.products}
                onHit={(h) => go(hitUrl(h))}
              />
            )}
            {results.transactions.length > 0 && (
              <div className="mb-1 mt-2 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Transactions ({results.transactions.length})
              </div>
            )}
            {results.transactions.map((t) => (
              <button
                key={t.key}
                onClick={() => openTxn(t.type, t.db_id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-700">
                    {t.reference}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {t.party_name ?? "Walk-in"} · {new Date(t.date).toLocaleDateString("en-LK")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums text-slate-700">
                    {formatMoney(t.total)}
                  </div>
                  <div className="text-[10px] uppercase text-slate-400">
                    {t.type.replace("_", " ")}
                  </div>
                </div>
              </button>
            ))}

            {q.trim() && !loading && totalHits > 0 && (
              <button
                onClick={() => go(`/transactions?q=${encodeURIComponent(q.trim())}`)}
                className="mt-1 w-full rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-600 transition hover:bg-slate-100"
              >
                See all in Transactions →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  hits,
  onHit,
}: {
  label: string;
  hits: GlobalSearchHit[];
  onHit: (h: GlobalSearchHit) => void;
}) {
  return (
    <div>
      <div className="mb-1 mt-2 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      {hits.map((h) => {
        const meta = KIND_META[h.kind];
        return (
          <button
            key={`${h.kind}-${h.id}`}
            onClick={() => onHit(h)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${meta.tone}`}
            >
              {meta.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-700">
                {h.title}
              </span>
              <span className="block truncate text-xs text-slate-400">
                {h.subtitle ?? h.meta ?? ""}
              </span>
            </span>
            {h.meta && (
              <span className="shrink-0 text-xs font-medium text-slate-400">
                {h.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
