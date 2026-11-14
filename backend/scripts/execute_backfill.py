from app.database import SessionLocal
from sqlalchemy import text
import csv

db = SessionLocal()

# Read the CSV
allocations = []
with open('scripts/physical_count_template.csv', newline='') as f:
    reader = csv.DictReader(f)
    for row in reader:
        pid_raw = (row.get("product_id") or "").strip()
        if not pid_raw or pid_raw.startswith("#"):
            continue
        allocations.append({
            "product_id": int(pid_raw),
            "branch_id": int(row["branch_id"]),
            "quantity": int(row["quantity"]),
            "unit_cost": row.get("unit_cost") or None,
        })

print(f"Read {len(allocations)} allocation rows from CSV")

# Verify no existing stock_movements (should be empty after reset)
cnt = db.execute(text("SELECT COUNT(*) FROM stock_movements")).scalar()
print(f"Existing stock_movements rows: {cnt}")

# Insert opening movements and update branch_stocks
total_qty = 0
for a in allocations:
    pid = a["product_id"]
    bid = a["branch_id"]
    qty = a["quantity"]
    unit_cost = a["unit_cost"]
    
    if qty == 0:
        continue  # Skip zero-quantity rows
    
    # Insert opening movement
    db.execute(
        text(
            "INSERT INTO stock_movements "
            "(branch_id, product_id, qty, quantity, previous_quantity, "
            "new_quantity, movement_type, reference_type, balance_after, "
            "note, created_by, created_at, unit_cost) "
            "VALUES (:b, :p, :q, :q, 0, :q, 'opening', 'opening', :q, "
            "'Opening balance (Mode B: physical count)', NULL, "
            "datetime('now'), :uc)"
        ),
        {"b": bid, "p": pid, "q": qty, "uc": unit_cost},
    )
    
    # Update branch_stocks projection (upsert)
    db.execute(
        text(
            "INSERT INTO branch_stocks "
            "(product_id, branch_id, quantity, reserved_quantity, "
            "avg_cost, last_movement_at, created_at, updated_at) "
            "VALUES (:p, :b, :q, 0, 0, datetime('now'), datetime('now'), datetime('now')) "
            "ON CONFLICT(product_id, branch_id) DO UPDATE SET "
            "quantity = :q, reserved_quantity = 0, avg_cost = :uc, "
            "last_movement_at = datetime('now'), updated_at = datetime('now')"
        ),
        {"p": pid, "b": bid, "q": qty, "uc": unit_cost},
    )
    
    total_qty += qty

db.commit()
print(f"Committed: {total_qty} total quantity across {len(allocations)} allocation rows")

# Verify
rows = db.execute(text("SELECT COUNT(*) FROM branch_stocks WHERE quantity > 0")).scalar()
print(f"branch_stocks rows with qty > 0: {rows}")

rows2 = db.execute(text("SELECT COUNT(*) FROM stock_movements")).scalar()
print(f"stock_movements rows: {rows2}")

# Show sample
sample = db.execute(
    text("SELECT branch_id, product_id, quantity FROM branch_stocks WHERE quantity > 0 ORDER BY branch_id, product_id LIMIT 10")
).fetchall()
print("\nSample branch_stocks:")
for r in sample:
    print(f"  branch={r[0]} product={r[1]} qty={r[2]}")

db.close()
