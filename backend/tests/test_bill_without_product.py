import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.database import Base
from app.services import sales_service
from app.routers.sales import _broadcast_sale
from app.services.printing.layout import build_receipt_layout


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    maker = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = maker()
    yield session
    session.close()


def test_custom_bill_without_product_creation(db):
    # Create sale containing only ad-hoc items (no product database records required)
    sale_in = schemas.SaleIn(
        items=[
            schemas.SaleItemIn(
                product_id=None,
                item_type="AD_HOC",
                item_name="Service Charge",
                qty=1,
                price=2500.0,
                line_discount=0.0,
            ),
            schemas.SaleItemIn(
                product_id=None,
                item_type="AD_HOC",
                item_name="Repair Work",
                qty=2,
                price=1500.0,
                line_discount=200.0,
            ),
        ],
        payment_method="cash",
        paid_amount=5300.0,
    )

    sale = sales_service.create_sale(db, sale_in, user_id=None)

    assert sale.id is not None
    assert len(sale.items) == 2

    # Check item 1
    assert sale.items[0].product_id is None
    assert sale.items[0].item_type == "AD_HOC"
    assert sale.items[0].item_name == "Service Charge"
    assert sale.items[0].product_name == "Service Charge"
    assert sale.items[0].line_total == 2500.0

    # Check item 2: 2 * 1500 - 200 = 2800
    assert sale.items[1].product_id is None
    assert sale.items[1].item_type == "AD_HOC"
    assert sale.items[1].item_name == "Repair Work"
    assert sale.items[1].product_name == "Repair Work"
    assert sale.items[1].line_total == 2800.0

    # Total: 2500 + 2800 = 5300
    assert sale.subtotal == 5300.0
    assert sale.total == 5300.0
    assert sale.paid_amount == 5300.0
    assert sale.due_amount == 0.0


def test_mixed_bill_product_and_custom_item(db):
    # Create an actual inventory product
    prod = models.Product(
        name="USB Cable",
        price=500.0,
        stock=10,
        category="Accessories",
        is_active=True,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    sale_in = schemas.SaleIn(
        items=[
            schemas.SaleItemIn(
                product_id=prod.id,
                item_type="STOCK",
                qty=2,
                price=500.0,
            ),
            schemas.SaleItemIn(
                product_id=None,
                item_type="AD_HOC",
                item_name="Phone Screen Repair",
                qty=1,
                price=3500.0,
            ),
        ],
        payment_method="card",
        paid_amount=4500.0,
    )

    sale = sales_service.create_sale(db, sale_in, user_id=None)

    assert sale.id is not None
    assert len(sale.items) == 2
    assert sale.total == 4500.0

    # Verify inventory was deducted ONLY for the stock product, not for the custom item
    db.refresh(prod)
    assert prod.stock == 8  # 10 - 2


@pytest.mark.anyio
async def test_broadcast_sale_handles_custom_items_without_error(db):
    # Ensure _broadcast_sale does not raise AttributeError on item.product.id
    sale_in = schemas.SaleIn(
        items=[
            schemas.SaleItemIn(
                product_id=None,
                item_type="AD_HOC",
                item_name="Diagnostic Check",
                qty=1,
                price=1000.0,
            ),
        ],
        payment_method="cash",
        paid_amount=1000.0,
    )

    sale = sales_service.create_sale(db, sale_in, user_id=None)
    # This should execute cleanly without crashing
    await _broadcast_sale(sale)


def test_receipt_layout_with_custom_items():
    from datetime import datetime
    # Verify build_receipt_layout handles custom items cleanly without printing "None"
    invoice = {
        "invoice_no": "INV-001",
        "currency": "Rs",
        "created_at": datetime.utcnow(),
        "cashier": "Admin",
        "customer": "Walk-in",
        "subtotal": 2500.0,
        "discount": 0.0,
        "tax": 0.0,
        "tax_rate": 0.0,
        "total": 2500.0,
        "payment_method": "cash",
        "paid": 2500.0,
        "change": 0.0,
        "lines": [
            {
                "name": "Custom Service",
                "sku": None,
                "unit_price": 2500.0,
                "qty": 1,
                "discount": 0.0,
            }
        ],
    }

    # Should build layout without any exceptions
    payload = build_receipt_layout(invoice, width_mm=80.0, store_name="Tech MOS")
    assert payload is not None
    assert "items" in payload
    # Check that "None" was not printed as SKU
    for item in payload["items"]:
        if item.get("type") == "text":
            assert "None" not in item.get("text", "")
