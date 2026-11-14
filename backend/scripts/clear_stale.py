from app.database import SessionLocal, engine
from sqlalchemy import text
db = SessionLocal()
# Temporarily drop the append-only DELETE trigger for cutover cleanup
db.execute(text("DROP TRIGGER IF EXISTS trg_stock_movements_bdel"))
# Delete stale opening movements from the old buggy auto-backfill
deleted = db.execute(text("DELETE FROM stock_movements WHERE movement_type = 'opening'")).rowcount
db.commit()
# Recreate the append-only DELETE trigger
db.execute(text("""
    CREATE TRIGGER IF NOT EXISTS trg_stock_movements_bdel
    BEFORE DELETE ON stock_movements
    BEGIN
        SELECT RAISE(ABORT, 'stock_movements is append-only: DELETE is forbidden');
    END;
"""))
db.commit()
print(f'Deleted {deleted} stale opening movements. Trigger restored.')
db.close()
