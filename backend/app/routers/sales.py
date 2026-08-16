from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services import sales_service

router = APIRouter(prefix="/sales", tags=["sales"])


def _sale_out(db: Session, s: models.Sale) -> schemas.SaleOut:
    returned = sales_service._get_returned_qty(db, s.id)
    return schemas.SaleOut(
        id=s.id,
        customer_id=s.customer_id,
        customer_name=s.customer.name if s.customer else None,
        status=s.status,
        subtotal=s.subtotal,
        discount_amount=s.discount_amount,
        tax_amount=s.tax_amount,
        total=s.total,
        paid_amount=s.paid_amount,
        due_amount=s.due_amount,
        payment_method=s.payment_method,
        loyalty_points_used=s.loyalty_points_used,
        created_by_name=s.user.full_name if s.user else None,
        created_at=s.created_at,
        items=[
            schemas.SaleItemOut(
                product_id=i.product_id,
                product_name=i.product_name,
                qty=i.qty,
                price=i.price,
                line_total=i.line_total,
                imeis=[u.imei for u in i.units if u.imei],
                sku=i.product.sku if i.product else None,
                barcode=i.product.barcode if i.product else None,
                model=i.product.model if i.product else None,
                returned_qty=returned.get(i.product_id, 0),
            )
            for i in s.items
        ],
    )


def _return_out(r: models.SaleReturn) -> schemas.SaleReturnOut:
    return schemas.SaleReturnOut(
        id=r.id,
        return_number=r.return_number,
        sale_id=r.sale_id,
        customer_id=r.customer_id,
        customer_name=r.customer.name if r.customer else None,
        return_date=r.return_date,
        reason=r.reason,
        total=r.total,
        created_at=r.created_at,
        items=[
            schemas.SaleReturnItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                qty=i.qty,
                price=i.price,
                line_total=i.line_total,
                sku=i.product.sku if i.product else None,
                barcode=i.product.barcode if i.product else None,
            )
            for i in r.items
        ],
    )


async def _broadcast_sale(sale: models.Sale) -> None:
    for item in sale.items:
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


async def _broadcast_return(ret: models.SaleReturn) -> None:
    for item in ret.items:
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


@router.post("", response_model=schemas.SaleOut, status_code=201)
async def create_sale(
    data: schemas.SaleIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.create")),
):
    sale = sales_service.create_sale(db, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="sale.create",
        entity_type="sale",
        entity_id=sale.id,
        user_id=current.id,
        details=f"Sale #{sale.id} total {sale.total}",
    )
    await _broadcast_sale(sale)
    return _sale_out(db, sale)


@router.get("", response_model=list[schemas.SaleOut])
def list_sales(
    limit: int = Query(default=100, ge=1, le=1000),
    status: str | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("sales.view")),
):
    sales = sales_service.list_sales(db, limit=limit, status=status, customer_id=customer_id)
    return [_sale_out(db, s) for s in sales]


@router.get("/returns", response_model=list[schemas.SaleReturnOut])
def list_sale_returns(
    limit: int = Query(default=100, ge=1, le=1000),
    sale_id: int | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("sales.view")),
):
    returns = sales_service.list_sale_returns(
        db, limit=limit, sale_id=sale_id, customer_id=customer_id
    )
    return [_return_out(r) for r in returns]


@router.get("/{sale_id}", response_model=schemas.SaleOut)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("sales.view")),
):
    return _sale_out(db, sales_service.get_sale(db, sale_id))


@router.post("/{sale_id}/payments", response_model=schemas.PaymentOut, status_code=201)
def record_sale_payment(
    sale_id: int,
    data: schemas.SalePaymentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.create")),
):
    payment = sales_service.record_sale_payment(db, sale_id, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="sale.payment",
        entity_type="sale",
        entity_id=sale_id,
        user_id=current.id,
        details=f"Payment of {data.amount} against sale #{sale_id}",
    )
    return payment


@router.post("/{sale_id}/returns", response_model=schemas.SaleReturnOut, status_code=201)
async def create_sale_return(
    sale_id: int,
    data: schemas.SaleReturnIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.return")),
):
    ret = sales_service.create_sale_return(db, sale_id, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="sale.return",
        entity_type="sale_return",
        entity_id=ret.id,
        user_id=current.id,
        details=f"Return {ret.return_number} on sale #{sale_id} total {ret.total}",
    )
    await _broadcast_return(ret)
    return _return_out(ret)
