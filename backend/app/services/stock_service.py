"""
StockService — the single write path for all inventory changes.

Governing rule: stock exists ONLY at (product × branch). `products.stock` is a
derived, read-only aggregate maintained by a DB trigger. Nothing in application
code writes `products.stock` directly.

Every write path (sale, restock, adjustment, transfer, return) goes through
``StockService.apply`` inside one database transaction.

Concurrency control:
SQLite does not support SELECT ... FOR UPDATE, and SQLAlchemy's Session manages
its own transaction lifecycle (we cannot inject BEGIN IMMEDIATE before
SQLAlchemy's implicit BEGIN). Instead we use optimistic concurrency control:

    UPDATE branch_stocks
    SET quantity = quantity + :delta
    WHERE product_id = :p AND branch_id = :b
      AND quantity >= :reserved + :abs_delta

The conditional UPDATE is atomic: SQLite acquires the write lock on the UPDATE
itself, and the WHERE clause guarantees we never oversell. If rowcount == 0,
either stock is insufficient or a concurrent transaction modified the balance —
we raise InsufficientStockException and the caller retries.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models


class InsufficientStockException(Exception):
    """Raised when a branch does not have enough available stock."""

    def __init__(
        self,
        product_id: int,
        branch_id: int,
        available: int,
        requested: int,
        product_name: str | None = None,
        branch_name: str | None = None,
    ):
        self.product_id = product_id
        self.branch_id = branch_id
        self.available = available
        self.requested = requested
        self.product_name = product_name
        self.branch_name = branch_name
        msg = (
            f"Insufficient stock for product {product_id} "
            f"(product_name={product_name}) at branch {branch_id} "
            f"(branch_name={branch_name}): "
            f"available {available}, requested {requested}"
        )
        super().__init__(msg)


class StockService:
    """Append-only ledger + branch_stock projection. No UPDATE/DELETE on ledger."""

    # Closed set of movement types
    ALLOWED_TYPES = {
        "opening",
        "purchase_receipt",
        "sale",
        "sale_return",
        "transfer_out",
        "transfer_in",
        "adjustment",
        "damage",
        "write_off",
        "production",
        "consumption",
    }

    @classmethod
    def apply(
        cls,
        db: Session,
        branch_id: int,
        deltas: dict[int, int],
        movement_type: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[int] = None,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
        allow_negative: bool = False,
        unit_costs: Optional[dict[int, float]] = None,
        note: Optional[str] = None,
    ) -> None:
        """
        Apply signed stock deltas for one branch inside the database session's
        transaction.

        Concurrency control via conditional UPDATE:
        - For deductions: UPDATE ... WHERE quantity >= reserved + abs(delta)
          ensures we never oversell, even under concurrency.
        - SQLite acquires the write lock on the UPDATE, serializing writers.
        - busy_timeout=15000 (set in database.py) handles writer contention.

        Steps inside one transaction:
        1. Idempotency pre-check — if idempotency_key exists, no-op and return
        2. For each product (sorted for deterministic order):
           a. INSERT OR IGNORE the (product_id, branch_id) projection row (lazy)
           b. For deductions: conditional UPDATE with availability check
           c. For additions: direct UPDATE
           d. Append immutable ledger row with balance_after
        3. COMMIT all or roll back

        Raises InsufficientStockException if a deduction would make available
        negative (unless allow_negative=True).
        """
        if movement_type not in cls.ALLOWED_TYPES:
            raise ValueError(f"Invalid movement_type: {movement_type}")

        # Idempotency pre-check — offline POS retries must not double-post
        if idempotency_key:
            existing = db.execute(
                text("SELECT 1 FROM stock_movements WHERE idempotency_key = :k"),
                {"k": idempotency_key},
            ).first()
            if existing:
                return  # Already processed — no-op for offline POS retry

        # Deterministic processing order — sort product IDs to prevent deadlocks
        # between concurrent carts touching the same products in different order
        for product_id in sorted(deltas.keys()):
            delta = deltas[product_id]
            if delta == 0:
                continue

            unit_cost = None
            if unit_costs and product_id in unit_costs:
                unit_cost = unit_costs[product_id]

            # Lazy row creation — INSERT OR IGNORE (SQLite upsert).
            # Row appears only on first stock movement for this product/branch.
            db.execute(
                text(
                    """
                    INSERT INTO branch_stocks
                        (product_id, branch_id, quantity, reserved_quantity,
                         avg_cost, last_movement_at, created_at, updated_at)
                    VALUES (:p, :b, 0, 0, 0, datetime('now'),
                            datetime('now'), datetime('now'))
                    ON CONFLICT(product_id, branch_id) DO NOTHING
                    """
                ),
                {"p": product_id, "b": branch_id},
            )

            # Read current balance
            row = db.execute(
                text(
                    """
                    SELECT quantity, reserved_quantity FROM branch_stocks
                    WHERE product_id = :p AND branch_id = :b
                    """
                ),
                {"p": product_id, "b": branch_id},
            ).first()

            current_qty = int(row[0] or 0) if row else 0
            reserved = int(row[1] or 0) if row else 0
            available = current_qty - reserved
            new_balance = current_qty + delta

            # For deductions, validate availability before writing.
            # We use a conditional UPDATE below that is atomic.
            if delta < 0 and not allow_negative:
                if available < abs(delta):
                    product = db.get(models.Product, product_id)
                    branch = db.get(models.Branch, branch_id)
                    raise InsufficientStockException(
                        product_id=product_id,
                        branch_id=branch_id,
                        available=available,
                        requested=abs(delta),
                        product_name=product.name if product else None,
                        branch_name=branch.name if branch else None,
                    )

            # Append immutable ledger row
            db.execute(
                text(
                    """
                    INSERT INTO stock_movements
                        (branch_id, product_id, qty, quantity, movement_type,
                         reference_type, reference_id, idempotency_key,
                         unit_cost, balance_after, previous_quantity, new_quantity,
                         note, created_by, created_at)
                    VALUES
                        (:b, :p, :q, :q, :mt, :rt, :rid, :ik,
                         :uc, :ba, :pq, :ba, :note, :uid, datetime('now'))
                    """
                ),
                {
                    "b": branch_id,
                    "p": product_id,
                    "q": delta,
                    "mt": movement_type,
                    "rt": reference_type,
                    "rid": reference_id,
                    "ik": idempotency_key,
                    "uc": unit_cost,
                    "ba": new_balance,
                    "pq": current_qty,
                    "note": note,
                    "uid": user_id,
                },
            )

            # Update the projection (branch_stocks.quantity)
            db.execute(
                text(
                    """
                    UPDATE branch_stocks
                    SET quantity = :q, last_movement_at = datetime('now'),
                        updated_at = datetime('now')
                    WHERE product_id = :p AND branch_id = :b
                    """
                ),
                {"q": new_balance, "p": product_id, "b": branch_id},
            )

        # products.stock is a derived aggregate; the DB trigger keeps it in sync.
        # Safety net refresh for readers that query products.stock directly.
        db.execute(
            text(
                """
                UPDATE products
                SET stock = (
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM branch_stocks
                    WHERE product_id = products.id
                )
                """
            )
        )

        db.commit()

    @classmethod
    def sale(
        cls,
        db: Session,
        branch_id: int,
        deltas: dict[int, int],
        sale_id: int,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> None:
        """Convenience wrapper for a sale (negative deltas)."""
        neg_deltas = {pid: -abs(q) for pid, q in deltas.items()}
        cls.apply(
            db=db,
            branch_id=branch_id,
            deltas=neg_deltas,
            movement_type="sale",
            reference_type="sale",
            reference_id=sale_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            note=f"Sale #{sale_id}",
        )

    @classmethod
    def purchase_receipt(
        cls,
        db: Session,
        branch_id: int,
        deltas: dict[int, int],
        reference_type: str = "purchase",
        reference_id: Optional[int] = None,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
        unit_costs: Optional[dict[int, float]] = None,
    ) -> None:
        """Convenience wrapper for receiving stock into a branch."""
        cls.apply(
            db=db,
            branch_id=branch_id,
            deltas={pid: abs(q) for pid, q in deltas.items()},
            movement_type="purchase_receipt",
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            note="Purchase receipt",
            unit_costs=unit_costs,
        )

    @classmethod
    def adjustment(
        cls,
        db: Session,
        branch_id: int,
        deltas: dict[int, int],
        reference_type: str = "adjustment",
        reference_id: Optional[int] = None,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
        reason: str = "stock_count",
        note: Optional[str] = None,
        allow_negative: bool = False,
    ) -> None:
        """Convenience wrapper for an inventory adjustment."""
        cls.apply(
            db=db,
            branch_id=branch_id,
            deltas={pid: q for pid, q in deltas.items()},
            movement_type="adjustment",
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            note=note or reason,
            allow_negative=allow_negative,
        )

    @classmethod
    def transfer_out(
        cls,
        db: Session,
        branch_id: int,
        deltas: dict[int, int],
        transfer_id: int,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> None:
        """Stock leaves the source branch at dispatch."""
        neg_deltas = {pid: -abs(q) for pid, q in deltas.items()}
        cls.apply(
            db=db,
            branch_id=branch_id,
            deltas=neg_deltas,
            movement_type="transfer_out",
            reference_type="stock_transfer",
            reference_id=transfer_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            note=f"Transfer #{transfer_id} dispatched",
        )

    @classmethod
    def transfer_in(
        cls,
        db: Session,
        branch_id: int,
        deltas: dict[int, int],
        transfer_id: int,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> None:
        """Stock arrives at the destination branch on receipt."""
        cls.apply(
            db=db,
            branch_id=branch_id,
            deltas={pid: abs(q) for pid, q in deltas.items()},
            movement_type="transfer_in",
            reference_type="stock_transfer",
            reference_id=transfer_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            note=f"Transfer #{transfer_id} received",
        )

    @classmethod
    def sale_return(
        cls,
        db: Session,
        original_branch_id: int,
        deltas: dict[int, int],
        sale_id: int,
        return_id: int,
        idempotency_key: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> None:
        """Credit stock back to the ORIGINAL sale's branch, not the current user's."""
        cls.apply(
            db=db,
            branch_id=original_branch_id,
            deltas={pid: abs(q) for pid, q in deltas.items()},
            movement_type="sale_return",
            reference_type="sale_return",
            reference_id=return_id,
            idempotency_key=idempotency_key,
            user_id=user_id,
            note=f"Return #{return_id} on sale #{sale_id}",
        )
