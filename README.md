# ShoplyPOS — Real-Time Stock & Sales System

A modern, client-ready point-of-sale and stock management system built with **FastAPI + SQLite** (backend) and **Next.js + Tailwind CSS** (frontend). Prices in **LKR (Rs.)**, fully mobile responsive, real-time stock sync.

## Features

- **Point of Sale** — tap products to build an order, quantity steppers, cart drawer on mobile, cash payment with quick amounts, change calculation, digital receipt
- **Real-time stock** — stock updates live across every open browser via WebSocket (`/ws`)
- **Dashboard** — today's revenue, 7-day revenue chart, stock alerts, recent sales
- **Inventory** — add / edit / delete products with modal forms, live stock badges
- **Reports** — KPI cards, top-seller bars, low stock (≤ 5), out of stock, period filter (7d / 30d / all), **CSV export**
- **Mobile responsive** — bottom tab navigation, floating cart button, bottom-sheet dialogs, touch-friendly controls

## Project layout

```
pos-system/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app + WebSocket endpoint
│   │   ├── database.py      # SQLite engine/session
│   │   ├── models.py        # Product, Sale, SaleItem
│   │   ├── schemas.py       # Pydantic request/response models
│   │   ├── crud.py          # business logic (transactional stock deduction)
│   │   ├── manager.py       # WebSocket connection manager
│   │   └── routers/         # products, sales, reports (+ dashboard)
│   ├── seed.py              # sample products (LKR prices)
│   └── requirements.txt
└── frontend/
    ├── app/                 # POS (/), dashboard, products, reports
    ├── components/          # Header, CartPanel, PaymentModal, Receipt, UI kit
    ├── hooks/useStock.ts    # WebSocket real-time hook
    └── lib/                 # api client, types, constants (currency, icons)
```

## Run it

### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows
# source venv/bin/activate       # macOS/Linux

pip install -r requirements.txt
python seed.py                   # optional: sample products + demo sales
venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — open two tabs on the POS page and charge a sale in one; stock updates in both instantly.

## API summary

| Method | Endpoint            | Description                          |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/products`         | List products (search, category)     |
| POST   | `/products`         | Create product                       |
| PATCH  | `/products/{id}`    | Update product                       |
| DELETE | `/products/{id}`    | Delete product                       |
| POST   | `/sales`            | Create sale, deducts stock           |
| GET    | `/sales`            | Recent sales                         |
| GET    | `/reports/stock`    | Stock summary + low/out of stock     |
| GET    | `/reports/sales`    | Sales totals + top sellers (period)  |
| GET    | `/reports/dashboard`| KPIs, weekly trend, recent sales     |
| WS     | `/ws`               | Real-time product/stock sync         |

## How real-time works

1. Each browser connects to the WebSocket `/ws` and receives a full product sync.
2. Creating a sale (or editing stock) broadcasts a `stock_update` message.
3. The frontend `useStock` hook applies updates instantly to every connected tab.
4. SQLite transactions keep stock deduction safe under concurrent checkouts.
