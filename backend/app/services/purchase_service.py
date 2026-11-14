from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from . import ledger_service
from .stock_service import StockService


def _next_number(db: Session, prefix: str) -> str:
    """Generate a sequential business number like ``PO-20260805-001``."""
    today = datetime.utcnow().strftime("%Y%m%d")
    specs = {
        "PO": (models.PurchaseOrder, models.PurchaseOrder.po_number),
        "PUR": (models.Purchase, models.Purchase.purchase_number),
        "PRT": (models.PurchaseReturn, models.PurchaseReturn.return_number),
    }
    model, column = specs[prefix]
    count = db.query(model).filter(column.like(f"{prefix}-{today}%")).count()
    return f"{prefix}-{today}-{count + 1:03d}"


def _round2(v: float) -> float:
    return round(float(v or 0), 2)


def _get_product(db: Session, product_id: int) -> models.Product:
    product = db.get(models.Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product


def create_purchase_order(
    db: Session,
    data,
    user_id: Optional[int] = None,
) -> models.PurchaseOrder:
    supplier = db.get(models.Supplier, data.supplier_id)
    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")
    if data.warehouse_id is not None and db.get(models.Warehouse, data.warehouse_id) is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    items = []
    subtotal = 0.0
    for line in data.items:
        _get_product(db, line.product_id)
        line_total = _round2(line.qty_ordered * line.cost_price)
        subtotal += line_total
        items.append(
            models.PurchaseOrderItem(
                product_id=line.product_id,
                qty_ordered=line.qty_ordered,
                qty_received=0,
                cost_price=_round2(line.cost_price),
                line_total=line_total,
            )
        )

    subtotal = _round2(subtotal)
    total = _round2(subtotal - data.discount_amount + data.tax_amount)

    po = models.PurchaseOrder(
        po_number=_next_number(db, "PO"),
        supplier_id=data.supplier_id,
        warehouse_id=data.warehouse_id,
        status=models.PurchaseOrderStatus.ORDERED.value,
        order_date=data.order_date or datetime.utcnow(),
        expected_date=data.expected_date,
        subtotal=subtotal,
        discount_amount=_round2(data.discount_amount),
        tax_amount=_round2(data.tax_amount),
        total=total,
        notes=data.notes,
        created_by=user_id,
        items=items,
    )
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def get_purchase_order(db: Session, po_id: int) -> models.PurchaseOrder:
    po = db.get(models.PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


def list_purchase_orders(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    search: Optional[str] = None,
):
    query = db.query(models.PurchaseOrder)
    if status:
        query = query.filter(models.PurchaseOrder.status == status)
    if supplier_id:
        query = query.filter(models.PurchaseOrder.supplier_id == supplier_id)
    if search:
        query = query.filter(models.PurchaseOrder.po_number.contains(search))
    total = query.count()
    items = (
        query.order_by(models.PurchaseOrder.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total else 0
    return items, total, total_pages


def cancel_purchase_order(
    db: Session, po_id: int, user_id: Optional[int] = None
) -> models.PurchaseOrder:
    po = get_purchase_order(db, po_id)
    if po.status in (
        models.PurchaseOrderStatus.CANCELLED.value,
        models.PurchaseOrderStatus.RECEIVED.value,
    ):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a {po.status} order")
    if sum(i.qty_received or 0 for i in po.items) > 0:
        raise HTTPException(status_code=400, detail="Cannot cancel an order with received stock")
    po.status = models.PurchaseOrderStatus.CANCELLED.value
    db.commit()
    db.refresh(po)
    return po


def _update_po_receive_status(db: Session, po: models.PurchaseOrder) -> None:
    if all(i.qty_received >= i.qty_ordered for i in po.items):
        po.status = models.PurchaseOrderStatus.RECEIVED.value
    else:
        po.status = models.PurchaseOrderStatus.PARTIAL.value


def receive_purchase_order(
    db: Session,
    po_id: int,
    data,
    user_id: Optional[int] = None,
) -> models.Purchase:
    po = get_purchase_order(db, po_id)
    if po.status == models.PurchaseOrderStatus.CANCELLED.value:
        raise HTTPException(status_code=400, detail="Cannot receive a cancelled order")
    if po.status == models.PurchaseOrderStatus.RECEIVED.value:
        raise HTTPException(status_code=400, detail="Order is fully received")

    po_items = {i.product_id: i for i in po.items}
    received_map = {}
    for line in data.qty:
        item = po_items.get(line.product_id)
        if item is None:
            raise HTTPException(
                status_code=400, detail=f"Product {line.product_id} is not on this order"
            )
        remaining = item.qty_ordered - (item.qty_received or 0)
        if line.qty <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        if line.qty > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Product {line.product_id}: cannot receive more than remaining {remaining}",
            )
        received_map[line.product_id] = line.qty

    warehouse_id = data.warehouse_id or po.warehouse_id
    if warehouse_id is not None and db.get(models.Warehouse, warehouse_id) is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")

def receive_purchase_order(
    db: Session,
    po_id: int,
    data,
    user_id: Optional[int] = None,
    branch_id: Optional[int] = None,
) -> models.Purchase:
    po = get_purchase_order(db, po_id)
    if po.status == models.PurchaseOrderStatus.CANCELLED.value:
        raise HTTPException(status_code=400, detail="Cannot receive a cancelled order")
    if po.status == models.PurchaseOrderStatus.RECEIVED.value:
        raise HTTPException(status_code=400, detail="Order is fully received")

    po_items = {i.product_id: i for i in po.items}
    received_map = {}
    for line in data.qty:
        item = po_items.get(line.product_id)
        if item is None:
            raise HTTPException(
                status_code=400, detail=f"Product {line.product_id} is not on this order"
            )
        remaining = item.qty_ordered - (item.qty_received or 0)
        if line.qty <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        if line.qty > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Product {line.product_id}: cannot receive more than remaining {remaining}",
            )
        received_map[line.product_id] = line.qty

    warehouse_id = data.warehouse_id or po.warehouse_id
    if warehouse_id is not None and db.get(models.Warehouse, warehouse_id) is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    # Resolve receiving branch: PO branch takes precedence, else user's branch
    receiving_branch_id = po.branch_id or branch_id
    if not receiving_branch_id:
        raise HTTPException(
            status_code=400,
            detail="No receiving branch on purchase order or user context",
        )

    purchase_items = []
    received_subtotal = 0.0
    for product_id, qty in received_map.items():
        item = po_items[product_id]
        _get_product(db, product_id)
        line_total = _round2(qty * item.cost_price)
        received_subtotal += line_total
        purchase_items.append(
            models.PurchaseItem(
                product_id=product_id,
                qty=qty,
                cost_price=item.cost_price,
                line_total=line_total,
            )
        )

    received_subtotal = _round2(received_subtotal)
    if po.subtotal and po.subtotal > 0:
        ratio = received_subtotal / po.subtotal
        discount = _round2(po.discount_amount * ratio)
        tax = _round2(po.tax_amount * ratio)
    else:
        discount, tax = 0.0, 0.0
    total = _round2(received_subtotal - discount + tax)

    purchase = models.Purchase(
        purchase_number=_next_number(db, "PUR"),
        po_id=po.id,
        supplier_id=po.supplier_id,
        warehouse_id=warehouse_id,
        invoice_number=data.invoice_number,
        invoice_date=data.invoice_date,
        purchase_date=datetime.utcnow(),
        subtotal=received_subtotal,
        discount_amount=discount,
        tax_amount=tax,
        total=total,
        paid_amount=0.0,
        status=models.PurchaseStatus.UNPAID.value,
        notes=data.notes,
        created_by=user_id,
        branch_id=receiving_branch_id,
        items=purchase_items,
    )
    db.add(purchase)
    db.flush()

    # Stock goes through StockService (single write path, branch-scoped).
    unit_costs = {pid: po_items[pid].cost_price for pid in received_map}
    StockService.purchase_receipt(
        db=db,
        branch_id=receiving_branch_id,
        deltas=received_map,
        reference_type="purchase",
        reference_id=purchase.id,
        user_id=user_id,
        unit_costs=unit_costs,
    )

    po_items_map = {i.product_id: i for i in po.items}
    for product_id, qty in received_map.items():
        po_items_map[product_id].qty_received = (
            po_items_map[product_id].qty_received or 0
        ) + qty

    ledger_service.post_ledger_entry(
        db,
        party_type="supplier",
        party_id=po.supplier_id,
        entry_type="purchase",
        amount=total,
        direction="debit",
        reference=purchase.purchase_number,
        reference_id=purchase.id,
        note=f"Purchase {purchase.purchase_number} received",
        entry_date=purchase.purchase_date,
        user_id=user_id,
    )

    _update_po_receive_status(db, po)
    db.commit()
    db.refresh(purchase)
    return purchase


def get_purchase(db: Session, purchase_id: int) -> models.Purchase:
    purchase = db.get(models.Purchase, purchase_id)
    if purchase is None:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return purchase


def list_purchases(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    search: Optional[str] = None,
):
    query = db.query(models.Purchase)
    if status:
        query = query.filter(models.Purchase.status == status)
    if supplier_id:
        query = query.filter(models.Purchase.supplier_id == supplier_id)
    if search:
        query = query.filter(models.Purchase.purchase_number.contains(search))
    total = query.count()
    items = (
        query.order_by(models.Purchase.purchase_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total else 0
    return items, total, total_pages


def record_purchase_payment(
    db: Session,
    purchase_id: int,
    data,
    user_id: Optional[int] = None,
) -> models.Payment:
    purchase = get_purchase(db, purchase_id)
    due = _round2(purchase.total - purchase.paid_amount)
    if data.amount > due + 0.001:
        raise HTTPException(
            status_code=400, detail=f"Amount exceeds outstanding balance of {due}"
        )

    payment = ledger_service.record_payment(
        db,
        party_type="supplier",
        party_id=purchase.supplier_id,
        amount=data.amount,
        method=data.method,
        reference=data.reference or purchase.purchase_number,
        note=data.note or f"Payment for purchase {purchase.purchase_number}",
        payment_date=data.payment_date,
        purchase_id=purchase.id,
        user_id=user_id,
    )
    purchase.paid_amount = _round2(purchase.paid_amount + data.amount)
    if purchase.paid_amount + 0.001 >= purchase.total:
        purchase.status = models.PurchaseStatus.PAID.value
    else:
        purchase.status = models.PurchaseStatus.PARTIAL.value
    db.commit()
    db.refresh(payment)
    return payment


def _get_returned_qty(db: Session, purchase_id: int) -> dict:
    rows = (
        db.query(models.PurchaseReturnItem, models.PurchaseReturn)
        .join(models.PurchaseReturn, models.PurchaseReturn.id == models.PurchaseReturnItem.return_id)
        .filter(models.PurchaseReturn.purchase_id == purchase_id)
        .all()
    )
    out: dict[int, int] = {}
    for item, _ in rows:
        out[item.product_id] = out.get(item.product_id, 0) + item.qty
    return out


def create_purchase_return(
    db: Session,
    purchase_id: int,
    data,
    user_id: Optional[int] = None,
) -> models.PurchaseReturn:
    purchase = get_purchase(db, purchase_id)
    purchase_items = {i.product_id: i for i in purchase.items}
    returned = _get_returned_qty(db, purchase_id)

    return_items = []
    total = 0.0
    for line in data.items:
        pi = purchase_items.get(line.product_id)
        if pi is None:
            raise HTTPException(
                status_code=400, detail=f"Product {line.product_id} was not on this purchase"
            )
        available = pi.qty - returned.get(line.product_id, 0)
        if line.qty <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        if line.qty > available:
            raise HTTPException(
                status_code=400,
                detail=f"Product {pi.product.name if pi.product else line.product_id}: only {available} returnable",
            )
        line_total = _round2(line.qty * pi.cost_price)
        total += line_total
        return_items.append(
            models.PurchaseReturnItem(
                product_id=line.product_id,
                qty=line.qty,
                cost_price=pi.cost_price,
                line_total=line_total,
            )
        )

    ret = models.PurchaseReturn(
        return_number=_next_number(db, "PRT"),
        purchase_id=purchase.id,
        supplier_id=purchase.supplier_id,
        return_date=data.return_date or datetime.utcnow(),
        reason=data.reason,
        total=_round2(total),
        created_by=user_id,
        items=return_items,
    )
    db.add(ret)
    db.flush()

    # Return stock to the branch where the purchase was originally received.
    return_branch_id = purchase.branch_id
    if not return_branch_id:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Purchase #{purchase.id} has no branch context; cannot process return.",
        )

    StockService.adjustment(
        db=db,
        branch_id=return_branch_id,
        deltas={line.product_id: -line.qty for line in data.items},
        reference_type="purchase_return",
        reference_id=ret.id,
        user_id=user_id,
        reason="purchase_return",
        note=f"Purchase return {ret.return_number}",
        allow_negative=False,
    )

    ledger_service.post_ledger_entry(
        db,
        party_type="supplier",
        party_id=purchase.supplier_id,
        entry_type="return",
        amount=ret.total,
        direction="credit",
        reference=ret.return_number,
        reference_id=ret.id,
        note=f"Purchase return {ret.return_number}",
        entry_date=ret.return_date,
        user_id=user_id,
    )

    db.commit()
    db.refresh(ret)
    return ret


def list_purchase_returns(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    supplier_id: Optional[int] = None,
    purchase_id: Optional[int] = None,
):
    query = db.query(models.PurchaseReturn)
    if supplier_id:
        query = query.filter(models.PurchaseReturn.supplier_id == supplier_id)
    if purchase_id:
        query = query.filter(models.PurchaseReturn.purchase_id == purchase_id)
    total = query.count()
    items = (
        query.order_by(models.PurchaseReturn.return_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total else 0
    return items, total, total_pages
