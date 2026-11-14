import random
import csv
import sys
sys.path.insert(0, '.')
from app.database import SessionLocal
from app import models

db = SessionLocal()
branches = db.query(models.Branch).filter(models.Branch.is_active == True).order_by(models.Branch.id).all()
products = db.query(models.Product).order_by(models.Product.id).all()

random.seed(42)  # reproducible

rows = []
for p in products:
    total_stock = p.stock or 0
    if total_stock == 0:
        # All branches get 0
        for b in branches:
            rows.append([p.id, b.id, 0, ""])
    else:
        # Distribute total_stock across branches randomly
        remaining = total_stock
        branch_quantities = []
        for i, b in enumerate(branches):
            if i == len(branches) - 1:
                qty = remaining  # last branch gets remainder
            else:
                qty = random.randint(0, remaining)
            branch_quantities.append(qty)
            remaining -= qty
        for b, qty in zip(branches, branch_quantities):
            unit_cost = round(random.uniform(5, 500), 2) if qty > 0 else ""
            rows.append([p.id, b.id, qty, unit_cost])

# Write CSV
with open('scripts/physical_count_template.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(["product_id", "branch_id", "quantity", "unit_cost"])
    for r in rows:
        writer.writerow(r)

print(f"Wrote {len(rows)} allocation rows to scripts/physical_count_template.csv")
for p in products:
    total = sum(r[2] for r in rows if r[0] == p.id)
    print(f"  Product {p.id} ({p.name}): legacy_stock={p.stock}, allocated_total={total}")

db.close()
