from app.database import Base, SessionLocal, engine
from app import models

SAMPLE_PRODUCTS = [
    {"name": "Samsung Galaxy A15", "price": 42999, "stock": 12, "category": "Mobile Phones"},
    {"name": "iPhone 13 128GB", "price": 245000, "stock": 6, "category": "Mobile Phones"},
    {"name": "Redmi Note 13", "price": 48999, "stock": 15, "category": "Mobile Phones"},
    {"name": "Tecno Spark 20", "price": 27999, "stock": 0, "category": "Mobile Phones"},
    {"name": "Nokia 105", "price": 4999, "stock": 30, "category": "Mobile Phones"},
    {"name": "Silicone Phone Case", "price": 850, "stock": 200, "category": "Accessories"},
    {"name": "Tempered Glass Guard", "price": 450, "stock": 300, "category": "Accessories"},
    {"name": "USB Type-C Cable", "price": 700, "stock": 150, "category": "Accessories"},
    {"name": "Phone Stand", "price": 1200, "stock": 60, "category": "Accessories"},
    {"name": "25W Fast Charger", "price": 1800, "stock": 80, "category": "Chargers"},
    {"name": "Wireless Charger Pad", "price": 4500, "stock": 3, "category": "Chargers"},
    {"name": "Power Bank 10000mAh", "price": 6500, "stock": 40, "category": "Chargers"},
    {"name": "Wired Earphones", "price": 1200, "stock": 90, "category": "Earphones"},
    {"name": "TWS Earbuds Pro", "price": 4500, "stock": 45, "category": "Earphones"},
    {"name": "Over-Ear Headphones", "price": 8500, "stock": 18, "category": "Earphones"},
    {"name": "Smart Watch Fit", "price": 6500, "stock": 22, "category": "Smart Watches"},
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Product).count() > 0:
            print("Database already seeded, skipping.")
            return
        for item in SAMPLE_PRODUCTS:
            db.add(models.Product(**item))
        db.commit()
        print(f"Seeded {len(SAMPLE_PRODUCTS)} products.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
