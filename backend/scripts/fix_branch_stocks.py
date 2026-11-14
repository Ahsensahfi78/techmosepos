from app.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()

# Sync branch_stocks.quantity from the ledger (stock_movements is the source of truth)
db.execute(
    text(
        """
        UPDATE branch_stocks
        SET quantity = (
            SELECT COALESCE(SUM(qty), 0)
            FROM stock_movements sm
            WHERE sm.branch_id = branch_stocks.branch_id
              AND sm.product_id = branch_stocks.product_id
              AND sm.movement_type = 'opening'
        ),
        last_movement_at = datetime('now'),
        updated_at = datetime('now')
        WHERE EXISTS (
            SELECT 1 FROM stock_movements sm
            WHERE sm.branch_id = branch_stocks.branch_id
              AND sm.product_id = branch_stocks.product_id
              AND sm.movement_type = 'opening'
        )
        """
    )
)
updated = db.execute(text("SELECT changes()")).scalar()
print(f"Updated {updated} branch_stocks rows from ledger")

db.commit()

# Verify: products.stock should now match SUM(branch_stocks) via trigger
# But let's also run a direct sync to be safe
db.execute(
    text(
        """
        UPDATE products
        SET stock = (
            SELECT COALESCE(SUM(quantity), 0)
            FROM branch_stocks
            WHERE product_id = products.id
        )
        """
    )
)
db.commit()

# Verify reconciliation
print("\n--- Verification ---")
rows = db.execute(
    text(
        """
        SELECT bs.branch_id, bs.product_id, bs.quantity as projection,
               COALESCE(sm.ledger_sum, 0) as ledger_sum
        FROM branch_stocks bs
        LEFT JOIN (
            SELECT branch_id, product_id, SUM(qty) as ledger_sum
            FROM stock_movements
            GROUP BY branch_id, product_id
        ) sm ON sm.branch_id = bs.branch_id AND sm.product_id = bs.product_id
        WHERE bs.quantity <> COALESCE(sm.ledger_sum, 0)
        ORDER BY bs.branch_id, bs.product_id
        """
    )
).fetchall()
drift_count = len(rows)
if drift_count:
    print(f"Drift in check 1: {drift_count} rows")
    for r in rows[:10]:
        print(f"  branch={r[0]} product={r[1]} projection={r[2]} ledger={r[3]} diff={r[2]-r[3]}")
else:
    print("Check 1 (ledger vs projection): OK - all match")

rows2 = db.execute(
    text(
        """
        SELECT p.id, p.stock as product_stock,
               COALESCE(bs.sum_qty, 0) as branch_sum
        FROM products p
        LEFT JOIN (
            SELECT product_id, SUM(quantity) as sum_qty
            FROM branch_stocks
            GROUP BY product_id
        ) bs ON bs.product_id = p.id
        WHERE p.stock <> COALESCE(bs.sum_qty, 0)
        """
    )
).fetchall()
drift_count2 = len(rows2)
if drift_count2:
    print(f"Drift in check 2: {drift_count2} rows")
    for r in rows2[:10]:
        print(f"  product={r[0]} products.stock={r[1]} branch_sum={r[2]} diff={r[1]-r[2]}")
else:
    print("Check 2 (products.stock vs SUM): OK - all match")

# Show sample
sample = db.execute(
    text("SELECT branch_id, product_id, quantity FROM branch_stocks WHERE quantity > 0 ORDER BY branch_id, product_id LIMIT 15")
).fetchall()
print(f"\nSample branch_stocks (qty > 0):")
for r in sample:
    print(f"  branch={r[0]} product={r[1]} qty={r[2]}")

# Counts
cnt_bs = db.execute(text("SELECT COUNT(*) FROM branch_stocks WHERE quantity > 0")).scalar()
cnt_sm = db.execute(text("SELECT COUNT(*) FROM stock_movements")).scalar()
print(f"\nbranch_stocks rows with qty > 0: {cnt_bs}")
print(f"stock_movements rows: {cnt_sm}")

db.close()
