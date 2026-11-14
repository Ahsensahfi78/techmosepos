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
        # Add branch_id to quotations if not exists
        if "branch_id" not in q_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE quotations ADD COLUMN branch_id INTEGER"))

    if "quotation_items" in inspector.get_table_names():
        qi_cols = {col["name"]: col for col in inspector.get_columns("quotation_items")}
        # Add any missing columns first so they exist if copying
        for col_name, ddl in _QUOTATION_ITEM_COLUMNS.items():
            if col_name not in qi_cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE quotation_items ADD COLUMN {col_name} {ddl}"))
        inspector = inspect(engine)
        qi_cols = {col["name"]: col for col in inspector.get_columns("quotation_items")}

        # Ensure product_id is nullable for custom manual line items
        if "product_id" in qi_cols and not qi_cols["product_id"].get("nullable", True):
            with engine.begin() as conn:
                conn.execute(text("PRAGMA foreign_keys = OFF;"))
                conn.execute(text("DROP TABLE IF EXISTS quotation_items_migration;"))
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
                source_cols = [c for c in [
                    "id", "quotation_id", "product_id", "product_name", "product_type",
                    "description", "qty", "unit", "price", "discount", "tax", "line_total"
                ] if c in qi_cols]
                cols_str = ", ".join(source_cols)
                conn.execute(text(f"""
                    INSERT INTO quotation_items_migration ({cols_str})
                    SELECT {cols_str} FROM quotation_items;
                """))
                conn.execute(text("DROP TABLE quotation_items;"))
                conn.execute(text("ALTER TABLE quotation_items_migration RENAME TO quotation_items;"))
                conn.execute(text("PRAGMA foreign_keys = ON;"))
            # refresh qi_cols
            inspector = inspect(engine)
            qi_cols = {col["name"]: col for col in inspector.get_columns("quotation_items")}

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
                ("store_phone", "0752246378"),
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
                        "INSERT INTO branches (name, code, type, is_active, created_at, updated_at) "
                        "VALUES (:n, :c, 'store', 1, datetime('now'), datetime('now'))"
                    ),
                    {"n": branch["name"], "c": branch["code"]},
                )


def _init_branch_stocks(engine: Engine) -> None:
    """Initialize branch_stocks for existing products across all branches.

    Existing products get a branch_stocks row per branch with quantity=0.
    Stock is branch-specific — a product only appears in a branch when stock
    is actually received there via StockService. This prevents cross-branch
    leakage where every product shows in every branch.
    """
    inspector = inspect(engine)
    for tbl in ("branch_stocks", "products", "branches"):
        if tbl not in inspector.get_table_names():
            return
    with engine.begin() as conn:
        branches = conn.execute(text("SELECT id FROM branches WHERE is_active = 1")).fetchall()
        products = conn.execute(text("SELECT id FROM products")).fetchall()
        for branch in branches:
            for product in products:
                exists = conn.execute(
                    text("SELECT 1 FROM branch_stocks WHERE branch_id = :b AND product_id = :p"),
                    {"b": branch.id, "p": product.id},
                ).first()
                if not exists:
                    conn.execute(
                        text(
                            "INSERT INTO branch_stocks (branch_id, product_id, quantity, reserved_quantity, created_at, updated_at) "
                            "VALUES (:b, :p, 0, 0, datetime('now'), datetime('now'))"
                        ),
                        {"b": branch.id, "p": product.id},
                    )


def _cleanup_branch_stocks(engine: Engine) -> None:
    """Reset existing branch_stocks quantities to 0.

    Older installs copied products.stock into branch_stocks.quantity for every
    branch, causing cross-branch leakage. Reset to 0 so products only appear
    in branches where stock was actually received via StockService.
    """
    inspector = inspect(engine)
    if "branch_stocks" not in inspector.get_table_names():
        return
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE branch_stocks SET quantity = 0, reserved_quantity = 0, updated_at = datetime('now')")
        )


def _fix_previous_quantity_column(engine: Engine) -> None:
    """Ensure stock_movements.previous_quantity exists with a default of 0.

    Older installs may have this column as NOT NULL without a default, which
    breaks StockService.apply() inserts that don't set it. Make it nullable
    with DEFAULT 0 so inserts work.
    """
    inspector = inspect(engine)
    if "stock_movements" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("stock_movements")}
    if "previous_quantity" not in cols:
        # Column doesn't exist at all — add it with DEFAULT 0
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE stock_movements ADD COLUMN previous_quantity INTEGER DEFAULT 0"
                )
            )
        return
    # Column exists — try to set a default; SQLite can't ALTER DEFAULT directly,
    # but we can make it nullable by recreating the table if needed. For now,
    # just ensure any existing NULLs are 0.
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE stock_movements SET previous_quantity = 0 WHERE previous_quantity IS NULL")
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


