from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from . import ledger_service


def _add_months(dt: datetime, months: int) -> Optional[datetime]:
    if not months or months <= 0:
        return None
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return dt.replace(year=year, month=month, day=day)


def _next_return_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    count = (
        db.query(models.SaleReturn)
        .filter(models.SaleReturn.return_number.like(f"SRT-{today}%"))
        .count()
    )
    return f"SRT-{today}-{count + 1:03d}"


def _round2(v: float) -> float:
    return round(float(v or 0), 2)


def _get_product(db: Session, product_id: int) -> models.Product:
    product = db.get(models.Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product


def _get_customer(db: Session, customer_id: int) -> models.Customer:
    customer = db.get(models.Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


def _resolve_units(db: Session, product_id: int, imeis: list[str]) -> list[models.ProductUnit]:
    if not imeis:
        return []
    units = (
        db.query(models.ProductUnit)
        .filter(
            models.ProductUnit.product_id == product_id,
            models.ProductUnit.imei.in_(imeis),
            models.ProductUnit.status == models.UnitStatus.IN_STOCK.value,
        )
        .all()
    )
    found = {u.imei: u for u in units}
    for imei in imeis:
        if imei not in found:
            raise HTTPException(
                status_code=400,
                detail=f"IMEI '{imei}' not found or not in stock for this product",
            )
    return units


def create_sale(
    db: Session,
    data,
    user_id: Optional[int] = None,
) -> models.Sale:
    if not data.items:
        raise HTTPException(status_code=400, detail="Sale must contain items")

    customer = None
    if data.customer_id is not None:
        customer = _get_customer(db, data.customer_id)

    sale_items = []
    subtotal = 0.0
    for line in data.items:
        product = _get_product(db, line.product_id)
        if product.stock < line.qty:
            raise HTTPException(
                status_code=400,
                detail=f"Not enough stock for '{product.name}' (available: {product.stock})",
            )
        if product.track_imei:
            if len(line.imeis or []) != line.qty:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Product '{product.name}' tracks IMEI: provide exactly "
                        f"{line.qty} IMEI(s), got {len(line.imeis or [])}"
                    ),
                )
            units = _resolve_units(db, product.id, line.imeis)
            line._units = units
        price = _round2(line.price) if line.price is not None else _round2(product.price)
        line_total = _round2(line.qty * price)
        subtotal += line_total
        sale_items.append(
            models.SaleItem(
                product_id=product.id,
                qty=line.qty,
                price=price,
                line_total=line_total,
            )
        )

    subtotal = _round2(subtotal)
    total = _round2(subtotal - data.discount_amount + data.tax_amount)

    loyalty_points_used = 0
    if customer and data.loyalty_points_used > 0:
        if data.loyalty_points_used > customer.loyalty_points:
            raise HTTPException(
                status_code=400,
                detail=f"Customer has only {customer.loyalty_points} loyalty points",
            )
        loyalty_points_used = min(
            data.loyalty_points_used, max(0, int(total))
        )
        customer.loyalty_points = max(0, (customer.loyalty_points or 0) - loyalty_points_used)
        total = _round2(total - loyalty_points_used)
    total = max(0.0, total)

    if data.paid_amount is not None:
        paid_amount = _round2(data.paid_amount)
    elif data.payments:
        paid_amount = _round2(sum(p.amount for p in data.payments))
    elif customer:
        paid_amount = 0.0
    else:
        paid_amount = total
    if customer and paid_amount > total + 0.001:
        # Credit sales cannot be overpaid; cap the tendered amount at the total.
        paid_amount = total

    payments = data.payments or []
    if payments and len(payments) > 1:
        payment_method = "split"
    elif payments:
        payment_method = payments[0].method
    else:
        payment_method = data.payment_method

    sale = models.Sale(
        customer_id=customer.id if customer else None,
        status=models.SaleStatus.COMPLETED.value,
        subtotal=subtotal,
        discount_amount=_round2(data.discount_amount),
        tax_amount=_round2(data.tax_amount),
        total=total,
        paid_amount=paid_amount,
        payment_method=payment_method,
        loyalty_points_used=loyalty_points_used,
        created_by=user_id,
        items=sale_items,
    )
    db.add(sale)
    db.flush()

    for item, line in zip(sale.items, data.items):
        product = _get_product(db, item.product_id)
        prev = product.stock or 0
        product.stock = prev - item.qty
        db.add(
            models.StockTransaction(
                product_id=item.product_id,
                change_qty=-item.qty,
                previous_stock=prev,
                new_stock=product.stock,
                reason="sale",
                reference_id=sale.id,
            )
        )
        if product.track_imei:
            units = getattr(line, "_units", None)
            if not units:
                raise HTTPException(
                    status_code=400,
                    detail=f"Product '{product.name}' requires IMEI tracking",
                )
            now = datetime.utcnow()
            months = product.warranty_months or 0
            for unit in units:
                unit.status = models.UnitStatus.SOLD.value
                unit.sale_item_id = item.id
                unit.sold_at = now
                if months:
                    unit.warranty_start = now
                    unit.warranty_expiry = _add_months(now, months)

    if customer:
        if total > 0:
            ledger_service.post_ledger_entry(
                db,
                party_type="customer",
                party_id=customer.id,
                entry_type="sale",
                amount=total,
                direction="debit",
                reference=f"SALE-{sale.id}",
                reference_id=sale.id,
                note=f"Sale #{sale.id}",
                user_id=user_id,
            )
        if paid_amount > 0:
            if payments:
                for p in payments:
                    if p.amount <= 0:
                        continue
                    ledger_service.record_payment(
                        db,
                        party_type="customer",
                        party_id=customer.id,
                        amount=_round2(p.amount),
                        method=p.method,
                        reference=f"SALE-{sale.id}",
                        note=f"Split payment for sale #{sale.id}",
                        user_id=user_id,
                    )
            else:
                ledger_service.record_payment(
                    db,
                    party_type="customer",
                    party_id=customer.id,
                    amount=paid_amount,
                    method=payment_method or "cash",
                    reference=f"SALE-{sale.id}",
                    note=f"Payment for sale #{sale.id}",
                    user_id=user_id,
                )
        awarded = int(total)
        if awarded > 0:
            customer.loyalty_points = (customer.loyalty_points or 0) + awarded

    db.commit()
    db.refresh(sale)
    return sale


