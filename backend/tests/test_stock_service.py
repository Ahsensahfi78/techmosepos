"""Tests for branch-scoped inventory.

Tests that branch-scoped users (cashiers/managers) can only access data from
their own branch, while admins can see all branches.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from jose import jwt
from datetime import datetime, timedelta

from app import models
from app.database import Base, engine, SessionLocal, get_db
from app.main import app
from app.auth import hash_password, create_access_token


# ── Test database setup ──────────────────────────────────────────────────

test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=test_engine
)


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def client():
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[SessionLocal] = lambda: TestingSessionLocal()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── Helpers ──────────────────────────────────────────────────────────────

def _make_branch(db, code: str, name: str, btype: str = "store") -> models.Branch:
    b = models.Branch(name=name, code=code, type=btype, is_active=True)
    db.add(b)
    db.flush()
    return b


def _make_product(db, name: str, stock: int = 100) -> models.Product:
    p = models.Product(name=name, price=10.0, stock=stock, is_active=True)
    db.add(p)
    db.flush()
    return p


def _make_user(db, username: str, branch_code: str, role: str = "cashier") -> models.User:
    branch = db.query(models.Branch).filter(models.Branch.code == branch_code).first()
    if not branch:
        branch = _make_branch(db, branch_code, branch_code.title())
    u = models.User(
        username=username,
        email=f"{username}@test.local",
        full_name=username.title(),
        hashed_password=hash_password("password123"),
        role=role,
        branch=branch.code,
        is_active=True,
    )
    db.add(u)
    db.flush()
    return u


def _auth_header(user: models.User) -> dict:
    token = create_access_token(user_id=user.id, role=user.role)
    return {"Authorization": f"Bearer {token}"}


# ── Tests ──────────────────────────────────────────────────────────────

def test_sales_branch_scoped(client, db):
    """Branch-scoped user should only see sales from their branch."""
    klm = _make_branch(db, "klm", "Kalmunai")
    klv = _make_branch(db, "klv", "Kaluvanchikuti")
    product = _make_product(db, "Test Product", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")
    user_klv = _make_user(db, "cashier_klv", "klv")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 100}, user_id=1)
    StockService.purchase_receipt(db=db, branch_id=klv.id, deltas={product.id: 100}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    sale_a = sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=1)], payment_method="cash", paid_amount=50.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )
    sale_b = sales_service.create_sale(db=db, data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=1)], payment_method="cash", paid_amount=50.0), user_id=user_klv.id, branch_id=klv.id)

    headers_klm = _auth_header(user_klm)
    res = client.get("/sales/", headers=headers_klm)
    assert res.status_code == 200
    sales = res.json()
    assert all(s["branch_id"] == klm.id for s in sales), f"All sales should be from Kalmunai, got {[s['branch_id'] for s in sales]}"
    assert any(s["id"] == sale_a.id for s in sales), f"Sale {sale_a.id} should be in results"

    headers_klv = _auth_header(user_klv)
    res = client.get("/sales/", headers=headers_klv)
    assert res.status_code == 200
    sales = res.json()
    assert all(s["branch_id"] == klv.id for s in sales), f"All sales should be from Kaluvanchikuti, got {[s['branch_id'] for s in sales]}"
    assert any(s["id"] == sale_b.id for s in sales), f"Sale {sale_b.id} should be in results"


def test_sale_get_branch_scoped_auth(client, db):
    """Cashier at branch A cannot view sale from branch B."""
    branch_a = _make_branch(db, "klm", "Kalmunai")
    branch_b = _make_branch(db, "klv", "Kaluvanchikuti")
    product = _make_product(db, "Test Product", stock=100)

    user_a = _make_user(db, "cashier_a", "klm")
    user_b = _make_user(db, "cashier_b", "klv")

    from app.services import sales_service
    from app.services.stock_service import StockService
    from app.schemas import SaleIn, SaleItemIn

    StockService.purchase_receipt(db=db, branch_id=branch_a.id, deltas={product.id: 100}, user_id=1)
    data_a = SaleIn(items=[SaleItemIn(product_id=product.id, qty=1)], payment_method="cash", paid_amount=50.0)
    sale_a = sales_service.create_sale(db=db, data=data_a, user_id=user_a.id, branch_id=branch_a.id)

    headers_a = _auth_header(user_a)
    res = client.get(f"/sales/{sale_a.id}", headers=headers_a)
    assert res.status_code == 200

    headers_b = _auth_header(user_b)
    res = client.get(f"/sales/{sale_a.id}", headers=headers_b)
    assert res.status_code == 403


def test_repair_branch_scoped_auth(client, db):
    """Cashier at Kalmunai should only see Kalmunai repairs."""
    klm = _make_branch(db, "klm", "Kalmunai")
    klv = _make_branch(db, "klv", "Kaluvanchikuti")

    user_klm = _make_user(db, "cashier_klm", "klm")
    user_klv = _make_user(db, "cashier_klv", "klv")

    repair_a = models.Repair(
        repair_number="RPR-KLM-001",
        customer_name="Customer A",
        product_name="Phone Repair",
        issue="Screen crack",
        status="received",
        branch_id=klm.id,
        received_by=user_klm.id,
    )
    repair_b = models.Repair(
        repair_number="RPR-KLV-001",
        customer_name="Customer B",
        product_name="Tablet Repair",
        issue="Battery",
        status="received",
        branch_id=klv.id,
        received_by=user_klv.id,
    )
    db.add_all([repair_a, repair_b])
    db.commit()
    db.refresh(repair_a)
    db.refresh(repair_b)

    headers_klm = _auth_header(user_klm)
    res = client.get("/repairs/", headers=headers_klm)
    assert res.status_code == 200
    repairs = res.json()
    repair_ids = [r["id"] for r in repairs["items"]]
    assert repair_a.id in repair_ids
    assert repair_b.id not in repair_ids

    headers_klv = _auth_header(user_klv)
    res = client.get("/repairs/", headers=headers_klv)
    assert res.status_code == 200
    repairs = res.json()
    repair_ids = [r["id"] for r in repairs["items"]]
    assert repair_b.id in repair_ids
    assert repair_a.id not in repair_ids


def test_repair_get_branch_scoped_auth(client, db):
    """Cashier at branch A cannot view repair from branch B."""
    branch_a = _make_branch(db, "klm", "Kalmunai")
    branch_b = _make_branch(db, "klv", "Kaluvanchikuti")

    user_a = _make_user(db, "cashier_a", "klm")
    user_b = _make_user(db, "cashier_b", "klv")

    repair_a = models.Repair(
        repair_number="RPR-KLM-001",
        customer_name="Customer A",
        product_name="Phone Repair",
        issue="Screen crack",
        status="received",
        branch_id=branch_a.id,
        received_by=user_a.id,
    )
    repair_b = models.Repair(
        repair_number="RPR-KLV-001",
        customer_name="Customer B",
        product_name="Tablet Repair",
        issue="Battery",
        status="received",
        branch_id=branch_b.id,
        received_by=user_b.id,
    )
    db.add_all([repair_a, repair_b])
    db.commit()

    headers_a = _auth_header(user_a)
    res = client.get(f"/repairs/{repair_a.id}", headers=headers_a)
    assert res.status_code == 200

    headers_b = _auth_header(user_b)
    res = client.get(f"/repairs/{repair_a.id}", headers=headers_b)
    assert res.status_code == 403


def test_product_create_branch_scoped_auth(client, db):
    """Cashier at Kaluvanchikuti can only create products for Kaluvanchikuti."""
    klm = _make_branch(db, "klm", "Kalmunai")
    klv = _make_branch(db, "klv", "Kaluvanchikuti")

    user_klv = _make_user(db, "cashier_klv", "klv")

    headers_klv = _auth_header(user_klv)
    res = client.post("/products/", json={
        "name": "Test Phone",
        "price": 500.0,
        "stock": 10,
        "category": "Mobile Phones",
        "branch_id": klv.id
    }, headers=headers_klv)
    assert res.status_code == 201

    headers_klv = _auth_header(user_klv)
    res = client.post("/products/", json={
        "name": "Test Phone 2",
        "price": 500.0,
        "stock": 10,
        "category": "Mobile Phones",
        "branch_id": klm.id
    }, headers=headers_klv)
    assert res.status_code == 403

    admin = _make_user(db, "admin_user", "klm", role="super_admin")
    headers_admin = _auth_header(admin)
    res = client.post("/products/", json={
        "name": "Admin Phone",
        "price": 500.0,
        "stock": 10,
        "category": "Mobile Phones",
        "branch_id": klm.id
    }, headers=headers_admin)
    assert res.status_code == 201


def test_products_branch_scoped_auth(client, db):
    """Cashier at Kaluvanchikuti should only see Kaluvanchikuti stock."""
    klm = _make_branch(db, "klm", "Kalmunai")
    klv = _make_branch(db, "klv", "Kaluvanchikuti")
    product_a = _make_product(db, "Product A", stock=100)
    product_b = _make_product(db, "Product B", stock=50)

    user_klv = _make_user(db, "cashier_klv", "klv")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product_a.id: 100}, user_id=1)
    StockService.purchase_receipt(db=db, branch_id=klv.id, deltas={product_b.id: 50}, user_id=1)

    headers_klv = _auth_header(user_klv)
    res = client.get("/products/", headers=headers_klv)
    assert res.status_code == 200
    products = res.json()
    product_ids = [p["id"] for p in products]
    assert product_b.id in product_ids
    assert product_a.id not in product_ids


def test_user_without_branch_cannot_create_sale(client, db):
    """User without branch assignment cannot create a sale."""
    branch_a = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Product", stock=100)

    user_no_branch = models.User(
        username="nobranch",
        email="nobranch@test.local",
        full_name="No Branch",
        hashed_password=hash_password("password123"),
        role="cashier",
        branch=None,
        is_active=True,
    )
    db.add(user_no_branch)
    db.flush()

    headers = _auth_header(user_no_branch)
    res = client.post("/sales/", json={
        "items": [{"product_id": product.id, "qty": 1, "item_type": "STOCK"}],
        "payment_method": "cash",
        "paid_amount": 50.0
    }, headers=headers)
    assert res.status_code == 400
    assert "branch" in res.json()["detail"].lower()


# ── Single-Product Invoice/Sales Regression Tests ──────────────────────────

def test_single_product_sale_creation(client, db):
    """Regression: creating a sale with exactly one product should succeed."""
    klm = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")

    # Stock the branch
    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 100}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    sale = sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=1)],
                    payment_method="cash", paid_amount=10.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )

    assert sale.id is not None
    assert sale.branch_id == klm.id
    assert sale.total == 10.0  # product default price
    assert sale.paid_amount == 10.0
    assert sale.payment_method == "cash"
    assert len(sale.items) == 1
    assert sale.items[0].product_id == product.id
    assert sale.items[0].qty == 1
    assert sale.items[0].line_total == 10.0


def test_single_product_sale_deducts_branch_stock(client, db):
    """Regression: sale must deduct stock from the branch's branch_stocks."""
    klm = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 10}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=3)],
                    payment_method="cash", paid_amount=30.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )

    # Verify branch stock was decremented
    bs = db.query(models.BranchStock).filter(
        models.BranchStock.product_id == product.id,
        models.BranchStock.branch_id == klm.id,
    ).first()
    assert bs is not None
    assert bs.quantity == 7  # 10 - 3 = 7


