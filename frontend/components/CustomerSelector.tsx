"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { master } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { Customer } from "@/lib/types";

export interface CustomerSelection {
  id: number | null;
  name: string;
  phone: string;
  address: string;
  type: string;
}

interface CustomerSelectorProps {
  customers: Customer[];
  value: CustomerSelection;
  onChange: (val: CustomerSelection) => void;
  onCustomerCreated?: (c: Customer) => void;
  disabled?: boolean;
}

const DEFAULT_TYPES = ["Retail", "Wholesale", "Corporate", "Walk-in"];

export default function CustomerSelector({
  customers,
  value,
  onChange,
  onCustomerCreated,
  disabled = false,
}: CustomerSelectorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value.name || "");
  const [availableTypes, setAvailableTypes] = useState<string[]>(DEFAULT_TYPES);
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [isSavingNew, setIsSavingNew] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync search input if value.name updates from outside
  useEffect(() => {
    setSearch(value.name || "");
  }, [value.name]);

  // Load custom customer types if any exist in customers
  useEffect(() => {
    const customTypes = new Set<string>(DEFAULT_TYPES);
    customers.forEach((c) => {
      if (c.customer_type) customTypes.add(c.customer_type);
    });
    setAvailableTypes(Array.from(customTypes));
  }, [customers]);

  // Handle outside clicks to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers.slice(0, 10);
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q))
    ).slice(0, 15);
  }, [customers, search]);

  const exactMatch = customers.find(
    (c) => c.name.trim().toLowerCase() === search.trim().toLowerCase()
  );

  function handleSelect(c: Customer) {
    onChange({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      address: c.address || "",
      type: c.customer_type || "Retail",
    });
    setSearch(c.name);
    setOpen(false);
  }

  function handleManualType(nameInput: string) {
    setSearch(nameInput);
    onChange({
      ...value,
      id: null,
      name: nameInput,
    });
    if (!open) setOpen(true);
  }

  async function handleSaveAsNewCustomer() {
    const trimmedName = search.trim();
    if (!trimmedName) {
      toast("Please enter a customer name", "error");
      return;
    }
    setIsSavingNew(true);
    try {
      const created = await master.customers.create({
        name: trimmedName,
        phone: value.phone || undefined,
        address: value.address || undefined,
        customer_type: value.type || "Retail",
      });
      toast(`Customer "${created.name}" created!`, "success");
      onCustomerCreated?.(created);
      onChange({
        id: created.id,
        name: created.name,
        phone: created.phone || "",
        address: created.address || "",
        type: created.customer_type || value.type || "Retail",
      });
      setOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create customer";
      toast(msg, "error");
    } finally {
      setIsSavingNew(false);
    }
  }

  function handleAddCustomType() {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    if (!availableTypes.includes(trimmed)) {
      setAvailableTypes((prev) => [...prev, trimmed]);
    }
    onChange({ ...value, type: trimmed });
    setNewTypeName("");
    setShowAddType(false);
    toast(`Customer type "${trimmed}" added`, "success");
  }

  return (
    <div className="space-y-3" ref={containerRef}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Customer Search / Name Field */}
        <div className="relative">
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Customer Name <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              disabled={disabled}
              value={search}
              onChange={(e) => handleManualType(e.target.value)}
              onFocus={() => setOpen(true)}
              placeholder="Search existing or type new name..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50"
            />
            {value.id ? (
              <span className="absolute right-3 top-2.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Existing Customer
              </span>
            ) : search.trim() ? (
              <span className="absolute right-3 top-2.5 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                New Customer
              </span>
            ) : null}
          </div>

          {/* Autocomplete Dropdown */}
          {open && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              {filteredCustomers.length > 0 ? (
                <div className="space-y-0.5">
                  <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Matching Customers
                  </div>
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelect(c)}
                      className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-slate-50 ${
                        value.id === c.id ? "bg-primary-50 text-primary-900" : "text-slate-800"
                      }`}
                    >
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {c.phone ? `📞 ${c.phone}` : "No phone"} {c.address ? `• 📍 ${c.address}` : ""}
                        </div>
                      </div>
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {c.customer_type || "Retail"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-2 text-center text-xs text-slate-500">No matching customer found</div>
              )}

              {/* Action to save typed name as new customer */}
              {search.trim() && !exactMatch && (
                <div className="border-t border-slate-100 pt-1.5 mt-1">
                  <button
                    type="button"
                    disabled={isSavingNew}
                    onClick={handleSaveAsNewCustomer}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
                  >
                    <span>➕</span>
                    <span>
                      {isSavingNew ? "Saving..." : `Save "${search.trim()}" as New Customer`}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Customer Type Dropdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Customer Type
            </label>
            <button
              type="button"
              onClick={() => setShowAddType(!showAddType)}
              className="text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              {showAddType ? "Cancel" : "+ Add Option"}
            </button>
          </div>

          {showAddType ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="New type (e.g. Distributor)"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomType}
                className="btn btn-primary btn-sm"
              >
                Add
              </button>
            </div>
          ) : (
            <select
              disabled={disabled}
              value={value.type || "Retail"}
              onChange={(e) => onChange({ ...value, type: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50"
            >
              {availableTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Customer Details Display / Inline Editable fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Phone Number</label>
          <input
            type="text"
            disabled={disabled}
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            placeholder="e.g. +94 77 123 4567"
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Address</label>
          <input
            type="text"
            disabled={disabled}
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            placeholder="e.g. 123 Main Street, Colombo"
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div className="col-span-full flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-medium">Pricing Scheme:</span>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 font-semibold text-xs ${
                value.type === "Wholesale"
                  ? "bg-purple-100 text-purple-700"
                  : value.type === "Corporate"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {value.type === "Wholesale" ? "🏷️ Wholesale Pricing Applied" : `Standard (${value.type}) Pricing`}
            </span>
          </div>
          {value.id && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  id: null,
                  name: "",
                  phone: "",
                  address: "",
                  type: "Walk-in",
                })
              }
              className="text-xs text-slate-500 hover:text-red-600 underline"
            >
              Reset to Walk-in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
