import math
from typing import Optional

from sqlalchemy.orm import Session

from .. import models


class AuditLogRepository:
    def __init__(self, db: Session):
        self.db = db

    def log(
        self,
        action: str,
        entity_type: str,
        entity_id: Optional[int] = None,
        user_id: Optional[int] = None,
        details: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> models.AuditLog:
        entry = models.AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
            ip_address=ip_address,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return entry

    def get_all(
        self,
        search: Optional[str] = None,
        entity_type: Optional[str] = None,
        user_id: Optional[int] = None,
        page: int = 1,
        page_size: int = 50,
    ):
        query = self.db.query(models.AuditLog)

        if entity_type:
            query = query.filter(models.AuditLog.entity_type == entity_type)
        if user_id:
            query = query.filter(models.AuditLog.user_id == user_id)
        if search:
            query = query.filter(
                models.AuditLog.action.ilike(f"%{search}%")
                | models.AuditLog.details.ilike(f"%{search}%")
            )

        total = query.count()
        items = (
            query.order_by(models.AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        total_pages = math.ceil(total / page_size) if total > 0 else 0
        return items, total, total_pages


class StockTransactionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        product_id: int,
        change_qty: int,
        previous_stock: int,
        new_stock: int,
        reason: str,
        reference_id: Optional[int] = None,
    ) -> models.StockTransaction:
        tx = models.StockTransaction(
            product_id=product_id,
            change_qty=change_qty,
            previous_stock=previous_stock,
            new_stock=new_stock,
            reason=reason,
            reference_id=reference_id,
        )
        self.db.add(tx)
        self.db.flush()
        return tx

    def get_for_product(self, product_id: int, limit: int = 50):
        return (
            self.db.query(models.StockTransaction)
            .filter(models.StockTransaction.product_id == product_id)
            .order_by(models.StockTransaction.created_at.desc())
            .limit(limit)
            .all()
        )
