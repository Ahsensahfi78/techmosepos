"""Unified transaction feed, detail and search.

Read-only aggregation over the existing sales / purchases / sale_returns /
purchase_returns / stock_transactions / payments tables. No new tables are
created; the permanent key is the existing database id, and display
references (INV-/PUR-/SRT-/PRT-) are derived so a receipt is never required
to locate a transaction.
"""
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas

TYPE_KEYS = {
    "sale": "SALE",
    "purchase": "PURCHASE",
    "sale_return": "SALE_RETURN",
    "purchase_return": "PURCHASE_RETURN",
}


def _like(q: str | None) -> str | None:
    if not q:
        return None
    return f"%{q.strip().lower()}%"


def _where(prefix: str, f: dict) -> tuple[str, dict]:
    """Build a per-type WHERE clause from common filters (base column refs).

    Returns (sql_fragment, params). ``f`` carries: q, product_id, date_from,
    date_to, created_by, method, status plus the type-specific column refs
    ref_expr, id_col, party_name_col, party_phone_col, items_table,
    items_fk, main_alias, date_col, method_col, method_fk.
    """
    conds: list[str] = []
    params: dict = {}

    def bind(name: str, value):
        params[f"{prefix}{name}"] = value

    q = _like(f.get("q"))
    if q:
        bind("q", q)
        conds.append(
            f"""(
                LOWER({f['ref_expr']}) LIKE :{prefix}q
                OR CAST({f['id_col']} AS TEXT) LIKE :{prefix}q
                OR LOWER(COALESCE({f['party_name_col']}, '')) LIKE :{prefix}q
                OR LOWER(COALESCE({f['party_phone_col']}, '')) LIKE :{prefix}q
                OR EXISTS (
                    SELECT 1 FROM {f['items_table']} it
                    JOIN products p ON p.id = it.product_id
                    WHERE it.{f['items_fk']} = {f['main_alias']}.id
                      AND (
                          LOWER(p.name) LIKE :{prefix}q
                          OR LOWER(COALESCE(p.sku, '')) LIKE :{prefix}q
                          OR LOWER(COALESCE(p.barcode, '')) LIKE :{prefix}q
                          OR LOWER(COALESCE(p.model, '')) LIKE :{prefix}q
                      )
                )
            )"""
        )

    if f.get("product_id"):
        bind("pid", f["product_id"])
        conds.append(
            f"""EXISTS (
                SELECT 1 FROM {f['items_table']} it
                WHERE it.{f['items_fk']} = {f['main_alias']}.id
                  AND it.product_id = :{prefix}pid
            )"""
        )

    if f.get("date_from"):
        bind("df", f["date_from"])
        conds.append(f"{f['date_col']} >= :{prefix}df")
    if f.get("date_to"):
        bind("dt", f["date_to"])
        conds.append(f"{f['date_col']} <= :{prefix}dt")

    if f.get("created_by"):
        bind("cb", f["created_by"])
        conds.append(f"{f['main_alias']}.created_by = :{prefix}cb")

    if f.get("method") and f.get("method_col"):
        bind("m", f["method"])
        if f["method_col"] == "payments":
            conds.append(
                f"""EXISTS (
                    SELECT 1 FROM payments pm
                    WHERE pm.{f['method_fk']} = {f['main_alias']}.id
                      AND pm.method = :{prefix}m
                )"""
            )
        else:
            conds.append(f"{f['method_col']} = :{prefix}m")

    if f.get("status"):
        statuses = [s.strip() for s in str(f["status"]).split(",") if s.strip()]
        if statuses:
            binds = ", ".join(f":{prefix}st{i}" for i in range(len(statuses)))
            for i, st in enumerate(statuses):
                bind(f"st{i}", st)
            conds.append(f"{f['main_alias']}.status IN ({binds})")

    return (" AND ".join(conds), params) if conds else ("1=1", params)


