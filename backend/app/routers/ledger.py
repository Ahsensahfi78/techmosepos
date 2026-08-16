import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services import ledger_service

router = APIRouter(tags=["ledger"])

supplier_ledger = APIRouter(prefix="/suppliers", tags=["suppliers"])
customer_ledger = APIRouter(prefix="/customers", tags=["customers"])


# ── Supplier ledger ─────────────────────────────────────────────────────
@supplier_ledger.post("/{supplier_id}/payments", response_model=schemas.PaymentOut, status_code=201)
def supplier_payment(
    supplier_id: int,
    data: schemas.PaymentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("supplier.manage")),
):
    payment = ledger_service.record_payment(
        db,
        party_type="supplier",
        party_id=supplier_id,
        amount=data.amount,
        method=data.method,
        reference=data.reference,
        note=data.note,
        payment_date=data.payment_date,
        user_id=current.id,
    )
    AuditLogRepository(db).log(
        action="supplier.payment",
        entity_type="supplier",
        entity_id=supplier_id,
        user_id=current.id,
        details=f"Payment of {data.amount} to supplier #{supplier_id}",
    )
    return payment


@supplier_ledger.post("/{supplier_id}/credit-notes", response_model=schemas.LedgerEntryOut, status_code=201)
def supplier_credit_note(
    supplier_id: int,
    data: schemas.CreditNoteIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("supplier.manage")),
):
    entry = ledger_service.post_credit_note(
        db,
        party_type="supplier",
        party_id=supplier_id,
        amount=data.amount,
        reference=data.reference,
        note=data.note,
        entry_date=data.entry_date,
        user_id=current.id,
    )
    AuditLogRepository(db).log(
        action="supplier.credit_note",
        entity_type="supplier",
        entity_id=supplier_id,
        user_id=current.id,
        details=f"Credit note of {data.amount} for supplier #{supplier_id}",
    )
    return entry


@supplier_ledger.post("/{supplier_id}/opening-balance", response_model=schemas.LedgerEntryOut, status_code=201)
def supplier_opening_balance(
    supplier_id: int,
    data: schemas.CreditNoteIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("supplier.manage")),
):
    entry = ledger_service.post_ledger_entry(
        db,
        party_type="supplier",
        party_id=supplier_id,
        entry_type="opening_balance",
        amount=data.amount,
        direction="debit",
        note=data.note,
        entry_date=data.entry_date,
        user_id=current.id,
    )
    db.commit()
    db.refresh(entry)
    AuditLogRepository(db).log(
        action="supplier.opening_balance",
        entity_type="supplier",
        entity_id=supplier_id,
        user_id=current.id,
        details=f"Opening balance of {data.amount} for supplier #{supplier_id}",
    )
    return entry


@supplier_ledger.get("/{supplier_id}/ledger", response_model=schemas.Paginated[schemas.LedgerEntryOut])
def supplier_ledger_entries(
    supplier_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    entry_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("supplier.view")),
):
    items, total, total_pages = ledger_service.get_ledger_entries(
        db, "supplier", supplier_id, page=page, page_size=page_size, entry_type=entry_type
    )
    return schemas.Paginated[schemas.LedgerEntryOut](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ── Customer ledger & loyalty ───────────────────────────────────────────
@customer_ledger.post("/{customer_id}/payments", response_model=schemas.PaymentOut, status_code=201)
def customer_payment(
    customer_id: int,
    data: schemas.PaymentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("customer.manage")),
):
    payment = ledger_service.record_payment(
        db,
        party_type="customer",
        party_id=customer_id,
        amount=data.amount,
        method=data.method,
        reference=data.reference,
        note=data.note,
        payment_date=data.payment_date,
        user_id=current.id,
    )
    AuditLogRepository(db).log(
        action="customer.payment",
        entity_type="customer",
        entity_id=customer_id,
        user_id=current.id,
        details=f"Payment of {data.amount} from customer #{customer_id}",
    )
    return payment


@customer_ledger.post("/{customer_id}/credit-notes", response_model=schemas.LedgerEntryOut, status_code=201)
def customer_credit_note(
    customer_id: int,
    data: schemas.CreditNoteIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("customer.manage")),
):
    entry = ledger_service.post_credit_note(
        db,
        party_type="customer",
        party_id=customer_id,
        amount=data.amount,
        reference=data.reference,
        note=data.note,
        entry_date=data.entry_date,
        user_id=current.id,
    )
    AuditLogRepository(db).log(
        action="customer.credit_note",
        entity_type="customer",
        entity_id=customer_id,
        user_id=current.id,
        details=f"Credit note of {data.amount} for customer #{customer_id}",
    )
    return entry


@customer_ledger.post("/{customer_id}/loyalty", response_model=schemas.CustomerOut)
def adjust_loyalty(
    customer_id: int,
    data: schemas.LoyaltyUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("customer.manage")),
):
    customer = ledger_service.get_party(db, "customer", customer_id)
    customer.loyalty_points = max(0, (customer.loyalty_points or 0) + data.points_delta)
    db.commit()
    db.refresh(customer)
    AuditLogRepository(db).log(
        action="customer.loyalty",
        entity_type="customer",
        entity_id=customer_id,
        user_id=current.id,
        details=f"Loyalty points {data.points_delta:+d} for customer #{customer_id}",
    )
    return customer


@customer_ledger.post("/{customer_id}/opening-balance", response_model=schemas.LedgerEntryOut, status_code=201)
def customer_opening_balance(
    customer_id: int,
    data: schemas.CreditNoteIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("customer.manage")),
):
    entry = ledger_service.post_ledger_entry(
        db,
        party_type="customer",
        party_id=customer_id,
        entry_type="opening_balance",
        amount=data.amount,
        direction="debit",
        note=data.note,
        entry_date=data.entry_date,
        user_id=current.id,
    )
    db.commit()
    db.refresh(entry)
    AuditLogRepository(db).log(
        action="customer.opening_balance",
        entity_type="customer",
        entity_id=customer_id,
        user_id=current.id,
        details=f"Opening balance of {data.amount} for customer #{customer_id}",
    )
    return entry


@customer_ledger.get("/{customer_id}/ledger", response_model=schemas.Paginated[schemas.LedgerEntryOut])
def customer_ledger_entries(
    customer_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    entry_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("customer.view")),
):
    items, total, total_pages = ledger_service.get_ledger_entries(
        db, "customer", customer_id, page=page, page_size=page_size, entry_type=entry_type
    )
    return schemas.Paginated[schemas.LedgerEntryOut](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


router.include_router(supplier_ledger)
router.include_router(customer_ledger)
