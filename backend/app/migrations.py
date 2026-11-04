"""Idempotent schema migrations + seed data for the SQLite database.

New tables are created by ``Base.metadata.create_all``. Columns added to
pre-existing tables are handled with explicit ``ALTER TABLE`` statements so
the script can be re-run safely on an already-migrated database.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from . import models
from .database import Base

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
    "product_type": "VARCHAR(50) DEFAULT 'Goods'",
    "unit": "VARCHAR(20) DEFAULT 'pcs'",
}

DEFAULT_DEPARTMENTS = [
    "Mobile Phones",
    "Accessories",
    "Chargers",
    "Earphones",
    "Smart Watches",
    "Tablets",
]

DEFAULT_BRANCHES = [
    {"name": "Kalmunai", "code": "KLM"},
    {"name": "Kaluvanchikuti", "code": "KLV"},
    {"name": "Batticaloa", "code": "BTC"},
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
        if "item_type" not in item_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sale_items ADD COLUMN item_type VARCHAR(20) DEFAULT 'STOCK'"))
        if "item_name" not in item_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sale_items ADD COLUMN item_name VARCHAR(255)"))
        if "line_discount" not in item_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sale_items ADD COLUMN line_discount FLOAT DEFAULT 0"))


def _add_user_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("users")}
    if "expires_at" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN expires_at DATETIME"))
    if "branch" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN branch VARCHAR(50)"))


_EZCASH_COLUMNS = {
    "carrier": "VARCHAR(30)",
    "operator_id": "INTEGER",
    "operator_name": "VARCHAR(100)",
    "delivered_amount": "FLOAT",
    "delivered_currency": "VARCHAR(10)",
}


def _add_ezcash_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "ezcash_reloads" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("ezcash_reloads")}
    for column, ddl in _EZCASH_COLUMNS.items():
        if column not in existing:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE ezcash_reloads ADD COLUMN {column} {ddl}"))


def _add_branch_columns(engine: Engine) -> None:
    """Add branch_id to tables that need branch scoping."""
    inspector = inspect(engine)
    col_adds = {
        "sales": "branch_id INTEGER",
        "purchase_orders": "branch_id INTEGER",
        "purchases": "branch_id INTEGER",
        "repairs": "branch_id INTEGER",
        "stock_adjustments": "branch_id INTEGER",
        "stock_transactions": "branch_id INTEGER",
    }
    for table, ddl in col_adds.items():
        if table not in inspector.get_table_names():
            continue
        existing = {col["name"] for col in inspector.get_columns(table)}
        col_name = ddl.split()[0]
        if col_name not in existing:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def _add_customer_columns(engine: Engine) -> None:
    """customers gained notes and customer_type columns."""
    inspector = inspect(engine)
    if "customers" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("customers")}
    if "notes" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE customers ADD COLUMN notes TEXT"))
    if "customer_type" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE customers ADD COLUMN customer_type VARCHAR(50) DEFAULT 'Retail'"))


_QUOTATION_COLUMNS = {
    "customer_name": "VARCHAR(150)",
    "customer_phone": "VARCHAR(50)",
    "customer_address": "TEXT",
    "customer_type": "VARCHAR(50) DEFAULT 'Retail'",
    "tax_rate": "FLOAT DEFAULT 0",
    "terms": "TEXT",
}

_QUOTATION_ITEM_COLUMNS = {
    "product_name": "VARCHAR(255)",
    "product_type": "VARCHAR(50) DEFAULT 'Goods'",
    "description": "TEXT",
    "unit": "VARCHAR(20) DEFAULT 'pcs'",
    "discount": "FLOAT DEFAULT 0",
    "tax": "FLOAT DEFAULT 0",
}

_REPAIR_COLUMNS = {
    "customer_name": "VARCHAR(150)",
    "customer_phone": "VARCHAR(50)",
    "customer_address": "TEXT",
    "customer_type": "VARCHAR(50) DEFAULT 'Retail'",
    "estimated_cost": "FLOAT DEFAULT 0",
    "terms": "TEXT",
}


def _add_quotation_and_repair_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "quotations" in inspector.get_table_names():
        q_cols = {col["name"] for col in inspector.get_columns("quotations")}
        for col_name, ddl in _QUOTATION_COLUMNS.items():
            if col_name not in q_cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE quotations ADD COLUMN {col_name} {ddl}"))

    if "quotation_items" in inspector.get_table_names():
        qi_cols = {col["name"]: col for col in inspector.get_columns("quotation_items")}
        # Ensure product_id is nullable for custom manual line items
        if "product_id" in qi_cols and not qi_cols["product_id"].get("nullable", True):
            with engine.begin() as conn:
                conn.execute(text("PRAGMA foreign_keys = OFF;"))
                conn.execute(text("""
                    CREATE TABLE quotation_items_migration (
                        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                        quotation_id INTEGER NOT NULL,
                        product_id INTEGER,
                        product_name VARCHAR(255),
                        product_type VARCHAR(50) DEFAULT 'Goods',
                        description TEXT,
                        qty FLOAT NOT NULL DEFAULT 1,
                        unit VARCHAR(20) DEFAULT 'pcs',
                        price FLOAT NOT NULL DEFAULT 0,
                        discount FLOAT DEFAULT 0,
                        tax FLOAT DEFAULT 0,
                        line_total FLOAT NOT NULL DEFAULT 0,
                        FOREIGN KEY(quotation_id) REFERENCES quotations (id),
                        FOREIGN KEY(product_id) REFERENCES products (id)
                    );
                """))
                conn.execute(text("""
                    INSERT INTO quotation_items_migration (id, quotation_id, product_id, product_name, product_type, description, qty, unit, price, discount, tax, line_total)
                    SELECT id, quotation_id, product_id, product_name, product_type, description, qty, unit, price, discount, tax, line_total FROM quotation_items;
                """))
                conn.execute(text("DROP TABLE quotation_items;"))
                conn.execute(text("ALTER TABLE quotation_items_migration RENAME TO quotation_items;"))
                conn.execute(text("PRAGMA foreign_keys = ON;"))
            # refresh qi_cols
            inspector = inspect(engine)
            qi_cols = {col["name"]: col for col in inspector.get_columns("quotation_items")}

        for col_name, ddl in _QUOTATION_ITEM_COLUMNS.items():
            if col_name not in qi_cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE quotation_items ADD COLUMN {col_name} {ddl}"))

    if "repairs" in inspector.get_table_names():
        r_cols = {col["name"] for col in inspector.get_columns("repairs")}
        for col_name, ddl in _REPAIR_COLUMNS.items():
            if col_name not in r_cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE repairs ADD COLUMN {col_name} {ddl}"))


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
                ("store_address", ""),
                ("store_phone", ""),
                ("store_email", ""),
                ("store_logo", ""),
                ("receipt_width_mm", "80"),
                ("ezcash_enabled", "true"),
                ("ezcash_sandbox", "true"),
                ("ezcash_api_url", ""),
                ("ezcash_api_key", ""),
                ("ezcash_api_secret", ""),
                ("ezcash_timeout", "30"),
                ("ezcash_denominations", "100,250,500,1000"),
                ("ezcash_client_id", ""),
                ("ezcash_client_secret", ""),
                ("ezcash_provider", "reloadly"),
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


def _seed_branches(engine: Engine) -> None:
    """Seed the three default branches."""
    inspector = inspect(engine)
    if "branches" not in inspector.get_table_names():
        return
    with engine.begin() as conn:
        for branch in DEFAULT_BRANCHES:
            exists = conn.execute(
                text("SELECT 1 FROM branches WHERE code = :c"),
                {"c": branch["code"]},
            ).first()
            if not exists:
                conn.execute(
                    text(
                        "INSERT INTO branches (name, code, is_active, created_at, updated_at) "
                        "VALUES (:n, :c, 1, datetime('now'), datetime('now'))"
                    ),
                    {"n": branch["name"], "c": branch["code"]},
                )


def _init_branch_stocks(engine: Engine) -> None:
    """Initialize branch_stocks for existing products across all branches."""
    inspector = inspect(engine)
    for tbl in ("branch_stocks", "products", "branches"):
        if tbl not in inspector.get_table_names():
            return
    with engine.begin() as conn:
        branches = conn.execute(text("SELECT id FROM branches WHERE is_active = 1")).fetchall()
        products = conn.execute(text("SELECT id, stock FROM products")).fetchall()
        for branch in branches:
            for product in products:
                exists = conn.execute(
                    text("SELECT 1 FROM branch_stocks WHERE branch_id = :b AND product_id = :p"),
                    {"b": branch.id, "p": product.id},
                ).first()
                if not exists:
                    qty = product.stock or 0
                    conn.execute(
                        text(
                            "INSERT INTO branch_stocks (branch_id, product_id, quantity, created_at, updated_at) "
                            "VALUES (:b, :p, :q, datetime('now'), datetime('now'))"
                        ),
                        {"b": branch.id, "p": product.id, "q": qty},
                    )


def _add_product_indexes(engine: Engine) -> None:
    inspector = inspect(engine)
    if "products" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("products")}
    if "barcode" in columns:
        with engine.begin() as conn:
            conn.execute(text("UPDATE products SET sku = NULL WHERE sku = ''"))
            conn.execute(text("UPDATE products SET barcode = NULL WHERE barcode = ''"))
            conn.execute(
                text(
                    "UPDATE products SET barcode = NULL "
                    "WHERE barcode IS NOT NULL AND id NOT IN ("
                    "SELECT MIN(id) FROM products WHERE barcode IS NOT NULL GROUP BY barcode)"
                )
            )
    indexes = {idx["name"] for idx in inspector.get_indexes("products")}
    if "ix_products_barcode" not in indexes:
        with engine.begin() as conn:
            conn.execute(
                text("CREATE UNIQUE INDEX ix_products_barcode ON products (barcode)")
            )


def _init_product_code_sequence(engine: Engine) -> None:
    inspector = inspect(engine)
    if "sequences" not in inspector.get_table_names():
        return
    highest = 0
    if "products" in inspector.get_table_names():
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT sku FROM products WHERE sku LIKE 'PRD-%'")
            ).fetchall()
        for (value,) in rows:
            if not value:
                continue
            prefix, _, suffix = value.partition("-")
            if prefix.upper() == "PRD":
                try:
                    highest = max(highest, int(suffix))
                except ValueError:
                    continue
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT value FROM sequences WHERE name = 'product_sku'")
        ).first()
        if row is None:
            conn.execute(
                text(
                    "INSERT INTO sequences (name, value) VALUES ('product_sku', :v)"
                ),
                {"v": highest},
            )
        elif row[0] < highest:
            conn.execute(
                text("UPDATE sequences SET value = :v WHERE name = 'product_sku'"),
                {"v": highest},
            )


def run_migrations(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    _add_product_columns(engine)
    _add_payments_columns(engine)
    _add_sales_columns(engine)
    _add_user_columns(engine)
    _add_ezcash_columns(engine)
    _add_branch_columns(engine)
    _add_customer_columns(engine)
    _add_quotation_and_repair_columns(engine)
    _add_product_indexes(engine)
    _init_product_code_sequence(engine)
    _seed_master_data(engine)
    _seed_branches(engine)
    _init_branch_stocks(engine)
