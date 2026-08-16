from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/warranty", tags=["warranty"])

_UNIT_STATUSES = {
    models.UnitStatus.IN_STOCK.value,
    models.UnitStatus.SOLD.value,
    models.UnitStatus.RETURNED.value,
    models.UnitStatus.SERVICE.value,
}


def _unit_out(db: Session, u: models.ProductUnit) -> schemas.ProductUnitOut:
    sale_id = None
    customer_name = None
    if u.sale_item is not None and u.sale_item.sale is not None:
        sale_id = u.sale_item.sale.id
        if u.sale_item.sale.customer:
            customer_name = u.sale_item.sale.customer.name
    return schemas.ProductUnitOut(
        id=u.id,
        product_id=u.product_id,
        product_name=u.product_name,
        imei=u.imei,
        serial_number=u.serial_number,
        status=u.status,
        sale_item_id=u.sale_item_id,
        sale_id=sale_id,
        customer_name=customer_name,
        warranty_months=u.warranty_months,
        warranty_start=u.warranty_start,
        warranty_expiry=u.warranty_expiry,
        sold_at=u.sold_at,
        created_at=u.created_at,
    )


@router.post("/units", response_model=schemas.ProductUnitOut, status_code=201)
def create_unit(
    data: schemas.ProductUnitIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("warranty.manage")),
):
    product = db.get(models.Product, data.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.imei:
        dup = (
            db.query(models.ProductUnit)
            .filter(models.ProductUnit.imei == data.imei)
            .first()
        )
        if dup:
            raise HTTPException(
                status_code=400, detail=f"IMEI '{data.imei}' is already registered"
            )
    unit = models.ProductUnit(
        product_id=product.id,
        imei=data.imei,
        serial_number=data.serial_number,
        status=models.UnitStatus.IN_STOCK.value,
        warranty_months=data.warranty_months or product.warranty_months,
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)
    AuditLogRepository(db).log(
        action="warranty.unit.create",
        entity_type="product_unit",
        entity_id=unit.id,
        user_id=current.id,
        details=f"Registered unit for '{product.name}' (IMEI {unit.imei or unit.serial_number or unit.id})",
    )
    return _unit_out(db, unit)


@router.get("/units", response_model=schemas.Paginated[schemas.ProductUnitOut])
def list_units(
    product_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    expiring_days: int | None = Query(default=None, ge=1, le=3650),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("warranty.view")),
):
    query = db.query(models.ProductUnit)
    if product_id:
        query = query.filter(models.ProductUnit.product_id == product_id)
    if status:
        query = query.filter(models.ProductUnit.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (models.ProductUnit.imei.ilike(like))
            | (models.ProductUnit.serial_number.ilike(like))
        )
    if expiring_days:
        now = datetime.utcnow()
        horizon = now + timedelta(days=expiring_days)
        query = query.filter(
            models.ProductUnit.warranty_expiry.isnot(None),
            models.ProductUnit.warranty_expiry >= now,
            models.ProductUnit.warranty_expiry <= horizon,
        )
    total = query.count()
    rows = (
        query.order_by(models.ProductUnit.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.ProductUnitOut](
        items=[_unit_out(db, u) for u in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )


@router.get("/units/{unit_id}", response_model=schemas.ProductUnitOut)
def get_unit(
    unit_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("warranty.view")),
):
    unit = db.get(models.ProductUnit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return _unit_out(db, unit)


@router.patch("/units/{unit_id}/status", response_model=schemas.ProductUnitOut)
def update_unit_status(
    unit_id: int,
    data: schemas.ProductUnitStatusIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("warranty.manage")),
):
    unit = db.get(models.ProductUnit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    if data.status not in _UNIT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{data.status}'")
    unit.status = data.status
    db.commit()
    db.refresh(unit)
    AuditLogRepository(db).log(
        action="warranty.unit.status",
        entity_type="product_unit",
        entity_id=unit.id,
        user_id=current.id,
        details=f"Unit #{unit.id} marked {data.status}",
    )
    return _unit_out(db, unit)


@router.get("/expiring", response_model=list[schemas.ProductUnitOut])
def expiring_warranties(
    days: int = Query(default=30, ge=1, le=3650),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("warranty.view")),
):
    now = datetime.utcnow()
    horizon = now + timedelta(days=days)
    rows = (
        db.query(models.ProductUnit)
        .filter(
            models.ProductUnit.status == models.UnitStatus.SOLD.value,
            models.ProductUnit.warranty_expiry.isnot(None),
            models.ProductUnit.warranty_expiry >= now,
            models.ProductUnit.warranty_expiry <= horizon,
        )
        .order_by(models.ProductUnit.warranty_expiry.asc())
        .all()
    )
    return [_unit_out(db, u) for u in rows]
