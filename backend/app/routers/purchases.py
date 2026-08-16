import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services import purchase_service

router = APIRouter(tags=["purchases"])


def _po_out(po: models.PurchaseOrder) -> schemas.PurchaseOrderOut:
    return schemas.PurchaseOrderOut(
        id=po.id,
        po_number=po.po_number,
        supplier_id=po.supplier_id,
        supplier_name=po.supplier.name if po.supplier else "",
        warehouse_id=po.warehouse_id,
        status=po.status,
        order_date=po.order_date,
        expected_date=po.expected_date,
        subtotal=po.subtotal,
        discount_amount=po.discount_amount,
        tax_amount=po.tax_amount,
        total=po.total,
        notes=po.notes,
        created_at=po.created_at,
        items=[
            schemas.PurchaseOrderItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                qty_ordered=i.qty_ordered,
                qty_received=i.qty_received,
                cost_price=i.cost_price,
                line_total=i.line_total,
            )
            for i in po.items
        ],
    )


def _purchase_out(p: models.Purchase) -> schemas.PurchaseOut:
    return schemas.PurchaseOut(
        id=p.id,
        purchase_number=p.purchase_number,
        po_id=p.po_id,
        po_number=p.purchase_order.po_number if p.purchase_order else None,
        supplier_id=p.supplier_id,
        supplier_name=p.supplier.name if p.supplier else "",
        warehouse_id=p.warehouse_id,
        invoice_number=p.invoice_number,
        invoice_date=p.invoice_date,
        purchase_date=p.purchase_date,
        subtotal=p.subtotal,
        discount_amount=p.discount_amount,
        tax_amount=p.tax_amount,
        total=p.total,
        paid_amount=p.paid_amount,
        due_amount=round(p.total - p.paid_amount, 2),
        status=p.status,
        notes=p.notes,
        created_at=p.created_at,
        items=[
            schemas.PurchaseItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                qty=i.qty,
                cost_price=i.cost_price,
                line_total=i.line_total,
            )
            for i in p.items
        ],
    )


def _return_out(r: models.PurchaseReturn) -> schemas.PurchaseReturnOut:
    return schemas.PurchaseReturnOut(
        id=r.id,
        return_number=r.return_number,
        purchase_id=r.purchase_id,
        purchase_number=r.purchase.purchase_number if r.purchase else "",
        supplier_id=r.supplier_id,
        supplier_name=r.supplier.name if r.supplier else "",
        return_date=r.return_date,
        reason=r.reason,
        total=r.total,
        created_at=r.created_at,
        items=[
            schemas.PurchaseReturnItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                qty=i.qty,
                cost_price=i.cost_price,
                line_total=i.line_total,
            )
            for i in r.items
        ],
    )


# ── Purchase orders ──────────────────────────────────────────────────────
@router.post("/purchase-orders", response_model=schemas.PurchaseOrderOut, status_code=201)
def create_purchase_order(
    data: schemas.PurchaseOrderIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("purchase.manage")),
):
    po = purchase_service.create_purchase_order(db, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="purchase_order.create",
        entity_type="purchase_order",
        entity_id=po.id,
        user_id=current.id,
        details=f"Created PO {po.po_number} for supplier #{po.supplier_id}",
    )
    return _po_out(po)


@router.get("/purchase-orders", response_model=schemas.Paginated[schemas.PurchaseOrderOut])
def list_purchase_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("purchase.view")),
):
    items, total, total_pages = purchase_service.list_purchase_orders(
        db, page=page, page_size=page_size, status=status, supplier_id=supplier_id, search=search
    )
    return schemas.Paginated[schemas.PurchaseOrderOut](
        items=[_po_out(po) for po in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/purchase-orders/{po_id}", response_model=schemas.PurchaseOrderOut)
def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("purchase.view")),
):
    return _po_out(purchase_service.get_purchase_order(db, po_id))


@router.post("/purchase-orders/{po_id}/receive", response_model=schemas.PurchaseOut, status_code=201)
def receive_purchase_order(
    po_id: int,
    data: schemas.PurchaseOrderReceiveIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("purchase.manage")),
):
    purchase = purchase_service.receive_purchase_order(db, po_id, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="purchase.receive",
        entity_type="purchase",
        entity_id=purchase.id,
        user_id=current.id,
        details=f"Received purchase {purchase.purchase_number} (from PO #{po_id})",
    )
    return _purchase_out(purchase)


@router.post("/purchase-orders/{po_id}/cancel", response_model=schemas.PurchaseOrderOut)
def cancel_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("purchase.manage")),
):
    po = purchase_service.cancel_purchase_order(db, po_id, user_id=current.id)
    AuditLogRepository(db).log(
        action="purchase_order.cancel",
        entity_type="purchase_order",
        entity_id=po.id,
        user_id=current.id,
        details=f"Cancelled PO {po.po_number}",
    )
    return _po_out(po)


# ── Purchases (received invoices) ────────────────────────────────────────
@router.get("/purchases", response_model=schemas.Paginated[schemas.PurchaseOut])
def list_purchases(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("purchase.view")),
):
    items, total, total_pages = purchase_service.list_purchases(
        db, page=page, page_size=page_size, status=status, supplier_id=supplier_id, search=search
    )
    return schemas.Paginated[schemas.PurchaseOut](
        items=[_purchase_out(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/purchases/{purchase_id}", response_model=schemas.PurchaseOut)
def get_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("purchase.view")),
):
    return _purchase_out(purchase_service.get_purchase(db, purchase_id))


@router.post("/purchases/{purchase_id}/payments", response_model=schemas.PaymentOut, status_code=201)
def record_purchase_payment(
    purchase_id: int,
    data: schemas.PurchasePaymentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("purchase.manage")),
):
    payment = purchase_service.record_purchase_payment(db, purchase_id, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="purchase.payment",
        entity_type="purchase",
        entity_id=purchase_id,
        user_id=current.id,
        details=f"Payment of {data.amount} against purchase #{purchase_id}",
    )
    return payment


@router.post("/purchases/{purchase_id}/returns", response_model=schemas.PurchaseReturnOut, status_code=201)
def create_purchase_return(
    purchase_id: int,
    data: schemas.PurchaseReturnIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("purchase.manage")),
):
    ret = purchase_service.create_purchase_return(db, purchase_id, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="purchase.return",
        entity_type="purchase_return",
        entity_id=ret.id,
        user_id=current.id,
        details=f"Return {ret.return_number} against purchase #{purchase_id}",
    )
    return _return_out(ret)


@router.get("/purchase-returns", response_model=schemas.Paginated[schemas.PurchaseReturnOut])
def list_purchase_returns(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    supplier_id: int | None = Query(default=None),
    purchase_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("purchase.view")),
):
    items, total, total_pages = purchase_service.list_purchase_returns(
        db, page=page, page_size=page_size, supplier_id=supplier_id, purchase_id=purchase_id
    )
    return schemas.Paginated[schemas.PurchaseReturnOut](
        items=[_return_out(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
