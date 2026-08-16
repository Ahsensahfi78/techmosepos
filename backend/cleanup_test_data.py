from sqlalchemy import text
from app.database import SessionLocal

TEST_USERS = ["mgr", "acc", "cash", "temp"]
TEST_BRANDS = ["Samsung", "Apple", "Nokia"]
TEST_SUPPLIERS = ["Tech Distributor", "Parts Co"]
TEST_CUSTOMERS = ["John Doe", "Jane Smith", "Nope"]
TEST_WAREHOUSES = ["Branch Store"]
TEST_CATEGORIES = ["Smartphones", "Test Category"]

db = SessionLocal()
try:
    for name in TEST_USERS:
        r = db.execute(
            text("UPDATE users SET is_active = 0 WHERE username = :n"), {"n": name}
        )
        if r.rowcount:
            print(f"deactivated user '{name}'")
    for table, names in [
        ("brands", TEST_BRANDS),
        ("suppliers", TEST_SUPPLIERS),
        ("customers", TEST_CUSTOMERS),
        ("warehouses", TEST_WAREHOUSES),
        ("categories", TEST_CATEGORIES),
    ]:
        for name in names:
            r = db.execute(
                text(f"DELETE FROM {table} WHERE name = :n"), {"n": name}
            )
            if r.rowcount:
                print(f"deleted {table[:-1]} '{name}'")
    db.commit()

    print("\n--- remaining state ---")
    for table in ["users", "categories", "brands", "departments", "suppliers", "customers", "warehouses"]:
        count = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
        print(f"{table}: {count}")
finally:
    db.close()