def _add_branch_type_columns(engine: Engine) -> None:
    """Add warehouse/store type and default-receiving flag to branches."""
    inspector = inspect(engine)
    if "branches" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("branches")}
    with engine.begin() as conn:
        if "type" not in existing:
            conn.execute(
                text("ALTER TABLE branches ADD COLUMN type VARCHAR(20) DEFAULT 'store'")
            )
        if "is_default_receiving" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE branches ADD COLUMN is_default_receiving BOOLEAN DEFAULT 0"
                )
            )


def _add_branch_stock_columns(engine: Engine) -> None:
    """Add reserved_quantity, avg_cost, last_movement_at to branch_stocks + unique index."""
    inspector = inspect(engine)
    if "branch_stocks" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("branch_stocks")}
    with engine.begin() as conn:
        if "reserved_quantity" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE branch_stocks ADD COLUMN reserved_quantity INTEGER DEFAULT 0"
                )
            )
        if "avg_cost" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE branch_stocks ADD COLUMN avg_cost FLOAT DEFAULT 0"
                )
            )
        if "last_movement_at" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE branch_stocks ADD COLUMN last_movement_at DATETIME"
                )
            )
        # Unique index on (product_id, branch_id) — safe because the old seed
        # already inserted at most one row per (branch, product).
        indexes = {idx["name"] for idx in inspector.get_indexes("branch_stocks")}
        if "ux_branch_stocks_product_branch" not in indexes:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX ux_branch_stocks_product_branch "
                    "ON branch_stocks (product_id, branch_id)"
                )
            )


def _add_stock_movement_columns(engine: Engine) -> None:
    """Add qty, idempotency_key, unit_cost, balance_after to stock_movements."""
    inspector = inspect(engine)
    if "stock_movements" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("stock_movements")}
    with engine.begin() as conn:
        if "quantity" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE stock_movements ADD COLUMN quantity INTEGER DEFAULT 0"
                )
            )
        if "qty" not in existing:
            conn.execute(
                text("ALTER TABLE stock_movements ADD COLUMN qty INTEGER")
            )
            # Backfill qty from quantity for existing rows
            conn.execute(
                text("UPDATE stock_movements SET qty = quantity WHERE qty IS NULL")
            )
        if "idempotency_key" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE stock_movements ADD COLUMN idempotency_key VARCHAR(64)"
                )
            )
        if "unit_cost" not in existing:
            conn.execute(
                text("ALTER TABLE stock_movements ADD COLUMN unit_cost FLOAT")
            )
        if "balance_after" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE stock_movements ADD COLUMN balance_after INTEGER DEFAULT 0"
                )
            )
        if "previous_quantity" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE stock_movements ADD COLUMN previous_quantity INTEGER DEFAULT 0"
                )
            )
        if "new_quantity" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE stock_movements ADD COLUMN new_quantity INTEGER DEFAULT 0"
                )
            )
        if "note" not in existing:
            conn.execute(
                text("ALTER TABLE stock_movements ADD COLUMN note TEXT")
            )
        if "created_by" not in existing:
            conn.execute(
                text("ALTER TABLE stock_movements ADD COLUMN created_by INTEGER")
            )
        # Indexes
        indexes = {idx["name"] for idx in inspector.get_indexes("stock_movements")}
        if "ix_stock_movements_branch_product_id" not in indexes:
            conn.execute(
                text(
                    "CREATE INDEX ix_stock_movements_branch_product_id "
                    "ON stock_movements (branch_id, product_id, id)"
                )
            )
        if "ix_stock_movements_reference" not in indexes:
            conn.execute(
                text(
                    "CREATE INDEX ix_stock_movements_reference "
                    "ON stock_movements (reference_type, reference_id)"
                )
            )
        if "ux_stock_movements_idempotency_key" not in indexes:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX ux_stock_movements_idempotency_key "
                    "ON stock_movements (idempotency_key)"
                )
            )


