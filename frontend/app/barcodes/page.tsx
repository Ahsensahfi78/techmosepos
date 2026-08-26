"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import BarcodeLabel from "@/components/BarcodeLabel";
import type { Product } from "@/lib/types";
import type { BarcodeItem, BarcodeDisplaySettings, PaperSize } from "@/lib/barcodes";
import {
  PAPER_SIZES,
  DEFAULT_PAPER,
  DEFAULT_DISPLAY_SETTINGS,
  getPaperSize,
  getTotalLabels,
  buildPrintLabels,
} from "@/lib/barcodes";
import { formatMoney } from "@/lib/constants";

export default function BarcodesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canPrint = user?.role !== "accountant";

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<BarcodeItem[]>([]);
  const [paperId, setPaperId] = useState(DEFAULT_PAPER.id);
  const [display, setDisplay] = useState<BarcodeDisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [storeName, setStoreName] = useState("My Store");
  const [preview, setPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputBuffer = useRef("");
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paper: PaperSize = getPaperSize(paperId);

  const loadProducts = useCallback(async () => {
    try {
      const data = await api.products.list();
      setProducts(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.settings.print();
      if (data.store_name) setStoreName(data.store_name);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadSettings();
  }, [loadProducts, loadSettings]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("barcode-bulk-items");
      if (!raw) return;
      const parsed = JSON.parse(raw) as BarcodeItem[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setItems((prev) => {
          const merged = [...prev];
          for (const incoming of parsed) {
            const existing = merged.find((i) => i.product.id === incoming.product.id);
            if (existing) {
              existing.qty += incoming.qty;
            } else {
              merged.push(incoming);
            }
          }
          return merged;
        });
        toast(`${parsed.length} product${parsed.length !== 1 ? "s" : ""} loaded from selection`, "success");
      }
      sessionStorage.removeItem("barcode-bulk-items");
    } catch {
      /* ignore */
    }
  }, [toast]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const q = searchQuery.toLowerCase();
    const matches = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
    setSearchResults(matches.slice(0, 10));
    setSearchOpen(true);
  }, [searchQuery, products]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        document.activeElement &&
        (document.activeElement as HTMLElement).tagName === "INPUT"
      ) {
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function addProduct(product: Product) {
    const existing = items.find((i) => i.product.id === product.id);
    if (existing) {
      setItems((prev) =>
        prev.map((i) => (i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i))
      );
    } else {
      setItems((prev) => [...prev, { product, qty: 1 }]);
    }
    setSearchQuery("");
    setSearchOpen(false);
    setPreview(false);
    searchInputRef.current?.focus();
  }

  function handleSearchInput(value: string) {
    if (barcodeTimer.current) clearTimeout(barcodeTimer.current);

    const isLikelyScan = value.length > 6 && /^\d+$/.test(value);

    if (isLikelyScan) {
      const product = products.find(
        (p) => p.barcode === value || p.sku === value
      );
      if (product) {
        addProduct(product);
        setSearchQuery("");
        return;
      }
    }

    barcodeInputBuffer.current = value;
    barcodeTimer.current = setTimeout(() => {
      barcodeInputBuffer.current = "";
    }, 200);

    setSearchQuery(value);
  }

  function updateQty(productId: number, delta: number) {
    setItems((prev) =>
      prev
        .map((i) =>
          i.product.id === productId
            ? { ...i, qty: Math.max(1, i.qty + delta) }
            : i
        )
        .filter((i) => i.qty > 0)
    );
    setPreview(false);
  }

  function setQty(productId: number, raw: string) {
    const num = parseInt(raw, 10);
    if (isNaN(num) || num < 1) return;
    setItems((prev) =>
      prev.map((i) => (i.product.id === productId ? { ...i, qty: num } : i))
    );
    setPreview(false);
  }

  function removeItem(productId: number) {
    setItems((prev) => prev.filter((i) => i.product.id !== productId));
    setPreview(false);
  }

  function handleReset() {
    if (items.length > 0 && !confirmReset) {
      setConfirmReset(true);
      return;
    }
    setItems([]);
    setPaperId(DEFAULT_PAPER.id);
    setDisplay(DEFAULT_DISPLAY_SETTINGS);
    setPreview(false);
    setConfirmReset(false);
    setSearchQuery("");
  }

  function handlePrint() {
    window.print();
  }

  const totalLabels = getTotalLabels(items);

  return (
    <div className="page-container">
      <PageHeader
        title="Print Barcode"
        subtitle="Generate and print barcode labels for products"
      >
        {canPrint && (
          <>
            <button
              onClick={async () => {
                if (items.length === 0) {
                  toast("Select at least one product", "error");
                  return;
                }
                if (!paperId) {
                  toast("Select a paper size", "error");
                  return;
                }
                const fresh = await api.products.list();
                setProducts(fresh);
                setItems((prev) =>
                  prev.map((item) => {
                    const updated = fresh.find((p) => p.id === item.product.id);
                    return updated ? { ...item, product: updated } : item;
                  })
                );
                setPreview(true);
              }}
              className="btn btn-primary btn-sm"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Generate Barcode
            </button>
            <button
              onClick={() => {
                if (!preview) {
                  toast("Generate barcode preview first", "error");
                  return;
                }
                handlePrint();
              }}
              className="btn btn-danger btn-sm"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Barcode
            </button>
          </>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Product Selection</h3>
              <span className="badge bg-slate-100 text-slate-600">
                {items.length} products &middot; {totalLabels} labels
              </span>
            </div>

            <div className="relative" ref={searchRef}>
              <label className="label">Product *</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() => {
                    if (searchResults.length > 0) setSearchOpen(true);
                  }}
                  placeholder="Search Product by Code"
                  className="input pl-10"
                  autoComplete="off"
                />
              </div>

              {searchOpen && searchResults.length > 0 && (
                <div className="absolute z-[35] mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-xl">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50"
                    >
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm">
                          📦
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-700">
                          {p.name}
                        </div>
                        <div className="truncate text-xs text-slate-400">
                          {p.sku && `SKU: ${p.sku}`}
                          {p.sku && p.barcode && " · "}
                          {p.barcode && `Barcode: ${p.barcode}`}
                          {!p.sku && !p.barcode && `Code: ${p.name}`}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-slate-500">
                        {formatMoney(p.price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 ? (
              <div className="mt-4 table-shell">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Code</th>
                      <th>Qty</th>
                      <th className="w-16">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.product.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            {item.product.image_url ? (
                              <img
                                src={item.product.image_url}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm">
                                📦
                              </span>
                            )}
                            <span className="font-medium text-slate-800">
                              {item.product.name}
                            </span>
                          </div>
                        </td>
                        <td className="text-xs text-slate-500">
                          {item.product.sku || "—"}
                        </td>
                        <td className="font-mono text-xs text-slate-600">
                          {item.product.barcode || "—"}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => updateQty(item.product.id, -1)}
                              className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={item.qty}
                              onChange={(e) =>
                                setQty(item.product.id, e.target.value)
                              }
                              className="h-7 w-12 rounded-lg border border-slate-200 bg-white text-center text-sm font-semibold text-slate-800 focus:ring-1 focus:ring-primary-500"
                            />
                            <button
                              onClick={() => updateQty(item.product.id, 1)}
                              className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td>
                          <button
                            onClick={() => removeItem(item.product.id)}
                            className="btn-icon-sm text-red-500 hover:bg-red-50 hover:text-red-600"
                            title="Remove"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="🏷️"
                title="No products selected"
                hint="Search and add products to print barcode labels"
              />
            )}
          </div>

          {preview && items.length > 0 && (
            <div className="card" id="barcode-print-area">
              <div className="card-header no-print">
                <h3 className="card-title">Barcode Preview</h3>
                <span className="badge bg-emerald-100 text-emerald-700">
                  {totalLabels} labels
                </span>
              </div>

              <div
                className="barcode-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${paper.cols}, 1fr)`,
                  gap: `${paper.gapY}${paper.unit === "mm" ? "mm" : "in"}`,
                }}
              >
                {buildPrintLabels(items, display, storeName).map((label, idx) => (
                  <div
                    key={`${label.product.id}-${idx}`}
                    className="barcode-cell"
                    style={{
                      padding: `${paper.paddingY}${paper.unit === "mm" ? "mm" : "in"} ${paper.paddingX}${paper.unit === "mm" ? "mm" : "in"}`,
                      breakInside: "avoid",
                      pageBreakInside: "avoid",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      background: "#fff",
                      minHeight: `${paper.height * 0.8}${paper.unit}`,
                    }}
                  >
                    <BarcodeLabel
                      product={label.product}
                      storeName={label.storeName}
                      settings={label.settings}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 className="card-title mb-4">Settings</h3>

            <div className="space-y-4">
              <div>
                <label className="label">Paper Size *</label>
                <select
                  value={paperId}
                  onChange={(e) => setPaperId(e.target.value)}
                  className="select"
                >
                  {PAPER_SIZES.map((ps) => (
                    <option key={ps.id} value={ps.id}>
                      {ps.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-700">
                  Display Settings
                </h4>
                <div className="space-y-3">
                  {([
                    ["showStoreName", "Show Store Name"],
                    ["showProductName", "Show Product Name"],
                    ["showPrice", "Show Price"],
                    ["showSku", "Show SKU"],
                    ["showBarcode", "Show Barcode"],
                    ["showCode", "Show Code"],
                  ] as const).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center justify-between"
                    >
                      <span className="text-sm text-slate-600">{label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={display[key]}
                        onClick={() =>
                          setDisplay((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                          display[key] ? "bg-emerald-500" : "bg-slate-200"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            display[key] ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <button
                  onClick={() => handleReset()}
                  className="btn btn-secondary btn-sm w-full"
                >
                  Reset Barcode
                </button>
                {confirmReset && (
                  <p className="mt-2 text-center text-xs text-amber-600">
                    Are you sure? Click again to confirm.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="barcode-print-portal" className="hidden" />
    </div>
  );
}
