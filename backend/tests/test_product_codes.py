import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import crud, models, schemas
from app.database import Base
from app.services import product_code_service as pcs


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


def _create(db, **kwargs):
    payload = {"name": "Product", "price": 10.0, "stock": 1}
    payload.update(kwargs)
    return crud.create_product(db, schemas.ProductCreate(**payload))


def test_format_product_code_pads_to_six_digits():
    assert pcs.format_product_code(1) == "PRD-000001"
    assert pcs.format_product_code(125) == "PRD-000125"


def test_auto_generate_creates_unique_sku_and_barcode(db):
    first = _create(db, name="A", auto_generate=True)
    second = _create(db, name="B", auto_generate=True)
    assert first.sku == "PRD-000001"
    assert first.barcode == first.sku
    assert second.sku == "PRD-000002"
    assert second.sku != first.sku


def test_auto_generate_keeps_displayed_code_when_free(db):
    product = _create(db, name="A", auto_generate=True, sku="PRD-000042")
    assert product.sku == "PRD-000042"
    assert product.barcode == "PRD-000042"


def test_auto_generate_replaces_displayed_code_when_taken(db):
    _create(db, name="Taken", sku="PRD-000042")
    product = _create(db, name="Race", auto_generate=True, sku="PRD-000042")
    assert product.sku != "PRD-000042"
    assert pcs.find_code_conflict(db, product.sku) is product


def test_generation_skips_codes_taken_by_sku_or_barcode(db):
    db.add(models.Sequence(name=pcs.SEQUENCE_NAME, value=4))
    db.add(models.Product(name="S", sku="PRD-000005", price=1.0, stock=1))
    db.add(models.Product(name="B", barcode="PRD-000006", price=1.0, stock=1))
    db.commit()
    assert pcs.next_product_code(db) == "PRD-000007"


def test_generation_starts_after_existing_manual_codes(db):
    db.add(models.Product(name="Legacy", sku="PRD-000100", price=1.0, stock=1))
    db.commit()
    assert pcs.next_product_code(db) == "PRD-000101"


def test_deleted_product_code_is_not_reused(db):
    product = _create(db, name="A", auto_generate=True)
    assert product.sku == "PRD-000001"
    crud.delete_product(db, product.id)
    assert pcs.next_product_code(db) == "PRD-000002"


def test_manual_duplicate_sku_rejected_with_400(db):
    _create(db, name="A", sku="GAL-A15")
    with pytest.raises(HTTPException) as exc:
        _create(db, name="B", sku="gal-a15")
    assert exc.value.status_code == 400
    assert "already exists" in exc.value.detail


def test_duplicate_barcode_rejected_with_400(db):
    _create(db, name="A", barcode="4006381333931")
    with pytest.raises(HTTPException) as exc:
        _create(db, name="B", barcode="4006381333931")
    assert exc.value.status_code == 400
    assert "Barcode" in exc.value.detail


def test_sku_matching_another_products_barcode_rejected(db):
    _create(db, name="A", barcode="PRD-000009")
    with pytest.raises(HTTPException) as exc:
        _create(db, name="B", sku="PRD-000009")
    assert exc.value.status_code == 400


def test_update_duplicate_code_rejected_with_400(db):
    first = _create(db, name="A", sku="CODE-1")
    second = _create(db, name="B", sku="CODE-2")
    with pytest.raises(HTTPException) as exc:
        crud.update_product(db, second.id, schemas.ProductUpdate(sku="code-1"))
    assert exc.value.status_code == 400
    assert exc.value.detail.startswith("Product code")
    assert second.id != first.id


def test_update_keeping_own_code_is_allowed(db):
    product = _create(db, name="A", sku="CODE-1", barcode="BC-1")
    updated = crud.update_product(
        db,
        product.id,
        schemas.ProductUpdate(sku="CODE-1", barcode="BC-1", price=20.0),
    )
    assert updated.sku == "CODE-1"
    assert updated.price == 20.0


def test_two_generated_codes_can_both_be_saved(db):
    code_a = pcs.next_product_code(db)
    code_b = pcs.next_product_code(db)
    assert code_a != code_b
    a = _create(db, name="A", auto_generate=True, sku=code_a, barcode=code_a)
    b = _create(db, name="B", auto_generate=True, sku=code_b, barcode=code_b)
    assert a.sku == code_a
    assert b.sku == code_b


def test_blank_sku_falls_back_to_generation(db):
    product = _create(db, name="Legacy client", sku="", barcode="")
    assert product.sku == "PRD-000001"
    assert product.barcode == "PRD-000001"
