from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("", response_model=schemas.Paginated[schemas.AuditLogOut])
def list_audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("audit.view")),
):
    items, total, total_pages = AuditLogRepository(db).get_all(
        search=search,
        entity_type=entity_type,
        user_id=user_id,
        page=page,
        page_size=page_size,
    )
    return schemas.Paginated[schemas.AuditLogOut](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
