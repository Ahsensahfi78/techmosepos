"""Unique product code (SKU) generation and cross-field uniqueness checks.

The generated value is stored in ``products.sku`` (the existing product-code
field) and mirrored to ``products.barcode`` so POS scanners can read it.

A row in the ``sequences`` table keeps the highest issued number, so codes are
never reused after a product is deleted. ``products.sku`` keeps its UNIQUE
index as the final database-level guard against concurrent generators.
"""
from fastapi import HTTPException
from sqlalchemy import func, or_, update
from sqlalchemy.orm import Session

from .. import models

PRODUCT_CODE_PREFIX = "PRD"
PRODUCT_CODE_WIDTH = 6
SEQUENCE_NAME = "product_sku"


def format_product_code(number: int) -> str:
    return f"{PRODUCT_CODE_PREFIX}-{number:0{PRODUCT_CODE_WIDTH}d}"


def find_code_conflict(
    db: Session, value: str | None, exclude_id: int | None = None
) -> models.Product | None:
    """Return another product using ``value`` as sku or barcode (case-insensitive)."""
    if not value:
        return None
    needle = value.strip().lower()
    if not needle:
        return None
    query = db.query(models.Product).filter(
        or_(
            func.lower(models.Product.sku) == needle,
            func.lower(models.Product.barcode) == needle,
        )
    )
    if exclude_id is not None:
        query = query.filter(models.Product.id != exclude_id)
    return query.first()


def validate_product_codes(
    db: Session,
    sku: str | None = None,
    barcode: str | None = None,
    exclude_id: int | None = None,
) -> None:
    """Raise HTTP 400 when a code collides with another product's sku/barcode."""
    if sku:
        if find_code_conflict(db, sku, exclude_id) is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Product code '{sku}' already exists. Choose a different code.",
            )
    if barcode and barcode.lower() != (sku or "").lower():
        if find_code_conflict(db, barcode, exclude_id) is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Barcode '{barcode}' is already used by another product.",
            )


def _max_code_number(db: Session) -> int:
    rows = (
        db.query(models.Product.sku)
        .filter(models.Product.sku.like(f"{PRODUCT_CODE_PREFIX}-%"))
        .all()
    )
    highest = 0
    for (value,) in rows:
        if not value:
            continue
        parts = value.split("-", 1)
        if len(parts) == 2 and parts[0].upper() == PRODUCT_CODE_PREFIX:
            try:
                highest = max(highest, int(parts[1]))
            except ValueError:
                continue
    return highest


def _bump_sequence(db: Session) -> int:
    stmt = (
        update(models.Sequence)
        .where(models.Sequence.name == SEQUENCE_NAME)
        .values(value=models.Sequence.value + 1)
        .returning(models.Sequence.value)
    )
    value = db.execute(stmt).scalar_one_or_none()
    if value is not None:
        return value

    existing = db.get(models.Sequence, SEQUENCE_NAME)
    if existing is None:
        db.add(
            models.Sequence(name=SEQUENCE_NAME, value=_max_code_number(db))
        )
        db.flush()
    value = db.execute(stmt).scalar_one()
    return value


def next_product_code(db: Session, commit: bool = True) -> str:
    """Issue the next unused ``PRD-NNNNNN`` code.

    The sequence row is updated with a single atomic UPDATE (SQLite serialises
    writers), and every candidate is re-checked against both ``sku`` and
    ``barcode`` before it is returned, so the code is unique across all
    products — including archived rows — at generation time.
    """
    for _ in range(10_000):
        number = _bump_sequence(db)
        code = format_product_code(number)
        if find_code_conflict(db, code) is None:
            if commit:
                db.commit()
            return code
    raise HTTPException(
        status_code=500, detail="Could not generate a unique product code"
    )