def _sale_select(f: dict) -> tuple[str, dict]:
    conds, params = _where("s_", f)
    return (
        f"""SELECT
            'sale' AS type,
            s.id AS db_id,
            s.created_at AS date,
            'INV-' || substr('000000' || CAST(s.id AS TEXT), -6) AS reference,
            'customer' AS party_type,
            s.customer_id AS party_id,
            c.name AS party_name,
            c.phone AS party_phone,
            s.subtotal AS subtotal,
            s.discount_amount AS discount,
            s.tax_amount AS tax,
            s.total AS total,
            s.paid_amount AS paid,
            round(MAX(0.0, s.total - s.paid_amount), 2) AS due,
            s.payment_method AS payment_method,
            s.status AS status,
            COALESCE(sic.cnt, 0) AS item_count,
            u.full_name AS created_by
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN users u ON u.id = s.created_by
        LEFT JOIN (SELECT sale_id, COUNT(*) AS cnt FROM sale_items GROUP BY sale_id) sic ON sic.sale_id = s.id
        WHERE {conds}""",
        params,
    )


def _purchase_select(f: dict) -> tuple[str, dict]:
    conds, params = _where("pu_", f)
    method_clause = ""
    if f.get("method"):
        method_clause = (
            " AND EXISTS (SELECT 1 FROM payments pm WHERE pm.purchase_id = p.id AND pm.method = :pu_m)"
        )
        params["pu_m"] = f["method"]
    return (
        f"""SELECT
            'purchase' AS type,
            p.id AS db_id,
            p.purchase_date AS date,
            p.purchase_number AS reference,
            'supplier' AS party_type,
            p.supplier_id AS party_id,
            sup.name AS party_name,
            sup.phone AS party_phone,
            p.subtotal AS subtotal,
            p.discount_amount AS discount,
            p.tax_amount AS tax,
            p.total AS total,
            p.paid_amount AS paid,
            round(MAX(0.0, p.total - p.paid_amount), 2) AS due,
            NULL AS payment_method,
            p.status AS status,
            COALESCE(pic.cnt, 0) AS item_count,
            u.full_name AS created_by
        FROM purchases p
        LEFT JOIN suppliers sup ON sup.id = p.supplier_id
        LEFT JOIN users u ON u.id = p.created_by
        LEFT JOIN (SELECT purchase_id, COUNT(*) AS cnt FROM purchase_items GROUP BY purchase_id) pic ON pic.purchase_id = p.id
        WHERE {conds}{method_clause}""",
        params,
    )


def _sale_return_select(f: dict) -> tuple[str, dict]:
    conds, params = _where("sr_", f)
    return (
        f"""SELECT
            'sale_return' AS type,
            r.id AS db_id,
            r.return_date AS date,
            r.return_number AS reference,
            'customer' AS party_type,
            r.customer_id AS party_id,
            c.name AS party_name,
            c.phone AS party_phone,
            r.total AS subtotal,
            0.0 AS discount,
            0.0 AS tax,
            r.total AS total,
            r.total AS paid,
            0.0 AS due,
            NULL AS payment_method,
            'completed' AS status,
            COALESCE(ric.cnt, 0) AS item_count,
            u.full_name AS created_by
        FROM sale_returns r
        LEFT JOIN customers c ON c.id = r.customer_id
        LEFT JOIN users u ON u.id = r.created_by
        LEFT JOIN (SELECT return_id, COUNT(*) AS cnt FROM sale_return_items GROUP BY return_id) ric ON ric.return_id = r.id
        WHERE {conds}""",
        params,
    )


def _purchase_return_select(f: dict) -> tuple[str, dict]:
    conds, params = _where("pr_", f)
    return (
        f"""SELECT
            'purchase_return' AS type,
            r.id AS db_id,
            r.return_date AS date,
            r.return_number AS reference,
            'supplier' AS party_type,
            r.supplier_id AS party_id,
            sup.name AS party_name,
            sup.phone AS party_phone,
            r.total AS subtotal,
            0.0 AS discount,
            0.0 AS tax,
            r.total AS total,
            r.total AS paid,
            0.0 AS due,
            NULL AS payment_method,
            'completed' AS status,
            COALESCE(ric.cnt, 0) AS item_count,
            u.full_name AS created_by
        FROM purchase_returns r
        LEFT JOIN suppliers sup ON sup.id = r.supplier_id
        LEFT JOIN users u ON u.id = r.created_by
        LEFT JOIN (SELECT return_id, COUNT(*) AS cnt FROM purchase_return_items GROUP BY return_id) ric ON ric.return_id = r.id
        WHERE {conds}""",
        params,
    )


