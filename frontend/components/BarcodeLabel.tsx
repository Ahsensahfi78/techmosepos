"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import type { Product } from "@/lib/types";
import type { BarcodeDisplaySettings } from "@/lib/barcodes";
import { detectBarcodeFormat } from "@/lib/barcodes";
import { formatMoney } from "@/lib/constants";

export default function BarcodeLabel({
  product,
  storeName,
  settings,
  className = "",
}: {
  product: Product;
  storeName: string;
  settings: BarcodeDisplaySettings;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  const barcodeValue = product.barcode || product.sku || product.name;
  const hasValidBarcode = !!(product.barcode || product.sku);

  useEffect(() => {
    if (svgRef.current && hasValidBarcode) {
      try {
        JsBarcode(svgRef.current, barcodeValue, {
          format: detectBarcodeFormat(barcodeValue),
          width: 1.5,
          height: 30,
          displayValue: false,
          margin: 0,
          background: "transparent",
          lineColor: "#000000",
        });
      } catch {
        if (svgRef.current) {
          try {
            JsBarcode(svgRef.current, barcodeValue, {
              format: "CODE128",
              width: 1.5,
              height: 30,
              displayValue: false,
              margin: 0,
              background: "transparent",
              lineColor: "#000000",
            });
          } catch {
            if (svgRef.current) svgRef.current.innerHTML = "";
          }
        }
      }
    }
  }, [barcodeValue, hasValidBarcode]);

  return (
    <div className={`barcode-label flex flex-col items-center text-center ${className}`}>
      {settings.showStoreName && storeName && (
        <div className="barcode-store-name text-[9px] font-bold uppercase tracking-wide text-slate-800">
          {storeName}
        </div>
      )}

      {settings.showProductName && (
        <div className="barcode-product-name mt-0.5 max-w-full truncate text-[10px] font-semibold text-slate-700">
          {product.name}
        </div>
      )}

      <div className="barcode-image my-1">
        {hasValidBarcode ? (
          <svg ref={svgRef} className="max-w-full" />
        ) : (
          <div className="flex h-[34px] items-center text-[8px] text-slate-400">
            No barcode
          </div>
        )}
      </div>

      {settings.showCode && (
        <div className="barcode-code text-[8px] font-mono text-slate-600">
          {product.barcode || product.sku || "---"}
        </div>
      )}

      {settings.showSku && product.sku && (
        <div className="barcode-sku text-[7px] text-slate-400">
          SKU: {product.sku}
        </div>
      )}

      {settings.showPrice && (
        <div className="barcode-price mt-0.5 text-[10px] font-bold text-slate-800">
          {formatMoney(product.price)}
        </div>
      )}
    </div>
  );
}
