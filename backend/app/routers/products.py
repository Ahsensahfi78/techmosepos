from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission
from ..services import product_code_service

router = APIRouter(prefix="/products", tags=["products"])


def _resolve_user_branch(db: Session, current: models.User) -> int | None:
    """Resolve the branch a user is allowed to access. Returns None for admins."""
    if current.role in ("super_admin", "admin"):
        return None  # admin can access all branches
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


class BulkDeleteInput(BaseModel):
    product_ids: list[int]


@router.get("", response_model=list[schemas.ProductOut])
def list_products(
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    branch_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("product.view")),
):
    # Resolve branch: explicit param > current user's branch
    target_branch_id = branch_id
    if target_branch_id is None and current.branch:
        branch_row = (
            db.query(models.Branch).filter(models.Branch.code.ilike(current.branch)).first()
        )
        if branch_row:
            target_branch_id = branch_row.id

    # Get all products first
    products = crud.get_products(db, search=search, category=category)

    # Filter by branch stock availability
    if target_branch_id is not None:
        # Get product_ids that have stock in this branch (quantity > 0)
        bs_rows = (
            db.query(models.BranchStock.product_id)
            .filter(models.BranchStock.branch_id == target_branch_id)
            .filter(models.BranchStock.quantity > 0)
            .all()
        )
        branch_product_ids = {r[0] for r in bs_rows}
        products = [p for p in products if p.id in branch_product_ids]
        # Override global stock with branch-specific stock
        branch_stock_map = {
            r.product_id: r.quantity
            for r in db.query(models.BranchStock.product_id, models.BranchStock.quantity)
            .filter(models.BranchStock.branch_id == target_branch_id)
            .filter(models.BranchStock.quantity > 0)
            .all()
        }
        result = []
        for p in products:
            p.stock = branch_stock_map.get(p.id, 0)
            result.append(p)
        return result

    return products


@router.post("", response_model=schemas.ProductOut, status_code=201)
async def create_product(
    data: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("product.create")),
):
    # Branch-scoped users can only create products for their own branch.
    # Admins can create products for any branch or without specifying one.
    target_branch_id = data.branch_id
    if current.role not in ("super_admin", "admin"):
        if current.branch:
            branch_row = (
                db.query(models.Branch).filter(models.Branch.code.ilike(current.branch)).first()
            )
            if branch_row:
                user_branch_id = branch_row.id
                if data.branch_id is not None and data.branch_id != user_branch_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Cannot create products for another branch",
                    )
                target_branch_id = user_branch_id
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No branch found for your user account",
                )
        else:
            raise HTTPException(
                status_code=400,
                detail="No branch assigned to your user account",
            )

    product = crud.create_product(db, data, target_branch_id)
    await manager.broadcast(
        {"type": "stock_update", "product": crud.product_to_dict(product)}
    )
    return product


@router.get("/next-code", response_model=schemas.ProductCodeOut)
def next_product_code(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("product.manage")),
):
    return {"code": product_code_service.next_product_code(db)}


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
    current: models.User = Depends(require_permission("product.create")),
):
    product = crud.get_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    # Branch-scoped users can only edit products stocked in their own branch
    # (quantity must be > 0 — a product with zero stock in your branch is not
    # yours to edit).
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id is not None:
        bs = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id == product_id,
                models.BranchStock.branch_id == user_branch_id,
                models.BranchStock.quantity > 0,
            )
            .first()
        )
        if bs is None:
            raise HTTPException(
                status_code=403,
                detail="You can only edit products stocked in your own branch",
            )

    # Stock exists only at (product × branch).  When stock is edited, sync the
    # branch_stocks row so products.stock (derived aggregate via trigger) stays
    # consistent.  Branch-scoped users can only adjust stock for products that
    # already exist in their branch with quantity > 0.
    payload = data.model_dump(exclude_unset=True)
    if "stock" in payload and user_branch_id is not None:
        bs = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id == product_id,
                models.BranchStock.branch_id == user_branch_id,
                models.BranchStock.quantity > 0,
            )
            .first()
        )
        if bs is None:
            raise HTTPException(
                status_code=403,
                detail="You can only adjust stock for products in your own branch",
            )
        bs.quantity = int(payload["stock"] or 0)
        bs.updated_at = datetime.utcnow()
        db.add(bs)
        db.commit()

    product = crud.update_product(db, product_id, data)
    await manager.broadcast(
        {"type": "stock_update", "product": crud.product_to_dict(product)}
    )
    return product


@router.post("/bulk-delete", status_code=200)
async def bulk_delete_products(
    data: BulkDeleteInput,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("product.create")),
):
    # Branch-scoped users can only bulk-delete products in their own branch
    user_branch_id = _resolve_user_branch(db, current)
    deleted = 0
    for pid in data.product_ids:
        product = db.get(models.Product, pid)
        if product is None:
            continue
        # Branch-scoped users can only delete products in their own branch
        if user_branch_id is not None:
            bs = (
                db.query(models.BranchStock)
                .filter(
                    models.BranchStock.product_id == pid,
                    models.BranchStock.branch_id == user_branch_id,
                )
                .first()
            )
            if bs is None or bs.quantity > 0:
                continue
        db.delete(product)
        deleted += 1
    db.commit()
    for pid in data.product_ids:
        await manager.broadcast({"type": "product_removed", "id": pid})
    return {"deleted": deleted}


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("product.create")),
):
    product = crud.get_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    # Branch-scoped users can only delete products stocked in their own branch
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id is not None:
        bs = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id == product_id,
                models.BranchStock.branch_id == user_branch_id,
            )
            .first()
        )
        if bs is None:
            raise HTTPException(
                status_code=403,
                detail="You can only delete products stocked in your own branch",
            )
        # Only allow deletion if no stock remains in the branch
        if bs.quantity > 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete product with remaining stock",
            )

    crud.delete_product(db, product_id)
    await manager.broadcast({"type": "product_removed", "id": product_id})
    return Response(status_code=204)
