import csv
import io
import math

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..services import ezcash_service

router = APIRouter(prefix="/ezcash", tags=["ezcash"])


def _reload_out(r: models.EzCashReload) -> schemas.EzCashReloadOut:
    return schemas.EzCashReloadOut(
        id=r.id,
        reference_number=r.reference_number,
        phone_number=r.phone_number,
        normalized_phone=r.normalized_phone,
        amount=r.amount,
        payment_method=r.payment_method,
        status=r.status,
        provider_response=r.provider_response,
        provider_reference=r.provider_reference,
        failure_reason=r.failure_reason,
        created_by=r.created_by,
        created_by_name=r.user.full_name if r.user else None,
        pos_register=r.pos_register,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


@router.post("/reload", response_model=schemas.EzCashReloadOut, status_code=201)
def create_reload(
    data: schemas.EzCashReloadIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("ezcash.create")),
):
    reload = ezcash_service.create_reload(db, data, user_id=current.id)
    AuditLogRepository(db).log(
        action="ezcash.reload",
        entity_type="ezcash_reload",
        entity_id=reload.id,
        user_id=current.id,
        details=f"EZ Cash reload {reload.reference_number} Rs.{reload.amount} -> {reload.normalized_phone} [{reload.status}]",
    )
    return _reload_out(reload)


@router.get("/reloads")
def list_reloads(
    phone: str | None = Query(default=None),
    reference: str | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    created_by: int | None = Query(default=None),
    amount_min: float | None = Query(default=None),
    amount_max: float | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("ezcash.view")),
):
    items, total = ezcash_service.list_reloads(
        db,
        phone=phone,
        reference=reference,
        status=status,
        date_from=date_from,
        date_to=date_to,
        created_by=created_by,
        amount_min=amount_min,
        amount_max=amount_max,
        page=page,
        page_size=page_size,
    )
    return {
        "items": [_reload_out(r) for r in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@router.get("/reloads/{reload_id}", response_model=schemas.EzCashReloadOut)
def get_reload(
    reload_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("ezcash.view")),
):
    reload = ezcash_service.get_reload(db, reload_id)
    return _reload_out(reload)


@router.post("/reloads/{reload_id}/retry", response_model=schemas.EzCashReloadOut)
def retry_reload(
    reload_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("ezcash.create")),
):
    reload = ezcash_service.retry_reload(db, reload_id, user_id=current.id)
    AuditLogRepository(db).log(
        action="ezcash.retry",
        entity_type="ezcash_reload",
        entity_id=reload.id,
        user_id=current.id,
        details=f"Retried EZ Cash reload {reload.reference_number} [{reload.status}]",
    )
    return _reload_out(reload)


@router.patch("/reloads/{reload_id}/cancel", response_model=schemas.EzCashReloadOut)
def cancel_reload(
    reload_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("ezcash.manage")),
):
    reload = ezcash_service.cancel_reload(db, reload_id, user_id=current.id)
    AuditLogRepository(db).log(
        action="ezcash.cancel",
        entity_type="ezcash_reload",
        entity_id=reload.id,
        user_id=current.id,
        details=f"Cancelled EZ Cash reload {reload.reference_number}",
    )
    return _reload_out(reload)


@router.get("/reports/daily", response_model=schemas.EzCashReloadSummary)
def daily_report(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("ezcash.report")),
):
    return ezcash_service.daily_summary(db, date_from=date_from, date_to=date_to)


@router.get("/reports/cashier", response_model=list[schemas.EzCashCashierSummary])
def cashier_report(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("ezcash.report")),
):
    return ezcash_service.cashier_summary(db, date_from=date_from, date_to=date_to)


@router.get("/reports/export")
def export_csv(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("ezcash.report")),
):
    items, _ = ezcash_service.list_reloads(
        db, date_from=date_from, date_to=date_to, status=status, page_size=10000
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Reference", "Phone", "Normalized Phone", "Amount",
        "Payment Method", "Status", "Provider Ref", "Failure Reason",
        "Cashier", "Created At",
    ])
    for r in items:
        writer.writerow([
            r.reference_number,
            r.phone_number,
            r.normalized_phone,
            r.amount,
            r.payment_method or "",
            r.status,
            r.provider_reference or "",
            r.failure_reason or "",
            r.user.full_name if r.user else "",
            r.created_at.isoformat() if r.created_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ezcash-reloads.csv"},
    )