def _add_stock_transfer_columns(engine: Engine) -> None:
    """Add reference, dispatched_at, received_at to stock_transfers;
    qty_received + unique index to stock_transfer_items."""
    inspector = inspect(engine)
    if "stock_transfers" in inspector.get_table_names():
        existing = {col["name"] for col in inspector.get_columns("stock_transfers")}
        with engine.begin() as conn:
            if "reference" not in existing:
                conn.execute(
                    text("ALTER TABLE stock_transfers ADD COLUMN reference VARCHAR(100)")
                )
            if "dispatched_at" not in existing:
                conn.execute(
                    text("ALTER TABLE stock_transfers ADD COLUMN dispatched_at DATETIME")
                )
            if "received_at" not in existing:
                conn.execute(
                    text("ALTER TABLE stock_transfers ADD COLUMN received_at DATETIME")
                )

    if "stock_transfer_items" in inspector.get_table_names():
        existing = {col["name"] for col in inspector.get_columns("stock_transfer_items")}
        indexes = {idx["name"] for idx in inspector.get_indexes("stock_transfer_items")}
        with engine.begin() as conn:
            if "qty_received" not in existing:
                conn.execute(
                    text(
                        "ALTER TABLE stock_transfer_items ADD COLUMN qty_received INTEGER DEFAULT 0"
                    )
                )
            if "ux_stock_transfer_items_transfer_product" not in indexes:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX ux_stock_transfer_items_transfer_product "
                        "ON stock_transfer_items (transfer_id, product_id)"
                    )
                )


def _create_stock_triggers(engine: Engine) -> None:
    """Create triggers that keep products.stock = SUM(branch_stocks.quantity).

    products.stock is a derived, read-only aggregate. These triggers fire on
    every INSERT/UPDATE/DELETE of branch_stocks.
    """
    inspector = inspect(engine)
    if "branch_stocks" not in inspector.get_table_names():
        return
    if "products" not in inspector.get_table_names():
        return

    triggers = {
        "trg_branch_stocks_ai": """
            CREATE TRIGGER IF NOT EXISTS trg_branch_stocks_ai
            AFTER INSERT ON branch_stocks
            BEGIN
                UPDATE products
                SET stock = (
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM branch_stocks
                    WHERE product_id = NEW.product_id
                )
                WHERE id = NEW.product_id;
            END;
        """,
        "trg_branch_stocks_au": """
            CREATE TRIGGER IF NOT EXISTS trg_branch_stocks_au
            AFTER UPDATE ON branch_stocks
            BEGIN
                UPDATE products
                SET stock = (
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM branch_stocks
                    WHERE product_id = NEW.product_id
                )
                WHERE id = NEW.product_id;
            END;
        """,
        "trg_branch_stocks_ad": """
            CREATE TRIGGER IF NOT EXISTS trg_branch_stocks_ad
            AFTER DELETE ON branch_stocks
            BEGIN
                UPDATE products
                SET stock = (
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM branch_stocks
                    WHERE product_id = OLD.product_id
                )
                WHERE id = OLD.product_id;
            END;
        """,
    }
    with engine.begin() as conn:
        for name, ddl in triggers.items():
            conn.execute(text(ddl))


def _create_append_only_triggers(engine: Engine) -> None:
    """Make stock_movements append-only: BEFORE UPDATE/DELETE raise ABORT.

    Corrections must be compensating rows, never edits or deletions.
    """
    inspector = inspect(engine)
    if "stock_movements" not in inspector.get_table_names():
        return

    triggers = {
        "trg_stock_movements_bupd": """
            CREATE TRIGGER IF NOT EXISTS trg_stock_movements_bupd
            BEFORE UPDATE ON stock_movements
            BEGIN
                SELECT RAISE(ABORT, 'stock_movements is append-only: UPDATE is forbidden');
            END;
        """,
        "trg_stock_movements_bdel": """
            CREATE TRIGGER IF NOT EXISTS trg_stock_movements_bdel
            BEFORE DELETE ON stock_movements
            BEGIN
                SELECT RAISE(ABORT, 'stock_movements is append-only: DELETE is forbidden');
            END;
        """,
    }
    with engine.begin() as conn:
        for name, ddl in triggers.items():
            conn.execute(text(ddl))


def _align_user_branch_codes(engine: Engine) -> None:
    """Align existing users' ``branch`` values with branch codes.

    Older installs seeded users with full branch names (e.g. "kalmunai") while
    branches use uppercase codes (e.g. "KLM"). Match by branch name
    (case-insensitive) and rewrite the user's branch to the branch code so
    server-side branch resolution works.
    """
    inspector = inspect(engine)
    for tbl in ("users", "branches"):
        if tbl not in inspector.get_table_names():
            return
    with engine.begin() as conn:
        branches = conn.execute(
            text("SELECT id, name, code FROM branches WHERE is_active = 1")
        ).fetchall()
        users = conn.execute(
            text("SELECT id, branch FROM users WHERE branch IS NOT NULL AND branch != ''")
        ).fetchall()
        for uid, user_branch in users:
            for bid, bname, bcode in branches:
                if bname and user_branch.strip().lower() == bname.strip().lower():
                    conn.execute(
                        text("UPDATE users SET branch = :c WHERE id = :u"),
                        {"c": bcode, "u": uid},
                    )
                    break


