from app.database import SessionLocal, engine
from sqlalchemy import text
db = SessionLocal()

# Step 1: Temporarily drop the append-only DELETE trigger on stock_movements
db.execute(text("DROP TRIGGER IF EXISTS trg_stock_movements_bdel"))

# Step 2: Delete ALL opening movements from the previous (faulty) backfill
deleted = db.execute(text("DELETE FROM stock_movements WHERE movement_type = 'opening'")).rowcount
print(f"Deleted {deleted} stale opening movements")

# Step 3: Reset all branch_stocks to zero (clear the old seed data)
reset_count = db.execute(text("UPDATE branch_stocks SET quantity = 0, reserved_quantity = 0, last_movement_at = NULL")).rowcount
print(f"Reset {reset_count} branch_stocks rows to zero")

# Step 4: Recreate the append-only DELETE trigger
db.execute(text("""
    CREATE TRIGGER IF NOT EXISTS trg_stock_movements_bdel
    BEFORE DELETE ON stock_movements
    BEGIN
        SELECT RAISE(ABORT, 'stock_movements is append-only: DELETE is forbidden');
    END;
"""))

db.commit()
print("Done. branch_stocks reset to zero, stale movements removed, trigger restored.")
db.close()