def get_sale(db: Session, sale_id: int) -> models.Sale:
    sale = db.get(models.Sale, sale_id)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


def list_sales(
    db: Session,
    limit: int = 100,
    status: Optional[str] = None,
    customer_id: Optional[int] = None,
) -> list[models.Sale]:
    query = db.query(models.Sale)
    if status:
        query = query.filter(models.Sale.status == status)
    if customer_id:
        query = query.filter(models.Sale.customer_id == customer_id)
    return query.order_by(models.Sale.created_at.desc()).limit(limit).all()


def record_sale_payment(
    db: Session,
    sale_id: int,
    data,
    user_id: Optional[int] = None,
) -> models.Payment:
    sale = get_sale(db, sale_id)
    if sale.customer_id is None:
        raise HTTPException(status_code=400, detail="Walk-in sale is not on credit")
    due = _round2(sale.total - sale.paid_amount)
    if data.amount > due + 0.001:
        raise HTTPException(
            status_code=400, detail=f"Amount exceeds outstanding balance of {due}"
        )

    payment = ledger_service.record_payment(
        db,
        party_type="customer",
        party_id=sale.customer_id,
        amount=data.amount,
        method=data.method,
        reference=data.reference or f"SALE-{sale.id}",
        note=data.note or f"Payment for sale #{sale.id}",
        payment_date=data.payment_date,
        user_id=user_id,
    )
    sale.paid_amount = _round2(sale.paid_amount + data.amount)
    db.commit()
    db.refresh(payment)
    return payment


