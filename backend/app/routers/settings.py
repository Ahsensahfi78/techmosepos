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
    # Receipt / invoice details (header block shown on printed receipts).
    # Empty string = the line is omitted from the receipt rather than blank.
    "store_address": "",
    "store_phone": "0752246378",
    "store_email": "",
    "store_logo": "",
    # Roll width of the printed receipt in millimetres (clamped to 58–80).
    "receipt_width_mm": "80",
    # Some thermal printers feed the paper so the receipt comes out upside
    # down. "true" rotates the printed receipt by 180° in CSS so the output is
    # right way up. On-screen previews are never rotated.
    "receipt_rotate_180": "false",
}

# Keys rendered by GET /settings/print — any role with pos.access can read them.
PRINT_KEYS = [
    "store_name",
    "store_address",
    "store_phone",
    "store_email",
    "store_logo",
    "receipt_footer",
    "receipt_width_mm",
    "receipt_rotate_180",
    "currency",
]

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
    rows = db.query(models.Setting).filter(models.Setting.key.in_(PRINT_KEYS)).all()
    return {row.key: (row.value or "") for row in rows}


# Settings that must never be edited through the generic PUT /settings/{key}
# endpoint (none at the moment — the receipt footer is intentionally editable).
PROTECTED_SETTINGS: set = set()

# Settings with a constrained numeric range — validated on write so the
# printer can never receive a width outside the hardware's supported roll.
RANGE_SETTINGS = {
    "receipt_width_mm": (58, 80),
}

# Boolean settings. Normalised to the literal strings "true" / "false" so the
# frontend can compare without guessing.
BOOL_SETTINGS = {
    "receipt_rotate_180",
}

_TRUE_WORDS = {"true", "1", "yes", "on", "y"}
_FALSE_WORDS = {"false", "0", "no", "off", "n"}


@router.put("/{key}", response_model=schemas.SettingOut)
def update_setting(
    key: str,
    data: schemas.SettingUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("settings.manage")),
):
    if key in PROTECTED_SETTINGS:
        raise HTTPException(status_code=403, detail=f"Setting '{key}' is protected and cannot be modified")
    setting = db.get(models.Setting, key)
    if setting is None:
        raise HTTPException(status_code=404, detail=f"Unknown setting '{key}'")
    if key in RANGE_SETTINGS:
        low, high = RANGE_SETTINGS[key]
        raw = (data.value or "").strip()
        try:
            number = int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"Setting '{key}' must be a whole number between {low} and {high}")
        if not low <= number <= high:
            raise HTTPException(status_code=422, detail=f"Setting '{key}' must be between {low} and {high}")
        data.value = str(number)
    if key in BOOL_SETTINGS:
        raw = (data.value or "").strip().lower()
        if raw in _TRUE_WORDS:
            data.value = "true"
        elif raw in _FALSE_WORDS:
            data.value = "false"
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Setting '{key}' must be true or false",
            )
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