_TABLE_INFO = {
    "sale": {
        "select": _sale_select,
        "items_table": "sale_items",
        "items_fk": "sale_id",
        "date_col": "s.created_at",
        "main_alias": "s",
        "ref_expr": "'INV-' || substr('000000' || CAST(s.id AS TEXT), -6)",
        "id_col": "s.id",
        "party_name_col": "c.name",
        "party_phone_col": "c.phone",
        "method_col": "s.payment_method",
        "method_fk": None,
    },
    "purchase": {
        "select": _purchase_select,
        "items_table": "purchase_items",
        "items_fk": "purchase_id",
        "date_col": "p.purchase_date",
        "main_alias": "p",
        "ref_expr": "p.purchase_number",
        "id_col": "p.id",
        "party_name_col": "sup.name",
        "party_phone_col": "sup.phone",
        "method_col": "payments",
        "method_fk": "purchase_id",
    },
    "sale_return": {
        "select": _sale_return_select,
        "items_table": "sale_return_items",
        "items_fk": "return_id",
        "date_col": "r.return_date",
        "main_alias": "r",
        "ref_expr": "r.return_number",
        "id_col": "r.id",
        "party_name_col": "c.name",
        "party_phone_col": "c.phone",
        "method_col": None,
        "method_fk": None,
    },
    "purchase_return": {
        "select": _purchase_return_select,
        "items_table": "purchase_return_items",
        "items_fk": "return_id",
        "date_col": "r.return_date",
        "main_alias": "r",
        "ref_expr": "r.return_number",
        "id_col": "r.id",
        "party_name_col": "sup.name",
        "party_phone_col": "sup.phone",
        "method_col": None,
        "method_fk": None,
    },
}


def _row_to_record(row) -> schemas.TransactionRecord:
    return schemas.TransactionRecord(
        type=row.type,
        db_id=row.db_id,
        key=f"{TYPE_KEYS[row.type]}-{row.db_id}",
        reference=row.reference,
        date=row.date,
        party_type=row.party_type,
        party_id=row.party_id,
        party_name=row.party_name,
        party_phone=row.party_phone,
        subtotal=row.subtotal or 0.0,
        discount=row.discount or 0.0,
        tax=row.tax or 0.0,
        total=row.total or 0.0,
        paid=row.paid or 0.0,
        due=row.due or 0.0,
        payment_method=row.payment_method,
        status=row.status,
        item_count=row.item_count or 0,
        created_by=row.created_by,
    )


