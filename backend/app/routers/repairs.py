from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/repairs", tags=["repairs"])

_STATUS_MAP = {
    "in_progress": "repairing",
    "completed": "ready",
}

_REVERSE_STATUS_MAP = {
    "repairing": "in_progress",
    "ready": "completed",
}

_ALL_VALID_STATUSES = {
    "received",
    "diagnosing",
    "repairing",
    "in_progress",
    "ready",
    "completed",
    "delivered",
    "cancelled",
}


def _normalize_status(s: str | None) -> str:
    if not s:
        return models.RepairStatus.RECEIVED.value
    raw = s.lower().strip()
    return _STATUS_MAP.get(raw, raw)


def _out(r: models.Repair) -> schemas.RepairOut:
    items_total = sum(float(i.line_total or 0) for i in r.items) if r.items else 0.0
    calc_total = items_total if items_total > 0 else (float(r.service_charge or 0) + float(r.parts_cost or 0))
    total = round(calc_total, 2)

    cust_name = r.customer_name or (r.customer.name if r.customer else None)
    cust_phone = r.customer_phone or (r.customer.phone if r.customer else None)
    cust_address = r.customer_address or (r.customer.address if r.customer else None)
    cust_type = r.customer_type or (r.customer.customer_type if r.customer and r.customer.customer_type else "Retail")

    return schemas.RepairOut(
        id=r.id,
        repair_number=r.repair_number,
        customer_id=r.customer_id,
        customer_name=cust_name,
        customer_phone=cust_phone,
        customer_address=cust_address,
        customer_type=cust_type,
        product_name=r.product_name,
        imei=r.imei,
        issue=r.issue,
        status=r.status,
        estimated_cost=round(float(r.estimated_cost or 0), 2),
        service_charge=round(float(r.service_charge or 0), 2),
        parts_cost=round(float(r.parts_cost or 0), 2),
        deposit=round(float(r.deposit or 0), 2),
        paid_amount=round(float(r.paid_amount or 0), 2),
        total=total,
        technician=r.technician,
        notes=r.notes,
        terms=r.terms,
        received_by=r.received_by,
        received_by_name=r.user.full_name if r.user else None,
        created_at=r.created_at,
        updated_at=r.updated_at,
        items=[
            schemas.RepairItemOut(
                id=i.id,
                repair_id=i.repair_id,
                product_id=i.product_id,
                product_name=i.resolved_name or i.product_name or "",
                product_type=i.product_type or "Service",
                description=i.description,
                qty=i.qty,
                unit=i.unit or "pcs",
                price=i.price,
                discount=i.discount,
                tax=i.tax,
                line_total=i.line_total,
            )
            for i in r.items
        ],
    )


def _next_repair_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.Repair)
        .filter(models.Repair.repair_number.like(f"RPR-{today}%"))
        .count()
    )
    return f"RPR-{today}-{count + 1:03d}"


def _build_repair_items(db: Session, lines: list[schemas.RepairItemIn]):
    items = []
    parts_cost = 0.0
    service_charge = 0.0
    for line in lines:
        product = db.get(models.Product, line.product_id) if line.product_id else None
        p_name = line.product_name or (product.name if product else "Repair Item")
        p_type = line.product_type or (product.product_type if product and product.product_type else "Service")
        p_unit = line.unit or (product.unit if product and product.unit else "pcs")
        qty = float(line.qty)
        price = round(float(line.price), 2)
        disc = round(float(line.discount or 0), 2)
        tax = round(float(line.tax or 0), 2)
        line_tot = round(float(line.line_total), 2) if line.line_total is not None else round(qty * price - disc + tax, 2)

        if p_type.lower() == "service":
            service_charge += line_tot
        else:
            parts_cost += line_tot

        items.append(
            models.RepairItem(
                product_id=product.id if product else None,
                product_name=p_name,
                product_type=p_type,
                description=line.description,
                qty=qty,
                unit=p_unit,
                price=price,
                discount=disc,
                tax=tax,
                line_total=line_tot,
            )
        )
    return items, round(parts_cost, 2), round(service_charge, 2)


