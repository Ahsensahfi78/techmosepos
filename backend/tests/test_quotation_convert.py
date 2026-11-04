import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from app.database import Base
from app import models, schemas
from app.services import quotation_service

# In-memory SQLite for testing
@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Create dummy user
    user = models.User(
        username="admin",
        email="admin@example.com",
        full_name="Admin User",
        hashed_password="hashed_password",
        role="admin",
    )
    session.add(user)

    # Create dummy product
    product = models.Product(
        name="Test Item",
        price=150.0,
        stock=10,
        category="General",
    )
    session.add(product)
    session.commit()

    yield session
    session.close()


def test_convert_quotation_idempotent(db_session):
    product = db_session.query(models.Product).first()

    # Create a draft quotation
    quote_in = schemas.QuotationIn(
        customer_name="John Doe",
        customer_type="Retail",
        items=[
            schemas.QuotationItemIn(
                product_id=product.id,
                product_name=product.name,
                qty=2,
                price=150.0,
                unit="pcs",
                line_total=300.0,
            )
        ],
        subtotal=300.0,
        total=300.0,
    )
    quotation = quotation_service.create_quotation(db_session, quote_in, user_id=1)
    assert quotation.status == models.QuotationStatus.DRAFT.value

    # First conversion
    sale1, already_converted1 = quotation_service.convert_quotation(
        db_session,
        quotation.id,
        payment_method="cash",
        paid=300.0,
        user_id=1,
    )
    assert already_converted1 is False
    assert sale1 is not None
    assert quotation.status == models.QuotationStatus.CONVERTED.value
    assert quotation.converted_sale_id == sale1.id

    # Stock should be deducted once (10 - 2 = 8)
    db_session.refresh(product)
    assert product.stock == 8

    # Total sales count in database
    sales_count_before = db_session.query(models.Sale).count()
    assert sales_count_before == 1

    # Second conversion attempt (user clicked button again or retry)
    sale2, already_converted2 = quotation_service.convert_quotation(
        db_session,
        quotation.id,
        payment_method="cash",
        paid=300.0,
        user_id=1,
    )
    assert already_converted2 is True
    assert sale2.id == sale1.id

    # Sales count must still be 1 (NO duplicate sale created)
    sales_count_after = db_session.query(models.Sale).count()
    assert sales_count_after == 1

    # Stock must NOT be deducted again (still 8)
    db_session.refresh(product)
    assert product.stock == 8


def test_convert_cancelled_quotation_fails(db_session):
    quote_in = schemas.QuotationIn(
        customer_name="Cancelled Guy",
        customer_type="Retail",
        items=[
            schemas.QuotationItemIn(
                product_name="Custom",
                qty=1,
                price=50.0,
                line_total=50.0,
            )
        ],
        subtotal=50.0,
        total=50.0,
    )
    quotation = quotation_service.create_quotation(db_session, quote_in, user_id=1)
    quotation.status = models.QuotationStatus.CANCELLED.value
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        quotation_service.convert_quotation(
            db_session,
            quotation.id,
            payment_method="cash",
            paid=50.0,
            user_id=1,
        )
    assert exc_info.value.status_code == 400
    assert "cancelled" in exc_info.value.detail.lower()