def test_single_product_sale_insufficient_stock(client, db):
    """Regression: sale must fail when branch has insufficient stock."""
    klm = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 2}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    with pytest.raises(Exception) as exc:
        sales_service.create_sale(
            db=db,
            data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=5)],
                        payment_method="cash", paid_amount=50.0),
            user_id=user_klm.id,
            branch_id=klm.id,
        )

    assert exc.value.status_code == 400


def test_single_product_sale_get_returns_correct_data(client, db):
    """Regression: GET /sales/{id} must return complete sale data."""
    klm = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 100}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    sale = sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=2)],
                    payment_method="cash", paid_amount=20.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )

    headers = _auth_header(user_klm)
    res = client.get(f"/sales/{sale.id}", headers=headers)
    assert res.status_code == 200

    data = res.json()
    assert data["id"] == sale.id
    assert data["branch_id"] == klm.id
    assert data["total"] == 20.0
    assert data["paid_amount"] == 20.0
    assert data["payment_method"] == "cash"
    assert len(data["items"]) == 1
    assert data["items"][0]["product_id"] == product.id
    assert data["items"][0]["qty"] == 2
    assert data["items"][0]["line_total"] == 20.0


def test_single_product_sale_receipt_endpoint(client, db):
    """Regression: GET /sales/{id}/receipt must return complete receipt data."""
    klm = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 100}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    sale = sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=1)],
                    payment_method="cash", paid_amount=10.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )

    headers = _auth_header(user_klm)
    res = client.get(f"/sales/{sale.id}/receipt", headers=headers)
    assert res.status_code == 200

    data = res.json()
    assert data["id"] == sale.id
    assert data["reference"] == f"INV-{sale.id:06d}"
    assert data["total"] == 10.0
    assert data["paid_amount"] == 10.0
    assert data["payment_method"] == "cash"
    assert len(data["items"]) == 1
    assert data["items"][0]["product_name"] == "Test Phone"
    assert data["store_name"] != ""
    assert data["currency"] != ""
    assert data["receipt_width_mm"] != ""