def _get_returned_qty(db: Session, sale_id: int) -> dict:
    rows = (
        db.query(models.SaleReturnItem, models.SaleReturn)
        .join(models.SaleReturn, models.SaleReturn.id == models.SaleReturnItem.return_id)
        .filter(models.SaleReturn.sale_id == sale_id)
        .all()
    )
    out: dict[int, int] = {}
    for item, _ in rows:
        out[item.product_id] = out.get(item.product_id, 0) + item.qty
    return out


def create_sale_return(
    db: Session,
    sale_id: int,
    data,
    user_id: Optional[int] = None,
) -> models.SaleReturn:
    sale = get_sale(db, sale_id)
    sale_items = {i.product_id: i for i in sale.items}
    returned = _get_returned_qty(db, sale_id)

    return_items = []
    total = 0.0
    for line in data.items:
        si = sale_items.get(line.product_id)
        if si is None:
            raise HTTPException(
                status_code=400, detail=f"Product {line.product_id} was not on this sale"
            )
        available = si.qty - returned.get(line.product_id, 0)
        if line.qty <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        if line.qty > available:
            raise HTTPException(
                status_code=400,
                detail=f"Product {si.product.name if si.product else line.product_id}: only {available} returnable",
            )
        line_total = _round2(line.qty * si.price)
        total += line_total
        return_items.append(
            models.SaleReturnItem(
                product_id=line.product_id,
                qty=line.qty,
                price=si.price,
                line_total=line_total,
            )
        )

    ret = models.SaleReturn(
        return_number=_next_return_number(db),
        sale_id=sale.id,
        customer_id=sale.customer_id,
        return_date=data.return_date or datetime.utcnow(),
        reason=data.reason,
        total=_round2(total),
        created_by=user_id,
        items=return_items,
    )
    db.add(ret)
    db.flush()

    for line in data.items:
        product = _get_product(db, line.product_id)
        prev = product.stock or 0
        product.stock = prev + line.qty
        db.add(
            models.StockTransaction(
                product_id=line.product_id,
                change_qty=line.qty,
                previous_stock=prev,
                new_stock=product.stock,
                reason="sale_return",
                reference_id=ret.id,
            )
        )

    if sale.customer_id:
        ledger_service.post_ledger_entry(
            db,
            party_type="customer",
            party_id=sale.customer_id,
            entry_type="return",
            amount=ret.total,
            direction="credit",
            reference=ret.return_number,
            reference_id=ret.id,
            note=f"Sale return {ret.return_number}",
            entry_date=ret.return_date,
            user_id=user_id,
        )
        clawback = int(ret.total)
        if clawback > 0:
            customer = _get_customer(db, sale.customer_id)
            customer.loyalty_points = max(
                0, (customer.loyalty_points or 0) - clawback
            )

    returned_map = _get_returned_qty(db, sale.id)
    returned_total = 0.0
    for si in sale.items:
        returned_total += (returned_map.get(si.product_id, 0)) * si.price
    if returned_total + 0.001 >= (sale.total or 0):
        sale.status = models.SaleStatus.RETURNED.value
    else:
        sale.status = models.SaleStatus.PARTIAL.value

    db.commit()
    db.refresh(ret)
    return ret


def list_sale_returns(
    db: Session,
    limit: int = 100,
    sale_id: Optional[int] = None,
    customer_id: Optional[int] = None,
) -> list[models.SaleReturn]:
    query = db.query(models.SaleReturn)
    if sale_id:
        query = query.filter(models.SaleReturn.sale_id == sale_id)
    if customer_id:
        query = query.filter(models.SaleReturn.customer_id == customer_id)
    return query.order_by(models.SaleReturn.return_date.desc()).limit(limit).all()
