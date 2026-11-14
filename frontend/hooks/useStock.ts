"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { api } from "@/lib/api";
import { loadCatalog, saveCatalog } from "@/lib/offline";
import type { Product } from "@/lib/types";

interface StockMessage {
  type: string;
  products?: Product[];
  product?: Product;
  id?: number;
}

function wsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/ws`;
}

export function useStock(branchId?: number) {
  const [products, setProducts] = useState<Product[]>(
    () => loadCatalog() ?? []
  );
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string>("");
  const [branchLabel, setBranchLabel] = useState<string | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    const connect = () => {
      ws = new WebSocket(wsUrl());

      ws.onopen = () => {
        setConnected(true);
        // When a branch is set, fetch branch-specific products via REST API
        if (branchId !== undefined && mounted) {
          api.products
            .list(branchId)
            .then((data) => {
              if (mounted) {
                setProducts(data);
                saveCatalog(data);
              }
            })
            .catch(() => {
              // Fall back to WebSocket sync if REST fails
            });
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (mounted) retry = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as StockMessage;
        if (data.type === "sync" && data.products) {
          // WebSocket sync sends global products; only apply if no branch filter
          if (branchId === undefined && mounted) {
            setProducts(data.products);
            saveCatalog(data.products);
          }
        } else if (data.type === "stock_update" && data.product) {
          setProducts((prev) => {
            const exists = prev.some((p) => p.id === data.product!.id);
            const next = exists
              ? prev.map((p) =>
                  p.id === data.product!.id ? data.product! : p
                )
              : [...prev, data.product!];
            saveCatalog(next);
            return next;
          });
          setLastEvent(`${data.product.name} stock -> ${data.product.stock}`);
        } else if (data.type === "product_removed") {
          setProducts((prev) => {
            const next = prev.filter((p) => p.id !== data.id);
            saveCatalog(next);
            return next;
          });
          setLastEvent("Product removed");
        }
      };
    };

    connect();
    return () => {
      mounted = false;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [branchId]);

  // Resolve branch label from branchId if available
  useEffect(() => {
    if (branchId !== undefined) {
      // Try to find branch name from products or keep null
      // Branch label is set externally via the Products page
    }
  }, [branchId]);

  const applyOptimisticStock = useCallback((productId: number, qty: number) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p
      )
    );
  }, []);

  return { products, connected, lastEvent, applyOptimisticStock, branchLabel };
}
