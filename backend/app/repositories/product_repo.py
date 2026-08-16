import math
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models


class ProductRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, product_id: int) -> Optional[models.Product]:
        return self.db.query(models.Product).filter(
            models.Product.id == product_id,
            models.Product.is_active == True,
        ).first()

    def get_by_id_any(self, product_id: int) -> Optional[models.Product]:
        return self.db.get(models.Product, product_id)

    def get_all(
        self,
        search: Optional[str] = None,
        category: Optional[str] = None,
        sort_by: str = "name",
        sort_dir: str = "asc",
        page: int = 1,
        page_size: int = 50,
        include_inactive: bool = False,
    ):
        query = self.db.query(models.Product)

        if not include_inactive:
            query = query.filter(models.Product.is_active == True)

        if search:
            query = query.filter(
                or_(
                    models.Product.name.ilike(f"%{search}%"),
                    models.Product.category.ilike(f"%{search}%"),
                    models.Product.sku.ilike(f"%{search}%"),
                    models.Product.barcode.ilike(f"%{search}%"),
                )
            )

        if category:
            query = query.filter(models.Product.category == category)

        total = query.count()

        sort_column = getattr(models.Product, sort_by, models.Product.name)
        if sort_dir == "desc":
            sort_column = sort_column.desc()
        query = query.order_by(sort_column)

        items = query.offset((page - 1) * page_size).limit(page_size).all()

        return items, total, math.ceil(total / page_size) if total > 0 else 0

    def get_categories(self) -> list[str]:
        results = (
            self.db.query(models.Product.category)
            .filter(models.Product.is_active == True)
            .distinct()
            .all()
        )
        return [r[0] for r in results if r[0]]

    def create(self, **kwargs) -> models.Product:
        product = models.Product(**kwargs)
        self.db.add(product)
        self.db.commit()
        self.db.refresh(product)
        return product

    def update(self, product: models.Product, **kwargs) -> models.Product:
        for key, value in kwargs.items():
            if value is not None:
                setattr(product, key, value)
        self.db.commit()
        self.db.refresh(product)
        return product

    def soft_delete(self, product: models.Product) -> models.Product:
        product.is_active = False
        self.db.commit()
        self.db.refresh(product)
        return product

    def count(self) -> int:
        return self.db.query(models.Product).filter(models.Product.is_active == True).count()
