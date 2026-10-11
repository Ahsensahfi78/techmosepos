from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

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
    db: Session = Depends(get_db),
    _current: models.User = Depends(require_permission("branch.view")),
):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    stocks = (
        db.query(models.BranchStock)
        .filter(models.BranchStock.product_id == product_id)
        .all()
    )
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
