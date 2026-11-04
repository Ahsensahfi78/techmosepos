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
    cust_name = q.customer_name or (q.customer.name if q.customer else None)
    cust_phone = q.customer_phone or (q.customer.phone if q.customer else None)
    cust_address = q.customer_address or (q.customer.address if q.customer else None)
    cust_type = q.customer_type or (q.customer.customer_type if q.customer and q.customer.customer_type else "Retail")

    return schemas.QuotationOut(
        id=q.id,
        quotation_number=q.quotation_number,
        customer_id=q.customer_id,
        customer_name=cust_name,
        customer_phone=cust_phone,
        customer_address=cust_address,
        customer_type=cust_type,
        status=q.status,
        subtotal=q.subtotal,
        tax_rate=q.tax_rate or 0.0,
        discount_amount=q.discount_amount,
        tax_amount=q.tax_amount,
        total=q.total,
        notes=q.notes,
        terms=q.terms,
        valid_until=q.valid_until,
        converted_sale_id=q.converted_sale_id,
        created_by=q.created_by,
        created_at=q.created_at,
        updated_at=q.updated_at,
        items=[
            schemas.QuotationItemOut(
                id=i.id,
                quotation_id=i.quotation_id,
                product_id=i.product_id,
                product_name=i.resolved_name or i.product_name or "",
                product_type=i.product_type or "Goods",
                description=i.description,
                qty=i.qty,
                unit=i.unit or "pcs",
                price=i.price,
                discount=i.discount,
                tax=i.tax,
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
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("quotation.view")),
):
    items, total, total_pages = quotation_service.list_quotations(
        db, page=page, page_size=page_size, status=status, q=q
    )
    return schemas.Paginated[schemas.QuotationOut](
        items=[_out(qu) for qu in items],
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


@router.put("/{quotation_id}", response_model=schemas.QuotationOut)
def update_quotation(
    quotation_id: int,
    data: schemas.QuotationUpdateIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("quotation.manage")),
):
    quotation = quotation_service.update_quotation(db, quotation_id, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="quotation.update",
        entity_type="quotation",
        entity_id=quotation_id,
        user_id=current.id,
        details=f"Updated quotation #{quotation.quotation_number}",
    )
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
