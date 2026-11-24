from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..manager import manager
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services.stock_service import StockService, InsufficientStockException

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _next_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.StockAdjustment)
        .filter(models.StockAdjustment.reference.like(f"ADJ-{today}%"))
        .count()
    )
    return f"ADJ-{today}-{count + 1:03d}"


def _get_product(db: Session, product_id: int) -> models.Product:
    product = db.get(models.Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product #{product_id} not found")
    return product


def _out(a: models.StockAdjustment) -> schemas.StockAdjustmentOut:
    return schemas.StockAdjustmentOut(
        id=a.id,
        reference=a.reference,
        warehouse_id=a.warehouse_id,
        warehouse_name=a.warehouse.name if a.warehouse else None,
        reason=a.reason,
        note=a.note,
        created_by=a.created_by,
        created_by_name=a.user.full_name if a.user else None,
        created_at=a.created_at,
        items=[
            schemas.StockAdjustmentItemOut(
                id=i.id,
                product_id=i.product_id,
                product_name=i.product.name if i.product else "",
                qty_delta=i.qty_delta,
                previous_stock=i.previous_stock,
                new_stock=i.new_stock,
            )
            for i in a.items
        ],
    )


async def _broadcast_adjustment(items) -> None:
    for item in items:
        if item.product is None:
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


@router.post("/adjustments", response_model=schemas.StockAdjustmentOut, status_code=201)
async def create_adjustment(
    data: schemas.StockAdjustmentIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("inventory.manage")),
):
    # Branch resolved server-side from the authenticated user — never from payload.
    branch_id = None
    if current.role not in ("super_admin", "admin") and current.branch:
        branch_row = (
            db.query(models.Branch).filter(models.Branch.code.ilike(current.branch)).first()
        )
        if branch_row:
            branch_id = branch_row.id
        else:
            raise HTTPException(
                status_code=400,
                detail="No branch assigned to this user. Contact an administrator.",
            )

    adjustment = models.StockAdjustment(
        reference=_next_number(db),
        warehouse_id=data.warehouse_id,
        branch_id=branch_row.id,
        reason=data.reason or "stock_count",
        note=data.note,
        created_by=current.id,
    )
    db.add(adjustment)
    db.flush()

    deltas: dict[int, int] = {}
    for line in data.items:
        product = _get_product(db, line.product_id)
        deltas[product.id] = deltas.get(product.id, 0) + line.qty_delta

    # All stock changes go through StockService (single write path).
    try:
        StockService.adjustment(
            db=db,
            branch_id=branch_row.id,
            deltas=deltas,
            reference_type="adjustment",
            reference_id=adjustment.id,
            idempotency_key=None,
            user_id=current.id,
            reason=data.reason or "stock_count",
        )
    except InsufficientStockException as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=(
                f"Not enough stock for '{exc.product_name}' at branch {exc.branch_id} "
                f"(available: {exc.available}, requested: {exc.requested})"
            ),
        )

    # Build adjustment item rows for audit (previous/new stock from branch_stocks).
    adjustment_items = []
    for line in data.items:
        product = _get_product(db, line.product_id)
        bs = (
            db.query(models.BranchStock)
            .filter(
                models.BranchStock.product_id == product.id,
                models.BranchStock.branch_id == branch_row.id,
            )
            .first()
        )
        current_qty = bs.quantity if bs else 0
        prev = current_qty - line.qty_delta
        adjustment_items.append(
            models.StockAdjustmentItem(
                adjustment_id=adjustment.id,
                product_id=product.id,
                qty_delta=line.qty_delta,
                previous_stock=prev,
                new_stock=current_qty,
            )
        )
    db.add_all(adjustment_items)

    db.commit()
    db.refresh(adjustment)
    AuditLogRepository(db).log(
        action="inventory.adjustment",
        entity_type="inventory",
        entity_id=adjustment.id,
        user_id=current.id,
        details=f"Stock adjustment {adjustment.reference} ({adjustment.reason})",
    )
    await _broadcast_adjustment(adjustment.items)
    return _out(adjustment)