def search_transactions(
    db: Session,
    q: str | None = None,
    type: str | None = None,
    party_type: str | None = None,
    party_id: int | None = None,
    product_id: int | None = None,
    method: str | None = None,
    status: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    created_by: int | None = None,
    page: int = 1,
    page_size: int = 20,
    visible_types: list[str] | None = None,
):
    """Paginated unified feed across all transaction types."""
    types = ["sale", "purchase", "sale_return", "purchase_return"]
    if visible_types:
        types = [t for t in types if t in visible_types]
    if type:
        types = [type] if type in types else []

    filters = {
        "q": q,
        "product_id": product_id,
        "date_from": date_from,
        "date_to": date_to,
        "created_by": created_by,
        "method": method,
        "status": status,
    }

    subqueries: list[str] = []
    params: dict = {}
    for t in types:
        info = _TABLE_INFO[t]
        merged = dict(filters)
        for key in (
            "items_table",
            "items_fk",
            "date_col",
            "main_alias",
            "ref_expr",
            "id_col",
            "party_name_col",
            "party_phone_col",
            "method_col",
            "method_fk",
        ):
            merged[key] = info[key]
        sql, sub_params = info["select"](merged)
        subqueries.append(sql)
        params.update(sub_params)

    if not subqueries:
        return [], 0, 0

    union_sql = " UNION ALL ".join(subqueries)

    outer: list[str] = []
    if party_type == "none":
        outer.append("(party_type IS NULL AND type IN ('sale','sale_return'))")
    elif party_type:
        outer.append("party_type = :party_type")
        params["party_type"] = party_type
    if party_id:
        outer.append("party_id = :party_id")
        params["party_id"] = party_id

    outer_sql = f" WHERE {' AND '.join(outer)}" if outer else ""

    total = db.execute(
        text(f"SELECT COUNT(*) AS c FROM ({union_sql}) t{outer_sql}"), params
    ).one().c

    rows = db.execute(
        text(
            f"""SELECT * FROM ({union_sql}) t{outer_sql}
            ORDER BY t.date DESC, t.db_id DESC
            LIMIT :limit OFFSET :offset"""
        ),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    ).all()

    total_pages = max(1, (total + page_size - 1) // page_size)
    return [_row_to_record(r) for r in rows], total, total_pages


# ── Detail ───────────────────────────────────────────────────────────────

def _find_source_purchase(db: Session, product_id: int, before: datetime | None):
    """Best-effort trace: most recent purchase of this product (optionally
    dated before the sale) with its supplier contact details."""
    conds = "pi.product_id = :pid"
    params: dict = {"pid": product_id}
    if before is not None:
        conds += " AND (pur.purchase_date <= :bd OR pur.purchase_date IS NULL)"
        params["bd"] = before
    row = db.execute(
        text(
            f"""SELECT pi.purchase_id AS purchase_id,
                pur.purchase_number AS purchase_number,
                pur.purchase_date AS purchase_date,
                pur.invoice_number AS invoice_number,
                sup.id AS supplier_id,
                sup.name AS supplier_name,
                sup.phone AS supplier_phone,
                sup.email AS supplier_email,
                pi.cost_price AS cost_price,
                pi.line_total AS line_total,
                pi.qty AS qty_purchased
            FROM purchase_items pi
            JOIN purchases pur ON pur.id = pi.purchase_id
            JOIN suppliers sup ON sup.id = pur.supplier_id
            WHERE {conds}
            ORDER BY pur.purchase_date DESC
            LIMIT 1"""
        ),
        params,
    ).first()
    if not row:
        return None
    return schemas.SourcePurchaseOut(
        purchase_id=row.purchase_id,
        purchase_number=row.purchase_number,
        purchase_date=row.purchase_date,
        supplier_id=row.supplier_id,
        supplier_name=row.supplier_name,
        supplier_phone=row.supplier_phone,
        supplier_email=row.supplier_email,
        cost_price=row.cost_price or 0.0,
        line_total=row.line_total or 0.0,
        qty_purchased=row.qty_purchased or 0,
        invoice_number=row.invoice_number,
    )


def _movements(db: Session, reason: str, reference_id: int) -> list:
    rows = db.execute(
        text(
            """SELECT st.product_id AS product_id, p.name AS product_name,
                st.change_qty AS change_qty, st.previous_stock AS previous_stock,
                st.new_stock AS new_stock, st.reason AS reason, st.created_at AS created_at
            FROM stock_transactions st
            LEFT JOIN products p ON p.id = st.product_id
            WHERE st.reason = :reason AND st.reference_id = :rid
            ORDER BY st.created_at"""
        ),
        {"reason": reason, "rid": reference_id},
    ).all()
    return [
        schemas.TransactionMovementOut(
            product_id=r.product_id,
            product_name=r.product_name or f"Product #{r.product_id}",
            change_qty=r.change_qty,
            previous_stock=r.previous_stock,
            new_stock=r.new_stock,
            reason=r.reason,
            created_at=r.created_at,
        )
        for r in rows
    ]


def _sale_detail(db: Session, sale_id: int) -> schemas.TransactionDetailOut:
    s = db.execute(
        text(
            """SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
                c.email AS customer_email, u.full_name AS user_name
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
            LEFT JOIN users u ON u.id = s.created_by
            WHERE s.id = :id"""
        ),
        {"id": sale_id},
    ).mappings().first()
    if not s:
        raise ValueError("sale not found")

    item_rows = db.execute(
        text(
            """SELECT si.product_id AS product_id, p.name AS product_name,
                p.sku AS sku, p.barcode AS barcode, si.qty AS qty,
                si.price AS price, si.line_total AS line_total
            FROM sale_items si
            LEFT JOIN products p ON p.id = si.product_id
            WHERE si.sale_id = :id ORDER BY si.id"""
        ),
        {"id": sale_id},
    ).all()

    items = []
    for r in item_rows:
        items.append(
            schemas.TransactionItemOut(
                product_id=r.product_id,
                product_name=r.product_name or f"Product #{r.product_id}",
                sku=r.sku,
                barcode=r.barcode,
                qty=r.qty,
                unit_price=r.price,
                line_total=r.line_total,
                source_purchase=_find_source_purchase(db, r.product_id, s.created_at),
            )
        )

    payments = []
    if s.paid_amount and s.paid_amount > 0:
        payments.append(
            schemas.TransactionPaymentOut(
                amount=s.paid_amount,
                method=s.payment_method or "cash",
                reference=f"INV-{sale_id:06d}",
                date=s.created_at,
            )
        )
    pay_rows = db.execute(
        text(
            """SELECT amount, method, reference, payment_date
            FROM payments
            WHERE party_type = 'customer' AND party_id = :cid
              AND (reference = :r1 OR reference = :r2 OR note LIKE :r3)
            ORDER BY payment_date"""
        ),
        {
            "cid": s.customer_id,
            "r1": f"INV-{sale_id:06d}",
            "r2": f"SALE-{sale_id}",
            "r3": f"%sale #{sale_id}%",
        },
    ).all()
    seen_refs = {p.reference for p in payments}
    for r in pay_rows:
        if r.reference not in seen_refs:
            payments.append(
                schemas.TransactionPaymentOut(
                    amount=r.amount, method=r.method, reference=r.reference, date=r.payment_date
                )
            )
            seen_refs.add(r.reference)

    return_rows = db.execute(
        text(
            """SELECT id, return_number, return_date, total FROM sale_returns
            WHERE sale_id = :id ORDER BY return_date"""
        ),
        {"id": sale_id},
    ).all()
    related = [
        schemas.RelatedTransactionOut(
            type="sale_return",
            db_id=r.id,
            key=f"{TYPE_KEYS['sale_return']}-{r.id}",
            reference=r.return_number,
            date=r.return_date,
            total=r.total or 0.0,
            status="completed",
        )
        for r in return_rows
    ]

    return schemas.TransactionDetailOut(
        type="sale",
        db_id=sale_id,
        key=f"SALE-{sale_id}",
        reference=f"INV-{sale_id:06d}",
        date=s.created_at,
        party_type="customer" if s.customer_id else None,
        party_id=s.customer_id,
        party_name=s.customer_name,
        party_phone=s.customer_phone,
        party_email=s.customer_email,
        subtotal=s.subtotal or 0.0,
        discount=s.discount_amount or 0.0,
        tax=s.tax_amount or 0.0,
        total=s.total or 0.0,
        paid=s.paid_amount or 0.0,
        due=max(0.0, (s.total or 0.0) - (s.paid_amount or 0.0)),
        payment_method=s.payment_method,
        status=s.status,
        created_by=s.user_name,
        created_at=s.created_at,
        items=items,
        payments=payments,
        movements=_movements(db, "sale", sale_id),
        related_returns=related,
    )


def _purchase_detail(db: Session, purchase_id: int) -> schemas.TransactionDetailOut:
    p = db.execute(
        text(
            """SELECT p.*, sup.name AS supplier_name, sup.phone AS supplier_phone,
                sup.email AS supplier_email, u.full_name AS user_name
            FROM purchases p
            LEFT JOIN suppliers sup ON sup.id = p.supplier_id
            LEFT JOIN users u ON u.id = p.created_by
            WHERE p.id = :id"""
        ),
        {"id": purchase_id},
    ).mappings().first()
    if not p:
        raise ValueError("purchase not found")

    item_rows = db.execute(
        text(
            """SELECT pi.product_id AS product_id, pr.name AS product_name,
                pr.sku AS sku, pr.barcode AS barcode, pi.qty AS qty,
                pi.cost_price AS price, pi.line_total AS line_total
            FROM purchase_items pi
            LEFT JOIN products pr ON pr.id = pi.product_id
            WHERE pi.purchase_id = :id ORDER BY pi.id"""
        ),
        {"id": purchase_id},
    ).all()

    items = [
        schemas.TransactionItemOut(
            product_id=r.product_id,
            product_name=r.product_name or f"Product #{r.product_id}",
            sku=r.sku,
            barcode=r.barcode,
            qty=r.qty,
            unit_price=r.price,
            line_total=r.line_total,
        )
        for r in item_rows
    ]

    pay_rows = db.execute(
        text(
            """SELECT amount, method, reference, payment_date FROM payments
            WHERE purchase_id = :id ORDER BY payment_date"""
        ),
        {"id": purchase_id},
    ).all()
    payments = [
        schemas.TransactionPaymentOut(
            amount=r.amount, method=r.method, reference=r.reference, date=r.payment_date
        )
        for r in pay_rows
    ]

    return_rows = db.execute(
        text(
            """SELECT id, return_number, return_date, total FROM purchase_returns
            WHERE purchase_id = :id ORDER BY return_date"""
        ),
        {"id": purchase_id},
    ).all()
    related = [
        schemas.RelatedTransactionOut(
            type="purchase_return",
            db_id=r.id,
            key=f"{TYPE_KEYS['purchase_return']}-{r.id}",
            reference=r.return_number,
            date=r.return_date,
            total=r.total or 0.0,
            status="completed",
        )
        for r in return_rows
    ]

    return schemas.TransactionDetailOut(
        type="purchase",
        db_id=purchase_id,
        key=f"PURCHASE-{purchase_id}",
        reference=p.purchase_number,
        date=p.purchase_date,
        party_type="supplier",
        party_id=p.supplier_id,
        party_name=p.supplier_name,
        party_phone=p.supplier_phone,
        party_email=p.supplier_email,
        subtotal=p.subtotal or 0.0,
        discount=p.discount_amount or 0.0,
        tax=p.tax_amount or 0.0,
        total=p.total or 0.0,
        paid=p.paid_amount or 0.0,
        due=max(0.0, (p.total or 0.0) - (p.paid_amount or 0.0)),
        payment_method=None,
        status=p.status,
        note=p.notes,
        created_by=p.user_name,
        created_at=p.created_at,
        items=items,
        payments=payments,
        movements=_movements(db, "purchase", purchase_id),
        related_returns=related,
    )


def _sale_return_detail(db: Session, return_id: int) -> schemas.TransactionDetailOut:
    r = db.execute(
        text(
            """SELECT r.*, c.name AS customer_name, c.phone AS customer_phone,
                c.email AS customer_email, u.full_name AS user_name,
                s.created_at AS sale_date, s.total AS sale_total, s.status AS sale_status
            FROM sale_returns r
            LEFT JOIN customers c ON c.id = r.customer_id
            LEFT JOIN users u ON u.id = r.created_by
            LEFT JOIN sales s ON s.id = r.sale_id
            WHERE r.id = :id"""
        ),
        {"id": return_id},
    ).mappings().first()
    if not r:
        raise ValueError("sale return not found")

    item_rows = db.execute(
        text(
            """SELECT ri.product_id AS product_id, p.name AS product_name,
                p.sku AS sku, p.barcode AS barcode, ri.qty AS qty,
                ri.price AS price, ri.line_total AS line_total
            FROM sale_return_items ri
            LEFT JOIN products p ON p.id = ri.product_id
            WHERE ri.return_id = :id ORDER BY ri.id"""
        ),
        {"id": return_id},
    ).all()
    items = [
        schemas.TransactionItemOut(
            product_id=r2.product_id,
            product_name=r2.product_name or f"Product #{r2.product_id}",
            sku=r2.sku,
            barcode=r2.barcode,
            qty=r2.qty,
            unit_price=r2.price,
            line_total=r2.line_total,
            source_purchase=_find_source_purchase(
                db, r2.product_id, r.sale_date or r.created_at
            ),
        )
        for r2 in item_rows
    ]

    original = None
    if r.sale_id:
        original = schemas.RelatedTransactionOut(
            type="sale",
            db_id=r.sale_id,
            key=f"SALE-{r.sale_id}",
            reference=f"INV-{r.sale_id:06d}",
            date=r.sale_date,
            total=r.sale_total or 0.0,
            status=r.sale_status or "completed",
        )

    return schemas.TransactionDetailOut(
        type="sale_return",
        db_id=return_id,
        key=f"SALE_RETURN-{return_id}",
        reference=r.return_number,
        date=r.return_date,
        party_type="customer" if r.customer_id else None,
        party_id=r.customer_id,
        party_name=r.customer_name,
        party_phone=r.customer_phone,
        party_email=r.customer_email,
        subtotal=r.total or 0.0,
        discount=0.0,
        tax=0.0,
        total=r.total or 0.0,
        paid=r.total or 0.0,
        due=0.0,
        payment_method=None,
        status="completed",
        note=r.reason,
        created_by=r.user_name,
        created_at=r.created_at,
        items=items,
        movements=_movements(db, "sale_return", return_id),
        original=original,
    )


def _purchase_return_detail(db: Session, return_id: int) -> schemas.TransactionDetailOut:
    r = db.execute(
        text(
            """SELECT r.*, sup.name AS supplier_name, sup.phone AS supplier_phone,
                sup.email AS supplier_email, u.full_name AS user_name,
                p.purchase_date AS purchase_date, p.total AS purchase_total,
                p.status AS purchase_status
            FROM purchase_returns r
            LEFT JOIN suppliers sup ON sup.id = r.supplier_id
            LEFT JOIN users u ON u.id = r.created_by
            LEFT JOIN purchases p ON p.id = r.purchase_id
            WHERE r.id = :id"""
        ),
        {"id": return_id},
    ).mappings().first()
    if not r:
        raise ValueError("purchase return not found")

    item_rows = db.execute(
        text(
            """SELECT ri.product_id AS product_id, p.name AS product_name,
                p.sku AS sku, p.barcode AS barcode, ri.qty AS qty,
                ri.cost_price AS price, ri.line_total AS line_total
            FROM purchase_return_items ri
            LEFT JOIN products p ON p.id = ri.product_id
            WHERE ri.return_id = :id ORDER BY ri.id"""
        ),
        {"id": return_id},
    ).all()
    items = [
        schemas.TransactionItemOut(
            product_id=r2.product_id,
            product_name=r2.product_name or f"Product #{r2.product_id}",
            sku=r2.sku,
            barcode=r2.barcode,
            qty=r2.qty,
            unit_price=r2.price,
            line_total=r2.line_total,
        )
        for r2 in item_rows
    ]

    original = None
    if r.purchase_id:
        original = schemas.RelatedTransactionOut(
            type="purchase",
            db_id=r.purchase_id,
            key=f"PURCHASE-{r.purchase_id}",
            reference=r.purchase_number if hasattr(r, "purchase_number") else f"PUR-{r.purchase_id}",
            date=r.purchase_date,
            total=r.purchase_total or 0.0,
            status=r.purchase_status or "paid",
        )

    return schemas.TransactionDetailOut(
        type="purchase_return",
        db_id=return_id,
        key=f"PURCHASE_RETURN-{return_id}",
        reference=r.return_number,
        date=r.return_date,
        party_type="supplier",
        party_id=r.supplier_id,
        party_name=r.supplier_name,
        party_phone=r.supplier_phone,
        party_email=r.supplier_email,
        subtotal=r.total or 0.0,
        discount=0.0,
        tax=0.0,
        total=r.total or 0.0,
        paid=r.total or 0.0,
        due=0.0,
        payment_method=None,
        status="completed",
        note=r.reason,
        created_by=r.user_name,
        created_at=r.created_at,
        items=items,
        movements=_movements(db, "purchase_return", return_id),
        original=original,
    )


DETAIL_BUILDERS = {
    "sale": _sale_detail,
    "purchase": _purchase_detail,
    "sale_return": _sale_return_detail,
    "purchase_return": _purchase_return_detail,
}


def get_transaction_detail(db: Session, type: str, db_id: int) -> schemas.TransactionDetailOut:
    builder = DETAIL_BUILDERS.get(type)
    if not builder:
        raise ValueError("unknown transaction type")
    return builder(db, db_id)


# ── Global search ────────────────────────────────────────────────────────

def global_search(db: Session, q: str, visible_types: list[str] | None = None):
    like = _like(q)
    if not like:
        return schemas.GlobalSearchOut()

    customers = db.execute(
        text(
            """SELECT c.id AS id, c.name AS name, c.phone AS phone, c.email AS email,
                c.due_balance AS due,
                (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS txn_count
            FROM customers c
            WHERE LOWER(COALESCE(c.name,'')) LIKE :q
               OR LOWER(COALESCE(c.phone,'')) LIKE :q
               OR LOWER(COALESCE(c.email,'')) LIKE :q
            ORDER BY c.name LIMIT 6"""
        ),
        {"q": like},
    ).all()

    suppliers = db.execute(
        text(
            """SELECT s.id AS id, s.name AS name, s.phone AS phone, s.email AS email,
                s.due_balance AS due,
                (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS txn_count
            FROM suppliers s
            WHERE LOWER(COALESCE(s.name,'')) LIKE :q
               OR LOWER(COALESCE(s.phone,'')) LIKE :q
               OR LOWER(COALESCE(s.email,'')) LIKE :q
            ORDER BY s.name LIMIT 6"""
        ),
        {"q": like},
    ).all()

    products = db.execute(
        text(
            """SELECT p.id AS id, p.name AS name, p.sku AS sku, p.barcode AS barcode,
                p.price AS price, p.stock AS stock, p.category AS category
            FROM products p
            WHERE LOWER(COALESCE(p.name,'')) LIKE :q
               OR LOWER(COALESCE(p.sku,'')) LIKE :q
               OR LOWER(COALESCE(p.barcode,'')) LIKE :q
               OR LOWER(COALESCE(p.model,'')) LIKE :q
            ORDER BY p.name LIMIT 6"""
        ),
        {"q": like},
    ).all()

    txns, _, _ = search_transactions(
        db, q=q, page=1, page_size=8, visible_types=visible_types
    )

    return schemas.GlobalSearchOut(
        customers=[
            schemas.GlobalSearchHit(
                kind="customer",
                id=c.id,
                title=c.name,
                subtitle=c.phone,
                meta=f"Due {c.due or 0.0:.2f} · {c.txn_count or 0} transactions",
            )
            for c in customers
        ],
        suppliers=[
            schemas.GlobalSearchHit(
                kind="supplier",
                id=s.id,
                title=s.name,
                subtitle=s.phone,
                meta=f"Due {s.due or 0.0:.2f} · {s.txn_count or 0} transactions",
            )
            for s in suppliers
        ],
        products=[
            schemas.GlobalSearchHit(
                kind="product",
                id=p.id,
                title=p.name,
                subtitle=" ".join(x for x in (p.sku, p.barcode) if x) or p.category,
                meta=f"{p.price or 0.0:.2f} · stock {p.stock or 0}",
            )
            for p in products
        ],
        transactions=txns,
    )


# ── Product history summary ──────────────────────────────────────────────

def product_history_summary(db: Session, product_id: int) -> schemas.ProductHistorySummaryOut:
    product = db.execute(
        text("SELECT * FROM products WHERE id = :id"), {"id": product_id}
    ).mappings().first()
    if not product:
        raise ValueError("product not found")

    def total_for(reason: str, sign: int = 1) -> int:
        row = db.execute(
            text(
                "SELECT COALESCE(SUM(change_qty), 0) AS v FROM stock_transactions "
                "WHERE product_id = :pid AND reason = :reason"
            ),
            {"pid": product_id, "reason": reason},
        ).one()
        return sign * (row.v or 0)

    purchased = total_for("purchase")
    sold = -total_for("sale")
    sale_returns = total_for("sale_return")
    purchase_returns = -total_for("purchase_return")
    adjustments = total_for("adjustment")
    current = product.stock or 0
    opening = current - (purchased - sold + sale_returns - purchase_returns + adjustments)

    return schemas.ProductHistorySummaryOut(
        product_id=product.id,
        product_name=product.name,
        sku=product.sku,
        barcode=product.barcode,
        opening_stock=opening,
        purchased=purchased,
        sold=sold,
        sale_returns=sale_returns,
        purchase_returns=purchase_returns,
        adjustments=adjustments,
        current_stock=current,
    )
