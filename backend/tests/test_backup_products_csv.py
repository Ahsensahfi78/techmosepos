import os
import tempfile

import pytest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/t.db")

from fastapi.testclient import TestClient  # noqa: E402

from app import auth, models  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
import main  # noqa: E402

CSV = (
    b"name,sku,barcode,category,price,cost_price,stock,min_stock\n"
    b"Phone A,,,Phones,100,80,5,1\n"
    b"Case B,CB1,CB1,Acc,5,2,10,2\n"
)


@pytest.fixture()
def client_and_tokens():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    tokens = {}
    for role in ("cashier", "admin"):
        u = db.query(models.User).filter_by(username=f"{role}_csv").first()
        if u is None:
          u = models.User(
            username=f"{role}_csv", email=f"{role}_csv@x.com", full_name=role,
            hashed_password=auth.hash_password("x"), role=role, is_active=True,
          )
          db.add(u)
          db.flush()
        tokens[role] = {"Authorization": f"Bearer {auth.create_access_token(u.id, role)}"}
    db.commit()
    db.close()
    return TestClient(main.app), tokens


@pytest.mark.parametrize("role", ["cashier", "admin"])
def test_import_and_export_products_csv(client_and_tokens, role):
    client, tokens = client_and_tokens
    r = client.post(
        "/backup/import/products",
        files={"file": ("p.csv", CSV, "text/csv")},
        headers=tokens[role],
    )
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    r = client.get("/backup/export/products", headers=tokens[role])
    assert r.status_code == 200, r.text
    assert "Phone A" in r.text