def _seed_warehouse_branch(engine: Engine) -> None:
    """Ensure a warehouse branch exists for receiving stock."""
    inspector = inspect(engine)
    if "branches" not in inspector.get_table_names():
        return
    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM branches WHERE type = 'warehouse' LIMIT 1")
        ).first()
        if not exists:
            conn.execute(
                text(
                    "INSERT INTO branches (name, code, type, is_default_receiving, "
                    "is_active, created_at, updated_at) "
                    "VALUES ('Main Warehouse', 'WH-001', 'warehouse', 1, 1, "
                    "datetime('now'), datetime('now'))"
                )
            )
def _backfill_opening_movements(engine: Engine) -> None:
    """Backfill opening movements so ledger sum == branch_stocks.quantity.

    Opening stock is received into the default receiving branch (or the first
    warehouse branch). This is run once at cutover.
    """
    inspector = inspect(engine)
    for tbl in ("branch_stocks", "products", "branches", "stock_movements"):
        if tbl not in inspector.get_table_names():
            return

    with engine.begin() as conn:
        # Find the default receiving branch (warehouse preferred)
        receiving = conn.execute(
            text(
                "SELECT id FROM branches WHERE is_default_receiving = 1 "
                "AND is_active = 1 LIMIT 1"
            )
        ).first()
        if not receiving:
            receiving = conn.execute(
                text(
                    "SELECT id FROM branches WHERE type = 'warehouse' "
                    "AND is_active = 1 LIMIT 1"
                )
            ).first()
        if not receiving:
            receiving = conn.execute(
                text("SELECT id FROM branches WHERE is_active = 1 LIMIT 1")
            ).first()
        if not receiving:
            return
        warehouse_branch_id = receiving[0]

        # Only backfill if no opening movements exist yet
        already = conn.execute(
            text("SELECT 1 FROM stock_movements WHERE movement_type = 'opening' LIMIT 1")
        ).first()
        if already:
            return

        # Get current branch_stock quantities as the opening balance
        rows = conn.execute(
            text(
                "SELECT product_id, branch_id, quantity FROM branch_stocks"
            )
        ).fetchall()

        for product_id, branch_id, qty in rows:
            if qty and qty != 0:
                conn.execute(
                    text(
                        "INSERT INTO stock_movements "
                        "(branch_id, product_id, qty, quantity, previous_quantity, "
                        "new_quantity, movement_type, reference_type, reference_id, "
                        "balance_after, note, created_by, created_at) "
                        "VALUES (:b, :p, :q, :q, 0, :q, 'opening', 'opening', NULL, "
                        ":ba, 'Opening balance', NULL, datetime('now'))"
                    ),
                    {
                        "b": branch_id,
                        "p": product_id,
                        "q": qty,
                        "ba": qty,
                    },
                )


def _init_branch_stocks(engine: Engine) -> None:
    """Initialize branch_stocks table structure only.

    NOTE: We no longer pre-seed every product into every branch. Rows appear
    lazily via StockService when stock physically moves into a branch.
    Existing rows from previous seeds are left untouched.
    """
    inspector = inspect(engine)
    if "branch_stocks" not in inspector.get_table_names():
        return
    # Table exists — nothing to seed automatically.
    # New branches start with zero stock implicitly (LEFT JOIN + COALESCE(0) on reads).
    pass


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
    # ── Multi-branch inventory (additive, deployable independently) ─────
    _add_branch_type_columns(engine)
    _add_branch_stock_columns(engine)
    _add_stock_movement_columns(engine)
    _add_stock_transfer_columns(engine)
    _create_stock_triggers(engine)
    _create_append_only_triggers(engine)
    _seed_master_data(engine)
    _seed_branches(engine)
    _align_user_branch_codes(engine)
    _seed_warehouse_branch(engine)
    _init_branch_stocks(engine)  # no longer copies products into branches
    _cleanup_branch_stocks(engine)  # reset leaked cross-branch stock to 0
    _fix_previous_quantity_column(engine)  # ensure column has DEFAULT 0
    # NOTE: _backfill_opening_movements is NOT called here. It must be run
    # explicitly via the backfill CLI command after the user confirms which
    # opening-balance mode reflects physical reality.
