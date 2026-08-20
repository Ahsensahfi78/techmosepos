"""Idempotent schema migrations + seed data for the SQLite database.

New tables are created by ``Base.metadata.create_all``. Columns added to
pre-existing tables are handled with explicit ``ALTER TABLE`` statements so
the script can be re-run safely on an already-migrated database.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from . import models
from .database import Base

# Columns introduced on the pre-existing ``products`` table (SQLite DDL).
_PRODUCT_COLUMNS = {
    "brand_id": "INTEGER",
    "department_id": "INTEGER",
    "supplier_id": "INTEGER",
    "min_stock": "INTEGER DEFAULT 0",
    "barcode": "VARCHAR(100)",
    "model": "VARCHAR(100)",
    "imei": "VARCHAR(50)",
    "warranty_months": "INTEGER",
    "wholesale_price": "FLOAT",
    "track_imei_col": "BOOLEAN DEFAULT 0",
}

DEFAULT_DEPARTMENTS = [
    "Mobile Phones",
    "Accessories",
    "Chargers",
    "Earphones",
    "Smart Watches",
    "Tablets",
]


def _add_product_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "products" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("products")}
    for column, ddl in _PRODUCT_COLUMNS.items():
        if column not in existing:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE products ADD COLUMN {column} {ddl}"))


def _add_payments_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "payments" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("payments")}
    if "purchase_id" not in existing:
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE payments ADD COLUMN purchase_id INTEGER")
            )


_SALES_COLUMNS = {
    "customer_id": "INTEGER",
    "status": "VARCHAR(20) DEFAULT 'completed'",
    "subtotal": "FLOAT DEFAULT 0",
    "discount_amount": "FLOAT DEFAULT 0",
    "tax_amount": "FLOAT DEFAULT 0",
    "paid_amount": "FLOAT DEFAULT 0",
    "payment_method": "VARCHAR(30)",
    "loyalty_points_used": "INTEGER DEFAULT 0",
    "created_by": "INTEGER",
}


def _add_sales_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "sales" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("sales")}
    for column, ddl in _SALES_COLUMNS.items():
        if column not in existing:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE sales ADD COLUMN {column} {ddl}"))
    if "sale_items" in inspector.get_table_names():
        item_cols = {c["name"] for c in inspector.get_columns("sale_items")}
        if "line_total" not in item_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sale_items ADD COLUMN line_total FLOAT DEFAULT 0"))


def _add_user_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("users")}
    if "expires_at" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN expires_at DATETIME"))


def _seed_master_data(engine: Engine) -> None:
    with engine.begin() as conn:
        for name in DEFAULT_DEPARTMENTS:
            exists = conn.execute(
                text("SELECT 1 FROM departments WHERE name = :n"),
                {"n": name},
            ).first()
            if not exists:
                conn.execute(
                    text(
                        "INSERT INTO departments (name, description, created_at, updated_at) "
                        "VALUES (:n, :d, datetime('now'), datetime('now'))"
                    ),
                    {"n": name, "d": None},
                )
        default_warehouse = conn.execute(
            text("SELECT 1 FROM warehouses WHERE is_default = 1")
        ).first()
        if not default_warehouse and conn.execute(
            text("SELECT 1 FROM warehouses LIMIT 1")
        ).first() is None:
            conn.execute(
                text(
                    "INSERT INTO warehouses (name, location, is_default, created_at, updated_at) "
                    "VALUES ('Main Warehouse', NULL, 1, datetime('now'), datetime('now'))"
                )
            )
        if "settings" in inspect(engine).get_table_names():
            for key, value in (
                ("store_name", "My Store"),
                ("tax_rate", "0"),
                ("currency", "Rs"),
                ("receipt_footer", "Thank you for your purchase!\nReturn policy: Items eligible for return within 3 days with receipt."),
                ("low_stock_threshold", "5"),
                ("ezcash_enabled", "true"),
                ("ezcash_sandbox", "true"),
                ("ezcash_api_url", ""),
                ("ezcash_api_key", ""),
                ("ezcash_api_secret", ""),
                ("ezcash_timeout", "30"),
                ("ezcash_denominations", "100,250,500,1000"),
            ):
                exists = conn.execute(
                    text("SELECT 1 FROM settings WHERE key = :k"),
                    {"k": key},
                ).first()
                if not exists:
                    conn.execute(
                        text(
                            "INSERT INTO settings (key, value, updated_at) "
                            "VALUES (:k, :v, datetime('now'))"
                        ),
                        {"k": key, "v": value},
                    )


def run_migrations(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    _add_product_columns(engine)
    _add_payments_columns(engine)
    _add_sales_columns(engine)
    _add_user_columns(engine)
    _seed_master_data(engine)
