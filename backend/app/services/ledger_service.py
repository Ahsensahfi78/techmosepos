from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models

PARTY_TYPES = ("supplier", "customer")

# Entry types used by this system. Purchases (Module 4) and sales (Module 5)
# post their own entries through the same service.
SUPPLIER_ENTRY_TYPES = {"purchase", "payment", "credit_note", "opening_balance"}
CUSTOMER_ENTRY_TYPES = {"sale", "payment", "return", "credit_note", "opening_balance"}

VALID_DIRECTIONS = ("debit", "credit")


def _party_model(party_type: str):
    if party_type == "supplier":
        return models.Supplier
    if party_type == "customer":
        return models.Customer
    raise HTTPException(status_code=400, detail="Invalid party type")


def get_party(db: Session, party_type: str, party_id: int):
    party = db.get(_party_model(party_type), party_id)
    if party is None:
        raise HTTPException(
            status_code=404, detail=f"{party_type.capitalize()} not found"
        )
    return party


def post_ledger_entry(
    db: Session,
    *,
    party_type: str,
    party_id: int,
    entry_type: str,
    amount: float,
    direction: str,
    reference: Optional[str] = None,
    reference_id: Optional[int] = None,
    note: Optional[str] = None,
    entry_date: Optional[datetime] = None,
    user_id: Optional[int] = None,
) -> models.LedgerEntry:
    """Post an entry to a party's ledger and update their running balance.

    ``debit`` increases the due balance; ``credit`` decreases it.
    The entry is flushed (not committed) so callers can bundle it in a
    transaction with the underlying operation.
    """
    if party_type not in PARTY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid party type")
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=400, detail="Invalid ledger direction")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    party = get_party(db, party_type, party_id)
    delta = round(amount, 2) if direction == "debit" else round(-amount, 2)
    party.due_balance = round((party.due_balance or 0) + delta, 2)

    supplier_id = party_id if party_type == "supplier" else None
    customer_id = party_id if party_type == "customer" else None

    entry = models.LedgerEntry(
        party_type=party_type,
        party_id=party_id,
        supplier_id=supplier_id,
        customer_id=customer_id,
        entry_type=entry_type,
        direction=direction,
        amount=round(amount, 2),
        reference=reference,
        reference_id=reference_id,
        note=note,
        entry_date=entry_date or datetime.utcnow(),
        created_by=user_id,
    )
    db.add(entry)
    db.flush()
    return entry


def record_payment(
    db: Session,
    *,
    party_type: str,
    party_id: int,
    amount: float,
    method: str,
    reference: Optional[str] = None,
    note: Optional[str] = None,
    payment_date: Optional[datetime] = None,
    purchase_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> models.Payment:
    """Record a payment to/from a party and post a credit ledger entry."""
    get_party(db, party_type, party_id)

    payment = models.Payment(
        party_type=party_type,
        party_id=party_id,
        amount=round(amount, 2),
        method=method,
        reference=reference,
        note=note,
        payment_date=payment_date or datetime.utcnow(),
        purchase_id=purchase_id,
        created_by=user_id,
    )
    db.add(payment)
    db.flush()

    post_ledger_entry(
        db,
        party_type=party_type,
        party_id=party_id,
        entry_type="payment",
        amount=amount,
        direction="credit",
        reference=reference,
        reference_id=payment.id,
        note=f"{party_type.capitalize()} payment ({method})" + (f" — {note}" if note else ""),
        entry_date=payment.payment_date,
        user_id=user_id,
    )
    db.commit()
    db.refresh(payment)
    return payment


def post_credit_note(
    db: Session,
    *,
    party_type: str,
    party_id: int,
    amount: float,
    reference: Optional[str] = None,
    note: Optional[str] = None,
    entry_date: Optional[datetime] = None,
    user_id: Optional[int] = None,
) -> models.LedgerEntry:
    """Issue a credit note to a party (reduces their due balance)."""
    entry = post_ledger_entry(
        db,
        party_type=party_type,
        party_id=party_id,
        entry_type="credit_note",
        amount=amount,
        direction="credit",
        reference=reference,
        note=note,
        entry_date=entry_date,
        user_id=user_id,
    )
    db.commit()
    db.refresh(entry)
    return entry


def get_ledger_entries(
    db: Session,
    party_type: str,
    party_id: int,
    page: int = 1,
    page_size: int = 50,
    entry_type: Optional[str] = None,
):
    get_party(db, party_type, party_id)
    query = (
        db.query(models.LedgerEntry)
        .filter(
            models.LedgerEntry.party_type == party_type,
            models.LedgerEntry.party_id == party_id,
        )
    )
    if entry_type:
        query = query.filter(models.LedgerEntry.entry_type == entry_type)
    total = query.count()
    items = (
        query.order_by(models.LedgerEntry.entry_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total else 0
    return items, total, total_pages


def ledger_totals(db: Session, party_type: str, party_id: int) -> dict:
    """Aggregate a party's ledger by entry type and direction."""
    get_party(db, party_type, party_id)
    rows = (
        db.query(
            models.LedgerEntry.entry_type,
            models.LedgerEntry.direction,
            models.LedgerEntry.amount,
        )
        .filter(
            models.LedgerEntry.party_type == party_type,
            models.LedgerEntry.party_id == party_id,
        )
        .all()
    )
    totals: dict[str, float] = {}
    counts: dict[str, int] = {}
    for entry_type, direction, amount in rows:
        key = entry_type
        totals[key] = round(totals.get(key, 0) + amount, 2)
        counts[key] = counts.get(key, 0) + 1
    return {"totals": totals, "counts": counts}