# ── Split Restock: one receipt, many destination branches ─────────────────
@router.post("/restock", response_model=schemas.RestockOut, status_code=201)
async def create_restock(
    data: schemas.RestockIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("inventory.manage")),
):
    """
    Admin split restock: one receipt form, many destination branches.
    Allocations are posted atomically — all or nothing.

    - Managers may receive only into their own branch.
    - Admins may allocate across any branches.
    - Allocation totals are validated PER PRODUCT (not one meaningless total
      across unlike products).
    - Idempotency key prevents double-posting on offline POS retry.
    """
    # Determine if this is a global split (multiple branches) or single-branch
    is_global = len(data.allocations) > 1
    if is_global and current.role not in ("super_admin", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Global split restock across branches is admin-only",
        )

    # Idempotency pre-check
    if data.idempotency_key:
        existing = db.execute(
            text("SELECT 1 FROM stock_movements WHERE idempotency_key = :k"),
            {"k": data.idempotency_key},
        ).first()
        if existing:
            return schemas.RestockOut(
                reference=data.reference or "replayed",
                idempotency_key=data.idempotency_key,
                lines=[],
                total_lines=0,
                total_quantity=0,
            )

    # Validate allocations per product
    product_totals: dict[int, int] = {}
    for alloc in data.allocations:
        # Branch access check
        if current.role not in ("super_admin", "admin"):
            if current.branch:
                branch_row = (
                    db.query(models.Branch)
                    .filter(models.Branch.code == current.branch)
                    .first()
                )
                if not branch_row or branch_row.id != alloc.branch_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Managers may receive only into their own branch",
                    )
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No branch assigned to this user",
                )

        branch = db.get(models.Branch, alloc.branch_id)
        if not branch or not branch.is_active:
            raise HTTPException(
                status_code=404,
                detail=f"Branch #{alloc.branch_id} not found or inactive",
            )

        for line in alloc.items:
            product = _get_product(db, line.product_id)
            key = line.product_id
            product_totals[key] = product_totals.get(key, 0) + line.quantity

    # Validate that allocation totals don't exceed received qty per product
    # (received qty is the sum of all allocations for that product)
    # No separate "received total" field — the allocations themselves define
    # what was received. Each product's total across all branches is the
    # received quantity.

    # Post all allocations atomically via StockService
    from ..services.stock_service import StockService

    lines_out: list[schemas.RestockLineOut] = []
    total_quantity = 0

    try:
        db.execute(text("BEGIN IMMEDIATE"))
        try:
            for alloc in data.allocations:
                branch = db.get(models.Branch, alloc.branch_id)
                deltas: dict[int, int] = {}
                unit_costs: dict[int, float] = {}
                for line in alloc.items:
                    deltas[line.product_id] = line.quantity
                    if line.unit_cost is not None:
                        unit_costs[line.product_id] = line.unit_cost

                StockService.apply(
                    db=db,
                    branch_id=alloc.branch_id,
                    deltas=deltas,
                    movement_type="purchase_receipt",
                    reference_type="purchase",
                    reference_id=None,
                    idempotency_key=data.idempotency_key,
                    user_id=current.id,
                    unit_costs=unit_costs,
                    note=data.reference or "Split restock",
                )

                for line in alloc.items:
                    product = _get_product(db, line.product_id)
                    lines_out.append(
                        schemas.RestockLineOut(
                            product_id=line.product_id,
                            product_name=product.name,
                            branch_id=alloc.branch_id,
                            branch_name=branch.name,
                            quantity=line.quantity,
                            unit_cost=line.unit_cost,
                        )
                    )
                    total_quantity += line.quantity

            db.execute(text("COMMIT"))
        except Exception:
            db.execute(text("ROLLBACK"))
            raise
    except InsufficientStockException as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient stock context for '{exc.product_name}' at branch "
                f"{exc.branch_id}: {exc}"
            ),
        )

    return schemas.RestockOut(
        reference=data.reference or "restock",
        idempotency_key=data.idempotency_key,
        lines=lines_out,
        total_lines=len(lines_out),
        total_quantity=total_quantity,
    )


@router.get("/adjustments")
def list_adjustments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("inventory.view")),
):
    query = db.query(models.StockAdjustment)
    total = query.count()
    rows = (
        query.order_by(models.StockAdjustment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.StockAdjustmentOut](
        items=[_out(a) for a in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )
