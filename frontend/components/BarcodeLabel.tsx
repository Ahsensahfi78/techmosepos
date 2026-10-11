"use client";

import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import type { Product } from "@/lib/types";
import type { BarcodeDisplaySettings } from "@/lib/barcodes";
import { detectBarcodeFormat } from "@/lib/barcodes";
import { formatMoney } from "@/lib/constants";

// 11px ≈ 8.25pt, the smallest size that still meets the 8pt print minimum.
const TEXT = "text-[11px] text-black";
const PRICE = "text-[12px] text-black";

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
  const [failed, setFailed] = useState(false);

  const code = product.barcode || product.sku || "";
  const barcodeValue = code || product.name;

  useEffect(() => {
    setFailed(false);
    if (!svgRef.current || !barcodeValue) return;
    try {
      JsBarcode(svgRef.current, barcodeValue, {
        format: detectBarcodeFormat(barcodeValue),
        width: 2,
        height: 40,
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
      return;
    } catch {
      /* fall through to CODE128 */
    }
    try {
      JsBarcode(svgRef.current, barcodeValue, {
        format: "CODE128",
        width: 2,
        height: 40,
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      setFailed(true);
    }
  }, [barcodeValue]);

  return (
    <div className={`barcode-label flex flex-col items-center text-center text-black ${className}`}>
      {settings.showStoreName && storeName && (
        <div className={`barcode-store-name font-bold uppercase tracking-wide ${TEXT}`}>
          {storeName}
        </div>
      )}

      {settings.showProductName && (
        <div className={`barcode-product-name mt-0.5 max-w-full truncate font-semibold ${TEXT}`}>
          {product.name}
        </div>
      )}

      {settings.showBarcode && (
        <div className="barcode-image my-1 bg-white">
          {barcodeValue && !failed ? (
            <svg ref={svgRef} className="max-w-full bg-white" />
          ) : (
            <div className={`flex h-[34px] max-w-full items-center px-1 font-semibold ${TEXT}`}>
              {product.name}
            </div>
          )}
        </div>
      )}

      {settings.showCode && (
        <div className={`barcode-code font-mono ${TEXT}`}>
          {product.barcode || product.sku || "---"}
        </div>
      )}

      {settings.showSku && product.sku && (
        <div className={`barcode-sku ${TEXT}`}>SKU: {product.sku}</div>
      )}

      {settings.showPrice && (
        <div className={`barcode-price mt-0.5 font-bold ${PRICE}`}>
          {formatMoney(product.price)}
        </div>
      )}
    </div>
  );
}
