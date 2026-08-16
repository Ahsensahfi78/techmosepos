from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/cheques", tags=["cheques"])


def _out(c: models.Cheque) -> schemas.ChequeOut:
    return schemas.ChequeOut(
        id=c.id,
        direction=c.direction,
        number=c.number,
        bank=c.bank,
        account_name=c.account_name,
        payee=c.payee,
        amount=c.amount,
        due_date=c.due_date,
        status=c.status,
        notes=c.notes,
        created_by=c.created_by,
        created_by_name=c.user.full_name if c.user else None,
        cleared_at=c.cleared_at,
        created_at=c.created_at,
    )


@router.post("", response_model=schemas.ChequeOut, status_code=201)
def create_cheque(
    data: schemas.ChequeIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("cheque.manage")),
):
    cheque = models.Cheque(
        direction=data.direction,
        number=data.number,
        bank=data.bank,
        account_name=data.account_name,
        payee=data.payee,
        amount=data.amount,
        due_date=data.due_date,
        status=models.ChequeStatus.PENDING.value,
        notes=data.notes,
        created_by=current.id,
    )
    db.add(cheque)
    db.commit()
    db.refresh(cheque)
    AuditLogRepository(db).log(
        action="cheque.create",
        entity_type="cheque",
        entity_id=cheque.id,
        user_id=current.id,
        details=f"{data.direction.title()} cheque of {data.amount}",
    )
    return _out(cheque)


@router.get("")
def list_cheques(
    direction: str | None = Query(default=None, pattern="^(received|issued)$"),
    status: str | None = Query(default=None, pattern="^(pending|cleared|returned)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("cheque.manage")),
):
    query = db.query(models.Cheque)
    if direction:
        query = query.filter(models.Cheque.direction == direction)
    if status:
        query = query.filter(models.Cheque.status == status)
    total = query.count()
    rows = (
        query.order_by(models.Cheque.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.ChequeOut](
        items=[_out(c) for c in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )


@router.patch("/{cheque_id}/status", response_model=schemas.ChequeOut)
def update_cheque_status(
    cheque_id: int,
    data: schemas.ChequeStatusIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("cheque.manage")),
):
    cheque = db.get(models.Cheque, cheque_id)
    if cheque is None:
        raise HTTPException(status_code=404, detail="Cheque not found")

    transitions = {
        "pending": {"cleared", "returned"},
        "cleared": {"returned"},
        "returned": set(),
    }
    allowed = transitions.get(cheque.status, set())
    if data.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move cheque from '{cheque.status}' to '{data.status}'",
        )

    cheque.status = data.status
    cheque.cleared_at = datetime.utcnow() if data.status == "cleared" else None
    db.commit()
    db.refresh(cheque)
    AuditLogRepository(db).log(
        action="cheque.status",
        entity_type="cheque",
        entity_id=cheque.id,
        user_id=current.id,
        details=f"Cheque #{cheque.id} marked {data.status}",
    )
    return _out(cheque)


@router.delete("/{cheque_id}", response_model=schemas.ChequeOut)
def delete_cheque(
    cheque_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("cheque.manage")),
):
    cheque = db.get(models.Cheque, cheque_id)
    if cheque is None:
        raise HTTPException(status_code=404, detail="Cheque not found")
    db.delete(cheque)
    db.commit()
    AuditLogRepository(db).log(
        action="cheque.delete",
        entity_type="cheque",
        entity_id=cheque_id,
        user_id=current.id,
        details=f"Deleted cheque #{cheque_id}",
    )
    return _out(cheque)
