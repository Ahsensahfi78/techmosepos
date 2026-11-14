from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..services.stock_service import StockService, InsufficientStockException

router = APIRouter(prefix="/transfers", tags=["transfers"])


def _resolve_user_branch(db: Session, current: models.User) -> int | None:
    """Resolve the branch a user is allowed to access. Returns None for admins."""
    if current.role in ("super_admin", "admin"):
        return None  # admin can see all branches
    if current.branch:
        branch = db.query(models.Branch).filter(models.Branch.code.ilike(current.branch)).first()
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


def _next_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.StockTransfer)
        .filter(models.StockTransfer.transfer_number.like(f"TRF-{today}%"))
        .count()
    )
    return f"TRF-{today}-{count + 1:03d}"


def _out(t: models.StockTransfer, db: Session) -> schemas.StockTransferOut:
    return schemas.StockTransferOut(
        id=t.id,
        transfer_number=t.transfer_number,
        from_branch_id=t.from_branch_id,
        from_branch_name=t.from_branch.name if t.from_branch else "",
        to_branch_id=t.to_branch_id,
        to_branch_name=t.to_branch.name if t.to_branch else "",
        status=t.status,
        notes=t.notes,
        created_by=t.created_by,
        created_by_name=t.creator.full_name if t.creator else None,
        created_at=t.created_at,
        approved_by=t.approved_by,
        approved_at=t.approved_at,
        completed_by=t.completed_by,
        completed_at=t.completed_at,
        items=[
            schemas.StockTransferItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                quantity=i.quantity,
                from_quantity=i.from_quantity,
                to_quantity=i.to_quantity,
            )
            for i in t.items
        ],
    )


@router.get("", response_model=list[schemas.StockTransferOut])
def list_transfers(
    status: str = Query(default=None),
    branch_id: int = Query(default=None),
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("transfer.view")),
):
    q = db.query(models.StockTransfer)
    if status:
        q = q.filter(models.StockTransfer.status == status)
    # Branch-scoped users only see transfers involving their own branch
    user_branch_id = _resolve_user_branch(db, current)
    if user_branch_id is not None:
        q = q.filter(
            (models.StockTransfer.from_branch_id == user_branch_id)
            | (models.StockTransfer.to_branch_id == user_branch_id)
        )
    elif branch_id:
        q = q.filter(
            (models.StockTransfer.from_branch_id == branch_id)
            | (models.StockTransfer.to_branch_id == branch_id)
        )
    return [_out(t, db) for t in q.order_by(models.StockTransfer.created_at.desc()).all()]


@router.get("/{transfer_id}", response_model=schemas.StockTransferOut)
def get_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("transfer.view")),
):
    t = db.get(models.StockTransfer, transfer_id)
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    _require_branch_access(db, current, t.from_branch_id)
    _require_branch_access(db, current, t.to_branch_id)
    return _out(t, db)


@router.post("", response_model=schemas.StockTransferOut, status_code=201)
def create_transfer(
    data: schemas.StockTransferIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("transfer.manage")),
):
    # Branch-scoped users can only create transfers from their own branch
    user_branch_id = _resolve_user_branch(db, current)
    if current.role not in ("super_admin", "admin"):
        if not user_branch_id:
            raise HTTPException(
                status_code=400,
                detail="No branch assigned to this user. Contact an administrator.",
            )
        if data.from_branch_id != user_branch_id:
            raise HTTPException(
                status_code=403,
                detail="You can only create transfers from your own branch",
            )

    from_branch = db.get(models.Branch, data.from_branch_id)
    if not from_branch:
        raise HTTPException(status_code=404, detail="Source branch not found")
    to_branch = db.get(models.Branch, data.to_branch_id)
    if not to_branch:
        raise HTTPException(status_code=404, detail="Destination branch not found")

    transfer = models.StockTransfer(
        transfer_number=_next_number(db),
        from_branch_id=data.from_branch_id,
        to_branch_id=data.to_branch_id,
        status=models.StockTransferStatus.PENDING.value,
        notes=data.notes,
        created_by=current.id,
    )
    db.add(transfer)
    db.flush()

    for item in data.items:
        product = db.get(models.Product, item.product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"Product #{item.product_id} not found")

        from_stock = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.branch_id == data.from_branch_id,
                models.BranchStock.product_id == item.product_id,
            )
            .first()
        )
        from_qty = from_stock.quantity if from_stock else 0
        if from_qty < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {product.name} at {from_branch.name} (available: {from_qty})",
            )

        to_stock = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.branch_id == data.to_branch_id,
                models.BranchStock.product_id == item.product_id,
            )
            .first()
        )
        to_qty = to_stock.quantity if to_stock else 0

        transfer_item = models.StockTransferItem(
            transfer_id=transfer.id,
            product_id=item.product_id,
            quantity=item.quantity,
            from_quantity=from_qty,
            to_quantity=to_qty,
        )
        db.add(transfer_item)

    db.flush()
    db.refresh(transfer)
    return _out(transfer, db)


