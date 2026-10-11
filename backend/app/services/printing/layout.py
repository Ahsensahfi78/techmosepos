"""Builds print layouts for the hardware diagnostic tests.

A layout is a plain JSON document consumed by ``scripts/print.ps1``.  Building
it here (rather than inside PowerShell) keeps the geometry testable without a
printer attached.

Nothing in this module touches the database: every test document is built from
temporary in-memory data and carries an explicit "TEST" marker so a printed
page can never be mistaken for a real sale or a real price label.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Sequence
from uuid import uuid4

from .code128 import BarcodeError, encode_modules

PT_TO_MM = 25.4 / 72.0

FONT_LABEL = "Arial"
FONT_RECEIPT = "Consolas"

# Smallest module width we will attempt to print.  At 203 dpi one dot is
# 0.125 mm, so 0.25 mm is a 2-dot bar -- the usual floor for a hand scanner.
MIN_MODULE_MM = 0.25
MAX_QUIET_ZONE_MM = 6.0

TEST_BANNER = "TEST DOCUMENT - NOT A REAL SALE"


class LayoutError(ValueError):
    """Raised when a test document cannot be laid out for the given size."""


def new_test_sku(prefix: str = "TST") -> str:
    """Ephemeral, scan-able product code. Never written to the database."""
    return f"{prefix}{uuid4().hex[:8].upper()}"


def test_product(currency: str = "Rs") -> dict[str, Any]:
    """Temporary product used only by the barcode diagnostic."""
    sku = new_test_sku()
    return {
        "sku": sku,
        "barcode": sku,
        "name": "TEST PRODUCT (diagnostic)",
        "price": 1.00,
        "currency": currency,
        "symbology": "CODE128",
    }


def test_invoice(currency: str = "Rs", tax_rate: float = 0.0) -> dict[str, Any]:
    """Temporary invoice payload. Never persisted, never charged."""
    lines = [
        {
            "name": "TEST ITEM - diagnostic",
            "sku": new_test_sku("TSI"),
            "qty": 2,
            "unit_price": 10.00,
            "discount": 0.50,
        },
        {
            "name": "TEST ITEM 2 - diagnostic",
            "sku": new_test_sku("TSJ"),
            "qty": 1,
            "unit_price": 5.00,
            "discount": 0.0,
        },
    ]
    subtotal = sum(l["qty"] * l["unit_price"] for l in lines)
    discount = sum(l["discount"] for l in lines)
    taxable = max(0.0, subtotal - discount)
    tax = round(taxable * tax_rate / 100.0, 2)
    total = round(taxable + tax, 2)
    paid = round(total, 2)
    return {
        "invoice_no": f"TEST-{uuid4().hex[:8].upper()}",
        "created_at": datetime.utcnow(),
        "cashier": "DIAGNOSTIC",
        "customer": "WALK-IN (test)",
        "lines": lines,
        "subtotal": round(subtotal, 2),
        "discount": round(discount, 2),
        "tax": tax,
        "tax_rate": tax_rate,
        "total": total,
        "paid": paid,
        "payment_method": "cash",
        "change": round(paid - total, 2),
        "currency": currency,
    }


# --------------------------------------------------------------------------
# low level item helpers
# --------------------------------------------------------------------------


def _text(
    text: str,
    x: float,
    y: float,
    w: float,
    size_pt: float,
    *,
    align: str = "left",
    font: str = FONT_RECEIPT,
    bold: bool = False,
    italic: bool = False,
    color: str = "black",
) -> dict[str, Any]:
    return {
        "kind": "text",
        "text": text,
        "x_mm": round(x, 3),
        "y_mm": round(y, 3),
        "w_mm": round(w, 3),
        "size_pt": size_pt,
        "align": align,
        "font": font,
        "bold": bold,
        "italic": italic,
        "color": color,
    }


def _rule(y: float, width: float, *, dashed: bool = True, weight: float = 0.75) -> dict[str, Any]:
    return {
        "kind": "line",
        "x_mm": 0.0,
        "y_mm": round(y, 3),
        "x2_mm": round(width, 3),
        "y2_mm": round(y, 3),
        "width_pt": weight,
        "dash": dashed,
        "color": "black",
    }


def _line_height(size_pt: float, spacing: float = 1.35) -> float:
    return size_pt * spacing * PT_TO_MM


class _Canvas:
    """Tiny cursor-based layout helper."""

    def __init__(self, width: float, height: float, margin: float) -> None:
        self.width = width
        self.height = height
        self.margin = margin
        self.items: list[dict[str, Any]] = []
        self.y = margin

    @property
    def inner_width(self) -> float:
        return max(1.0, self.width - 2 * self.margin)

    def add(self, item: dict[str, Any]) -> None:
        self.items.append(item)

    def line(
        self,
        text: str,
        size_pt: float,
        *,
        align: str = "left",
        bold: bool = False,
        font: str = FONT_RECEIPT,
        color: str = "black",
        spacing: float = 1.35,
        advance: bool = True,
    ) -> float:
        self.items.append(
            _text(
                text,
                self.margin,
                self.y,
                self.inner_width,
                size_pt,
                align=align,
                font=font,
                bold=bold,
                color=color,
            )
        )
        used = _line_height(size_pt, spacing)
        if advance:
            self.y += used
        return used

    def row(
        self,
        label: str,
        value: str,
        size_pt: float,
        *,
        bold: bool = False,
        font: str = FONT_RECEIPT,
        spacing: float = 1.35,
    ) -> float:
        half = self.inner_width / 2
        self.items.append(
            _text(label, self.margin, self.y, half, size_pt, align="left", font=font, bold=bold)
        )
        self.items.append(
            _text(
                value,
                self.margin + half,
                self.y,
                half,
                size_pt,
                align="right",
                font=font,
                bold=bold,
            )
        )
        used = _line_height(size_pt, spacing)
        self.y += used
        return used

    def spacer(self, amount: float) -> None:
        self.y += amount

    def rule(self, *, dashed: bool = True, weight: float = 0.75) -> None:
        self.items.append(_rule(self.y, self.width, dashed=dashed, weight=weight))
        self.y += 1.2


# --------------------------------------------------------------------------
# barcode label
# --------------------------------------------------------------------------


def barcode_modules_for_width(
    data: str,
    available_mm: float,
    *,
    barcode_width_mm: float | None = None,
) -> tuple[list[int], float]:
    """Encode ``data`` and fit it into ``available_mm``.

    Returns ``(modules, module_width_mm)``.  Raises :class:`LayoutError` when
    the code is physically too wide for the label at the minimum module width.
    """
    try:
        modules = encode_modules(data)
    except BarcodeError as exc:
        raise LayoutError(str(exc)) from exc

    count = len(modules)
    target_width = barcode_width_mm if barcode_width_mm else available_mm
    # Reserve quiet zones (10 modules each side already inside `modules`).
    module_mm = target_width / count
    if module_mm < MIN_MODULE_MM:
        raise LayoutError(
            f"Barcode for {data!r} needs {count} modules; {target_width:.1f} mm "
            f"only allows {target_width / count:.3f} mm per module "
            f"(minimum {MIN_MODULE_MM} mm). Use a shorter product code or a "
            f"wider label."
        )
    return modules, module_mm


def build_label_layout(
    product: dict[str, Any],
    *,
    width_mm: float,
    height_mm: float,
    margin_mm: float = 3.0,
    store_name: str = "My Store",
    barcode_height_mm: float = 12.0,
    paper_size: str | None = None,
) -> dict[str, Any]:
    """Lay out a single test barcode label."""
    canvas = _Canvas(width_mm, height_mm, margin_mm)
    inner = canvas.inner_width

    canvas.line("TEST LABEL - NOT FOR SALE", 7.0, align="center", bold=True, color="#b91c1c")
    canvas.line(store_name, 8.0, align="center", bold=True)
    canvas.line(product["name"], 9.0, align="center", bold=True)
    canvas.line(f"SKU  {product['sku']}", 7.5, align="center", font="Consolas")

    canvas.spacer(1.0)
    modules, module_mm = barcode_modules_for_width(product["barcode"], inner)
    barcode_y = canvas.y
    barcode_width = len(modules) * module_mm
    barcode_x = canvas.margin + max(0.0, (inner - barcode_width) / 2)
    canvas.add(
        {
            "kind": "bars",
            "x_mm": round(barcode_x, 3),
            "y_mm": round(barcode_y, 3),
            "w_mm": round(barcode_width, 3),
            "h_mm": barcode_height_mm,
            "modules": modules,
            "color": "black",
        }
    )
    canvas.y += barcode_height_mm + 1.2

    canvas.line(product["barcode"], 8.0, align="center", font="Consolas")
    canvas.line(
        f"{product['currency']} {product['price']:.2f}",
        10.0,
        align="center",
        bold=True,
    )
    canvas.line(
        f"{product['symbology']} | module {module_mm:.3f} mm | "
        f"{len(modules)} modules | scan to verify",
        6.0,
        align="center",
        color="#475569",
    )
    canvas.line(
        f"height {height_mm:g} x width {width_mm:g} mm | temp data, no stock touched",
        6.0,
        align="center",
        color="#475569",
    )

    if canvas.y > height_mm - margin_mm + 0.5:
        raise LayoutError(
            f"Label content ({canvas.y:.1f} mm) does not fit in a "
            f"{height_mm:g} mm tall label."
        )

    items: list[dict[str, Any]] = [
        {
            "kind": "rect",
            "x_mm": 0.5,
            "y_mm": 0.5,
            "w_mm": round(width_mm - 1.0, 3),
            "h_mm": round(height_mm - 1.0, 3),
            "outline": "#cbd5e1",
            "outline_pt": 0.5,
        },
        *canvas.items,
    ]

    return {
        "printer": "",
        "kind": "label",
        "width_mm": width_mm,
        "height_mm": height_mm,
        "paper_size": paper_size,
        "background": "white",
        "items": items,
        "meta": {
            "sku": product["sku"],
            "barcode": product["barcode"],
            "symbology": product["symbology"],
            "module_mm": round(module_mm, 4),
            "module_count": len(modules),
            "barcode_width_mm": round(barcode_width, 3),
            "barcode_height_mm": barcode_height_mm,
        },
    }


# --------------------------------------------------------------------------
# invoice / receipt
# --------------------------------------------------------------------------


def _money(amount: float, currency: str) -> str:
    return f"{currency} {amount:,.2f}"


def build_receipt_layout(
    invoice: dict[str, Any],
    *,
    width_mm: float,
    store_name: str,
    store_tagline: str = "POS hardware diagnostic",
    footer: Sequence[str] = (),
    paper_size: str | None = None,
    margin_mm: float = 3.5,
    show_barcode: bool = False,
) -> dict[str, Any]:
    """Lay out a clearly marked TEST INVOICE."""
    canvas = _Canvas(width_mm, 0.0, margin_mm)
    currency = invoice["currency"]

    canvas.line(TEST_BANNER, 9.5, align="center", bold=True, color="#b91c1c")
    canvas.line(store_name, 12.0, align="center", bold=True, font=FONT_RECEIPT)
    canvas.line(store_tagline, 8.0, align="center", font=FONT_RECEIPT)
    canvas.rule()

    canvas.row("Invoice", invoice["invoice_no"], 9.0, font=FONT_RECEIPT)
    created = invoice["created_at"]
    canvas.row(
        "Date",
        created.strftime("%Y-%m-%d %H:%M:%S") + " UTC",
        9.0,
        font=FONT_RECEIPT,
    )
    canvas.row("Cashier", invoice["cashier"], 9.0, font=FONT_RECEIPT)
    canvas.row("Customer", invoice["customer"], 9.0, font=FONT_RECEIPT)
    canvas.rule()

    half = canvas.inner_width / 2
    canvas.add(
        _text(
            "ITEM",
            canvas.margin,
            canvas.y,
            half,
            8.0,
            align="left",
            font=FONT_RECEIPT,
            bold=True,
        )
    )
    canvas.add(
        _text(
            "QTY   TOTAL",
            canvas.margin + half,
            canvas.y,
            half,
            8.0,
            align="right",
            font=FONT_RECEIPT,
            bold=True,
        )
    )
    canvas.y += _line_height(8.0)

    for line in invoice["lines"]:
        canvas.line(line["name"], 9.0, font=FONT_RECEIPT)
        canvas.line(f"   {line['sku']}", 7.5, font=FONT_RECEIPT, color="#475569")
        detail = f"@ {_money(line['unit_price'], currency)} each"
        if line["discount"] > 0:
            detail += f"  - {_money(line['discount'], currency)} disc"
        canvas.line(f"   {detail}", 7.5, font=FONT_RECEIPT, color="#475569")
        line_total = line["qty"] * line["unit_price"] - line["discount"]
        canvas.add(
            _text(
                f"{line['qty']:>4}   {_money(line_total, currency)}",
                canvas.margin + half,
                canvas.y - 2 * _line_height(7.5),
                half,
                9.0,
                align="right",
                font=FONT_RECEIPT,
            )
        )
        canvas.y += 0.8

    canvas.rule()
    canvas.row("Subtotal", _money(invoice["subtotal"], currency), 9.0)
    if invoice["discount"] > 0:
        canvas.row("Discount", "-" + _money(invoice["discount"], currency), 9.0)
    if invoice["tax"] > 0:
        canvas.row(
            f"Tax ({invoice['tax_rate']:g}%)",
            "+" + _money(invoice["tax"], currency),
            9.0,
        )
    else:
        canvas.row("Tax", "not applicable", 9.0)
    canvas.row("TOTAL", _money(invoice["total"], currency), 11.0, bold=True)
    canvas.row(
        f"Paid ({invoice['payment_method']})",
        _money(invoice["paid"], currency),
        9.0,
    )
    canvas.row("Change", _money(invoice["change"], currency), 9.0)
    canvas.rule()

    if show_barcode:
        modules, module_mm = barcode_modules_for_width(
            invoice["invoice_no"],
            canvas.inner_width,
        )
        width = len(modules) * module_mm
        canvas.add(
            {
                "kind": "bars",
                "x_mm": round(canvas.margin + (canvas.inner_width - width) / 2, 3),
                "y_mm": round(canvas.y, 3),
                "w_mm": round(width, 3),
                "h_mm": 10.0,
                "modules": modules,
                "color": "black",
            }
        )
        canvas.y += 11.0
        canvas.line(invoice["invoice_no"], 8.0, align="center", font=FONT_RECEIPT)

    for text in footer:
        canvas.line(text or " ", 7.5, align="center")
    canvas.line(
        "DIAGNOSTIC ONLY - no sale, stock, payment or drawer was created.",
        7.5,
        align="center",
        bold=True,
        color="#b91c1c",
    )

    total_height = canvas.y + margin_mm

    return {
        "printer": "",
        "kind": "receipt",
        "width_mm": width_mm,
        "height_mm": round(total_height, 3),
        "paper_size": paper_size,
        "background": "white",
        "items": canvas.items,
        "meta": {
            "invoice_no": invoice["invoice_no"],
            "line_count": len(invoice["lines"]),
            "subtotal": invoice["subtotal"],
            "discount": invoice["discount"],
            "tax": invoice["tax"],
            "total": invoice["total"],
            "payment_method": invoice["payment_method"],
            "change": invoice["change"],
            "currency": currency,
            "has_barcode": show_barcode,
            "content_height_mm": round(total_height, 3),
        },
    }


def payload_summary(layout: dict[str, Any]) -> dict[str, Any]:
    """Small, log-safe summary of a layout (no customer/payment content)."""
    meta = dict(layout.get("meta", {}))
    return {
        "kind": layout.get("kind"),
        "width_mm": layout.get("width_mm"),
        "height_mm": layout.get("height_mm"),
        "item_count": len(layout.get("items", [])),
        "meta": meta,
    }
