"""
Seed rich test data for Customers, Quotations, and Repairs into pos.db.
"""
from datetime import datetime, timedelta
from app.database import SessionLocal, engine
from app.migrations import run_migrations
from app import models

def seed_test_data():
    run_migrations(engine)
    db = SessionLocal()
    try:
        admin_user = db.query(models.User).filter(models.User.username == "admin").first()
        admin_id = admin_user.id if admin_user else 1

        print("--- 1. Ensuring Service Products in Catalog ---")
        services = [
            {"name": "Screen Replacement Service", "price": 3500.0, "wholesale_price": 2500.0, "stock": 999, "category": "Repair Services", "product_type": "Service", "unit": "job"},
            {"name": "Battery Replacement Service", "price": 2500.0, "wholesale_price": 1800.0, "stock": 999, "category": "Repair Services", "product_type": "Service", "unit": "job"},
            {"name": "Device Diagnostics & Cleaning", "price": 1500.0, "wholesale_price": 1000.0, "stock": 999, "category": "Repair Services", "product_type": "Service", "unit": "job"},
            {"name": "Micro-Soldering Charging Port Labor", "price": 4000.0, "wholesale_price": 3000.0, "stock": 999, "category": "Repair Services", "product_type": "Service", "unit": "job"},
        ]
        for s in services:
            exists = db.query(models.Product).filter(models.Product.name == s["name"]).first()
            if not exists:
                prod = models.Product(**s)
                db.add(prod)
        db.commit()

        print("--- 2. Seeding Test Customers ---")
        test_customers = [
            {
                "name": "TechZone Solutions (Pvt) Ltd",
                "phone": "+94 77 123 4567",
                "email": "procurement@techzone.lk",
                "address": "No. 45 Galle Road, Colombo 03",
                "customer_type": "Corporate",
            },
            {
                "name": "Lanka Mobile Wholesale",
                "phone": "+94 71 987 6543",
                "email": "info@lankamobile.lk",
                "address": "Shop 12, Main Street, Pettah",
                "customer_type": "Wholesale",
            },
            {
                "name": "Kamal Perera",
                "phone": "+94 76 555 8899",
                "email": "kamal.perera@gmail.com",
                "address": "18 Lake Drive, Kandy",
                "customer_type": "Retail",
            },
            {
                "name": "Nimal Fernando",
                "phone": "+94 70 333 4411",
                "email": "nimal.f@outlook.com",
                "address": "124 Hospital Road, Kalmunai",
                "customer_type": "Walk-in",
            },
            {
                "name": "Metro Cellular Hub",
                "phone": "+94 77 888 2211",
                "email": "metrocellular@yahoo.com",
                "address": "Kurunegala Road, Kurunegala",
                "customer_type": "Wholesale",
            },
        ]

        cust_map = {}
        for cdata in test_customers:
            cust = db.query(models.Customer).filter(models.Customer.name == cdata["name"]).first()
            if not cust:
                cust = models.Customer(**cdata)
                db.add(cust)
                db.flush()
            cust_map[cdata["name"]] = cust
        db.commit()

        # Fetch some products
        p_samsung = db.query(models.Product).filter(models.Product.name.like("%Samsung Galaxy A15%")).first()
        p_iphone = db.query(models.Product).filter(models.Product.name.like("%iPhone 13%")).first()
        p_redmi = db.query(models.Product).filter(models.Product.name.like("%Redmi Note 13%")).first()
        p_case = db.query(models.Product).filter(models.Product.name.like("%Silicone%")).first()
        p_glass = db.query(models.Product).filter(models.Product.name.like("%Tempered%")).first()
        p_charger = db.query(models.Product).filter(models.Product.name.like("%Fast Charger%")).first()
        p_cable = db.query(models.Product).filter(models.Product.name.like("%Type-C%")).first()
        p_screen_svc = db.query(models.Product).filter(models.Product.name.like("%Screen Replacement Service%")).first()
        p_battery_svc = db.query(models.Product).filter(models.Product.name.like("%Battery Replacement Service%")).first()

        print("--- 3. Seeding Test Quotations ---")
        now = datetime.utcnow()
        today_str = now.strftime("%Y%m%d")

        # Clear existing test quotations if any so re-running is idempotent
        # Only add if empty or clean
        quotations_data = [
            {
                "number": f"QT-{today_str}-001",
                "customer": cust_map["Kamal Perera"],
                "status": models.QuotationStatus.DRAFT.value,
                "notes": "Customer considering Samsung A15 bundle with case and glass guard.",
                "terms": "1. Validity: 14 days from quote date.\n2. Payment: Cash or Card.\n3. Warranty: 1 Year Company Warranty for phone.",
                "valid_days": 14,
                "tax_rate": 0.0,
                "overall_discount": 299.0,
                "lines": [
                    {
                        "product_id": p_samsung.id if p_samsung else None,
                        "product_name": p_samsung.name if p_samsung else "Samsung Galaxy A15",
                        "product_type": "Goods",
                        "description": "Black 128GB, TRCSL approved",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 42999.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": p_case.id if p_case else None,
                        "product_name": p_case.name if p_case else "Silicone Phone Case",
                        "product_type": "Goods",
                        "description": "Clear anti-shock case",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 850.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": p_glass.id if p_glass else None,
                        "product_name": p_glass.name if p_glass else "Tempered Glass Guard",
                        "product_type": "Goods",
                        "description": "9H edge-to-edge guard",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 450.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
            {
                "number": f"QT-{today_str}-002",
                "customer": cust_map["Lanka Mobile Wholesale"],
                "status": models.QuotationStatus.SENT.value,
                "notes": "Wholesale bulk quote with 30-day dealer credit terms.",
                "terms": "1. Validity: 7 days.\n2. Payment: 50% advance, balance within 30 days.\n3. Free delivery within Colombo.",
                "valid_days": 7,
                "tax_rate": 0.0,
                "overall_discount": 4995.0,
                "lines": [
                    {
                        "product_id": p_samsung.id if p_samsung else None,
                        "product_name": p_samsung.name if p_samsung else "Samsung Galaxy A15",
                        "product_type": "Goods",
                        "description": "Sealed cartons (5 units)",
                        "qty": 5.0,
                        "unit": "pcs",
                        "price": 39999.0, # Wholesale price
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": p_charger.id if p_charger else None,
                        "product_name": p_charger.name if p_charger else "25W Fast Charger",
                        "product_type": "Goods",
                        "description": "Original Samsung 25W Type-C adapter",
                        "qty": 10.0,
                        "unit": "pcs",
                        "price": 1500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": p_cable.id if p_cable else None,
                        "product_name": p_cable.name if p_cable else "USB Type-C Cable",
                        "product_type": "Goods",
                        "description": "Braided 1m cable",
                        "qty": 20.0,
                        "unit": "pcs",
                        "price": 500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
            {
                "number": f"QT-{today_str}-003",
                "customer": cust_map["TechZone Solutions (Pvt) Ltd"],
                "status": models.QuotationStatus.ACCEPTED.value,
                "notes": "Corporate executive phone upgrade bundle. Approved by IT Director.",
                "terms": "1. Validity: 30 days.\n2. Payment: Bank transfer net 15 days.\n3. Apple 1-Year International Warranty.",
                "valid_days": 21,
                "tax_rate": 2.5,
                "overall_discount": 5000.0,
                "lines": [
                    {
                        "product_id": p_iphone.id if p_iphone else None,
                        "product_name": p_iphone.name if p_iphone else "iPhone 13 128GB",
                        "product_type": "Goods",
                        "description": "Midnight Black, Brand New Factory Sealed",
                        "qty": 2.0,
                        "unit": "pcs",
                        "price": 245000.0,
                        "discount": 10000.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": None,
                        "product_name": "Premium MagSafe Heavy Duty Armor Case",
                        "product_type": "Goods",
                        "description": "Military grade drop tested",
                        "qty": 2.0,
                        "unit": "pcs",
                        "price": 3500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
            {
                "number": f"QT-{today_str}-004",
                "customer": cust_map["Metro Cellular Hub"],
                "status": models.QuotationStatus.CONVERTED.value,
                "notes": "Converted to Invoice sale INV-202610-099.",
                "terms": "1. Warranty: Standard 6 Months.\n2. Goods once sold not returnable.",
                "valid_days": 10,
                "tax_rate": 0.0,
                "overall_discount": 2997.0,
                "lines": [
                    {
                        "product_id": p_redmi.id if p_redmi else None,
                        "product_name": p_redmi.name if p_redmi else "Redmi Note 13",
                        "product_type": "Goods",
                        "description": "Ocean Blue 8GB+256GB",
                        "qty": 3.0,
                        "unit": "pcs",
                        "price": 45999.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
        ]

        for qdata in quotations_data:
            existing_q = db.query(models.Quotation).filter(models.Quotation.quotation_number == qdata["number"]).first()
            if existing_q:
                continue

            subtotal = 0.0
            total_line_disc = 0.0
            total_line_tax = 0.0
            items_to_add = []

            for line in qdata["lines"]:
                line_sub = line["qty"] * line["price"]
                line_tot = line_sub - line["discount"] + line["tax"]
                subtotal += line_sub
                total_line_disc += line["discount"]
                total_line_tax += line["tax"]

                qi = models.QuotationItem(
                    product_id=line["product_id"],
                    product_name=line["product_name"],
                    product_type=line["product_type"],
                    description=line["description"],
                    qty=line["qty"],
                    unit=line["unit"],
                    price=line["price"],
                    discount=line["discount"],
                    tax=line["tax"],
                    line_total=round(line_tot, 2),
                )
                items_to_add.append(qi)

            overall_disc = qdata["overall_discount"]
            tax_rate = qdata["tax_rate"]
            taxable = max(0.0, subtotal - total_line_disc - overall_disc)
            header_tax = round(taxable * (tax_rate / 100.0), 2)
            grand_total = round(taxable + header_tax, 2)

            cust = qdata["customer"]
            q = models.Quotation(
                quotation_number=qdata["number"],
                customer_id=cust.id if cust else None,
                customer_name=cust.name if cust else None,
                customer_phone=cust.phone if cust else None,
                customer_address=cust.address if cust else None,
                customer_type=cust.customer_type if cust else "Retail",
                status=qdata["status"],
                subtotal=round(subtotal, 2),
                tax_rate=tax_rate,
                discount_amount=overall_disc,
                tax_amount=header_tax,
                total=grand_total,
                notes=qdata["notes"],
                terms=qdata["terms"],
                valid_until=now + timedelta(days=qdata["valid_days"]),
                created_by=admin_id,
                created_at=now - timedelta(days=qdata["valid_days"] // 3),
            )
            q.items = items_to_add
            db.add(q)
            db.flush()
            print(f"Added Quotation: {q.quotation_number} ({q.status}) - Total: {q.total}")

        db.commit()

        print("--- 4. Seeding Test Repairs ---")
        repairs_data = [
            {
                "number": f"REP-{today_str}-001",
                "customer": cust_map["Kamal Perera"],
                "product_name": "Samsung Galaxy A54 5G",
                "imei": "354891092837461",
                "technician": "Alex (Workshop)",
                "issue": "Cracked Super AMOLED display after hard drop; touch layer completely unresponsive.",
                "status": models.RepairStatus.RECEIVED.value,
                "estimated_cost": 18500.0,
                "advance_deposit": 5000.0,
                "paid_amount": 5000.0,
                "notes": "Device in good condition otherwise. Tested charging port - OK.",
                "terms": "1. 90-day warranty on replacement display.\n2. Back up data prior to repair.\n3. Unclaimed devices disposed after 60 days.",
                "lines": [
                    {
                        "product_id": None,
                        "product_name": "Original OLED Display Panel (Samsung A54)",
                        "product_type": "Goods",
                        "description": "Genuine service pack screen with frame",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 15000.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": p_screen_svc.id if p_screen_svc else None,
                        "product_name": p_screen_svc.name if p_screen_svc else "Screen Replacement Service",
                        "product_type": "Service",
                        "description": "Precision fitting, waterproofing seal and digitizer calibration",
                        "qty": 1.0,
                        "unit": "job",
                        "price": 3500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
            {
                "number": f"REP-{today_str}-002",
                "customer": cust_map["Nimal Fernando"],
                "product_name": "iPhone 12 Pro (Pacific Blue)",
                "imei": "359871109234852",
                "technician": "Shan (Workshop)",
                "issue": "Battery health degraded to 67%; unexpected shutdowns under 30% battery level.",
                "status": models.RepairStatus.REPAIRING.value,
                "estimated_cost": 12000.0,
                "advance_deposit": 0.0,
                "paid_amount": 0.0,
                "notes": "Disassembled, waiting for adhesive curing.",
                "terms": "1. 6 Months warranty on battery cell.\n2. Genuine high capacity Li-ion cell used.",
                "lines": [
                    {
                        "product_id": None,
                        "product_name": "High-Capacity Replacement Battery Cell (iPhone 12 Pro)",
                        "product_type": "Goods",
                        "description": "2815mAh Grade-A cell with BMS flex",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 9500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": p_battery_svc.id if p_battery_svc else None,
                        "product_name": p_battery_svc.name if p_battery_svc else "Battery Replacement Service",
                        "product_type": "Service",
                        "description": "Waterproof adhesive re-installation & battery health calibration",
                        "qty": 1.0,
                        "unit": "job",
                        "price": 2500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
            {
                "number": f"REP-{today_str}-003",
                "customer": cust_map["TechZone Solutions (Pvt) Ltd"],
                "product_name": "iPad Pro 11-inch (3rd Gen)",
                "imei": "DMPX1234987",
                "technician": "Alex (Workshop)",
                "issue": "USB-C charging port pins corroded/bent; no fast charging or computer data sync.",
                "status": models.RepairStatus.READY.value,
                "estimated_cost": 8500.0,
                "advance_deposit": 3000.0,
                "paid_amount": 3000.0,
                "notes": "Repaired and tested. Both 20W PD charging and OTG connectivity functional. Customer notified via SMS.",
                "terms": "1. 30-day warranty on charging port assembly.\n2. Please inspect upon collection.",
                "lines": [
                    {
                        "product_id": None,
                        "product_name": "iPad Pro 11 Type-C Sub-board & Flex Connector",
                        "product_type": "Goods",
                        "description": "Original replacement flex module",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 5500.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": None,
                        "product_name": "Micro-Soldering Labor & Diagnostic Testing",
                        "product_type": "Service",
                        "description": "Board level pin realignment and solder reflow",
                        "qty": 1.0,
                        "unit": "job",
                        "price": 3000.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
            {
                "number": f"REP-{today_str}-004",
                "customer": cust_map["Metro Cellular Hub"],
                "product_name": "Redmi Note 12",
                "imei": "867123049182736",
                "technician": "Shan (Workshop)",
                "issue": "Water splash into speaker grille; muffled sound during calls and media playback.",
                "status": models.RepairStatus.DELIVERED.value,
                "estimated_cost": 5000.0,
                "advance_deposit": 5000.0,
                "paid_amount": 5000.0,
                "notes": "Full service completed. Picked up by dealer rep and verified in store.",
                "terms": "1. 1 Month warranty on speaker part.",
                "lines": [
                    {
                        "product_id": None,
                        "product_name": "Redmi Note 12 Bottom Loudspeaker Module",
                        "product_type": "Goods",
                        "description": "OEM buzzer box",
                        "qty": 1.0,
                        "unit": "pcs",
                        "price": 2000.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                    {
                        "product_id": None,
                        "product_name": "Ultrasonic Chemical Decontamination & Service",
                        "product_type": "Service",
                        "description": "Liquid residue removal and acoustic chamber cleaning",
                        "qty": 1.0,
                        "unit": "job",
                        "price": 3000.0,
                        "discount": 0.0,
                        "tax": 0.0,
                    },
                ],
            },
        ]

        for rdata in repairs_data:
            existing_r = db.query(models.Repair).filter(models.Repair.repair_number == rdata["number"]).first()
            if existing_r:
                continue

            parts_cost = 0.0
            svc_charge = 0.0
            items_to_add = []

            for line in rdata["lines"]:
                line_tot = line["qty"] * line["price"] - line["discount"] + line["tax"]
                if line["product_type"] == "Goods":
                    parts_cost += line_tot
                else:
                    svc_charge += line_tot

                ri = models.RepairItem(
                    product_id=line["product_id"],
                    product_name=line["product_name"],
                    product_type=line["product_type"],
                    description=line["description"],
                    qty=line["qty"],
                    unit=line["unit"],
                    price=line["price"],
                    discount=line["discount"],
                    tax=line["tax"],
                    line_total=round(line_tot, 2),
                )
                items_to_add.append(ri)

            cust = rdata["customer"]
            r = models.Repair(
                repair_number=rdata["number"],
                customer_id=cust.id if cust else None,
                customer_name=cust.name if cust else None,
                customer_phone=cust.phone if cust else None,
                customer_address=cust.address if cust else None,
                customer_type=cust.customer_type if cust else "Retail",
                product_name=rdata["product_name"],
                imei=rdata["imei"],
                technician=rdata["technician"],
                issue=rdata["issue"],
                status=rdata["status"],
                estimated_cost=rdata["estimated_cost"],
                parts_cost=round(parts_cost, 2),
                service_charge=round(svc_charge, 2),
                deposit=rdata["advance_deposit"],
                paid_amount=rdata["paid_amount"],
                notes=rdata["notes"],
                terms=rdata["terms"],
                received_by=admin_id,
                created_at=now - timedelta(days=2),
            )
            r.items = items_to_add
            db.add(r)
            db.flush()
            print(f"Added Repair: {r.repair_number} ({r.status}) - Total: {parts_cost + svc_charge}, Due: {(parts_cost + svc_charge) - r.paid_amount}")

        db.commit()
        print("\nAll test data seeded successfully!")

    except Exception as e:
        db.rollback()
        print(f"Error seeding test data: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_test_data()
