"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import type { Product } from "@/lib/types";

export interface LineItemState {
  id?: number;
  product_id: number | null;
  product_name: string;
  product_type: string;
  description: string;
  qty: number;
  unit: string;
  price: number;
  discount: number;
  tax: number;
  line_total: number;
}

interface LineItemsTableProps {
  items: LineItemState[];
  products: Product[];
  customerType?: string;
  onChange: (items: LineItemState[]) => void;
  onProductCreated?: (product: Product) => void;
  defaultProductType?: "Goods" | "Service";
  disabled?: boolean;
  notes?: string;
  onChangeNotes?: (notes: string) => void;
  terms?: string;
  onChangeTerms?: (terms: string) => void;
  taxRate?: number;
  onChangeTaxRate?: (rate: number) => void;
  overallDiscount?: number;
  onChangeOverallDiscount?: (d: number) => void;
  title?: string;
}

const DEFAULT_PRODUCT_TYPES = ["Goods", "Service", "Digital", "Subscription"];

export default function LineItemsTable({
  items,
  products,
  customerType = "Retail",
  onChange,
  onProductCreated,
  defaultProductType = "Goods",
  disabled = false,
  notes,
  onChangeNotes,
  terms,
  onChangeTerms,
  taxRate = 0,
  onChangeTaxRate,
  overallDiscount = 0,
  onChangeOverallDiscount,
  title = "Item Lines",
}: LineItemsTableProps) {
  const { toast } = useToast();
  const [filterQuery, setFilterQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [activeSearchText, setActiveSearchText] = useState("");
  const [productTypes, setProductTypes] = useState<string[]>(DEFAULT_PRODUCT_TYPES);
  const [showAddTypeModal, setShowAddTypeModal] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [savingNewProductIndex, setSavingNewProductIndex] = useState<number | null>(null);

  const searchBoxRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Close search popup on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        activeSearchIndex !== null &&
        searchBoxRefs.current[activeSearchIndex] &&
        !searchBoxRefs.current[activeSearchIndex]?.contains(e.target as Node)
      ) {
        setActiveSearchIndex(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeSearchIndex]);

  // Recalculate line total helper
  function calcLineTotal(qty: number, price: number, discount: number, tax: number): number {
    const total = qty * price - discount + tax;
    return Math.max(0, Math.round(total * 100) / 100);
  }

  // Atomic update function to prevent stale state overwrites when changing multiple fields
  function handleLineUpdate(index: number, patch: Partial<LineItemState>) {
    const updated = [...items];
    const current = updated[index];
    if (!current) return;
    const item = { ...current, ...patch };

    if ("qty" in patch || "price" in patch || "discount" in patch || "tax" in patch) {
      const q = Number("qty" in patch ? patch.qty : item.qty) || 0;
      const p = Number("price" in patch ? patch.price : item.price) || 0;
      const d = Number("discount" in patch ? patch.discount : item.discount) || 0;
      const t = Number("tax" in patch ? patch.tax : item.tax) || 0;
      item.line_total = calcLineTotal(q, p, d, t);
    }

    updated[index] = item;
    onChange(updated);
  }

  function handleLineChange<K extends keyof LineItemState>(
    index: number,
    field: K,
    val: LineItemState[K]
  ) {
    handleLineUpdate(index, { [field]: val });
  }

  function handleSelectProduct(index: number, product: Product) {
    const isWholesale = customerType?.toLowerCase() === "wholesale";
    const unitPrice =
      isWholesale && product.wholesale_price && product.wholesale_price > 0
        ? product.wholesale_price
        : product.price;

    const currentItem = items[index];
    const qty = currentItem.qty || 1;
    const discount = currentItem.discount || 0;
    const tax = currentItem.tax || 0;

    handleLineUpdate(index, {
      product_id: product.id,
      product_name: product.name,
      product_type: product.product_type || defaultProductType,
      unit: product.unit || "pcs",
      price: unitPrice,
      line_total: calcLineTotal(qty, unitPrice, discount, tax),
    });
    setActiveSearchIndex(null);
  }

  async function handleSaveAsNewProduct(index: number) {
    const item = items[index];
    if (!item.product_name.trim()) {
      toast("Please enter a product name first", "error");
      return;
    }
    setSavingNewProductIndex(index);
    try {
      const created = await api.products.create({
        name: item.product_name.trim(),
        price: item.price || 0,
        stock: 0,
        category: "General",
        product_type: item.product_type || defaultProductType,
        unit: item.unit || "pcs",
        description: item.description || undefined,
        auto_generate: true,
      });
      toast(`Product "${created.name}" saved to database!`, "success");
      onProductCreated?.(created);
      handleLineUpdate(index, { product_id: created.id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save product";
      toast(msg, "error");
    } finally {
      setSavingNewProductIndex(null);
    }
  }

  function handleAddLine() {
    const newLine: LineItemState = {
      product_id: null,
      product_name: "",
      product_type: defaultProductType,
      description: "",
      qty: 1,
      unit: "pcs",
      price: 0,
      discount: 0,
      tax: 0,
      line_total: 0,
    };
    onChange([...items, newLine]);
  }

  function handleDeleteLine(index: number) {
    if (items.length <= 1) {
      // Keep at least one empty line
      onChange([
        {
          product_id: null,
          product_name: "",
          product_type: defaultProductType,
          description: "",
          qty: 1,
          unit: "pcs",
          price: 0,
          discount: 0,
          tax: 0,
          line_total: 0,
        },
      ]);
      return;
    }
    const updated = items.filter((_, i) => i !== index);
    onChange(updated);
  }

  function handleDuplicateLine(index: number) {
    const target = items[index];
    const clone: LineItemState = {
      ...target,
      id: undefined, // Fresh line
    };
    const updated = [...items];
    updated.splice(index + 1, 0, clone);
    onChange(updated);
  }

  function handleAddProductType() {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    if (!productTypes.includes(trimmed)) {
      setProductTypes([...productTypes, trimmed]);
    }
    setNewTypeName("");
    setShowAddTypeModal(false);
    toast(`Product type "${trimmed}" added`, "success");
  }

  // Filtered rows for display in table
  const filteredIndices = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return items.map((_, i) => i);
    return items
      .map((item, i) => {
        const match =
          item.product_name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.product_type.toLowerCase().includes(q) ||
          item.unit.toLowerCase().includes(q);
        return match ? i : null;
      })
      .filter((i): i is number => i !== null);
  }, [items, filterQuery]);

  // Product autocomplete list for active cell
  const matchingProducts = useMemo(() => {
    if (activeSearchIndex === null) return [];
    const q = activeSearchText.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [activeSearchIndex, activeSearchText, products]);

  // Calculated totals
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0),
    [items]
  );

  const totalLineDiscount = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.discount) || 0), 0),
    [items]
  );

  const totalDiscount = totalLineDiscount + (Number(overallDiscount) || 0);

  const totalLineTax = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.tax) || 0), 0),
    [items]
  );

  const headerTax = ((Math.max(0, subtotal - totalDiscount)) * (Number(taxRate) || 0)) / 100;
  const totalTax = totalLineTax + headerTax;
  const grandTotal = Math.max(0, subtotal - totalDiscount + totalTax);

  return (
    <div className="space-y-4">
      {/* Table Header Bar with Actions & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{title}</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {items.length} {items.length === 1 ? "line" : "lines"}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Table search filter */}
          <div className="relative">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter item lines..."
              className="w-48 sm:w-60 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 shadow-sm"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery("")}
                className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Add Line button */}
          <button
            type="button"
            disabled={disabled}
            onClick={handleAddLine}
            className="btn btn-primary btn-sm shadow-sm"
          >
            + Add Line
          </button>
        </div>
      </div>

      {/* Item Lines Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-bold text-slate-600 uppercase tracking-wider select-none">
              <th className="py-2.5 px-2 text-center w-8">#</th>
              <th className="py-2.5 px-3 min-w-[240px]">Item & Description</th>
              <th className="py-2.5 px-2 w-28 min-w-[105px]">Type</th>
              <th className="py-2.5 px-2 w-20 min-w-[76px] text-center">Qty</th>
              <th className="py-2.5 px-2 w-18 min-w-[66px] text-center">Unit</th>
              <th className="py-2.5 px-2 w-32 min-w-[125px] text-right">Price (Rs)</th>
              <th className="py-2.5 px-2 w-24 min-w-[85px] text-right">Discount</th>
              <th className="py-2.5 px-2 w-20 min-w-[75px] text-right">Tax</th>
              <th className="py-2.5 px-3 w-28 min-w-[110px] text-right font-bold text-slate-900">Total</th>
              <th className="py-2.5 px-2 w-16 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredIndices.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400 text-xs">
                  {filterQuery ? "No matching line items found" : "No item lines. Click + Add Line above."}
                </td>
              </tr>
            ) : (
              filteredIndices.map((realIndex, displayIndex) => {
                const line = items[realIndex];
                const isSearching = activeSearchIndex === realIndex;

                return (
                  <tr key={realIndex} className="hover:bg-slate-50/70 transition group">
                    {/* Line No */}
                    <td className="py-3 px-2 text-center text-slate-400 font-mono text-[11px] align-top pt-3.5">
                      {displayIndex + 1}
                    </td>

                    {/* Product Name & Description (Stacked cleanly for maximum width) */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="space-y-1.5">
                        <div
                          className="relative"
                          ref={(el) => {
                            searchBoxRefs.current[realIndex] = el;
                          }}
                        >
                          <input
                            type="text"
                            disabled={disabled}
                            value={line.product_name ?? ""}
                            onChange={(e) => {
                              const text = e.target.value;
                              handleLineUpdate(realIndex, {
                                product_name: text,
                                product_id: null,
                              });
                              setActiveSearchText(text);
                              setActiveSearchIndex(realIndex);
                            }}
                            onFocus={() => {
                              setActiveSearchIndex(realIndex);
                              setActiveSearchText(line.product_name || "");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setActiveSearchIndex(null);
                              }
                            }}
                            placeholder="Type product name or search catalog..."
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 shadow-sm"
                          />

                          {/* Autocomplete Dropdown Menu */}
                          {isSearching && (
                            <div className="absolute z-50 left-0 mt-1 w-80 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl">
                              {matchingProducts.length > 0 ? (
                                <div className="space-y-0.5">
                                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    Catalog Products ({customerType})
                                  </div>
                                  {matchingProducts.map((p) => {
                                    const isWholesale = customerType?.toLowerCase() === "wholesale";
                                    const displayPrice =
                                      isWholesale && p.wholesale_price && p.wholesale_price > 0
                                        ? p.wholesale_price
                                        : p.price;

                                    return (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => handleSelectProduct(realIndex, p)}
                                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs hover:bg-primary-50 hover:text-primary-900 transition"
                                      >
                                        <div className="truncate mr-2">
                                          <div className="font-semibold text-slate-800">{p.name}</div>
                                          <div className="text-[10px] text-slate-400">
                                            {p.sku || p.barcode || "No SKU"} • Stock: {p.stock} • {p.product_type || "Goods"}
                                          </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <div className="font-mono font-bold text-slate-700">
                                            {formatMoney(displayPrice)}
                                          </div>
                                          {isWholesale && p.wholesale_price ? (
                                            <div className="text-[9px] text-purple-600 font-bold">Wholesale</div>
                                          ) : null}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="p-3 text-center text-xs text-slate-500">
                                  <div>No catalog match for &quot;{activeSearchText}&quot;</div>
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    Keep typing to use as a custom line item
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Description / Notes sub-line */}
                        <input
                          type="text"
                          disabled={disabled}
                          value={line.description ?? ""}
                          onChange={(e) => handleLineChange(realIndex, "description", e.target.value)}
                          placeholder="Notes, specs, issue details (optional)..."
                          className="w-full rounded-md border border-slate-200/90 bg-slate-50/70 px-2.5 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 focus:bg-white focus:border-primary-500 focus:outline-none transition"
                        />

                        {/* Catalog / Custom status badge */}
                        <div className="flex items-center gap-2 pt-0.5">
                          {line.product_id ? (
                            <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                              ✓ Catalog item
                            </span>
                          ) : line.product_name.trim() ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-amber-600 font-medium">✏️ Custom item</span>
                              <button
                                type="button"
                                disabled={savingNewProductIndex === realIndex}
                                onClick={() => handleSaveAsNewProduct(realIndex)}
                                className="text-[10px] text-primary-600 hover:text-primary-800 font-semibold underline"
                              >
                                {savingNewProductIndex === realIndex ? "Saving..." : "Save to Products"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Product Type Dropdown */}
                    <td className="py-2.5 px-2 align-top">
                      <select
                        disabled={disabled}
                        value={line.product_type}
                        onChange={(e) => handleLineChange(realIndex, "product_type", e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-primary-500 focus:outline-none shadow-sm cursor-pointer"
                      >
                        {productTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Quantity */}
                    <td className="py-2.5 px-2 align-top">
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        disabled={disabled}
                        value={line.qty === 0 ? "" : line.qty}
                        placeholder="1"
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          handleLineChange(realIndex, "qty", Math.max(0, isNaN(v) ? 0 : v));
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-center font-mono font-medium text-slate-800 focus:border-primary-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-sm"
                      />
                    </td>

                    {/* Unit */}
                    <td className="py-2.5 px-2 align-top">
                      <input
                        type="text"
                        disabled={disabled}
                        value={line.unit ?? ""}
                        onChange={(e) => handleLineChange(realIndex, "unit", e.target.value)}
                        placeholder="pcs"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-center font-mono text-slate-700 focus:border-primary-500 focus:outline-none shadow-sm"
                      />
                    </td>

                    {/* Unit Price (Rs) - Spacious, visible, no spinners */}
                    <td className="py-2.5 px-2 align-top">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={disabled}
                        value={line.price === 0 ? "" : line.price}
                        placeholder="0.00"
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          handleLineChange(realIndex, "price", Math.max(0, isNaN(v) ? 0 : v));
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-right font-mono font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:border-primary-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-sm"
                      />
                    </td>

                    {/* Discount */}
                    <td className="py-2.5 px-2 align-top">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={disabled}
                        value={line.discount === 0 ? "" : line.discount}
                        placeholder="0"
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          handleLineChange(realIndex, "discount", Math.max(0, isNaN(v) ? 0 : v));
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-right font-mono text-slate-700 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-sm"
                      />
                    </td>

                    {/* Tax */}
                    <td className="py-2.5 px-2 align-top">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={disabled}
                        value={line.tax === 0 ? "" : line.tax}
                        placeholder="0"
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          handleLineChange(realIndex, "tax", Math.max(0, isNaN(v) ? 0 : v));
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-right font-mono text-slate-700 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-sm"
                      />
                    </td>

                    {/* Line Total */}
                    <td className="py-3 px-3 align-top text-right font-bold text-slate-900 font-mono text-xs whitespace-nowrap">
                      {formatMoney(line.line_total)}
                    </td>

                    {/* Actions: Duplicate & Delete */}
                    <td className="py-2.5 px-2 align-top text-center">
                      <div className="flex items-center justify-center gap-1 mt-0.5">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => handleDuplicateLine(realIndex)}
                          title="Duplicate line"
                          className="rounded-lg p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition"
                        >
                          📋
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => handleDeleteLine(realIndex)}
                          title="Delete line"
                          className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* User-Friendly Add Line Footer Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-200 bg-slate-50/80 px-4 py-3 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={handleAddLine}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary-500 bg-white px-4 py-2 text-xs font-bold text-primary-700 shadow-sm hover:bg-primary-50 active:scale-95 transition"
          >
            <span className="text-sm font-extrabold">+</span>
            <span>Add Another Line</span>
          </button>
          <div className="text-[11px] text-slate-500 font-medium">
            {items.length} {items.length === 1 ? "line item" : "line items"} • Subtotal:{" "}
            <span className="font-mono font-bold text-slate-800">{formatMoney(subtotal)}</span>
          </div>
        </div>
      </div>

      {/* Totals & Notes Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1">
        {/* Notes & Terms */}
        <div className="lg:col-span-7 space-y-3">
          {onChangeNotes && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Notes / Remarks
              </label>
              <textarea
                rows={2}
                disabled={disabled}
                value={notes || ""}
                onChange={(e) => onChangeNotes(e.target.value)}
                placeholder="Additional notes for quotation/repair..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none shadow-sm"
              />
            </div>
          )}

          {onChangeTerms && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Terms & Conditions
              </label>
              <textarea
                rows={2}
                disabled={disabled}
                value={terms || ""}
                onChange={(e) => onChangeTerms(e.target.value)}
                placeholder="Payment terms, warranty periods, condition terms..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none shadow-sm"
              />
            </div>
          )}
        </div>

        {/* Financial Summary */}
        <div className="lg:col-span-5 rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2.5 shadow-sm">
          <div className="flex justify-between items-center text-xs text-slate-600">
            <span>Subtotal:</span>
            <span className="font-mono font-medium text-slate-800">{formatMoney(subtotal)}</span>
          </div>

          {/* Overall Discount */}
          {onChangeOverallDiscount ? (
            <div className="flex justify-between items-center text-xs text-slate-600">
              <span>Total Discount:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={disabled}
                  value={overallDiscount === 0 ? "" : overallDiscount}
                  placeholder="0.00"
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : Number(e.target.value);
                    onChangeOverallDiscount(Math.max(0, isNaN(v) ? 0 : v));
                  }}
                  onFocus={(e) => e.target.select()}
                  className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-mono text-xs focus:border-primary-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-sm"
                />
                {totalLineDiscount > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    (+{formatMoney(totalLineDiscount)} lines)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center text-xs text-slate-600">
              <span>Total Discount:</span>
              <span className="font-mono font-medium text-emerald-600">-{formatMoney(totalDiscount)}</span>
            </div>
          )}

          {/* Tax Rate */}
          {onChangeTaxRate ? (
            <div className="flex justify-between items-center text-xs text-slate-600">
              <span className="flex items-center gap-1">
                Tax Rate (%):
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  disabled={disabled}
                  value={taxRate === 0 ? "" : taxRate}
                  placeholder="0"
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : Number(e.target.value);
                    onChangeTaxRate(Math.max(0, isNaN(v) ? 0 : v));
                  }}
                  onFocus={(e) => e.target.select()}
                  className="w-16 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs focus:border-primary-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-sm"
                />
              </span>
              <span className="font-mono font-medium">{formatMoney(totalTax)}</span>
            </div>
          ) : (
            <div className="flex justify-between items-center text-xs text-slate-600">
              <span>Tax:</span>
              <span className="font-mono font-medium">{formatMoney(totalTax)}</span>
            </div>
          )}

          <div className="border-t border-slate-200/90 pt-2 flex justify-between items-center">
            <span className="text-sm font-bold text-slate-900">Grand Total:</span>
            <span className="text-lg font-extrabold text-primary-700 font-mono">
              {formatMoney(grandTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
