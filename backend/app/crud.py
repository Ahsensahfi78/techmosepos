from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas
from .services import product_code_service


def get_product(db: Session, product_id: int) -> models.Product:
    product = db.get(models.Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def get_products(
    db: Session, search: str | None = None, category: str | None = None
) -> list[models.Product]:
    query = db.query(models.Product)
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                models.Product.name.ilike(term),
                models.Product.category.ilike(term),
                models.Product.sku.ilike(term),
                models.Product.barcode.ilike(term),
                models.Product.model.ilike(term),
            )
        )
    if category:
        query = query.filter(models.Product.category == category)
    return query.order_by(models.Product.name).all()


def create_product(db: Session, data: schemas.ProductCreate, branch_id: int | None = None) -> models.Product:
    payload = data.model_dump(exclude={"auto_generate", "branch_id"})
    sku = (payload.get("sku") or "").strip() or None
    barcode = (payload.get("barcode") or "").strip() or None

    if sku is None:
        sku = product_code_service.next_product_code(db)
    elif data.auto_generate and product_code_service.find_code_conflict(db, sku) is not None:
        # Displayed code was taken between generation and save (offline queue
        # or a concurrent user) — issue a fresh one instead of failing.
        sku = product_code_service.next_product_code(db)

    # When auto-generating, barcode always mirrors the final SKU to avoid
    # cross-field conflicts (e.g. barcode still holding the old conflicted code).
    if data.auto_generate:
        barcode = sku
    elif barcode is None:
        barcode = sku

    product_code_service.validate_product_codes(db, sku=sku, barcode=barcode)

    payload["sku"] = sku
    payload["barcode"] = barcode

    for attempt in range(3):
        product = models.Product(**payload)
        db.add(product)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if not data.auto_generate:
                raise HTTPException(
                    status_code=400,
                    detail="Product code or barcode already exists. Choose different values.",
                )
            payload["sku"] = product_code_service.next_product_code(db)
            payload["barcode"] = payload["sku"]
            continue
        db.refresh(product)

        # Create initial branch_stock row at the entered stock quantity for the
        # receiving branch.  products.stock is a derived aggregate (SUM of
        # branch_stocks.quantity) kept in sync by DB triggers, so we must seed
        # branch_stocks with the stock the user actually entered — otherwise the
        # trigger immediately resets products.stock back to 0.
        if branch_id is not None:
            initial_qty = int(payload.get("stock") or 0)
            db.add(
                models.BranchStock(
                    branch_id=branch_id,
                    product_id=product.id,
                    quantity=initial_qty,
                    reserved_quantity=0,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
            )
            db.commit()

        return product
    raise HTTPException(status_code=400, detail="Could not create a unique product code")


def update_product(
    db: Session, product_id: int, data: schemas.ProductUpdate
) -> models.Product:
    product = get_product(db, product_id)
    payload = data.model_dump(exclude_unset=True)
    if "sku" in payload:
        payload["sku"] = (payload.get("sku") or "").strip() or None
    if "barcode" in payload:
        payload["barcode"] = (payload.get("barcode") or "").strip() or None
    product_code_service.validate_product_codes(
        db,
        sku=payload.get("sku"),
        barcode=payload.get("barcode"),
        exclude_id=product_id,
    )
    for field, value in payload.items():
        setattr(product, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Product code or barcode already exists. Choose different values.",
        )
    db.refresh(product)
    return product


def delete_product(db: Session, product_id: int) -> None:
    product = get_product(db, product_id)
    db.delete(product)
    db.commit()


def create_sale(db: Session, data: schemas.SaleIn) -> models.Sale:
    """Legacy sale creation — stock is now handled by StockService.

    This function is kept for backward compatibility but no longer writes
    to products.stock. Use sales_service.create_sale (which routes through
    StockService) for all new sales.
    """
    if not data.items:
        raise HTTPException(status_code=400, detail="Sale must contain items")

    sale = models.Sale(total=0.0)
    db.add(sale)
    db.flush()

    total = 0.0
    for item in data.items:
        product = db.get(models.Product, item.product_id)
        if product is None:
            db.rollback()
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")

        # NOTE: stock deduction is now handled by StockService.apply in
        # sales_service.create_sale. Do NOT write product.stock here.
        line_total = product.price * item.qty
        total += line_total

        db.add(
            models.SaleItem(
                sale_id=sale.id,
                product_id=product.id,
                qty=item.qty,
                price=product.price,
            )
        )

    sale.total = round(total, 2)
    db.commit()
    db.refresh(sale)
    return sale


def get_sales(db: Session, limit: int = 100) -> list[models.Sale]:
    return db.query(models.Sale).order_by(models.Sale.created_at.desc()).limit(limit).all()


def product_to_dict(product: models.Product) -> dict:
    return {
        "id": product.id,
        "name": product.name,
        "price": product.price,
        "stock": product.stock,
        "category": product.category,
        "sku": product.sku,
        "barcode": product.barcode,
        "model": product.model,
        "image_url": product.image_url,
        "min_stock": product.min_stock,
        "track_imei": product.track_imei,
        "warranty_months": product.warranty_months,
    }
