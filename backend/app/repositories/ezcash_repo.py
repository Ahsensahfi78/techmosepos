from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models


class EzCashRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, **kwargs) -> models.EzCashReload:
        reload = models.EzCashReload(**kwargs)
        self.db.add(reload)
        self.db.commit()
        self.db.refresh(reload)
        return reload

    def get_by_id(self, reload_id: int) -> Optional[models.EzCashReload]:
        return self.db.get(models.EzCashReload, reload_id)

    def get_by_reference(self, reference: str) -> Optional[models.EzCashReload]:
        return (
            self.db.query(models.EzCashReload)
            .filter(models.EzCashReload.reference_number == reference)
            .first()
        )

    def get_by_idempotency_key(self, key: str) -> Optional[models.EzCashReload]:
        return (
            self.db.query(models.EzCashReload)
            .filter(models.EzCashReload.idempotency_key == key)
            .first()
        )

    def list_filtered(
        self,
        phone: Optional[str] = None,
        reference: Optional[str] = None,
        status: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        created_by: Optional[int] = None,
        amount_min: Optional[float] = None,
        amount_max: Optional[float] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple:
        q = self.db.query(models.EzCashReload)
        if phone:
            q = q.filter(
                models.EzCashReload.normalized_phone.ilike(f"%{phone}%")
                | models.EzCashReload.phone_number.ilike(f"%{phone}%")
            )
        if reference:
            q = q.filter(
                models.EzCashReload.reference_number.ilike(f"%{reference}%")
            )
        if status:
            q = q.filter(models.EzCashReload.status == status)
        if date_from:
            q = q.filter(models.EzCashReload.created_at >= date_from)
        if date_to:
            q = q.filter(models.EzCashReload.created_at <= date_to + " 23:59:59")
        if created_by is not None:
            q = q.filter(models.EzCashReload.created_by == created_by)
        if amount_min is not None:
            q = q.filter(models.EzCashReload.amount >= amount_min)
        if amount_max is not None:
            q = q.filter(models.EzCashReload.amount <= amount_max)

        total = q.count()
        items = (
            q.order_by(models.EzCashReload.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    def daily_summary(
        self, date_from: Optional[str] = None, date_to: Optional[str] = None
    ) -> dict:
        q = self.db.query(models.EzCashReload)
        if date_from:
            q = q.filter(models.EzCashReload.created_at >= date_from)
        if date_to:
            q = q.filter(models.EzCashReload.created_at <= date_to + " 23:59:59")

        rows = q.all()
        return {
            "date_from": date_from or "",
            "date_to": date_to or "",
            "total_reloads": len(rows),
            "successful": sum(1 for r in rows if r.status == "successful"),
            "failed": sum(1 for r in rows if r.status == "failed"),
            "cancelled": sum(1 for r in rows if r.status == "cancelled"),
            "pending": sum(1 for r in rows if r.status == "pending"),
            "total_amount": sum(r.amount for r in rows),
            "successful_amount": sum(
                r.amount for r in rows if r.status == "successful"
            ),
        }

    def cashier_summary(
        self, date_from: Optional[str] = None, date_to: Optional[str] = None
    ) -> list:
        q = (
            self.db.query(
                models.EzCashReload.created_by,
                func.count(models.EzCashReload.id).label("total_reloads"),
                func.sum(
                    func.cast(
                        models.EzCashReload.status == "successful", models.Integer
                    )
                ).label("successful"),
                func.sum(
                    func.cast(
                        models.EzCashReload.status == "failed", models.Integer
                    )
                ).label("failed"),
                func.coalesce(
                    func.sum(models.EzCashReload.amount), 0
                ).label("total_amount"),
            )
            .group_by(models.EzCashReload.created_by)
        )
        if date_from:
            q = q.filter(models.EzCashReload.created_at >= date_from)
        if date_to:
            q = q.filter(models.EzCashReload.created_at <= date_to + " 23:59:59")

        results = []
        for row in q.all():
            user = self.db.get(models.User, row.created_by) if row.created_by else None
            results.append(
                {
                    "user_id": row.created_by or 0,
                    "name": user.full_name if user else "Unknown",
                    "total_reloads": row.total_reloads,
                    "successful": row.successful or 0,
                    "failed": row.failed or 0,
                    "total_amount": float(row.total_amount or 0),
                }
            )
        return results
