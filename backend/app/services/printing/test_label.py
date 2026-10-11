"""End-to-end hardware test: print one real product's barcode label.

Read-only against the database, writes nothing to stock/sales/settings, and
targets the printer directly over RAW TSPL so the (currently wrong) Windows
driver is not in the loop.

    python -m app.services.printing.test_label --product 17 --send
    python -m app.services.printing.test_label --product 17
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).parent / "scripts"
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
DEFAULT_PRINTER = "Xprinter XP-365B"


def run_script(name: str, args: list[str], timeout: int = 90) -> dict[str, Any]:
    cmd = [
        POWERSHELL,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(SCRIPTS / name),
        *args,
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    out = proc.stdout.decode("utf-8", "replace").strip()
    err = proc.stderr.decode("utf-8", "replace").strip()
    if not out:
        return {"ok": False, "exit_code": proc.returncode, "error": err or "no output"}
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {"ok": False, "exit_code": proc.returncode, "error": out[:2000]}
    data["exit_code"] = proc.returncode
    if err:
        data["stderr"] = err[:2000]
    return data


def load_product(product_id: int, db_path: Path) -> dict[str, Any]:
    import sqlite3

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        row = con.execute(
            "SELECT id, name, sku, barcode, price FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
    finally:
        con.close()
    if row is None:
        raise SystemExit(f"product {product_id} not found in {db_path}")

    sku = row[2] or f"PRD-{row[0]:06d}"
    barcode = row[3] or sku
    return {
        "id": row[0],
        "name": row[1],
        "sku": sku,
        "barcode": barcode,
        "price": float(row[4] or 0.0),
        "currency": "Rs",
        "symbology": "CODE128",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--product", type=int, default=17, help="product id")
    ap.add_argument("--db", type=Path, default=Path("pos.db"))
    ap.add_argument("--printer", default=DEFAULT_PRINTER)
    ap.add_argument("--store", default="TechMOS")
    ap.add_argument("--width-mm", type=float, default=70.0)
    ap.add_argument("--height-mm", type=float, default=50.0)
    ap.add_argument("--gap-mm", type=float, default=2.0)
    ap.add_argument("--dpi", type=int, default=203)
    ap.add_argument("--send", action="store_true", help="actually print")
    ap.add_argument("--keep", action="store_true", help="keep intermediate files")
    opts = ap.parse_args()

    from app.services.printing.layout import build_label_layout

    product = load_product(opts.product, opts.db)
    layout = build_label_layout(
        product,
        width_mm=opts.width_mm,
        height_mm=opts.height_mm,
        store_name=opts.store,
        paper_size=f"{opts.width_mm:g}x{opts.height_mm:g}mm",
    )
    layout["printer"] = opts.printer

    fd, tmp_name = tempfile.mkstemp(suffix=".json")
    import os

    os.close(fd)
    tmp = Path(tmp_name)
    tspl_path = tmp.with_suffix(".tspl")
    try:
        tmp.write_text(json.dumps(layout), encoding="utf-8")

        render = run_script(
            "print.ps1",
            [
                "-LayoutPath",
                str(tmp),
                "-TsplOut",
                str(tspl_path),
                "-DryRunDpi",
                str(opts.dpi),
                "-TsplGapMm",
                str(opts.gap_mm),
                "-OutFile",
                str(tmp.with_suffix(".render.json")),
            ],
        )
        print(json.dumps({"stage": "render", "result": render}, indent=2))
        if not render.get("ok") or not tspl_path.exists():
            return 1

        tspl_bytes = tspl_path.read_bytes()
        preview = tspl_bytes.decode("ascii", "replace").splitlines()
        print(
            json.dumps(
                {
                    "stage": "tspl",
                    "bytes": len(tspl_bytes),
                    "commands": [ln[:80] for ln in preview if not ln.startswith("BITMAP")]
                    + [f"BITMAP ... ({len(ln)} chars)" for ln in preview if ln.startswith("BITMAP")],
                    "product": {
                        "id": product["id"],
                        "name": product["name"],
                        "sku": product["sku"],
                        "barcode": product["barcode"],
                        "price": product["price"],
                    },
                },
                indent=2,
            )
        )

        if not opts.send:
            print(json.dumps({"stage": "send", "skipped": True, "tspl": str(tspl_path)}))
            return 0

        result = run_script(
            "raw.ps1",
            ["-PrinterName", opts.printer, "-TextPath", str(tspl_path), "-WaitSeconds", "4"],
        )
        print(json.dumps({"stage": "send", "result": result}, indent=2))
        return 0 if result.get("ok") else 1
    finally:
        if not opts.keep:
            for p in (tmp, tspl_path, tmp.with_suffix(".render.json")):
                try:
                    p.unlink()
                except OSError:
                    pass


if __name__ == "__main__":
    sys.exit(main())
