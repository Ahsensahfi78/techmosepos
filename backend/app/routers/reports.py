from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..services import ledger_service

router = APIRouter(prefix="/reports", tags=["reports"])

LOW_STOCK_THRESHOLD = 5


def _summary(product: models.Product, status: str) -> schemas.StockSummary:
    return schemas.StockSummary(
        id=product.id,
        name=product.name,
        category=product.category,
        price=product.price,
        stock=product.stock,
        status=status,
    )


@router.get("/reorder", response_model=list[schemas.ReorderItemOut])
def reorder_report(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    rows = (
        db.query(models.Product)
        .filter(models.Product.is_active.is_(True))
        .order_by(models.Product.stock.asc())
        .all()
    )
    out: list[schemas.ReorderItemOut] = []
    for p in rows:
        threshold = max(int(p.min_stock or 0), LOW_STOCK_THRESHOLD)
        if (p.stock or 0) > threshold:
            continue
        suggested_qty = max(threshold * 2, threshold + 10) - (p.stock or 0)
        out.append(
            schemas.ReorderItemOut(
                product_id=p.id,
                name=p.name,
                stock=p.stock or 0,
                min_stock=p.min_stock or 0,
                threshold=threshold,
                suggested_qty=max(suggested_qty, 0),
            )
        )
    return out


@router.get("/stock", response_model=schemas.ReportOut)
def stock_report(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    products = db.query(models.Product).all()

    low_stock = [
        _summary(p, "low")
        for p in products
        if 0 < p.stock <= max(int(p.min_stock or 0), LOW_STOCK_THRESHOLD)
    ]
    out_of_stock = [_summary(p, "out") for p in products if p.stock == 0]

    return schemas.ReportOut(
        total_products=len(products),
        total_units=sum(p.stock for p in products),
        total_value=round(sum(p.price * p.stock for p in products), 2),
        low_stock=low_stock,
        out_of_stock=out_of_stock,
    )


@router.get("/sales")
def sales_report(
    days: int | None = Query(default=None, ge=1, le=365),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    sale_query = db.query(models.Sale)
    if days is not None:
        since = datetime.utcnow() - timedelta(days=days)
        sale_query = sale_query.filter(models.Sale.created_at >= since)

    total_sales = sale_query.count()
    total_revenue = (
        sale_query.with_entities(func.coalesce(func.sum(models.Sale.total), 0))
        .scalar()
    )

    top = (
        db.query(
            models.Product.name,
            func.sum(models.SaleItem.qty).label("units_sold"),
            func.sum(models.SaleItem.qty * models.SaleItem.price).label("revenue"),
        )
        .join(models.SaleItem, models.SaleItem.product_id == models.Product.id)
        .group_by(models.Product.id)
        .order_by(func.sum(models.SaleItem.qty).desc())
        .limit(10)
        .all()
    )

    return {
        "total_sales": total_sales,
        "total_revenue": round(total_revenue, 2),
        "top_products": [
            {
                "name": row.name,
                "units_sold": int(row.units_sold),
                "revenue": round(row.revenue, 2),
            }
            for row in top
        ],
    }


@router.get("/dashboard")
def dashboard_report(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=6)

    def _range_sales(start: datetime) -> tuple[int, float]:
        query = db.query(
            func.count(models.Sale.id),
            func.coalesce(func.sum(models.Sale.total), 0),
        ).filter(models.Sale.created_at >= start)
        count, revenue = query.one()
        return int(count), round(revenue, 2)

    today_sales, today_revenue = _range_sales(today_start)
    week_sales, week_revenue = _range_sales(week_start)

    daily_rows = (
        db.query(
            func.date(models.Sale.created_at).label("day"),
            func.coalesce(func.sum(models.Sale.total), 0),
        )
        .filter(models.Sale.created_at >= week_start)
        .group_by("day")
        .all()
    )
    daily_map = {str(row.day): round(row[1], 2) for row in daily_rows}

    trend = []
    for i in range(7):
        day = (today_start - timedelta(days=6 - i)).date()
        trend.append(
            {"date": day.isoformat(), "revenue": daily_map.get(day.isoformat(), 0.0)}
        )

    products = db.query(models.Product).all()
    low_stock = [p for p in products if 0 < p.stock <= LOW_STOCK_THRESHOLD]
    out_of_stock = [p for p in products if p.stock == 0]

    recent = (
        db.query(models.Sale)
        .order_by(models.Sale.created_at.desc())
        .limit(5)
        .all()
    )

    return {
        "today_sales": today_sales,
        "today_revenue": today_revenue,
        "week_sales": week_sales,
        "week_revenue": week_revenue,
        "weekly_trend": trend,
        "low_stock_count": len(low_stock),
        "out_of_stock_count": len(out_of_stock),
        "low_stock": [_summary(p, "low") for p in low_stock],
        "recent_sales": [
            {
                "id": s.id,
                "total": s.total,
                "created_at": s.created_at.isoformat(),
                "items": [
                    {
                        "product_name": it.product_name,
                        "qty": it.qty,
                        "price": it.price,
                    }
                    for it in s.items
                ],
            }
            for s in recent
        ],
    }


@router.get("/cashiers")
def cashier_report(
    days: int | None = Query(default=None, ge=1, le=3650),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    since = (
        datetime.utcnow() - timedelta(days=days)
        if days is not None
        else datetime(1970, 1, 1)
    )

    items_sub = (
        db.query(
            models.Sale.created_by.label("user_id"),
            func.sum(models.SaleItem.qty).label("items_sold"),
        )
        .join(models.SaleItem, models.SaleItem.sale_id == models.Sale.id)
        .filter(models.Sale.created_at >= since)
        .group_by(models.Sale.created_by)
        .subquery()
    )

    rows = (
        db.query(
            models.User.id.label("user_id"),
            models.User.full_name.label("name"),
            func.count(models.Sale.id).label("orders"),
            func.coalesce(func.sum(models.Sale.total), 0).label("revenue"),
            func.coalesce(func.sum(models.Sale.discount_amount), 0).label(
                "discount_given"
            ),
            func.coalesce(items_sub.c.items_sold, 0).label("items_sold"),
        )
        .join(models.Sale, models.Sale.created_by == models.User.id)
        .outerjoin(items_sub, items_sub.c.user_id == models.User.id)
        .filter(models.Sale.created_at >= since)
        .group_by(models.User.id)
        .order_by(func.sum(models.Sale.total).desc())
        .all()
    )

    total_revenue = sum(float(r.revenue or 0) for r in rows)
    cashiers = []
    for r in rows:
        revenue = float(r.revenue or 0)
        orders = int(r.orders or 0)
        cashiers.append(
            {
                "user_id": r.user_id,
                "name": r.name or "Unknown",
                "orders": orders,
                "revenue": round(revenue, 2),
                "avg_order": round(revenue / orders, 2) if orders else 0.0,
                "discount_given": round(float(r.discount_given or 0), 2),
                "items_sold": int(r.items_sold or 0),
                "share_pct": (
                    round((revenue / total_revenue) * 100, 1)
                    if total_revenue
                    else 0.0
                ),
            }
        )

    return {"cashiers": cashiers}


@router.get("/taxes-discounts")
def tax_discount_report(
    days: int | None = Query(default=None, ge=1, le=3650),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    sale_query = db.query(
        func.count(models.Sale.id).label("orders"),
        func.coalesce(func.sum(models.Sale.total), 0).label("revenue"),
        func.coalesce(func.sum(models.Sale.discount_amount), 0).label(
            "discount_total"
        ),
        func.coalesce(func.sum(models.Sale.tax_amount), 0).label("tax_total"),
        func.coalesce(func.sum(models.Sale.loyalty_points_used), 0).label(
            "points_redeemed"
        ),
    )
    return_query = db.query(
        func.count(models.SaleReturn.id).label("returns"),
        func.coalesce(func.sum(models.SaleReturn.total), 0).label("refunded"),
    )
    if days is not None:
        since = datetime.utcnow() - timedelta(days=days)
        sale_query = sale_query.filter(models.Sale.created_at >= since)
        return_query = return_query.filter(models.SaleReturn.return_date >= since)

    orders, revenue, discount_total, tax_total, points = sale_query.one()
    return_count, refunded = return_query.one()

    return {
        "orders": int(orders),
        "revenue": round(float(revenue), 2),
        "discount_total": round(float(discount_total), 2),
        "tax_total": round(float(tax_total), 2),
        "points_redeemed": int(points),
        "returns": int(return_count),
        "refunded": round(float(refunded), 2),
    }


def _parse_day(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")


@router.get("/analytics")
def analytics_report(
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (inclusive)"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (inclusive)"),
    trend_days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Aggregated analytics for the dashboard.

    All widgets share a single date range. ``previous`` always refers to the
    period of equal length immediately before the selected range so the UI can
    show % change arrows.
    """
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    if date_from and date_to:
        start = _parse_day(date_from)
        end = _parse_day(date_to) + timedelta(days=1)
        if start > end - timedelta(days=1):
            end = start + timedelta(days=1)
    else:
        end = today + timedelta(days=1)
        start = end - timedelta(days=trend_days)
    span = end - start
    prev_start = start - span
    prev_end = start

    def _sales(start_dt: datetime, end_dt: datetime) -> tuple[int, float]:
        count, revenue = (
            db.query(
                func.count(models.Sale.id),
                func.coalesce(func.sum(models.Sale.total), 0),
            )
            .filter(models.Sale.created_at >= start_dt)
            .filter(models.Sale.created_at < end_dt)
            .one()
        )
        return int(count), round(revenue, 2)

    cur_orders, cur_revenue = _sales(start, end)
    prev_orders, prev_revenue = _sales(prev_start, prev_end)

    def _pct(cur: float, prev: float) -> float:
        if prev == 0:
            return 100.0 if cur > 0 else 0.0
        return round(((cur - prev) / prev) * 100, 1)

    # ── Revenue trend ────────────────────────────────────────────────
    trend_rows = (
        db.query(
            func.date(models.Sale.created_at).label("day"),
            func.count(models.Sale.id).label("orders"),
            func.coalesce(func.sum(models.Sale.total), 0).label("revenue"),
        )
        .filter(models.Sale.created_at >= start - timedelta(days=1))
        .filter(models.Sale.created_at < end)
        .group_by("day")
        .all()
    )
    trend_map = {str(r.day): r for r in trend_rows}
    trend = []
    for i in range(trend_days):
        day = (end - timedelta(days=trend_days - i)).date()
        row = trend_map.get(day.isoformat())
        trend.append(
            {
                "date": day.isoformat(),
                "revenue": round(float(row.revenue) if row else 0.0, 2),
                "orders": int(row.orders) if row else 0,
            }
        )

    # ── Top products ─────────────────────────────────────────────────
    top = (
        db.query(
            models.Product.id.label("product_id"),
            models.Product.name.label("name"),
            func.sum(models.SaleItem.qty).label("units_sold"),
            func.sum(models.SaleItem.line_total).label("revenue"),
            func.coalesce(
                func.sum(models.SaleItem.qty * models.Product.cost_price), 0
            ).label("cogs"),
        )
        .join(models.SaleItem, models.SaleItem.product_id == models.Product.id)
        .join(models.Sale, models.Sale.id == models.SaleItem.sale_id)
        .filter(models.Sale.created_at >= start)
        .filter(models.Sale.created_at < end)
        .group_by(models.Product.id)
        .order_by(func.sum(models.SaleItem.qty).desc())
        .limit(10)
        .all()
    )
    top_products = [
        {
            "product_id": r.product_id,
            "name": r.name,
            "units_sold": int(r.units_sold or 0),
            "revenue": round(float(r.revenue or 0), 2),
            "cogs": round(float(r.cogs or 0), 2),
        }
        for r in top
    ]

    # ── Category breakdown ───────────────────────────────────────────
    cat_rows = (
        db.query(
            models.Product.category.label("category"),
            func.coalesce(func.sum(models.SaleItem.qty), 0).label("units"),
            func.coalesce(func.sum(models.SaleItem.line_total), 0).label("revenue"),
        )
        .join(models.SaleItem, models.SaleItem.product_id == models.Product.id)
        .join(models.Sale, models.Sale.id == models.SaleItem.sale_id)
        .filter(models.Sale.created_at >= start)
        .filter(models.Sale.created_at < end)
        .group_by(models.Product.category)
        .order_by(func.sum(models.SaleItem.line_total).desc())
        .all()
    )
    category_breakdown = [
        {
            "category": r.category or "Uncategorized",
            "units": int(r.units or 0),
            "revenue": round(float(r.revenue or 0), 2),
        }
        for r in cat_rows
    ]

    # ── Payment method breakdown ─────────────────────────────────────
    pay_rows = (
        db.query(
            models.Sale.payment_method.label("method"),
            func.count(models.Sale.id).label("orders"),
            func.coalesce(func.sum(models.Sale.total), 0).label("amount"),
        )
        .filter(models.Sale.created_at >= start)
        .filter(models.Sale.created_at < end)
        .group_by(models.Sale.payment_method)
        .order_by(func.sum(models.Sale.total).desc())
        .all()
    )
    payment_breakdown = [
        {
            "method": (r.method or "unknown").lower(),
            "orders": int(r.orders or 0),
            "amount": round(float(r.amount or 0), 2),
        }
        for r in pay_rows
    ]

    # ── Customer insights ────────────────────────────────────────────
    total_customers = db.query(models.Customer).count()
    new_customers = (
        db.query(models.Customer)
        .filter(models.Customer.created_at >= start)
        .filter(models.Customer.created_at < end)
        .count()
    )
    active_customers = (
        db.query(func.count(func.distinct(models.Sale.customer_id)))
        .filter(models.Sale.created_at >= start)
        .filter(models.Sale.created_at < end)
        .filter(models.Sale.customer_id.isnot(None))
        .scalar()
        or 0
    )
    top_customers = (
        db.query(
            models.Customer.id.label("customer_id"),
            models.Customer.name.label("name"),
            models.Customer.phone.label("phone"),
            func.count(models.Sale.id).label("orders"),
            func.coalesce(func.sum(models.Sale.total), 0).label("spend"),
        )
        .join(models.Sale, models.Sale.customer_id == models.Customer.id)
        .filter(models.Sale.created_at >= start)
        .filter(models.Sale.created_at < end)
        .group_by(models.Customer.id)
        .order_by(func.sum(models.Sale.total).desc())
        .limit(5)
        .all()
    )

    # ── Profit (revenue vs COGS) ─────────────────────────────────────
    profit_rows = (
        db.query(
            models.Product.category.label("category"),
            func.coalesce(func.sum(models.SaleItem.line_total), 0).label("revenue"),
            func.coalesce(
                func.sum(models.SaleItem.qty * models.Product.cost_price), 0
            ).label("cogs"),
        )
        .join(models.SaleItem, models.SaleItem.product_id == models.Product.id)
        .join(models.Sale, models.Sale.id == models.SaleItem.sale_id)
        .filter(models.Sale.created_at >= start)
        .filter(models.Sale.created_at < end)
        .group_by(models.Product.category)
        .all()
    )
    profit_revenue = sum(float(r.revenue or 0) for r in profit_rows)
    profit_cogs = sum(float(r.cogs or 0) for r in profit_rows)
    profit_by_category = [
        {
            "category": r.category or "Uncategorized",
            "revenue": round(float(r.revenue or 0), 2),
            "cogs": round(float(r.cogs or 0), 2),
            "profit": round(float((r.revenue or 0) - (r.cogs or 0)), 2),
        }
        for r in profit_rows
    ]

    # ── Dead stock (no sales in last 30 days) ────────────────────────
    dead_since = datetime.utcnow() - timedelta(days=30)
    sold_recently = (
        db.query(models.SaleItem.product_id)
        .join(models.Sale, models.Sale.id == models.SaleItem.sale_id)
        .filter(models.Sale.created_at >= dead_since)
    )
    dead_rows = (
        db.query(models.Product)
        .filter(models.Product.is_active.is_(True))
        .filter(~models.Product.id.in_(sold_recently))
        .order_by(models.Product.stock.desc())
        .limit(25)
        .all()
    )
    dead_stock = [
        {
            "product_id": p.id,
            "name": p.name,
            "sku": p.sku,
            "stock": p.stock or 0,
            "category": p.category,
        }
        for p in dead_rows
    ]

    # ── Low stock alerts ─────────────────────────────────────────────
    low_stock = []
    for p in db.query(models.Product).filter(models.Product.is_active.is_(True)).all():
        threshold = max(int(p.min_stock or 0), LOW_STOCK_THRESHOLD)
        if (p.stock or 0) > threshold:
            continue
        low_stock.append(
            {
                "product_id": p.id,
                "name": p.name,
                "sku": p.sku,
                "category": p.category,
                "stock": p.stock or 0,
                "min_stock": p.min_stock or 0,
                "threshold": threshold,
                "suggested_qty": max(threshold * 2 - (p.stock or 0), 1),
            }
        )
    low_stock.sort(key=lambda x: x["stock"])

    # ── Recent transactions ──────────────────────────────────────────
    recent = (
        db.query(models.Sale)
        .order_by(models.Sale.created_at.desc())
        .limit(8)
        .all()
    )
    recent_transactions = [
        {
            "key": f"SALE-{s.id}",
            "type": "sale",
            "db_id": s.id,
            "reference": f"INV-{s.id:06d}",
            "date": s.created_at.isoformat(),
            "party_name": s.customer.name if s.customer else None,
            "total": round(s.total or 0, 2),
            "status": s.status,
            "item_count": len(s.items),
        }
        for s in recent
    ]

    return {
        "range": {
            "from": start.date().isoformat(),
            "to": (end - timedelta(days=1)).date().isoformat(),
        },
        "overview": {
            "orders": cur_orders,
            "revenue": cur_revenue,
            "avg_order_value": round(cur_revenue / cur_orders, 2) if cur_orders else 0,
            "previous_orders": prev_orders,
            "previous_revenue": prev_revenue,
            "revenue_change_pct": _pct(cur_revenue, prev_revenue),
            "orders_change_pct": _pct(float(cur_orders), float(prev_orders)),
        },
        "trend": trend,
        "top_products": top_products,
        "category_breakdown": category_breakdown,
        "payment_breakdown": payment_breakdown,
        "customer_insights": {
            "total_customers": total_customers,
            "new_customers": new_customers,
            "returning_customers": max(int(active_customers) - int(new_customers), 0),
            "active_customers": int(active_customers),
            "top_customers": [
                {
                    "customer_id": r.customer_id,
                    "name": r.name,
                    "phone": r.phone,
                    "orders": int(r.orders or 0),
                    "spend": round(float(r.spend or 0), 2),
                }
                for r in top_customers
            ],
        },
        "profit": {
            "revenue": round(profit_revenue, 2),
            "cogs": round(profit_cogs, 2),
            "gross_profit": round(profit_revenue - profit_cogs, 2),
            "margin_pct": round(
                ((profit_revenue - profit_cogs) / profit_revenue) * 100, 1
            )
            if profit_revenue
            else 0.0,
            "by_category": profit_by_category,
        },
        "dead_stock": dead_stock,
        "low_stock": low_stock,
        "recent_transactions": recent_transactions,
    }



# ── Supplier reports ────────────────────────────────────────────────────
@router.get("/suppliers/outstanding")
def suppliers_outstanding(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    suppliers = (
        db.query(models.Supplier)
        .filter(models.Supplier.due_balance > 0.01)
        .order_by(models.Supplier.due_balance.desc())
        .all()
    )
    total_outstanding = round(sum(s.due_balance for s in suppliers), 2)
    return {
        "total_outstanding": total_outstanding,
        "suppliers": [
            schemas.PartyBalanceOut(id=s.id, name=s.name, due_balance=s.due_balance)
            for s in suppliers
        ],
    }


@router.get("/suppliers/{supplier_id}", response_model=schemas.SupplierReportOut)
def supplier_report(
    supplier_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    supplier = ledger_service.get_party(db, "supplier", supplier_id)
    ledger = ledger_service.ledger_totals(db, "supplier", supplier_id)
    totals, counts = ledger["totals"], ledger["counts"]
    products_supplied = (
        db.query(models.Product)
        .filter(models.Product.supplier_id == supplier_id)
        .count()
    )
    recent, _, _ = ledger_service.get_ledger_entries(
        db, "supplier", supplier_id, page=1, page_size=5
    )
    return schemas.SupplierReportOut(
        supplier_id=supplier.id,
        name=supplier.name,
        company=supplier.company,
        due_balance=supplier.due_balance,
        total_purchases=round(totals.get("purchase", 0), 2),
        purchase_count=counts.get("purchase", 0),
        total_payments=round(totals.get("payment", 0), 2),
        payment_count=counts.get("payment", 0),
        total_credit_notes=round(totals.get("credit_note", 0), 2),
        products_supplied=products_supplied,
        recent_entries=recent,
    )


# ── Customer reports ────────────────────────────────────────────────────
@router.get("/customers/owes")
def customers_owes(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    customers = (
        db.query(models.Customer)
        .filter(models.Customer.due_balance > 0.01)
        .order_by(models.Customer.due_balance.desc())
        .all()
    )
    total_owed = round(sum(c.due_balance for c in customers), 2)
    return {
        "total_owed": total_owed,
        "customers": [
            schemas.PartyBalanceOut(id=c.id, name=c.name, due_balance=c.due_balance)
            for c in customers
        ],
    }


@router.get("/customers/{customer_id}", response_model=schemas.CustomerReportOut)
def customer_report(
    customer_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("report.view")),
):
    customer = ledger_service.get_party(db, "customer", customer_id)
    ledger = ledger_service.ledger_totals(db, "customer", customer_id)
    totals, counts = ledger["totals"], ledger["counts"]
    recent, _, _ = ledger_service.get_ledger_entries(
        db, "customer", customer_id, page=1, page_size=5
    )
    return schemas.CustomerReportOut(
        customer_id=customer.id,
        name=customer.name,
        phone=customer.phone,
        due_balance=customer.due_balance,
        credit_limit=customer.credit_limit,
        loyalty_points=customer.loyalty_points,
        total_sales=round(totals.get("sale", 0), 2),
        sale_count=counts.get("sale", 0),
        total_payments=round(totals.get("payment", 0), 2),
        payment_count=counts.get("payment", 0),
        total_returns=round(totals.get("return", 0), 2),
        recent_entries=recent,
    )
