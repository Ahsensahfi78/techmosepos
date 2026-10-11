"use client";

import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { detectBarcodeFormat } from "@/lib/barcodes";

export default function BarcodePreview({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  const trimmed = value.trim();

  useEffect(() => {
    setFailed(false);
    if (!svgRef.current || !trimmed) return;
    try {
      JsBarcode(svgRef.current, trimmed, {
        format: detectBarcodeFormat(trimmed),
        width: 2,
        height: 56,
        displayValue: true,
        fontSize: 14,
        margin: 4,
        background: "transparent",
        lineColor: "#000000",
      });
    } catch {
      try {
        JsBarcode(svgRef.current, trimmed, {
          format: "CODE128",
          width: 2,
          height: 56,
          displayValue: true,
          fontSize: 14,
          margin: 4,
          background: "transparent",
          lineColor: "#000000",
        });
      } catch {
        setFailed(true);
      }
    }
  }, [trimmed]);

  if (!trimmed) {
    return (
      <p className={`text-xs text-slate-400 ${className}`}>
        Barcode preview appears after a code is generated.
      </p>
    );
  }

  if (failed) {
    return (
      <p className={`text-xs font-semibold text-amber-600 ${className}`}>
        Preview unavailable — the code will still be saved.
      </p>
    );
  }

  return (
    <div
      className={`flex justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 ${className}`}
      data-testid="barcode-preview"
    >
      <svg ref={svgRef} aria-label={`Barcode preview for ${trimmed}`} />
    </div>
  );
}