def test_single_product_sale_branch_scoping(client, db):
    """Regression: cashier at branch A cannot see branch B's sales via API."""
    klm = _make_branch(db, "klm", "Kalmunai")
    klv = _make_branch(db, "klv", "Kaluvanchikuti")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")
    user_klv = _make_user(db, "cashier_klv", "klv")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 100}, user_id=1)
    StockService.purchase_receipt(db=db, branch_id=klv.id, deltas={product.id: 100}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    # Cashier at Kalmunai creates sale at Kalmunai via API - should succeed
    headers_klm = _auth_header(user_klm)
    res = client.post("/sales/", json={
        "items": [{"product_id": product.id, "qty": 1, "item_type": "STOCK"}],
        "payment_method": "cash",
        "paid_amount": 10.0
    }, headers=headers_klm)
    assert res.status_code == 201
    sale_klm_id = res.json()["id"]

    # Cashier at Kaluvanchikuti creates sale at Kaluvanchikuti via API - should succeed (at their own branch)
    headers_klv = _auth_header(user_klv)
    res = client.post("/sales/", json={
        "items": [{"product_id": product.id, "qty": 1, "item_type": "STOCK"}],
        "payment_method": "cash",
        "paid_amount": 10.0
    }, headers=headers_klv)
    assert res.status_code == 201
    sale_klv_id = res.json()["id"]

    # Cashier at Kalmunai can only see Kalmunai sales - should NOT see Kaluvanchikuti's sale
    res = client.get(f"/sales/{sale_klv_id}", headers=headers_klm)
    assert res.status_code == 403

    # Cashier at Kaluvanchikuti can only see Kaluvanchikuti sales - should NOT see Kalmunai's sale
    res = client.get(f"/sales/{sale_klm_id}", headers=headers_klv)
    assert res.status_code == 403


def test_single_product_sale_multiple_same_product(client, db):
    """Regression: multiple sales of same product should deduct stock correctly."""
    klm = _make_branch(db, "klm", "Kalmunai")
    product = _make_product(db, "Test Phone", stock=100)

    user_klm = _make_user(db, "cashier_klm", "klm")

    from app.services.stock_service import StockService
    StockService.purchase_receipt(db=db, branch_id=klm.id, deltas={product.id: 10}, user_id=1)

    from app.services import sales_service
    from app.schemas import SaleIn, SaleItemIn

    # Sale 1: qty 3
    sale1 = sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=3)],
                    payment_method="cash", paid_amount=30.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )

    # Sale 2: qty 4
    sale2 = sales_service.create_sale(
        db=db,
        data=SaleIn(items=[SaleItemIn(product_id=product.id, qty=4)],
                    payment_method="cash", paid_amount=40.0),
        user_id=user_klm.id,
        branch_id=klm.id,
    )

    # Verify remaining stock: 10 - 3 - 4 = 3
    bs = db.query(models.BranchStock).filter(
        models.BranchStock.product_id == product.id,
        models.BranchStock.branch_id == klm.id,
    ).first()
    assert bs.quantity == 3