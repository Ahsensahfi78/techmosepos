from typing import Optional, Type, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

M = TypeVar("M", bound=BaseModel)
U = TypeVar("U", bound=BaseModel)
O = TypeVar("O", bound=BaseModel)


def _crud_router(
    entity: str,
    model: Type,
    create_schema: Type[M],
    update_schema: Type[U],
    out_schema: Type[O],
    write_perm: str,
    read_perm: str,
) -> APIRouter:
    router = APIRouter(prefix=f"/{entity}", tags=[entity])

    def _unique_check(db: Session, name: str, exclude_id: Optional[int] = None) -> None:
        query = db.query(model).filter(model.name == name)
        if exclude_id is not None:
            query = query.filter(model.id != exclude_id)
        if query.first():
            raise HTTPException(status_code=400, detail=f"{entity[:-1].title()} name already exists")

    @router.get("", response_model=schemas.Paginated[out_schema])
    def list_items(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=200),
        search: str | None = Query(default=None),
        db: Session = Depends(get_db),
        _: models.User = Depends(require_permission(read_perm)),
    ):
        query = db.query(model)
        if search:
            query = query.filter(model.name.ilike(f"%{search}%"))
        total = query.count()
        items = (
            query.order_by(model.name.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        total_pages = (total + page_size - 1) // page_size if total else 0
        return schemas.Paginated[out_schema](
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    @router.post("", response_model=out_schema, status_code=201)
    def create_item(
        data: create_schema,
        db: Session = Depends(get_db),
        current: models.User = Depends(require_permission(write_perm)),
    ):
        _unique_check(db, data.name)
        obj = model(**data.model_dump())
        db.add(obj)
        db.commit()
        db.refresh(obj)
        AuditLogRepository(db).log(
            action=f"{entity}.create",
            entity_type=entity,
            entity_id=obj.id,
            user_id=current.id,
            details=f"Created {entity[:-1]} '{obj.name}'",
        )
        return obj

    @router.get("/{item_id}", response_model=out_schema)
    def get_item(
        item_id: int,
        db: Session = Depends(get_db),
        _: models.User = Depends(require_permission(read_perm)),
    ):
        obj = db.get(model, item_id)
        if obj is None:
            raise HTTPException(status_code=404, detail=f"{entity[:-1].title()} not found")
        return obj

    @router.patch("/{item_id}", response_model=out_schema)
    def update_item(
        item_id: int,
        data: update_schema,
        db: Session = Depends(get_db),
        current: models.User = Depends(require_permission(write_perm)),
    ):
        obj = db.get(model, item_id)
        if obj is None:
            raise HTTPException(status_code=404, detail=f"{entity[:-1].title()} not found")
        payload = data.model_dump(exclude_unset=True)
        if "name" in payload and payload["name"] != obj.name:
            _unique_check(db, payload["name"], exclude_id=obj.id)
        for field, value in payload.items():
            if value is not None:
                setattr(obj, field, value)
        db.commit()
        db.refresh(obj)
        AuditLogRepository(db).log(
            action=f"{entity}.update",
            entity_type=entity,
            entity_id=obj.id,
            user_id=current.id,
            details=f"Updated {entity[:-1]} '{obj.name}'",
        )
        return obj

    @router.delete("/{item_id}", status_code=204)
    def delete_item(
        item_id: int,
        db: Session = Depends(get_db),
        current: models.User = Depends(require_permission(write_perm)),
    ):
        obj = db.get(model, item_id)
        if obj is None:
            raise HTTPException(status_code=404, detail=f"{entity[:-1].title()} not found")
        AuditLogRepository(db).log(
            action=f"{entity}.delete",
            entity_type=entity,
            entity_id=obj.id,
            user_id=current.id,
            details=f"Deleted {entity[:-1]} '{obj.name}'",
        )
        db.delete(obj)
        db.commit()
        return None

    return router


categories_router = _crud_router(
    "categories",
    models.Category,
    schemas.CategoryCreate,
    schemas.CategoryUpdate,
    schemas.CategoryOut,
    write_perm="product.manage",
    read_perm="product.view",
)

brands_router = _crud_router(
    "brands",
    models.Brand,
    schemas.BrandCreate,
    schemas.BrandUpdate,
    schemas.BrandOut,
    write_perm="product.manage",
    read_perm="product.view",
)

departments_router = _crud_router(
    "departments",
    models.Department,
    schemas.DepartmentCreate,
    schemas.DepartmentUpdate,
    schemas.DepartmentOut,
    write_perm="product.manage",
    read_perm="product.view",
)

warehouses_router = _crud_router(
    "warehouses",
    models.Warehouse,
    schemas.WarehouseCreate,
    schemas.WarehouseUpdate,
    schemas.WarehouseOut,
    write_perm="warehouse.manage",
    read_perm="warehouse.view",
)

suppliers_router = _crud_router(
    "suppliers",
    models.Supplier,
    schemas.SupplierCreate,
    schemas.SupplierUpdate,
    schemas.SupplierOut,
    write_perm="supplier.manage",
    read_perm="supplier.view",
)

customers_router = _crud_router(
    "customers",
    models.Customer,
    schemas.CustomerCreate,
    schemas.CustomerUpdate,
    schemas.CustomerOut,
    write_perm="customer.manage",
    read_perm="customer.view",
)
