from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..services import ledger_service

router = APIRouter(prefix="/reports", tags=["reports"])

LOW_STOCK_THRESHOLD = 5


def _resolve_user_branch(db: Session, current: models.User) -> int | None:
    """Resolve the branch a user is allowed to access. Returns None for admins."""
    if current.role in ("super_admin", "admin"):
        return None  # admin can see all branches
    if current.branch:
        branch = db.query(models.Branch).filter(models.Branch.code.ilike(current.branch)).first()
        return branch.id if branch else None
    return None


def _summary(product: models.Product, branch_stocks_qty: int, status: str) -> schemas.StockSummary:
    return schemas.StockSummary(
        id=product.id,
        name=product.name,
        category=product.category,
        price=product.price,
        stock=branch_stocks_qty,
        status=status,
    )


@router.get("/reorder", response_model=list[schemas.ReorderItemOut])
def reorder_report(
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("report.view")),
):
    user_branch_id = _resolve_user_branch(db, current)

    query = db.query(models.Product).filter(models.Product.is_active.is_(True))
    if user_branch_id is not None:
        # Only show products that have stock in this branch
        branch_stock_subq = (
            db.query(models.BranchStock.product_id)
            .filter(models.BranchStock.branch_id == user_branch_id)
            .subquery()
        )
        query = query.filter(models.Product.id.in_(branch_stock_subq))

    rows = query.order_by(models.Product.stock.asc()).all()
    out: list[schemas.ReorderItemOut] = []
    for p in rows:
        bs = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id == p.id,
                models.BranchStock.branch_id == user_branch_id,
            )
            .first()
        ) if user_branch_id is not None else None
        stock = bs.quantity if bs else (p.stock or 0)
        threshold = max(int(p.min_stock or 0), LOW_STOCK_THRESHOLD)
        if stock > threshold:
            continue
        suggested_qty = max(threshold * 2, threshold + 10) - stock
        out.append(
            schemas.ReorderItemOut(
                product_id=p.id,
                name=p.name,
                stock=stock,
                min_stock=p.min_stock or 0,
                threshold=threshold,
                suggested_qty=max(suggested_qty, 0),
            )
        )
    return out


@router.get("/stock", response_model=schemas.ReportOut)
def stock_report(
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("report.view")),
):
    user_branch_id = _resolve_user_branch(db, current)

    query = db.query(models.Product)
    if user_branch_id is not None:
        branch_stock_subq = (
            db.query(models.BranchStock.product_id)
            .filter(models.BranchStock.branch_id == user_branch_id)
            .subquery()
        )
        query = query.filter(models.Product.id.in_(branch_stock_subq))

    products = query.all()

    low_stock = []
    out_of_stock = []
    total_units = 0
    total_value = 0.0

    for p in products:
        bs = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id == p.id,
                models.BranchStock.branch_id == user_branch_id,
            )
            .first()
        ) if user_branch_id is not None else None
        stock = bs.quantity if bs else (p.stock or 0)
        total_units += stock
        total_value += round(p.price * stock, 2)

        if 0 < stock <= max(int(p.min_stock or 0), LOW_STOCK_THRESHOLD):
            low_stock.append(_summary(p, stock, "low"))
        elif stock == 0:
            out_of_stock.append(_summary(p, stock, "out"))

    return schemas.ReportOut(
        total_products=len(products),
        total_units=total_units,
        total_value=round(total_value, 2),
        low_stock=low_stock,
        out_of_stock=out_of_stock,
    )


@router.get("/sales")
def sales_report(
    days: int | None = Query(default=None, ge=1, le=365),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("report.view")),
):
    user_branch_id = _resolve_user_branch(db, current)

    sale_query = db.query(models.Sale)
    if user_branch_id is not None:
        sale_query = sale_query.filter(models.Sale.branch_id == user_branch_id)
    if days is not None:
        since = datetime.utcnow() - timedelta(days=days)
        sale_query = sale_query.filter(models.Sale.created_at >= since)

    total_sales = sale_query.count()
    total_revenue = (
        sale_query.with_entities(func.coalesce(func.sum(models.Sale.total), 0))
        .scalar()
    )

    top = (
        db.query(
            models.Product.name,
            func.sum(models.SaleItem.qty).label("total_qty"),
        )
        .join(models.SaleItem, models.SaleItem.product_id == models.Product.id)
        .join(models.Sale, models.Sale.id == models.SaleItem.sale_id)
    )
    if user_branch_id is not None:
        top = top.filter(models.Sale.branch_id == user_branch_id)
    if days is not None:
        top = top.filter(models.Sale.created_at >= since)
    top = top.group_by(models.Product.name).order_by(func.sum(models.SaleItem.qty).desc()).limit(10).all()

    return {
        "total_sales": total_sales,
        "total_revenue": round(total_revenue, 2),
        "top_products": [
            {"product_name": name, "total_qty": qty}
            for name, qty in top
        ],
    }


@router.get("/branches", response_model=list[schemas.BranchOut])
def branches_report(
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("report.view")),
):
    user_branch_id = _resolve_user_branch(db, current)
    query = db.query(models.Branch).filter(models.Branch.is_active.is_(True))
    if user_branch_id is not None:
        query = query.filter(models.Branch.id == user_branch_id)
    return query.all()
