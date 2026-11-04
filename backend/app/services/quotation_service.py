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


def _round2(v: float | None) -> float:
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


def _resolve_customer_info(db: Session, customer_id: int | None, name: str | None, phone: str | None, address: str | None, ctype: str | None):
    customer = db.get(models.Customer, customer_id) if customer_id else None
    res_name = name or (customer.name if customer else None)
    res_phone = phone or (customer.phone if customer else None)
    res_address = address or (customer.address if customer else None)
    res_type = ctype or (customer.customer_type if customer and customer.customer_type else "Retail")
    return res_name, res_phone, res_address, res_type


def create_quotation(
    db: Session,
    data: schemas.QuotationIn,
    user_id: int | None = None,
) -> models.Quotation:
    cust_name, cust_phone, cust_address, cust_type = _resolve_customer_info(
        db, data.customer_id, data.customer_name, data.customer_phone, data.customer_address, data.customer_type
    )

    items = []
    line_subtotal = 0.0
    line_discounts = 0.0
    line_taxes = 0.0

    for line in data.items:
        product = db.get(models.Product, line.product_id) if line.product_id else None
        p_name = line.product_name or (product.name if product else "Item")
        p_type = line.product_type or (product.product_type if product and product.product_type else "Goods")
        p_unit = line.unit or (product.unit if product and product.unit else "pcs")
        qty = float(line.qty)
        price = _round2(line.price)
        disc = _round2(line.discount)
        tax = _round2(line.tax)
        line_tot = _round2(line.line_total) if line.line_total is not None else _round2(qty * price - disc + tax)

        line_subtotal += qty * price
        line_discounts += disc
        line_taxes += tax

        items.append(
            models.QuotationItem(
                product_id=product.id if product else None,
                product_name=p_name,
                product_type=p_type,
                description=line.description,
                qty=qty,
                unit=p_unit,
                price=price,
                discount=disc,
                tax=tax,
                line_total=line_tot,
            )
        )

    subtotal = _round2(data.subtotal if data.subtotal is not None else line_subtotal)
    discount_amount = _round2(data.discount_amount if data.discount_amount else line_discounts)
    header_tax = _round2((subtotal - discount_amount) * (data.tax_rate or 0) / 100) if (data.tax_rate or 0) > 0 else 0.0
    tax_amount = _round2(data.tax_amount if data.tax_amount is not None else (header_tax + line_taxes))
    total = _round2(data.total if data.total is not None else (subtotal - discount_amount + tax_amount))

    quotation = models.Quotation(
        quotation_number=_next_number(db),
        customer_id=data.customer_id,
        customer_name=cust_name,
        customer_phone=cust_phone,
        customer_address=cust_address,
        customer_type=cust_type,
        status=data.status,
        subtotal=subtotal,
        tax_rate=_round2(data.tax_rate),
        discount_amount=discount_amount,
        tax_amount=tax_amount,
        total=total,
        notes=data.notes,
        terms=data.terms,
        valid_until=data.valid_until,
        created_by=user_id,
        items=items,
    )
    db.add(quotation)
    db.commit()
    db.refresh(quotation)
    return quotation


def update_quotation(
    db: Session,
    quotation_id: int,
    data: schemas.QuotationUpdateIn,
    user_id: int | None = None,
) -> models.Quotation:
    quotation = _get_quotation(db, quotation_id)
    if quotation.status == models.QuotationStatus.CONVERTED.value:
        raise HTTPException(status_code=400, detail="Converted quotations cannot be edited")

    if data.customer_id is not None:
        quotation.customer_id = data.customer_id
    if data.customer_name is not None:
        quotation.customer_name = data.customer_name
    if data.customer_phone is not None:
        quotation.customer_phone = data.customer_phone
    if data.customer_address is not None:
        quotation.customer_address = data.customer_address
    if data.customer_type is not None:
        quotation.customer_type = data.customer_type
    if data.status is not None:
        quotation.status = data.status
    if data.notes is not None:
        quotation.notes = data.notes
    if data.terms is not None:
        quotation.terms = data.terms
    if data.valid_until is not None:
        quotation.valid_until = data.valid_until
    if data.tax_rate is not None:
        quotation.tax_rate = _round2(data.tax_rate)

    if data.items is not None:
        quotation.items.clear()
        line_subtotal = 0.0
        line_discounts = 0.0
        line_taxes = 0.0

        for line in data.items:
            product = db.get(models.Product, line.product_id) if line.product_id else None
            p_name = line.product_name or (product.name if product else "Item")
            p_type = line.product_type or (product.product_type if product and product.product_type else "Goods")
            p_unit = line.unit or (product.unit if product and product.unit else "pcs")
            qty = float(line.qty)
            price = _round2(line.price)
            disc = _round2(line.discount)
            tax = _round2(line.tax)
            line_tot = _round2(line.line_total) if line.line_total is not None else _round2(qty * price - disc + tax)

            line_subtotal += qty * price
            line_discounts += disc
            line_taxes += tax

            quotation.items.append(
                models.QuotationItem(
                    product_id=product.id if product else None,
                    product_name=p_name,
                    product_type=p_type,
                    description=line.description,
                    qty=qty,
                    unit=p_unit,
                    price=price,
                    discount=disc,
                    tax=tax,
                    line_total=line_tot,
                )
            )

        subtotal = _round2(data.subtotal if data.subtotal is not None else line_subtotal)
        discount_amount = _round2(data.discount_amount if data.discount_amount is not None else line_discounts)
        header_tax = _round2((subtotal - discount_amount) * (quotation.tax_rate or 0) / 100) if (quotation.tax_rate or 0) > 0 else 0.0
        tax_amount = _round2(data.tax_amount if data.tax_amount is not None else (header_tax + line_taxes))
        total = _round2(data.total if data.total is not None else (subtotal - discount_amount + tax_amount))

        quotation.subtotal = subtotal
        quotation.discount_amount = discount_amount
        quotation.tax_amount = tax_amount
        quotation.total = total

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

    sale_items = []
    for i in quotation.items:
        if i.product_id:
            sale_items.append(
                schemas.SaleItemIn(
                    product_id=i.product_id,
                    qty=max(1, int(i.qty)),
                    price=i.price,
                    item_type="STOCK",
                    item_name=i.resolved_name or i.product_name,
                    line_discount=i.discount,
                )
            )
        else:
            sale_items.append(
                schemas.SaleItemIn(
                    product_id=None,
                    qty=max(1, int(i.qty)),
                    price=i.price,
                    item_type="CUSTOM",
                    item_name=i.resolved_name or i.product_name or "Custom Item",
                    line_discount=i.discount,
                )
            )

    sale_data = schemas.SaleIn(
        items=sale_items,
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
    q: str | None = None,
):
    query = db.query(models.Quotation)
    if status and status != "all":
        query = query.filter(models.Quotation.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (models.Quotation.quotation_number.ilike(like))
            | (models.Quotation.customer_name.ilike(like))
        )
    total = query.count()
    items = (
        query.order_by(models.Quotation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total, -(-total // page_size)