@router.post("/{transfer_id}/approve", response_model=schemas.StockTransferOut)
def approve_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("transfer.manage")),
):
    transfer = db.get(models.StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    _require_branch_access(db, current, transfer.from_branch_id)
    _require_branch_access(db, current, transfer.to_branch_id)
    if transfer.status != models.StockTransferStatus.PENDING.value:
        raise HTTPException(status_code=400, detail="Transfer is not pending")
    transfer.status = models.StockTransferStatus.APPROVED.value
    transfer.approved_by = current.id
    transfer.approved_at = datetime.utcnow()
    db.flush()
    db.refresh(transfer)
    return _out(transfer, db)


@router.post("/{transfer_id}/complete", response_model=schemas.StockTransferOut)
def complete_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("transfer.manage")),
):
    transfer = db.get(models.StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    _require_branch_access(db, current, transfer.from_branch_id)
    _require_branch_access(db, current, transfer.to_branch_id)
    if transfer.status != models.StockTransferStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="Transfer must be approved first")

    # Dispatch: stock leaves the source branch via StockService (transfer_out).
    out_deltas: dict[int, int] = {}
    for item in transfer.items:
        out_deltas[item.product_id] = out_deltas.get(item.product_id, 0) + item.quantity

    try:
        StockService.transfer_out(
            db=db,
            branch_id=transfer.from_branch_id,
            deltas=out_deltas,
            transfer_id=transfer.id,
            idempotency_key=None,
            user_id=current.id,
        )
    except InsufficientStockException as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient stock for '{exc.product_name}' at source branch {exc.branch_id} "
                f"(available: {exc.available}, requested: {exc.requested})"
            ),
        )

    # Receive: stock arrives at destination via StockService (transfer_in).
    # Shortfall (qty_received < qty) becomes a balancing adjustment at source.
    for item in transfer.items:
        received = item.qty_received or 0
        dispatched = item.quantity

        if received > 0:
            in_deltas = {item.product_id: received}
            try:
                StockService.transfer_in(
                    db=db,
                    branch_id=transfer.to_branch_id,
                    deltas=in_deltas,
                    transfer_id=transfer.id,
                    idempotency_key=None,
                    user_id=current.id,
                )
            except InsufficientStockException:
                # transfer_in should never fail on a positive delta
                pass

        shortfall = dispatched - received
        if shortfall > 0:
            # Shortfall becomes a damage/write_off at the source so the ledger balances.
            # allow_negative=True because missing stock is a write-off, not a sale.
            StockService.adjustment(
                db=db,
                branch_id=transfer.from_branch_id,
                deltas={item.product_id: -shortfall},
                reference_type="stock_transfer",
                reference_id=transfer.id,
                idempotency_key=None,
                user_id=current.id,
                reason="damage",
                note=f"Shortfall on transfer #{transfer.id}",
                allow_negative=True,
            )

    transfer.status = models.StockTransferStatus.COMPLETED.value
    transfer.completed_by = current.id
    transfer.completed_at = datetime.utcnow()
    db.flush()
    db.refresh(transfer)
    return _out(transfer, db)


@router.post("/{transfer_id}/cancel", response_model=schemas.StockTransferOut)
def cancel_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("transfer.manage")),
):
    transfer = db.get(models.StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    _require_branch_access(db, current, transfer.from_branch_id)
    _require_branch_access(db, current, transfer.to_branch_id)
    if transfer.status in (
        models.StockTransferStatus.COMPLETED.value,
        models.StockTransferStatus.CANCELLED.value,
    ):
        raise HTTPException(status_code=400, detail="Transfer cannot be cancelled")
    transfer.status = models.StockTransferStatus.CANCELLED.value
    db.flush()
    db.refresh(transfer)
    return _out(transfer, db)