@router.post("", response_model=schemas.RepairOut, status_code=201)
def create_repair(
    data: schemas.RepairIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("repair.manage")),
):
    cust_name = data.customer_name
    cust_phone = data.customer_phone
    cust_address = data.customer_address
    cust_type = data.customer_type or "Retail"

    if data.customer_id is not None:
        cust = db.get(models.Customer, data.customer_id)
        if cust:
            cust_name = cust_name or cust.name
            cust_phone = cust_phone or cust.phone
            cust_address = cust_address or cust.address
            cust_type = data.customer_type or cust.customer_type or "Retail"

    raw_status = _normalize_status(data.status)
    if raw_status not in _ALL_VALID_STATUSES and raw_status not in {s.value for s in models.RepairStatus}:
        raw_status = models.RepairStatus.RECEIVED.value

    repair_items, calc_parts, calc_service = _build_repair_items(db, data.items or [])
    parts_cost = data.parts_cost if data.parts_cost > 0 else calc_parts
    service_charge = data.service_charge if data.service_charge > 0 else calc_service

    repair = models.Repair(
        repair_number=_next_repair_number(db),
        customer_id=data.customer_id,
        customer_name=cust_name,
        customer_phone=cust_phone,
        customer_address=cust_address,
        customer_type=cust_type,
        product_name=data.product_name,
        imei=data.imei,
        issue=data.issue,
        status=raw_status,
        estimated_cost=round(float(data.estimated_cost or 0), 2),
        service_charge=round(float(service_charge or 0), 2),
        parts_cost=round(float(parts_cost or 0), 2),
        deposit=round(float(data.deposit or 0), 2),
        paid_amount=round(float(data.paid_amount or 0), 2),
        technician=data.technician,
        notes=data.notes,
        terms=data.terms,
        received_by=current.id,
        items=repair_items,
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
    if status and status != "all":
        norm = _normalize_status(status)
        query = query.filter((models.Repair.status == norm) | (models.Repair.status == status))
    if q:
        like = f"%{q}%"
        query = query.filter(
            (models.Repair.repair_number.ilike(like))
            | (models.Repair.product_name.ilike(like))
            | (models.Repair.imei.ilike(like))
            | (models.Repair.customer_name.ilike(like))
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
@router.put("/{repair_id}", response_model=schemas.RepairOut)
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
        cust = db.get(models.Customer, data.customer_id)
        if cust:
            repair.customer_id = data.customer_id
            if not data.customer_name:
                repair.customer_name = cust.name
            if not data.customer_phone:
                repair.customer_phone = cust.phone
            if not data.customer_address:
                repair.customer_address = cust.address
            if not data.customer_type:
                repair.customer_type = cust.customer_type or "Retail"

    if data.customer_name is not None:
        repair.customer_name = data.customer_name
    if data.customer_phone is not None:
        repair.customer_phone = data.customer_phone
    if data.customer_address is not None:
        repair.customer_address = data.customer_address
    if data.customer_type is not None:
        repair.customer_type = data.customer_type

    if data.product_name is not None:
        repair.product_name = data.product_name
    if data.imei is not None:
        repair.imei = data.imei
    if data.issue is not None:
        repair.issue = data.issue
    if data.status is not None:
        repair.status = _normalize_status(data.status)
    if data.estimated_cost is not None:
        repair.estimated_cost = round(float(data.estimated_cost), 2)
    if data.service_charge is not None:
        repair.service_charge = round(float(data.service_charge), 2)
    if data.parts_cost is not None:
        repair.parts_cost = round(float(data.parts_cost), 2)
    if data.deposit is not None:
        repair.deposit = round(float(data.deposit), 2)
    if data.paid_amount is not None:
        repair.paid_amount = round(float(data.paid_amount), 2)
    if data.technician is not None:
        repair.technician = data.technician
    if data.notes is not None:
        repair.notes = data.notes
    if data.terms is not None:
        repair.terms = data.terms

    if data.items is not None:
        repair.items.clear()
        repair_items, calc_parts, calc_service = _build_repair_items(db, data.items)
        repair.items.extend(repair_items)
        if data.parts_cost is None and calc_parts > 0:
            repair.parts_cost = calc_parts
        if data.service_charge is None and calc_service > 0:
            repair.service_charge = calc_service

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

    new_status = _normalize_status(data.status)
    repair.status = new_status
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
    items_total = sum(float(i.line_total or 0) for i in repair.items) if repair.items else 0.0
    calc_total = items_total if items_total > 0 else (float(repair.service_charge or 0) + float(repair.parts_cost or 0))
    total = round(calc_total, 2)
    due = round(total - float(repair.paid_amount or 0), 2)
    if data.amount > due + 0.01:
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
    out = _out(repair)
    db.delete(repair)
    db.commit()
    AuditLogRepository(db).log(
        action="repair.delete",
        entity_type="repair",
        entity_id=repair_id,
        user_id=current.id,
        details=f"Deleted repair #{repair_id}",
    )
    return out
