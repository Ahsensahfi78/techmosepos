import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import crud, models
from .auth import hash_password
from .database import Base, SessionLocal, engine
from .manager import manager
from .middleware.auth_mw import AuthMiddleware
from .migrations import run_migrations
from .repositories.user_repo import UserRepository
from .routers import (
    audit,
    auth,
    backup,
    cheques,
    finance,
    inventory,
    ledger,
    master,
    products,
    purchases,
    quotations,
    repairs,
    reports,
    sales,
    settings,
    transactions,
    users,
    warranty,
)


def _bootstrap_admin() -> None:
    db = SessionLocal()
    try:
        users = UserRepository(db)
        if users.count() > 0:
            return
        users.create(
            username=os.getenv("ADMIN_USERNAME", "admin"),
            email=os.getenv("ADMIN_EMAIL", "admin@techmos.local"),
            full_name="Administrator",
            hashed_password=hash_password(os.getenv("ADMIN_PASSWORD", "admin123")),
            role=models.Role.SUPER_ADMIN.value,
        )
        print("Created default admin account: admin / admin123")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations(engine)
    _bootstrap_admin()
    yield


app = FastAPI(title="POS Real-Time API", version="1.0.0", lifespan=lifespan)

app.add_middleware(AuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(audit.router)
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(reports.router)
app.include_router(master.categories_router)
app.include_router(master.brands_router)
app.include_router(master.departments_router)
app.include_router(master.warehouses_router)
app.include_router(master.suppliers_router)
app.include_router(master.customers_router)
app.include_router(ledger.router)
app.include_router(purchases.router)
app.include_router(finance.router)
app.include_router(cheques.router)
app.include_router(inventory.router)
app.include_router(quotations.router)
app.include_router(settings.router)
app.include_router(warranty.router)
app.include_router(repairs.router)
app.include_router(backup.router)
app.include_router(transactions.router)


@app.get("/")
def root():
    return {"status": "ok", "app": "POS API"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        db = SessionLocal()
        try:
            products = [crud.product_to_dict(p) for p in crud.get_products(db)]
        finally:
            db.close()
        await websocket.send_json({"type": "sync", "products": products})

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
