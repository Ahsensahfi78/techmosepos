import csv
import io
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models
from ..database import engine, get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/backup", tags=["backup"])


def _db_path() -> Path:
    url = str(engine.url)
    if url.startswith("sqlite:///"):
        return Path(url.replace("sqlite:///", "", 1))
    raise HTTPException(status_code=400, detail="Backup only supports SQLite")


def _sqlite_bytes(db_path: Path) -> bytes:
    """Create a consistent snapshot of the DB using SQLite's online backup."""
    dst_path = db_path.parent / f".pos-backup-{db_path.stem}.tmp"
    dst_path.unlink(missing_ok=True)
    try:
        src = sqlite3.connect(db_path)
        dst = sqlite3.connect(dst_path)
        try:
            src.backup(dst)
            dst.commit()
        finally:
            dst.close()
            src.close()
        return dst_path.read_bytes()
    finally:
        dst_path.unlink(missing_ok=True)


@router.get("/download")
def download_backup(
    _: models.User = Depends(require_permission("backup.manage")),
):
    db_path = _db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")
    data = _sqlite_bytes(db_path)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="pos-backup-{db_path.name}"'
        },
    )


@router.post("/restore", response_model=dict)
async def restore_backup(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("backup.manage")),
):
    db_path = _db_path()
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")

    tmp_path = db_path.parent / ".pos-restore-upload.tmp"
    tmp_path.write_bytes(data)
    try:
        probe = sqlite3.connect(tmp_path)
        try:
            count = probe.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','index')"
            ).fetchone()[0]
            if count == 0:
                raise HTTPException(
                    status_code=400, detail="Not a valid SQLite backup (no tables)"
                )
        finally:
            probe.close()

        live = sqlite3.connect(db_path)
        mem = sqlite3.connect(tmp_path)
        try:
            mem.backup(live)
            live.commit()
        finally:
            mem.close()
            live.close()
    except HTTPException:
        raise
    except sqlite3.Error as exc:
        raise HTTPException(status_code=400, detail=f"Not a valid SQLite backup: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)

    db.rollback()
    AuditLogRepository(db).log(
        action="backup.restore",
        entity_type="database",
        user_id=current.id,
        details=f"Restored database from '{file.filename}'",
    )
    return {"success": True, "message": "Database restored"}


@router.get("/export/products")
def export_products_csv(
    _: models.User = Depends(require_permission("export.view")),
):
    from ..database import SessionLocal

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "name",
            "sku",
            "barcode",
            "category",
            "department",
            "brand",
            "model",
            "price",
            "wholesale_price",
            "cost_price",
            "stock",
            "min_stock",
            "warranty_months",
            "track_imei",
        ]
    )
    session = SessionLocal()
    try:
        rows = session.query(models.Product).all()
        for row in rows:
            writer.writerow(
                [
                    row.name,
                    row.sku or "",
                    row.barcode or "",
                    row.category or "",
                    row.department.name if row.department else "",
                    row.brand.name if row.brand else "",
                    row.model or "",
                    row.price,
                    row.wholesale_price or "",
                    row.cost_price or "",
                    row.stock,
                    row.min_stock or 0,
                    row.warranty_months or "",
                    1 if row.track_imei else 0,
                ]
            )
    finally:
        session.close()
    return Response(
        content=buffer.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="products-export.csv"'},
    )


@router.post("/import/products", response_model=dict)
async def import_products_csv(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("backup.manage")),
):
    data = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(data))
    if reader.fieldnames is None or "name" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a 'name' column")
    created = 0
    updated = 0
    for line in reader:
        name = (line.get("name") or "").strip()
        if not name:
            continue
        product = db.query(models.Product).filter(models.Product.name == name).first()
        if product is None:
            product = models.Product(name=name)
            db.add(product)
            created += 1
        else:
            updated += 1
        try:
            product.sku = line.get("sku") or product.sku
            product.barcode = line.get("barcode") or product.barcode
            product.category = line.get("category") or product.category
            product.model = line.get("model") or product.model
            product.price = float(line.get("price") or 0 or product.price or 0)
            wholesale = _opt_float(line.get("wholesale_price"))
            if wholesale is not None:
                product.wholesale_price = wholesale
            cost = _opt_float(line.get("cost_price"))
            if cost is not None:
                product.cost_price = cost
            product.stock = int(line.get("stock") or 0 or product.stock or 0)
            product.min_stock = int(line.get("min_stock") or 0 or product.min_stock or 0)
            months = _opt_int(line.get("warranty_months"))
            if months is not None:
                product.warranty_months = months
            if line.get("track_imei") in {"1", "true", "yes", "True", "Yes"}:
                product.track_imei = True
        except (ValueError, TypeError):
            db.rollback()
            raise HTTPException(
                status_code=400, detail=f"Bad numeric value in row for '{name}'"
            )
    db.commit()
    AuditLogRepository(db).log(
        action="backup.import_products",
        entity_type="product",
        user_id=current.id,
        details=(
            f"Imported products CSV from '{file.filename}' "
            f"({created} created, {updated} updated)"
        ),
    )
    return {"success": True, "created": created, "updated": updated}


def _opt_float(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _opt_int(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None
