"""
Stock reconciliation command for multi-branch inventory.

Checks invariants:
1. SUM(stock_movements.qty) per (product, branch) == branch_stocks.quantity
2. products.stock == SUM(branch_stocks.quantity) per product
3. Reports branch_stocks rows with quantity <> 0 but no ledger history
4. Reports NULL branch_ids, invalid movement types, duplicate projections
5. Reports transfers stuck in dispatched status

Usage:
    python -m scripts.reconcile_stock          # report only
    python -m scripts.reconcile_stock --fix    # report only (no auto-fix per requirements)
"""

from __future__ import annotations

import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import engine

Session = sessionmaker(bind=engine)


def _fail(msg: str) -> None:
    print(f"ERROR: {msg}")
    sys.exit(1)


def reconcile(db, fix: bool = False) -> int:
    """Run reconciliation checks. Returns number of issues found."""
    issues = 0

    print("=== Stock Reconciliation Report ===\n")

    # 1. Ledger sum == branch_stocks.quantity per (product, branch)
    print("--- Check 1: ledger sum vs branch_stocks.quantity ---")
    rows = db.execute(
        text(
            """
            SELECT bs.branch_id, b.name as branch_name, bs.product_id, p.name as product_name,
                   bs.quantity as projection_qty,
                   COALESCE(sm.ledger_sum, 0) as ledger_sum,
                   (bs.quantity - COALESCE(sm.ledger_sum, 0)) as diff
            FROM branch_stocks bs
            JOIN branches b ON b.id = bs.branch_id
            JOIN products p ON p.id = bs.product_id
            LEFT JOIN (
                SELECT branch_id, product_id, SUM(qty) as ledger_sum
                FROM stock_movements
                GROUP BY branch_id, product_id
            ) sm ON sm.branch_id = bs.branch_id AND sm.product_id = bs.product_id
            WHERE bs.quantity <> COALESCE(sm.ledger_sum, 0)
            ORDER BY bs.branch_id, bs.product_id
        """
        )
    ).fetchall()
    if rows:
        issues += len(rows)
        for r in rows:
            print(
                f"  DRIFT: branch={r.branch_id} ({r.branch_name}) "
                f"product={r.product_id} ({r.product_name}) "
                f"projection={r.projection_qty} ledger={r.ledger_sum} diff={r.diff}"
            )
    else:
        print("  OK: all branch_stocks match ledger sums")

    # 2. products.stock == SUM(branch_stocks.quantity) per product
    print("\n--- Check 2: products.stock vs SUM(branch_stocks) ---")
    rows = db.execute(
        text(
            """
            SELECT p.id, p.name, p.stock as product_stock,
                   COALESCE(bs.sum_qty, 0) as branch_sum,
                   (p.stock - COALESCE(bs.sum_qty, 0)) as diff
            FROM products p
            LEFT JOIN (
                SELECT product_id, SUM(quantity) as sum_qty
                FROM branch_stocks
                GROUP BY product_id
            ) bs ON bs.product_id = p.id
            WHERE p.stock <> COALESCE(bs.sum_qty, 0)
            ORDER BY p.id
        """
        )
    ).fetchall()
    if rows:
        issues += len(rows)
        for r in rows:
            print(
                f"  DRIFT: product={r.id} ({r.name}) "
                f"products.stock={r.product_stock} branch_sum={r.branch_sum} diff={r.diff}"
            )
    else:
        print("  OK: products.stock matches SUM(branch_stocks)")

    # 3. branch_stocks rows with quantity <> 0 but no ledger history (dead seeds)
    print("\n--- Check 3: branch_stocks with qty <> 0 but no ledger history ---")
    rows = db.execute(
        text(
            """
            SELECT bs.branch_id, b.name as branch_name, bs.product_id, p.name as product_name,
                   bs.quantity
            FROM branch_stocks bs
            JOIN branches b ON b.id = bs.branch_id
            JOIN products p ON p.id = bs.product_id
            WHERE bs.quantity <> 0
              AND NOT EXISTS (
                  SELECT 1 FROM stock_movements sm
                  WHERE sm.branch_id = bs.branch_id AND sm.product_id = bs.product_id
              )
            ORDER BY bs.branch_id, bs.product_id
        """
        )
    ).fetchall()
    if rows:
        issues += len(rows)
        for r in rows:
            print(
                f"  DEAD SEED: branch={r.branch_id} ({r.branch_name}) "
                f"product={r.product_id} ({r.product_name}) qty={r.quantity}"
            )
    else:
        print("  OK: no dead seed rows")

    # 4. NULL branch_id on movements
    print("\n--- Check 4: movements with NULL branch_id ---")
    count = db.execute(
        text("SELECT COUNT(*) FROM stock_movements WHERE branch_id IS NULL")
    ).scalar()
    if count:
        issues += count
        print(f"  ISSUE: {count} movements have NULL branch_id")
    else:
        print("  OK: no NULL branch_id on movements")

    # 5. Invalid movement types
    print("\n--- Check 5: invalid movement types ---")
    valid_types = (
        "opening", "purchase_receipt", "sale", "sale_return",
        "transfer_out", "transfer_in", "adjustment", "damage",
        "write_off", "production", "consumption",
    )
    placeholders = ",".join(f"'{t}'" for t in valid_types)
    rows = db.execute(
        text(
            f"SELECT DISTINCT movement_type, COUNT(*) as cnt "
            f"FROM stock_movements WHERE movement_type NOT IN ({placeholders}) "
            f"GROUP BY movement_type"
        )
    ).fetchall()
    if rows:
        issues += sum(r[1] for r in rows)
        for r in rows:
            print(f"  INVALID TYPE: '{r.movement_type}' ({r.cnt} rows)")
    else:
        print("  OK: all movement types are valid")

    # 6. Duplicate projections (should be prevented by UNIQUE index)
    print("\n--- Check 6: duplicate (product_id, branch_id) projections ---")
    rows = db.execute(
        text(
            """
            SELECT product_id, branch_id, COUNT(*) as cnt
            FROM branch_stocks
            GROUP BY product_id, branch_id
            HAVING COUNT(*) > 1
        """
        )
    ).fetchall()
    if rows:
        issues += len(rows)
        for r in rows:
            print(
                f"  DUPLICATE: product={r.product_id} branch={r.branch_id} count={r.cnt}"
            )
    else:
        print("  OK: no duplicate projections")

    # 7. Transfers stuck in dispatched status
    print("\n--- Check 7: transfers stuck in 'dispatched' status ---")
    rows = db.execute(
        text(
            """
            SELECT id, transfer_number, from_branch_id, to_branch_id, dispatched_at
            FROM stock_transfers
            WHERE status = 'dispatched'
            ORDER BY dispatched_at
        """
        )
    ).fetchall()
    if rows:
        issues += len(rows)
        for r in rows:
            print(
                f"  STUCK: transfer={r.id} ({r.transfer_number}) "
                f"from={r.from_branch_id} to={r.to_branch_id} dispatched={r.dispatched_at}"
            )
    else:
        print("  OK: no stuck dispatched transfers")

    # 8. Negative available stock (quantity < reserved_quantity)
    print("\n--- Check 8: negative available stock (qty < reserved) ---")
    rows = db.execute(
        text(
            """
            SELECT branch_id, product_id, quantity, reserved_quantity
            FROM branch_stocks
            WHERE quantity < reserved_quantity
        """
        )
    ).fetchall()
    if rows:
        issues += len(rows)
        for r in rows:
            print(
                f"  NEGATIVE AVAILABLE: branch={r.branch_id} product={r.product_id} "
                f"qty={r.quantity} reserved={r.reserved_quantity}"
            )
    else:
        print("  OK: no negative available stock")

    print(f"\n=== Total issues found: {issues} ===")
    if issues > 0:
        print("\nNOTE: Reconciliation does NOT auto-repair drift. Review each issue and")
        print("create compensating stock_movements rows to correct imbalances.")
        return 1
    return 0


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Reconcile multi-branch stock invariants"
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Report only (auto-fix is not supported per requirements)",
    )
    args = parser.parse_args()

    db = Session()
    try:
        exit_code = reconcile(db, fix=args.fix)
    finally:
        db.close()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
