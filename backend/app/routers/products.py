from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[schemas.ProductOut])
def list_products(
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.view")),
):
    return crud.get_products(db, search=search, category=category)


@router.post("", response_model=schemas.ProductOut)
async def create_product(
    data: schemas.ProductCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.manage")),
):
    product = crud.create_product(db, data)
    await manager.broadcast(
        {"type": "stock_update", "product": crud.product_to_dict(product)}
    )
    return product


@router.get("/{product_id}", response_model=schemas.ProductOut)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.view")),
):
    return crud.get_product(db, product_id)


@router.patch("/{product_id}", response_model=schemas.ProductOut)
async def update_product(
    product_id: int,
    data: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.manage")),
):
    product = crud.update_product(db, product_id, data)
    await manager.broadcast(
        {"type": "stock_update", "product": crud.product_to_dict(product)}
    )
    return product


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.manage")),
):
    crud.delete_product(db, product_id)
    await manager.broadcast({"type": "product_removed", "id": product_id})
    return Response(status_code=204)
