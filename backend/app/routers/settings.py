from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULT_SETTINGS = {
    "store_name": "My Store",
    "tax_rate": "0",
    "currency": "Rs",
    "receipt_footer": "Thank you for your purchase!\nReturn policy: Items eligible for return within 3 days with receipt.",
    "low_stock_threshold": "5",
}

# Older installs were seeded with this single-line default. Upgrade it to the
# current two-line default only while it still matches (i.e. never overwrite an
# admin-customised footer).
LEGACY_RECEIPT_FOOTER = "Thank you for shopping with us!"


def ensure_defaults(db: Session) -> None:
    for key, value in DEFAULT_SETTINGS.items():
        row = db.get(models.Setting, key)
        if row is None:
            db.add(models.Setting(key=key, value=value))
        elif key == "receipt_footer" and (row.value or "") == LEGACY_RECEIPT_FOOTER:
            row.value = value
    db.commit()


@router.get("")
def get_settings(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("settings.manage")),
):
    ensure_defaults(db)
    rows = db.query(models.Setting).all()
    return {
        "settings": {
            row.key: schemas.SettingOut.model_validate(row) for row in rows
        }
    }


@router.get("/print")
def get_print_settings(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("pos.access")),
):
    """Print-time settings (store name, currency, receipt footer) for receipts.

    Any role with POS access can read these — no need for settings.manage.
    """
    ensure_defaults(db)
    keys = ["store_name", "currency", "receipt_footer"]
    rows = db.query(models.Setting).filter(models.Setting.key.in_(keys)).all()
    return {row.key: (row.value or "") for row in rows}


@router.put("/{key}", response_model=schemas.SettingOut)
def update_setting(
    key: str,
    data: schemas.SettingUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("settings.manage")),
):
    setting = db.get(models.Setting, key)
    if setting is None:
        raise HTTPException(status_code=404, detail=f"Unknown setting '{key}'")
    setting.value = data.value
    db.commit()
    db.refresh(setting)
    AuditLogRepository(db).log(
        action="settings.update",
        entity_type="setting",
        entity_id=None,
        user_id=current.id,
        details=f"Updated setting '{key}'",
    )
    return setting
