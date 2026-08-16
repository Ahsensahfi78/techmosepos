from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services import quotation_service

router = APIRouter(prefix="/quotations", tags=["quotations"])


def _out(q: models.Quotation) -> schemas.QuotationOut:
    return schemas.QuotationOut(
        id=q.id,
        quotation_number=q.quotation_number,
        customer_id=q.customer_id,
        customer_name=q.customer.name if q.customer else None,
        status=q.status,
        subtotal=q.subtotal,
        discount_amount=q.discount_amount,
        tax_amount=q.tax_amount,
        total=q.total,
        notes=q.notes,
        valid_until=q.valid_until,
        converted_sale_id=q.converted_sale_id,
        created_by=q.created_by,
        created_at=q.created_at,
        updated_at=q.updated_at,
        items=[
            schemas.QuotationItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product_name,
                qty=i.qty,
                price=i.price,
                line_total=i.line_total,
            )
            for i in q.items
        ],
    )


@router.post("", response_model=schemas.QuotationOut, status_code=201)
def create_quotation(
    data: schemas.QuotationIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("quotation.manage")),
):
    quotation = quotation_service.create_quotation(db, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="quotation.create",
        entity_type="quotation",
        entity_id=quotation.id,
        user_id=current.id,
        details=f"Quotation {quotation.quotation_number} for {quotation.total}",
    )
    return _out(quotation)


@router.get("")
def list_quotations(
    status: str | None = Query(default=None, pattern="^(draft|sent|converted|cancelled)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("quotation.view")),
):
    items, total, total_pages = quotation_service.list_quotations(
        db, page=page, page_size=page_size, status=status
    )
    return schemas.Paginated[schemas.QuotationOut](
        items=[_out(q) for q in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{quotation_id}", response_model=schemas.QuotationOut)
def get_quotation(
    quotation_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("quotation.view")),
):
    quotation = quotation_service._get_quotation(db, quotation_id)
    return _out(quotation)


@router.patch("/{quotation_id}/status", response_model=schemas.QuotationOut)
def update_quotation_status(
    quotation_id: int,
    data: schemas.QuotationStatusIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("quotation.manage")),
):
    quotation = quotation_service._get_quotation(db, quotation_id)
    if quotation.status == models.QuotationStatus.CONVERTED.value:
        raise HTTPException(status_code=400, detail="Converted quotations cannot change status")
    quotation.status = data.status
    db.commit()
    db.refresh(quotation)
    AuditLogRepository(db).log(
        action="quotation.status",
        entity_type="quotation",
        entity_id=quotation_id,
        user_id=current.id,
        details=f"Quotation #{quotation_id} marked {data.status}",
    )
    return _out(quotation)


@router.post("/{quotation_id}/convert", response_model=schemas.SaleOut, status_code=201)
async def convert_quotation(
    quotation_id: int,
    data: schemas.QuotationConvertIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("quotation.manage")),
):
    sale = quotation_service.convert_quotation(
        db,
        quotation_id,
        payment_method=data.payment_method,
        paid=data.paid,
        user_id=current.id,
    )
    for item in sale.items:
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
    AuditLogRepository(db).log(
        action="quotation.convert",
        entity_type="quotation",
        entity_id=quotation_id,
        user_id=current.id,
        details=f"Quotation #{quotation_id} converted to sale #{sale.id}",
    )
    from .sales import _sale_out

    return _sale_out(sale)


@router.delete("/{quotation_id}", response_model=schemas.QuotationOut)
def delete_quotation(
    quotation_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("quotation.manage")),
):
    quotation = quotation_service._get_quotation(db, quotation_id)
    if quotation.status == models.QuotationStatus.CONVERTED.value:
        raise HTTPException(status_code=400, detail="Converted quotations cannot be deleted")
    out = _out(quotation)
    db.delete(quotation)
    db.commit()
    AuditLogRepository(db).log(
        action="quotation.delete",
        entity_type="quotation",
        entity_id=quotation_id,
        user_id=current.id,
        details=f"Deleted quotation #{quotation_id}",
    )
    return out
