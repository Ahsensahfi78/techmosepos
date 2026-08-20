import re
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..repositories.ezcash_repo import EzCashRepository
from .ezcash_provider import get_provider

_PHONE_RE = re.compile(r"^(?:\+?94|0)?7\d{8}$")


def validate_phone(phone: str) -> str:
    raw = phone.strip()
    digits = re.sub(r"[^\d]", "", raw)
    if digits.startswith("0") and len(digits) == 10:
        return "+94" + digits[1:]
    if digits.startswith("94") and len(digits) == 11:
        return "+" + digits
    if digits.startswith("7") and len(digits) == 9:
        return "+94" + digits
    if raw.startswith("+94") and len(digits) == 11:
        return "+94" + digits[2:]
    raise HTTPException(
        status_code=400,
        detail=f"Invalid Sri Lankan phone number: {phone}. Use 07XXXXXXXX or +947XXXXXXXX format.",
    )


def _next_reference_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.EzCashReload)
        .filter(models.EzCashReload.reference_number.like(f"EZC-{today}%"))
        .count()
    )
    return f"EZC-{today}-{count + 1:03d}"


def create_reload(db: Session, data, user_id: int) -> models.EzCashReload:
    repo = EzCashRepository(db)

    if data.idempotency_key:
        existing = repo.get_by_idempotency_key(data.idempotency_key)
        if existing:
            return existing

    normalized = validate_phone(data.phone_number)

    provider = get_provider()
    reference = _next_reference_number(db)

    reload = repo.create(
        reference_number=reference,
        phone_number=data.phone_number.strip(),
        normalized_phone=normalized,
        amount=data.amount,
        payment_method=data.payment_method,
        status=models.EzCashStatus.PENDING.value,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
        pos_register=getattr(data, "pos_register", None),
    )

    result = provider.reload(normalized, data.amount, reference)

    if result.success:
        reload.status = models.EzCashStatus.SUCCESSFUL.value
        reload.provider_reference = result.provider_reference
        reload.provider_response = result.raw_response
    else:
        reload.status = models.EzCashStatus.FAILED.value
        reload.failure_reason = result.failure_reason
        reload.provider_response = result.raw_response

    db.commit()
    db.refresh(reload)
    return reload


def retry_reload(
    db: Session, reload_id: int, user_id: int
) -> models.EzCashReload:
    repo = EzCashRepository(db)
    reload = repo.get_by_id(reload_id)
    if not reload:
        raise HTTPException(status_code=404, detail="Reload not found")
    if reload.status not in (
        models.EzCashStatus.FAILED.value,
        models.EzCashStatus.CANCELLED.value,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry a {reload.status} transaction",
        )

    provider = get_provider()
    result = provider.reload(reload.normalized_phone, reload.amount, reload.reference_number)

    if result.success:
        reload.status = models.EzCashStatus.SUCCESSFUL.value
        reload.provider_reference = result.provider_reference
        reload.provider_response = result.raw_response
        reload.failure_reason = None
    else:
        reload.status = models.EzCashStatus.FAILED.value
        reload.failure_reason = result.failure_reason
        reload.provider_response = result.raw_response

    db.commit()
    db.refresh(reload)
    return reload


def cancel_reload(
    db: Session, reload_id: int, user_id: int
) -> models.EzCashReload:
    repo = EzCashRepository(db)
    reload = repo.get_by_id(reload_id)
    if not reload:
        raise HTTPException(status_code=404, detail="Reload not found")
    if reload.status != models.EzCashStatus.PENDING.value:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a {reload.status} transaction",
        )
    reload.status = models.EzCashStatus.CANCELLED.value
    db.commit()
    db.refresh(reload)
    return reload


def list_reloads(db: Session, **kwargs) -> tuple:
    repo = EzCashRepository(db)
    return repo.list_filtered(**kwargs)


def get_reload(db: Session, reload_id: int) -> models.EzCashReload:
    repo = EzCashRepository(db)
    reload = repo.get_by_id(reload_id)
    if not reload:
        raise HTTPException(status_code=404, detail="Reload not found")
    return reload


def daily_summary(db: Session, **kwargs) -> dict:
    repo = EzCashRepository(db)
    return repo.daily_summary(**kwargs)


def cashier_summary(db: Session, **kwargs) -> list:
    repo = EzCashRepository(db)
    return repo.cashier_summary(**kwargs)
