from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/repairs", tags=["repairs"])

_VALID_STATUSES = {s.value for s in models.RepairStatus}

_TRANSITIONS = {
    "received": {"diagnosing", "repairing", "cancelled"},
    "diagnosing": {"repairing", "received", "cancelled"},
    "repairing": {"ready", "received", "cancelled"},
    "ready": {"delivered", "repairing"},
    "delivered": set(),
    "cancelled": set(),
}


def _out(r: models.Repair) -> schemas.RepairOut:
    total = round(float(r.service_charge or 0) + float(r.parts_cost or 0), 2)
    return schemas.RepairOut(
        id=r.id,
        repair_number=r.repair_number,
        customer_id=r.customer_id,
        customer_name=r.customer_name,
        product_name=r.product_name,
        imei=r.imei,
        issue=r.issue,
        status=r.status,
        service_charge=r.service_charge,
        parts_cost=r.parts_cost,
        deposit=r.deposit,
        paid_amount=r.paid_amount,
        total=total,
        technician=r.technician,
        notes=r.notes,
        received_by=r.received_by,
        received_by_name=r.user.full_name if r.user else None,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _next_repair_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.Repair)
        .filter(models.Repair.repair_number.like(f"RPR-{today}%"))
        .count()
    )
    return f"RPR-{today}-{count + 1:03d}"


@router.post("", response_model=schemas.RepairOut, status_code=201)
def create_repair(
    data: schemas.RepairIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("repair.manage")),
):
    if data.customer_id is not None and db.get(models.Customer, data.customer_id) is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    status = data.status or models.RepairStatus.RECEIVED.value
    if status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'")
    repair = models.Repair(
        repair_number=_next_repair_number(db),
        customer_id=data.customer_id,
        product_name=data.product_name,
        imei=data.imei,
        issue=data.issue,
        status=status,
        service_charge=data.service_charge,
        parts_cost=data.parts_cost,
        deposit=data.deposit,
        paid_amount=data.paid_amount,
        technician=data.technician,
        notes=data.notes,
        received_by=current.id,
    )
    db.add(repair)
    db.commit()
    db.refresh(repair)
    AuditLogRepository(db).log(
        action="repair.create",
        entity_type="repair",
        entity_id=repair.id,
        user_id=current.id,
        details=f"{repair.repair_number}: {repair.product_name}",
    )
    return _out(repair)


@router.get("", response_model=schemas.Paginated[schemas.RepairOut])
def list_repairs(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("repair.view")),
):
    query = db.query(models.Repair)
    if status:
        query = query.filter(models.Repair.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (models.Repair.repair_number.ilike(like))
            | (models.Repair.product_name.ilike(like))
            | (models.Repair.imei.ilike(like))
        )
    total = query.count()
    rows = (
        query.order_by(models.Repair.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.RepairOut](
        items=[_out(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )


@router.get("/{repair_id}", response_model=schemas.RepairOut)
def get_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("repair.view")),
):
    repair = db.get(models.Repair, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair not found")
    return _out(repair)


@router.patch("/{repair_id}", response_model=schemas.RepairOut)
def update_repair(
    repair_id: int,
    data: schemas.RepairUpdateIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("repair.manage")),
):
    repair = db.get(models.Repair, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair not found")
    if data.customer_id is not None:
        if db.get(models.Customer, data.customer_id) is None:
            raise HTTPException(status_code=404, detail="Customer not found")
        repair.customer_id = data.customer_id
    updates = {
        "product_name": data.product_name,
        "imei": data.imei,
        "issue": data.issue,
        "service_charge": data.service_charge,
        "parts_cost": data.parts_cost,
        "deposit": data.deposit,
        "paid_amount": data.paid_amount,
        "technician": data.technician,
        "notes": data.notes,
    }
    for field, value in updates.items():
        if value is not None:
            setattr(repair, field, value)
    db.commit()
    db.refresh(repair)
    AuditLogRepository(db).log(
        action="repair.update",
        entity_type="repair",
        entity_id=repair.id,
        user_id=current.id,
        details=f"Updated {repair.repair_number}",
    )
    return _out(repair)


@router.patch("/{repair_id}/status", response_model=schemas.RepairOut)
def update_repair_status(
    repair_id: int,
    data: schemas.RepairStatusIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("repair.manage")),
):
    repair = db.get(models.Repair, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair not found")
    if data.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{data.status}'")
    allowed = _TRANSITIONS.get(repair.status, set())
    if data.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move repair from '{repair.status}' to '{data.status}'",
        )
    repair.status = data.status
    db.commit()
    db.refresh(repair)
    AuditLogRepository(db).log(
        action="repair.status",
        entity_type="repair",
        entity_id=repair.id,
        user_id=current.id,
        details=f"{repair.repair_number} marked {data.status}",
    )
    return _out(repair)


@router.post("/{repair_id}/payment", response_model=schemas.RepairOut)
def record_repair_payment(
    repair_id: int,
    data: schemas.RepairPaymentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("repair.manage")),
):
    repair = db.get(models.Repair, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair not found")
    total = round(float(repair.service_charge or 0) + float(repair.parts_cost or 0), 2)
    due = round(total - float(repair.paid_amount or 0), 2)
    if data.amount > due + 0.001:
        raise HTTPException(
            status_code=400,
            detail=f"Amount exceeds outstanding balance of {due}",
        )
    repair.paid_amount = round(float(repair.paid_amount or 0) + data.amount, 2)
    db.commit()
    db.refresh(repair)
    AuditLogRepository(db).log(
        action="repair.payment",
        entity_type="repair",
        entity_id=repair.id,
        user_id=current.id,
        details=f"Payment of {data.amount} on {repair.repair_number}",
    )
    return _out(repair)


@router.delete("/{repair_id}", response_model=schemas.RepairOut)
def delete_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("repair.manage")),
):
    repair = db.get(models.Repair, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair not found")
    db.delete(repair)
    db.commit()
    AuditLogRepository(db).log(
        action="repair.delete",
        entity_type="repair",
        entity_id=repair_id,
        user_id=current.id,
        details=f"Deleted repair #{repair_id}",
    )
    return _out(repair)
