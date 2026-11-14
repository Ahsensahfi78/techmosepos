"""
Opening-balance backfill CLI for multi-branch inventory cutover.

Usage examples:

    # Dry-run Mode A: all legacy products.stock is at warehouse branch 5
    python -m scripts.backfill_stock --mode warehouse --warehouse-branch-id 5 --dry-run

    # Execute Mode A
    python -m scripts.backfill_stock --mode warehouse --warehouse-branch-id 5 --execute

    # Dry-run Mode B: physical-count allocation from CSV
    python -m scripts.backfill_stock --mode allocation --allocation-file counts.csv --dry-run

    # Execute Mode B
    python -m scripts.backfill_stock --mode allocation --allocation-file counts.csv --execute

CSV format (header required):
    product_id,branch_id,quantity,unit_cost
    1,1,100,12.50
    2,1,50,25.00
    1,2,30,12.50

Safety rules:
- Refuses to run if stock_movements already has rows (unless --force-resume)
- Refuses negative legacy stock
- One-time, transactionally atomic
- Never runs at API startup
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from typing import Optional

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.database import DATABASE_URL, engine
from app import models


def _fail(msg: str) -> None:
    print(f"ERROR: {msg}")
    sys.exit(1)


def _check_preconditions(db) -> None:
    """Refuse to backfill if stock_movements already has data."""
    count = db.execute(
        text("SELECT COUNT(*) FROM stock_movements")
    ).scalar()
    if count and count > 0:
        _fail(
            "stock_movements already has rows. Backfill is one-time only. "
            "If you need to resume, use --force-resume after review."
        )


def _check_no_negative_legacy(db) -> None:
    """Refuse negative legacy products.stock until resolved."""
    rows = db.execute(
        text("SELECT id, name, stock FROM products WHERE stock < 0")
    ).fetchall()
    if rows:
        details = ", ".join(f"#{r[0]} {r[1]}={r[2]}" for r in rows)
        _fail(f"Negative legacy stock found (must resolve first): {details}")


def _get_branch(db, branch_id: int) -> Optional[models.Branch]:
    branch = db.get(models.Branch, branch_id)
    if branch is None:
        _fail(f"Branch id={branch_id} does not exist")
    if not branch.is_active:
        _fail(f"Branch id={branch_id} ({branch.name}) is not active")
    return branch


def _get_product(db, product_id: int) -> Optional[models.Product]:
    product = db.get(models.Product, product_id)
    if product is None:
        _fail(f"Product id={product_id} does not exist")
    return product


def backfill_warehouse(
    db, warehouse_branch_id: int, dry_run: bool = True, force_resume: bool = False
) -> None:
    """Mode A: all current legacy products.stock is physically at one warehouse."""
    if not dry_run and not force_resume:
        _check_preconditions(db)
    _check_no_negative_legacy(db)

    warehouse = _get_branch(db, warehouse_branch_id)

    # Snapshot legacy products.stock BEFORE any triggers can change it
    products = db.execute(
        text("SELECT id, name, stock FROM products WHERE stock > 0")
    ).fetchall()

    total_rows = 0
    total_qty = 0
    for pid, name, stock in products:
        total_rows += 1
        total_qty += stock
        print(
            f"  {pid:>4} {name:<40} stock={stock:>6} -> opening at '{warehouse.name}' ({warehouse_branch_id})"
        )
        if not dry_run:
            db.execute(
                text(
                    "INSERT INTO stock_movements "
                    "(branch_id, product_id, qty, quantity, previous_quantity, "
                    "new_quantity, movement_type, reference_type, balance_after, "
                    "note, created_by, created_at) "
                    "VALUES (:b, :p, :q, :q, 0, :q, 'opening', 'opening', :q, "
                    "'Opening balance (Mode A: warehouse)', NULL, datetime('now'))"
                ),
                {"b": warehouse_branch_id, "p": pid, "q": stock},
            )

    if dry_run:
        print(f"\nDRY-RUN: would insert {total_rows} opening movements, total qty={total_qty}")
        print("Run without --dry-run to execute.")
    else:
        db.commit()
        print(f"\nCOMMITTED: {total_rows} opening movements, total qty={total_qty} at branch {warehouse_branch_id}")


def backfill_allocation(
    db, allocation_file: str, dry_run: bool = True, force_resume: bool = False
) -> None:
    """Mode B: physical-count allocation from CSV/JSON file."""
    if not dry_run and not force_resume:
        _check_preconditions(db)
    _check_no_negative_legacy(db)

    allocations = []
    errors = []

    if allocation_file.endswith(".json"):
        with open(allocation_file) as f:
            data = json.load(f)
        for row in data:
            allocations.append(
                {
                    "product_id": int(row["product_id"]),
                    "branch_id": int(row["branch_id"]),
                    "quantity": int(row["quantity"]),
                    "unit_cost": row.get("unit_cost"),
                }
            )
    else:
        # CSV
        with open(allocation_file, newline="") as f:
            reader = csv.DictReader(f)
            required = {"product_id", "branch_id", "quantity"}
            if not required.issubset(set(reader.fieldnames or [])):
                _fail(f"CSV must have columns: {', '.join(required)}")
            for row in reader:
                # Skip comment lines (rows where product_id starts with #)
                pid_raw = (row.get("product_id") or "").strip()
                if not pid_raw or pid_raw.startswith("#"):
                    continue
                allocations.append(
                    {
                        "product_id": int(pid_raw),
                        "branch_id": int(row["branch_id"]),
                        "quantity": int(row["quantity"]),
                        "unit_cost": row.get("unit_cost"),
                    }
                )

    # Validate
    seen_pairs = set()
    total_qty = 0
    for a in allocations:
        pid = a["product_id"]
        bid = a["branch_id"]
        qty = a["quantity"]

        _get_product(db, pid)
        _get_branch(db, bid)

        if qty < 0:
            errors.append(f"product {pid} at branch {bid}: negative qty {qty}")
        pair = (pid, bid)
        if pair in seen_pairs:
            errors.append(f"duplicate product {pid} at branch {bid}")
        seen_pairs.add(pair)
        total_qty += qty

    if errors:
        for e in errors:
            print(f"  VALIDATION ERROR: {e}")
        _fail("Allocation file validation failed")

    # Compare with legacy products.stock
    legacy_stock = {
        r[0]: r[1] for r in db.execute(text("SELECT id, stock FROM products")).fetchall()
    }
    allocated_by_product = {}
    for a in allocations:
        allocated_by_product[a["product_id"]] = (
            allocated_by_product.get(a["product_id"], 0) + a["quantity"]
        )

    print(f"\nAllocation summary: {len(allocations)} lines, total qty={total_qty}")
    print("\nDifferences from legacy products.stock:")
    all_pids = set(legacy_stock.keys()) | set(allocated_by_product.keys())
    for pid in sorted(all_pids):
        legacy = legacy_stock.get(pid, 0)
        allocated = allocated_by_product.get(pid, 0)
        diff = allocated - legacy
        product = _get_product(db, pid)
        if diff != 0:
            print(
                f"  {pid:>4} {product.name:<40} legacy={legacy:>6} allocated={allocated:>6} diff={diff:+d}"
            )

    if dry_run:
        print("\nDRY-RUN: no changes made. Run without --dry-run to execute.")
        return

    # Execute
    for a in allocations:
        db.execute(
            text(
                "INSERT INTO stock_movements "
                "(branch_id, product_id, qty, quantity, previous_quantity, "
                "new_quantity, movement_type, reference_type, balance_after, "
                "note, created_by, created_at, unit_cost) "
                "VALUES (:b, :p, :q, :q, 0, :q, 'opening', 'opening', :q, "
                "'Opening balance (Mode B: physical count)', NULL, "
                "datetime('now'), :uc)"
            ),
            {
                "b": a["branch_id"],
                "p": a["product_id"],
                "q": a["quantity"],
                "uc": a["unit_cost"],
            },
        )
    db.commit()
    print(f"\nCOMMITTED: {len(allocations)} opening movements, total qty={total_qty}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Opening-balance backfill for multi-branch inventory"
    )
    parser.add_argument(
        "--mode",
        required=True,
        choices=["warehouse", "allocation"],
        help="Backfill mode: warehouse (Mode A) or allocation (Mode B)",
    )
    parser.add_argument(
        "--warehouse-branch-id",
        type=int,
        help="Branch id for Mode A (warehouse receiving branch)",
    )
    parser.add_argument(
        "--allocation-file",
        help="CSV/JSON file for Mode B (physical-count allocation)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would happen without making changes",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Execute the backfill (required with --dry-run absent)",
    )
    parser.add_argument(
        "--force-resume",
        action="store_true",
        help="Force run even if stock_movements is non-empty (review first!)",
    )

    args = parser.parse_args()

    if args.dry_run and args.execute:
        _fail("Cannot specify both --dry-run and --execute")
    if not args.dry_run and not args.execute:
        _fail("Must specify either --dry-run or --execute")

    if args.mode == "warehouse":
        if not args.warehouse_branch_id:
            _fail("--warehouse-branch-id required for warehouse mode")
    elif args.mode == "allocation":
        if not args.allocation_file:
            _fail("--allocation-file required for allocation mode")

    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        if args.mode == "warehouse":
            backfill_warehouse(
                db,
                args.warehouse_branch_id,
                dry_run=args.dry_run,
                force_resume=args.force_resume,
            )
        else:
            backfill_allocation(
                db,
                args.allocation_file,
                dry_run=args.dry_run,
                force_resume=args.force_resume,
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
