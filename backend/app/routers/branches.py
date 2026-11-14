from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("", response_model=list[schemas.BranchOut])
def list_branches(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.view")),
):
    q = db.query(models.Branch)
    if active_only:
        q = q.filter(models.Branch.is_active == True)
    return q.order_by(models.Branch.name).all()


@router.get("/{branch_id}", response_model=schemas.BranchOut)
def get_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.view")),
):
    branch = db.get(models.Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch


@router.post("", response_model=schemas.BranchOut, status_code=201)
def create_branch(
    data: schemas.BranchCreate,
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.manage")),
):
    if db.query(models.Branch).filter(models.Branch.code == data.code).first():
        raise HTTPException(status_code=400, detail="Branch code already exists")
    if db.query(models.Branch).filter(models.Branch.name == data.name).first():
        raise HTTPException(status_code=400, detail="Branch name already exists")
    branch = models.Branch(**data.model_dump())
    db.add(branch)
    db.flush()
    db.refresh(branch)
    return branch


@router.put("/{branch_id}", response_model=schemas.BranchOut)
def update_branch(
    branch_id: int,
    data: schemas.BranchUpdate,
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.manage")),
):
    branch = db.get(models.Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    update_data = data.model_dump(exclude_unset=True)
    if "code" in update_data:
        existing = db.query(models.Branch).filter(
            models.Branch.code == update_data["code"],
            models.Branch.id != branch_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Branch code already exists")
    if "name" in update_data:
        existing = db.query(models.Branch).filter(
            models.Branch.name == update_data["name"],
            models.Branch.id != branch_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Branch name already exists")
    for field, value in update_data.items():
        setattr(branch, field, value)
    db.flush()
    db.refresh(branch)
    return branch


@router.get("/{branch_id}/stocks", response_model=list[schemas.BranchStockOut])
def get_branch_stocks(
    branch_id: int,
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.view")),
):
    branch = db.get(models.Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    stocks = (
        db.query(models.BranchStock)
        .filter(models.BranchStock.branch_id == branch_id)
        .all()
    )
    return [
        schemas.BranchStockOut(
            id=s.id,
            branch_id=s.branch_id,
            branch_name=branch.name,
            product_id=s.product_id,
            product_name=s.product.name if s.product else "",
            quantity=s.quantity,
            updated_at=s.updated_at,
        )
        for s in stocks
    ]


@router.get("/product/{product_id}/stocks", response_model=list[schemas.BranchStockOut])
def get_product_branch_stocks(
    product_id: int,
    branch_ids: str | None = Query(default=None, description="Comma-separated branch IDs"),
    in_stock_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.view")),
):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    q = db.query(models.BranchStock).filter(models.BranchStock.product_id == product_id)

    if branch_ids:
        try:
            ids = [int(x.strip()) for x in branch_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid branch_ids")
        q = q.filter(models.BranchStock.branch_id.in_(ids))

    if in_stock_only:
        q = q.filter(models.BranchStock.quantity > 0)

    stocks = q.all()
    return [
        schemas.BranchStockOut(
            id=s.id,
            branch_id=s.branch_id,
            branch_name=s.branch.name if s.branch else "",
            product_id=s.product_id,
            product_name=product.name,
            quantity=s.quantity,
            updated_at=s.updated_at,
        )
        for s in stocks
    ]


def _resolve_user_branch(db: Session, current: models.User) -> int | None:
    """Resolve the branch a user is allowed to see. Returns None for admins."""
    if current.role in ("super_admin", "admin"):
        return None  # admin can see all branches
    if current.branch:
        branch = (
            db.query(models.Branch).filter(models.Branch.code == current.branch).first()
        )
        return branch.id if branch else None
    return None


def _require_branch_access(db: Session, current: models.User, branch_id: int) -> None:
    """Raise 403 if a branch-scoped user tries to access a different branch."""
    if current.role in ("super_admin", "admin"):
        return
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id != branch_id:
        raise HTTPException(
            status_code=403, detail="Access restricted to your own branch"
        )


@router.get("/{branch_id}/stock", response_model=list[schemas.BranchStockDetailOut])
def get_branch_stock(
    branch_id: int,
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    low_stock: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("branch.view")),
):
    _require_branch_access(db, current, branch_id)

    branch = db.get(models.Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    q = (
        db.query(models.BranchStock, models.Product)
        .join(models.Product, models.BranchStock.product_id == models.Product.id)
        .filter(models.BranchStock.branch_id == branch_id)
    )

    if search:
        term = f"%{search}%"
        q = q.filter(models.Product.name.ilike(term))
    if category:
        q = q.filter(models.Product.category == category)

    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()

    # In-transit quantities for this branch
    in_transit_in = dict(
        db.query(
            models.StockTransferItem.product_id,
            db.func.sum(models.StockTransferItem.quantity - models.StockTransferItem.qty_received),
        )
        .join(models.StockTransfer)
        .filter(
            models.StockTransfer.to_branch_id == branch_id,
            models.StockTransfer.status == "dispatched",
        )
        .group_by(models.StockTransferItem.product_id)
        .all()
    )
    in_transit_out = dict(
        db.query(
            models.StockTransferItem.product_id,
            db.func.sum(models.StockTransferItem.quantity - models.StockTransferItem.qty_received),
        )
        .join(models.StockTransfer)
        .filter(
            models.StockTransfer.from_branch_id == branch_id,
            models.StockTransfer.status == "dispatched",
        )
        .group_by(models.StockTransferItem.product_id)
        .all()
    )

    results = []
    for bs, product in rows:
        on_hand = bs.quantity or 0
        reserved = bs.reserved_quantity or 0
        available = on_hand - reserved
        it_in = int(in_transit_in.get(product.id, 0) or 0)
        it_out = int(in_transit_out.get(product.id, 0) or 0)
        value = available * (bs.avg_cost or 0)

        if low_stock and available > (product.min_stock or 0):
            continue

        results.append(
            schemas.BranchStockDetailOut(
                product_id=product.id,
                sku=product.sku,
                name=product.name,
                category=product.category,
                on_hand=on_hand,
                reserved=reserved,
                available=available,
                in_transit_in=it_in,
                in_transit_out=it_out,
                avg_cost=float(bs.avg_cost or 0),
                value=float(value),
                last_movement_at=bs.last_movement_at,
                min_stock=product.min_stock or 0,
            )
        )

    return results


@router.get(
    "/{branch_id}/stock/{product_id}/movements",
    response_model=list[schemas.StockMovementOut],
)
def get_branch_product_movements(
    branch_id: int,
    product_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("branch.view")),
):
    """Drill-down ledger for a product at a branch. Mandatory for staff trust."""
    _require_branch_access(db, current, branch_id)

    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    rows = (
        db.query(models.StockMovement, models.User)
        .outerjoin(models.User, models.StockMovement.created_by == models.User.id)
        .filter(
            models.StockMovement.branch_id == branch_id,
            models.StockMovement.product_id == product_id,
        )
        .order_by(models.StockMovement.created_at.desc())
        .limit(limit)
        .all()
    )

    return [
        schemas.StockMovementOut(
            id=m.id,
            movement_type=m.movement_type,
            qty=m.qty,
            balance_after=m.balance_after,
            reference_type=m.reference_type,
            reference_id=m.reference_id,
            idempotency_key=m.idempotency_key,
            note=m.note,
            created_by=u.full_name if u else None,
            created_at=m.created_at,
        )
        for m, u in rows
    ]


@router.get("/{branch_id}/stock/matrix", response_model=list[schemas.BranchStockMatrixRow])
def get_branch_stock_matrix(
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("branch.view")),
):
    """Admin all-branches matrix: products as rows, branches as columns."""
    if current.role not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Admin only")

    branches = db.query(models.Branch).order_by(models.Branch.name).all()
    branch_ids = [b.id for b in branches]

    q = db.query(models.Product)
    if search:
        term = f"%{search}%"
        q = q.filter(models.Product.name.ilike(term))
    products = q.order_by(models.Product.name).all()

    # Fetch all branch_stocks for these products at once
    stock_map: dict[tuple[int, int], int] = {}
    if products and branch_ids:
        product_ids = [p.id for p in products]
        rows = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id.in_(product_ids),
                models.BranchStock.branch_id.in_(branch_ids),
            )
            .all()
        )
        for s in rows:
            stock_map[(s.product_id, s.branch_id)] = s.quantity or 0

    results = []
    for product in products:
        row = schemas.BranchStockMatrixRow(
            product_id=product.id,
            name=product.name,
            sku=product.sku,
            category=product.category,
        )
        total = 0
        for b in branches:
            qty = stock_map.get((product.id, b.id), 0)
            setattr(row, f"branch_{b.id}", qty)
            total += qty
        row.total = total
        results.append(row)

    return results
