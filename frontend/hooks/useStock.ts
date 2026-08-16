"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
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

export function useStock() {
  const [products, setProducts] = useState<Product[]>(
    () => loadCatalog() ?? []
  );
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string>("");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      ws = new WebSocket(wsUrl());

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
        retry = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as StockMessage;
        if (data.type === "sync" && data.products) {
          setProducts(data.products);
          saveCatalog(data.products);
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
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const applyOptimisticStock = useCallback((productId: number, qty: number) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p
      )
    );
  }, []);

  return { products, connected, lastEvent, applyOptimisticStock };
}
