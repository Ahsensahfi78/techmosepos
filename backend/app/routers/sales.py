from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services import sales_service
from ..routers.settings import PRINT_KEYS

router = APIRouter(prefix="/sales", tags=["sales"])


def _sale_out(db: Session, s: models.Sale) -> schemas.SaleOut:
    returned = sales_service._get_returned_qty(db, s.id)
    return schemas.SaleOut(
        id=s.id,
        branch_id=s.branch_id,
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
                returned_qty=returned.get(i.product_id, 0) if i.product_id else 0,
                item_type=i.item_type or "STOCK",
                line_discount=i.line_discount or 0.0,
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
        if not item.product:
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


async def _broadcast_return(ret: models.SaleReturn) -> None:
    for item in ret.items:
        if not item.product:
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


def _resolve_user_branch(db: Session, current: models.User) -> int | None:
    """Resolve the branch a user is allowed to access. Returns None for admins."""
    if current.role in ("super_admin", "admin"):
        return None  # admin can see all branches
    if current.branch:
        branch = (
            db.query(models.Branch)
            .filter(models.Branch.code.ilike(current.branch))
            .first()
        )
        return branch.id if branch else None
    return None


def _require_branch_access(db: Session, current: models.User, branch_id: int | None) -> None:
    """Raise 403 if a branch-scoped user tries to access a different branch."""
    if current.role in ("super_admin", "admin"):
        return
    if branch_id is None:
        return  # No branch on the record, allow
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id != branch_id:
        raise HTTPException(
            status_code=403, detail="Access restricted to your own branch"
        )


@router.post("", response_model=schemas.SaleOut, status_code=201)
async def create_sale(
    data: schemas.SaleIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.create")),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    # Branch resolved server-side from the authenticated user — never from payload.
    branch_code = current.branch
        
    # current.branch is a string (e.g. "kalmunai"); resolve to branch id (case-insensitive)
    branch_row = (
        db.query(models.Branch).filter(models.Branch.code.ilike(branch_code)).first()
    ) if branch_code and current.role not in ("super_admin", "admin") else None
    if not branch_row and current.role not in ("super_admin", "admin"):
        raise HTTPException(
            status_code=400,
            detail="No branch assigned to this user. Contact an administrator.",
        )
    sale = sales_service.create_sale(
        db,
        data,
        user_id=current.id,
        branch_id=branch_row.id if branch_row else None,
        idempotency_key=idempotency_key,
    )
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
    current: models.User = Depends(require_permission("sales.view")),
):
    sales = sales_service.list_sales(db, limit=limit, status=status, customer_id=customer_id)
    # Branch-scoped users only see their own branch's sales
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id is not None:
        sales = [s for s in sales if s.branch_id == user_branch_id]
    return [_sale_out(db, s) for s in sales]


@router.get("/returns", response_model=list[schemas.SaleReturnOut])
def list_sale_returns(
    limit: int = Query(default=100, ge=1, le=1000),
    sale_id: int | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.view")),
):
    returns = sales_service.list_sale_returns(
        db, limit=limit, sale_id=sale_id, customer_id=customer_id
    )
    # Branch-scoped users only see returns from their own branch's sales
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id is not None:
        returns = [r for r in returns if r.sale.branch_id == user_branch_id]
    return [_return_out(r) for r in returns]


@router.get("/{sale_id}", response_model=schemas.SaleOut)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.view")),
):
    sale = sales_service.get_sale(db, sale_id)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    _require_branch_access(db, current, sale.branch_id)
    return _sale_out(db, sale)


@router.post("/{sale_id}/payments", response_model=schemas.PaymentOut, status_code=201)
def record_sale_payment(
    sale_id: int,
    data: schemas.SalePaymentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.create")),
):
    sale = sales_service.get_sale(db, sale_id)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    _require_branch_access(db, current, sale.branch_id)
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
    sale = sales_service.get_sale(db, sale_id)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    _require_branch_access(db, current, sale.branch_id)
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


@router.get("/{sale_id}/receipt", response_model=schemas.SaleReceiptOut)
def reprint_receipt(
    sale_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.view")),
):
    """Return all data needed to reprint a sale receipt.

    Branch-scoped users can only reprint receipts from their own branch.
    """
    sale = (
        db.query(models.Sale)
        .filter(models.Sale.id == sale_id)
        .first()
    )
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    _require_branch_access(db, current, sale.branch_id)

    # Load customer + cashier names
    customer = db.get(models.Customer, sale.customer_id) if sale.customer_id else None
    cashier = db.get(models.User, sale.created_by) if sale.created_by else None

    # Load sale items with product codes
    item_rows = (
        db.query(models.SaleItem, models.Product)
        .outerjoin(models.Product, models.SaleItem.product_id == models.Product.id)
        .filter(models.SaleItem.sale_id == sale_id)
        .order_by(models.SaleItem.id)
        .all()
    )
    items = [
        schemas.SaleReceiptItemOut(
            product_id=si.product_id,
            product_name=si.product_name or (p.name if p else f"Product #{si.product_id}"),
            qty=si.qty,
            price=si.price,
            line_total=si.line_total,
            sku=p.sku if p else None,
            barcode=p.barcode if p else None,
        )
        for si, p in item_rows
    ]

    # Print settings
    rows = (
        db.query(models.Setting)
        .filter(models.Setting.key.in_(PRINT_KEYS))
        .all()
    )
    settings = {row.key: (row.value or "") for row in rows}

    change = max(0.0, (sale.paid_amount or 0.0) - (sale.total or 0.0))

    return schemas.SaleReceiptOut(
        id=sale.id,
        reference=f"INV-{sale_id:06d}",
        date=sale.created_at,
        customer_name=customer.name if customer else None,
        customer_phone=customer.phone if customer else None,
        cashier_name=cashier.full_name if cashier else None,
        items=items,
        subtotal=sale.subtotal or 0.0,
        discount_amount=sale.discount_amount or 0.0,
        tax_amount=sale.tax_amount or 0.0,
        total=sale.total or 0.0,
        paid_amount=sale.paid_amount or 0.0,
        due_amount=max(0.0, (sale.total or 0.0) - (sale.paid_amount or 0.0)),
        change_amount=change,
        payment_method=sale.payment_method,
        loyalty_points_used=sale.loyalty_points_used or 0,
        store_name=settings.get("store_name", "My Store"),
        store_address=settings.get("store_address", ""),
        store_phone=settings.get("store_phone", ""),
        store_email=settings.get("store_email", ""),
        store_logo=settings.get("store_logo", ""),
        currency=settings.get("currency", "Rs"),
        receipt_footer=settings.get("receipt_footer", ""),
        receipt_width_mm=settings.get("receipt_width_mm", "80"),
        receipt_rotate_180=settings.get("receipt_rotate_180", "false"),
    )