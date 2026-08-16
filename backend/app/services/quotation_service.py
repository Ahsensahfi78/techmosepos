from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from . import sales_service


def _next_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.Quotation)
        .filter(models.Quotation.quotation_number.like(f"QT-{today}%"))
        .count()
    )
    return f"QT-{today}-{count + 1:03d}"


def _round2(v: float) -> float:
    return round(float(v or 0), 2)


def _get_product(db: Session, product_id: int) -> models.Product:
    product = db.get(models.Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product #{product_id} not found")
    return product


def _get_quotation(db: Session, quotation_id: int) -> models.Quotation:
    quotation = db.get(models.Quotation, quotation_id)
    if quotation is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return quotation


def create_quotation(
    db: Session,
    data: schemas.QuotationIn,
    user_id: int | None = None,
) -> models.Quotation:
    if data.customer_id is not None:
        customer = db.get(models.Customer, data.customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found")

    items = []
    subtotal = 0.0
    for line in data.items:
        product = _get_product(db, line.product_id)
        line_total = _round2(line.qty * line.price)
        subtotal += line_total
        items.append(
            models.QuotationItem(
                product_id=product.id,
                qty=line.qty,
                price=_round2(line.price),
                line_total=line_total,
            )
        )

    subtotal = _round2(subtotal)
    tax_amount = _round2((subtotal - data.discount_amount) * data.tax_rate / 100)
    total = _round2(subtotal - data.discount_amount + tax_amount)

    quotation = models.Quotation(
        quotation_number=_next_number(db),
        customer_id=data.customer_id,
        status=data.status,
        subtotal=subtotal,
        discount_amount=_round2(data.discount_amount),
        tax_amount=tax_amount,
        total=total,
        notes=data.notes,
        valid_until=data.valid_until,
        created_by=user_id,
        items=items,
    )
    db.add(quotation)
    db.commit()
    db.refresh(quotation)
    return quotation


def convert_quotation(
    db: Session,
    quotation_id: int,
    payment_method: str,
    paid: float,
    user_id: int | None = None,
) -> models.Sale:
    quotation = _get_quotation(db, quotation_id)
    if quotation.status == models.QuotationStatus.CONVERTED.value:
        raise HTTPException(status_code=400, detail="Quotation is already converted")
    if quotation.status == models.QuotationStatus.CANCELLED.value:
        raise HTTPException(status_code=400, detail="Cannot convert a cancelled quotation")

    sale_data = schemas.SaleIn(
        items=[
            schemas.SaleItemIn(product_id=i.product_id, qty=i.qty, price=i.price)
            for i in quotation.items
        ],
        customer_id=quotation.customer_id,
        discount_amount=quotation.discount_amount,
        tax_amount=quotation.tax_amount,
        payment_method=payment_method,
        paid_amount=paid,
    )
    sale = sales_service.create_sale(db, sale_data, user_id=user_id)

    quotation.status = models.QuotationStatus.CONVERTED.value
    quotation.converted_sale_id = sale.id
    db.commit()
    return sale


def list_quotations(
    db: Session,
    page: int,
    page_size: int,
    status: str | None = None,
):
    query = db.query(models.Quotation)
    if status:
        query = query.filter(models.Quotation.status == status)
    total = query.count()
    items = (
        query.order_by(models.Quotation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total, -(-total // page_size)
