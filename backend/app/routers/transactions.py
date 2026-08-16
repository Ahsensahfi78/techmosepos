from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import get_role_permissions, require_permission
from ..services import transaction_service

router = APIRouter(prefix="/transactions", tags=["transactions"])

TYPES = ("sale", "purchase", "sale_return", "purchase_return")


def _visible_types(user: models.User) -> list[str]:
    perms = get_role_permissions(user.role)
    types = ["sale", "sale_return"]
    if "purchase.view" in perms:
        types += ["purchase", "purchase_return"]
    return types


@router.get("", response_model=schemas.Paginated[schemas.TransactionRecord])
def list_transactions(
    q: str | None = Query(default=None, max_length=200),
    type: str | None = Query(default=None),
    party_type: str | None = Query(default=None),
    party_id: int | None = Query(default=None),
    product_id: int | None = Query(default=None),
    method: str | None = Query(default=None, max_length=30),
    status: str | None = Query(default=None, max_length=100),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    created_by: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.view")),
):
    if type and type not in TYPES:
        raise HTTPException(status_code=400, detail="Unknown transaction type")
    if party_type and party_type not in ("customer", "supplier", "none"):
        raise HTTPException(status_code=400, detail="Unknown party type")

    items, total, total_pages = transaction_service.search_transactions(
        db,
        q=q,
        type=type,
        party_type=party_type,
        party_id=party_id,
        product_id=product_id,
        method=method,
        status=status,
        date_from=date_from,
        date_to=date_to,
        created_by=created_by,
        page=page,
        page_size=page_size,
        visible_types=_visible_types(current),
    )
    return schemas.Paginated[schemas.TransactionRecord](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/global-search", response_model=schemas.GlobalSearchOut)
def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.view")),
):
    return transaction_service.global_search(db, q, visible_types=_visible_types(current))


@router.get("/products/{product_id}/summary", response_model=schemas.ProductHistorySummaryOut)
def product_history_summary(
    product_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.view")),
):
    try:
        return transaction_service.product_history_summary(db, product_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Product not found")


@router.get("/{type}/{db_id}", response_model=schemas.TransactionDetailOut)
def transaction_detail(
    type: str,
    db_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("sales.view")),
):
    if type not in TYPES:
        raise HTTPException(status_code=400, detail="Unknown transaction type")
    if type in ("purchase", "purchase_return") and type not in _visible_types(current):
        raise HTTPException(status_code=403, detail="Permission required: purchase.view")
    try:
        return transaction_service.get_transaction_detail(db, type, db_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transaction not found")
