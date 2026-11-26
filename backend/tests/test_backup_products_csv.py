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


def _branch_cashier(db, code):
    br = db.query(models.Branch).filter_by(code=code).first()
    if br is None:
        br = models.Branch(name=f"Branch {code}", code=code)
        db.add(br)
        db.flush()
    u = models.User(
        username=f"c_{code}", email=f"c_{code}@x.com", full_name="c",
        hashed_password=auth.hash_password("x"), role="cashier",
        branch=code, is_active=True,
    )
    db.add(u)
    db.flush()
    h = {"Authorization": f"Bearer {auth.create_access_token(u.id, 'cashier')}"}
    return br.id, h


def test_import_assigns_to_branch_without_duplicates(client_and_tokens):
    client, _ = client_and_tokens
    db = SessionLocal()
    a_id, ha = _branch_cashier(db, "BRA")
    b_id, hb = _branch_cashier(db, "BRB")
    db.commit()
    db.close()
    csv_bytes = b"name,sku,barcode,price,stock\nShared Item,SH1,SH1,9,4\n"

    r = client.post("/backup/import/products", files={"file": ("p.csv", csv_bytes, "text/csv")}, headers=ha)
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    r = client.post("/backup/import/products", files={"file": ("p.csv", csv_bytes, "text/csv")}, headers=hb)
    assert r.status_code == 200, r.text
    assert r.json() == {"success": True, "created": 0, "updated": 1, "assigned": 1}

    db = SessionLocal()
    assert db.query(models.Product).filter_by(sku="SH1").count() == 1
    db.close()
    for h in (ha, hb):
        names = [p["name"] for p in client.get("/products", headers=h).json()]
        assert names == ["Shared Item"]

    # re-import in the same branch assigns nothing new
    r = client.post("/backup/import/products", files={"file": ("p.csv", csv_bytes, "text/csv")}, headers=hb)
    assert r.json()["assigned"] == 0
