from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _next_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.StockAdjustment)
        .filter(models.StockAdjustment.reference.like(f"ADJ-{today}%"))
        .count()
    )
    return f"ADJ-{today}-{count + 1:03d}"


def _get_product(db: Session, product_id: int) -> models.Product:
    product = db.get(models.Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product #{product_id} not found")
    return product


def _out(a: models.StockAdjustment) -> schemas.StockAdjustmentOut:
    return schemas.StockAdjustmentOut(
        id=a.id,
        reference=a.reference,
        warehouse_id=a.warehouse_id,
        warehouse_name=a.warehouse.name if a.warehouse else None,
        reason=a.reason,
        note=a.note,
        created_by=a.created_by,
        created_by_name=a.user.full_name if a.user else None,
        created_at=a.created_at,
        items=[
            schemas.StockAdjustmentItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                qty_delta=i.qty_delta,
                previous_stock=i.previous_stock,
                new_stock=i.new_stock,
            )
            for i in a.items
        ],
    )


async def _broadcast_adjustment(items) -> None:
    for item in items:
        if item.product is None:
            continue
        await manager.broadcast(
            {
                "type": "stock_update",
                "product": {
                    "id": item.product.id,
                    "name": item.product.name,
                    "price": item.product.price,
                    "stock": item.product.stock,
                    "category": item.product.category,
                },
            }
        )


@router.post("/adjustments", response_model=schemas.StockAdjustmentOut, status_code=201)
async def create_adjustment(
    data: schemas.StockAdjustmentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("inventory.manage")),
):
    adjustment = models.StockAdjustment(
        reference=_next_number(db),
        warehouse_id=data.warehouse_id,
        reason=data.reason or "stock_count",
        note=data.note,
        created_by=current.id,
    )
    db.add(adjustment)
    db.flush()

    for line in data.items:
        product = _get_product(db, line.product_id)
        prev = product.stock or 0
        new = prev + line.qty_delta
        if new < 0:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail=f"Stock would go negative for '{product.name}' (available: {prev})",
            )
        product.stock = new
        db.add(
            models.StockTransaction(
                product_id=product.id,
                change_qty=line.qty_delta,
                previous_stock=prev,
                new_stock=new,
                reason="adjustment",
                reference_id=adjustment.id,
            )
        )
        db.add(
            models.StockAdjustmentItem(
                adjustment_id=adjustment.id,
                product_id=product.id,
                qty_delta=line.qty_delta,
                previous_stock=prev,
                new_stock=new,
            )
        )

    db.commit()
    db.refresh(adjustment)
    AuditLogRepository(db).log(
        action="inventory.adjustment",
        entity_type="inventory",
        entity_id=adjustment.id,
        user_id=current.id,
        details=f"Stock adjustment {adjustment.reference} ({adjustment.reason})",
    )
    await _broadcast_adjustment(adjustment.items)
    return _out(adjustment)


@router.get("/adjustments")
def list_adjustments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("inventory.view")),
):
    query = db.query(models.StockAdjustment)
    total = query.count()
    rows = (
        query.order_by(models.StockAdjustment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.StockAdjustmentOut](
        items=[_out(a) for a in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )
