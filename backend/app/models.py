import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


class Role(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    MANAGER = "manager"
    CASHIER = "cashier"
    ACCOUNTANT = "accountant"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default=Role.CASHIER.value)
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    audit_logs = relationship("AuditLog", back_populates="user")
    refresh_tokens = relationship(
        "RefreshToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    jti = Column(String(36), unique=True, nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked = Column(Boolean, default=False)
    revoked_at = Column(DateTime, nullable=True)
    user_agent = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    sku = Column(String(100), nullable=True, unique=True)
    barcode = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    imei = Column(String(50), nullable=True)
    price = Column(Float, nullable=False, default=0.0)
    wholesale_price = Column(Float, nullable=True)
    cost_price = Column(Float, nullable=True, default=0.0)
    stock = Column(Integer, nullable=False, default=0)
    min_stock = Column(Integer, nullable=True, default=0)
    category = Column(String(100), default="General")
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    warranty_months = Column(Integer, nullable=True)
    track_imei = Column(Boolean, default=False, name="track_imei_col")
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, name="is_active_col")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    brand = relationship("Brand", back_populates="products")
    department = relationship("Department", back_populates="products")
    supplier = relationship("Supplier", back_populates="products")
    sale_items = relationship("SaleItem", back_populates="product")
    stock_transactions = relationship("StockTransaction", back_populates="product")
    purchase_order_items = relationship("PurchaseOrderItem", back_populates="product")
    purchase_items = relationship("PurchaseItem", back_populates="product")
    purchase_return_items = relationship("PurchaseReturnItem", back_populates="product")
    units = relationship("ProductUnit", back_populates="product")


class SaleStatus(str, enum.Enum):
    COMPLETED = "completed"
    PARTIAL = "partial"
    RETURNED = "returned"


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    status = Column(String(20), nullable=False, default=SaleStatus.COMPLETED.value, index=True)
    subtotal = Column(Float, nullable=False, default=0.0)
    discount_amount = Column(Float, nullable=False, default=0.0)
    tax_amount = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False, default=0.0)
    paid_amount = Column(Float, nullable=False, default=0.0)
    payment_method = Column(String(30), nullable=True)
    loyalty_points_used = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer")
    user = relationship("User")
    items = relationship(
        "SaleItem",
        back_populates="sale",
        cascade="all, delete-orphan",
    )
    returns = relationship(
        "SaleReturn", back_populates="sale", cascade="all, delete-orphan"
    )

    @property
    def due_amount(self) -> float:
        return round(max(0.0, (self.total or 0) - (self.paid_amount or 0)), 2)


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    qty = Column(Integer, nullable=False, default=1)
    price = Column(Float, nullable=False, default=0.0)
    line_total = Column(Float, nullable=False, default=0.0)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")
    units = relationship("ProductUnit", back_populates="sale_item")

    @property
    def product_name(self) -> str:
        return self.product.name if self.product else ""


class SaleReturn(Base):
    __tablename__ = "sale_returns"

    id = Column(Integer, primary_key=True, index=True)
    return_number = Column(String(50), unique=True, nullable=False, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    return_date = Column(DateTime, default=datetime.utcnow, index=True)
    reason = Column(Text, nullable=True)
    total = Column(Float, nullable=False, default=0.0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    sale = relationship("Sale", back_populates="returns")
    customer = relationship("Customer")
    items = relationship(
        "SaleReturnItem",
        back_populates="sale_return",
        cascade="all, delete-orphan",
    )
    user = relationship("User")


class SaleReturnItem(Base):
    __tablename__ = "sale_return_items"

    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("sale_returns.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty = Column(Integer, nullable=False, default=0)
    price = Column(Float, nullable=False, default=0.0)
    line_total = Column(Float, nullable=False, default=0.0)

    sale_return = relationship("SaleReturn", back_populates="items")
    product = relationship("Product")


class StockTransaction(Base):
    __tablename__ = "stock_transactions"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    change_qty = Column(Integer, nullable=False)
    previous_stock = Column(Integer, nullable=False)
    new_stock = Column(Integer, nullable=False)
    reason = Column(String(100), nullable=False)
    reference_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product", back_populates="stock_transactions")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="audit_logs")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Brand(Base):
    __tablename__ = "brands"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    products = relationship("Product", back_populates="brand")


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    products = relationship("Product", back_populates="department")


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    company = Column(String(150), nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    tax_number = Column(String(100), nullable=True)
    due_balance = Column(Float, nullable=False, default=0.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    products = relationship("Product", back_populates="supplier")
    ledger_entries = relationship("LedgerEntry", back_populates="supplier")
    purchase_orders = relationship("PurchaseOrder", back_populates="supplier")
    purchases = relationship("Purchase", back_populates="supplier")
    purchase_returns = relationship("PurchaseReturn", back_populates="supplier")


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(50), nullable=True)
    email = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    loyalty_points = Column(Integer, nullable=False, default=0)
    credit_limit = Column(Float, nullable=False, default=0.0)
    due_balance = Column(Float, nullable=False, default=0.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ledger_entries = relationship("LedgerEntry", back_populates="customer")


class LedgerEntry(Base):
    """General ledger for supplier and customer balances.

    ``direction`` is ``debit`` (increases the party's due balance) or
    ``credit`` (decreases it). ``party_type`` discriminates supplier vs
    customer so the balance math stays identical for both.
    """

    __tablename__ = "ledger_entries"

    id = Column(Integer, primary_key=True, index=True)
    party_type = Column(String(10), nullable=False, index=True)
    party_id = Column(Integer, nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    entry_type = Column(String(30), nullable=False, index=True)
    direction = Column(String(10), nullable=False)
    amount = Column(Float, nullable=False, default=0.0)
    reference = Column(String(100), nullable=True)
    reference_id = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)
    entry_date = Column(DateTime, default=datetime.utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="ledger_entries")
    customer = relationship("Customer", back_populates="ledger_entries")
    user = relationship("User")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    party_type = Column(String(10), nullable=False, index=True)
    party_id = Column(Integer, nullable=False, index=True)
    amount = Column(Float, nullable=False, default=0.0)
    method = Column(String(30), nullable=False, default="cash")
    reference = Column(String(100), nullable=True)
    note = Column(Text, nullable=True)
    payment_date = Column(DateTime, default=datetime.utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=True)
    user = relationship("User")
    purchase = relationship("Purchase", back_populates="payments")


class PurchaseOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    ORDERED = "ordered"
    PARTIAL = "partial"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class PurchaseStatus(str, enum.Enum):
    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    po_number = Column(String(50), unique=True, nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    status = Column(
        String(20), nullable=False, default=PurchaseOrderStatus.ORDERED.value, index=True
    )
    order_date = Column(DateTime, default=datetime.utcnow, index=True)
    expected_date = Column(DateTime, nullable=True)
    subtotal = Column(Float, nullable=False, default=0.0)
    discount_amount = Column(Float, nullable=False, default=0.0)
    tax_amount = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False, default=0.0)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="purchase_orders")
    warehouse = relationship("Warehouse")
    items = relationship(
        "PurchaseOrderItem",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
    )
    purchases = relationship("Purchase", back_populates="purchase_order")
    user = relationship("User")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True, index=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty_ordered = Column(Integer, nullable=False, default=0)
    qty_received = Column(Integer, nullable=False, default=0)
    cost_price = Column(Float, nullable=False, default=0.0)
    line_total = Column(Float, nullable=False, default=0.0)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    product = relationship("Product")


class Purchase(Base):
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    purchase_number = Column(String(50), unique=True, nullable=False, index=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    invoice_date = Column(DateTime, nullable=True)
    purchase_date = Column(DateTime, default=datetime.utcnow, index=True)
    subtotal = Column(Float, nullable=False, default=0.0)
    discount_amount = Column(Float, nullable=False, default=0.0)
    tax_amount = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False, default=0.0)
    paid_amount = Column(Float, nullable=False, default=0.0)
    status = Column(String(20), nullable=False, default=PurchaseStatus.UNPAID.value, index=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    purchase_order = relationship("PurchaseOrder", back_populates="purchases")
    supplier = relationship("Supplier", back_populates="purchases")
    warehouse = relationship("Warehouse")
    items = relationship(
        "PurchaseItem",
        back_populates="purchase",
        cascade="all, delete-orphan",
    )
    returns = relationship(
        "PurchaseReturn", back_populates="purchase", cascade="all, delete-orphan"
    )
    payments = relationship("Payment", back_populates="purchase")
    user = relationship("User")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty = Column(Integer, nullable=False, default=0)
    cost_price = Column(Float, nullable=False, default=0.0)
    line_total = Column(Float, nullable=False, default=0.0)

    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")


class PurchaseReturn(Base):
    __tablename__ = "purchase_returns"

    id = Column(Integer, primary_key=True, index=True)
    return_number = Column(String(50), unique=True, nullable=False, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    return_date = Column(DateTime, default=datetime.utcnow, index=True)
    reason = Column(Text, nullable=True)
    total = Column(Float, nullable=False, default=0.0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    purchase = relationship("Purchase", back_populates="returns")
    supplier = relationship("Supplier", back_populates="purchase_returns")
    items = relationship(
        "PurchaseReturnItem",
        back_populates="purchase_return",
        cascade="all, delete-orphan",
    )
    user = relationship("User")


class PurchaseReturnItem(Base):
    __tablename__ = "purchase_return_items"

    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("purchase_returns.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty = Column(Integer, nullable=False, default=0)
    cost_price = Column(Float, nullable=False, default=0.0)
    line_total = Column(Float, nullable=False, default=0.0)

    purchase_return = relationship("PurchaseReturn", back_populates="items")
    product = relationship("Product")


class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    location = Column(String(200), nullable=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100), nullable=False, default="Miscellaneous")
    amount = Column(Float, nullable=False, default=0.0)
    note = Column(Text, nullable=True)
    expense_date = Column(DateTime, default=datetime.utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Income(Base):
    __tablename__ = "income"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100), nullable=False, default="Other Income")
    amount = Column(Float, nullable=False, default=0.0)
    note = Column(Text, nullable=True)
    income_date = Column(DateTime, default=datetime.utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class ChequeStatus(str, enum.Enum):
    PENDING = "pending"
    CLEARED = "cleared"
    RETURNED = "returned"


class ChequeDirection(str, enum.Enum):
    RECEIVED = "received"
    ISSUED = "issued"


class Cheque(Base):
    __tablename__ = "cheques"

    id = Column(Integer, primary_key=True, index=True)
    direction = Column(String(10), nullable=False, default=ChequeDirection.RECEIVED.value)
    number = Column(String(50), nullable=True)
    bank = Column(String(100), nullable=True)
    account_name = Column(String(150), nullable=True)
    payee = Column(String(150), nullable=True)
    amount = Column(Float, nullable=False, default=0.0)
    due_date = Column(DateTime, index=True)
    status = Column(String(20), nullable=False, default=ChequeStatus.PENDING.value)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    cleared_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(50), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class QuotationStatus(str, enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    CONVERTED = "converted"
    CANCELLED = "cancelled"


class Quotation(Base):
    __tablename__ = "quotations"

    id = Column(Integer, primary_key=True, index=True)
    quotation_number = Column(String(50), unique=True, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    status = Column(String(20), nullable=False, default=QuotationStatus.DRAFT.value, index=True)
    subtotal = Column(Float, nullable=False, default=0.0)
    discount_amount = Column(Float, nullable=False, default=0.0)
    tax_amount = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False, default=0.0)
    notes = Column(Text, nullable=True)
    valid_until = Column(DateTime, nullable=True)
    converted_sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer = relationship("Customer")
    converted_sale = relationship("Sale")
    items = relationship(
        "QuotationItem",
        back_populates="quotation",
        cascade="all, delete-orphan",
    )
    user = relationship("User")


class QuotationItem(Base):
    __tablename__ = "quotation_items"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("quotations.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty = Column(Integer, nullable=False, default=1)
    price = Column(Float, nullable=False, default=0.0)
    line_total = Column(Float, nullable=False, default=0.0)

    quotation = relationship("Quotation", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.name if self.product else ""


class StockAdjustment(Base):
    __tablename__ = "stock_adjustments"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String(50), unique=True, nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    reason = Column(String(50), nullable=False, default="stock_count")
    note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    warehouse = relationship("Warehouse")
    items = relationship(
        "StockAdjustmentItem",
        back_populates="adjustment",
        cascade="all, delete-orphan",
    )
    user = relationship("User")


class StockAdjustmentItem(Base):
    __tablename__ = "stock_adjustment_items"

    id = Column(Integer, primary_key=True, index=True)
    adjustment_id = Column(Integer, ForeignKey("stock_adjustments.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    qty_delta = Column(Integer, nullable=False, default=0)
    previous_stock = Column(Integer, nullable=False, default=0)
    new_stock = Column(Integer, nullable=False, default=0)

    adjustment = relationship("StockAdjustment", back_populates="items")
    product = relationship("Product")


class UnitStatus(str, enum.Enum):
    IN_STOCK = "in_stock"
    SOLD = "sold"
    RETURNED = "returned"
    SERVICE = "service"


class ProductUnit(Base):
    __tablename__ = "product_units"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    imei = Column(String(50), nullable=True, index=True)
    serial_number = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default=UnitStatus.IN_STOCK.value)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=True, index=True)
    warranty_months = Column(Integer, nullable=True)
    warranty_start = Column(DateTime, nullable=True)
    warranty_expiry = Column(DateTime, nullable=True, index=True)
    sold_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product", back_populates="units")
    sale_item = relationship("SaleItem", back_populates="units")

    @property
    def product_name(self) -> str:
        return self.product.name if self.product else ""


class RepairStatus(str, enum.Enum):
    RECEIVED = "received"
    DIAGNOSING = "diagnosing"
    REPAIRING = "repairing"
    READY = "ready"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class Repair(Base):
    __tablename__ = "repairs"

    id = Column(Integer, primary_key=True, index=True)
    repair_number = Column(String(50), unique=True, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    product_name = Column(String(150), nullable=False)
    imei = Column(String(50), nullable=True, index=True)
    issue = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default=RepairStatus.RECEIVED.value)
    service_charge = Column(Float, nullable=False, default=0.0)
    parts_cost = Column(Float, nullable=False, default=0.0)
    deposit = Column(Float, nullable=False, default=0.0)
    paid_amount = Column(Float, nullable=False, default=0.0)
    technician = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    received_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer = relationship("Customer")
    user = relationship("User")

    @property
    def customer_name(self) -> str:
        return self.customer.name if self.customer else ""


class EzCashStatus(str, enum.Enum):
    PENDING = "pending"
    SUCCESSFUL = "successful"
    FAILED = "failed"
    CANCELLED = "cancelled"


class EzCashReload(Base):
    __tablename__ = "ezcash_reloads"

    id = Column(Integer, primary_key=True, index=True)
    reference_number = Column(String(50), unique=True, nullable=False, index=True)
    phone_number = Column(String(20), nullable=False, index=True)
    normalized_phone = Column(String(15), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    payment_method = Column(String(30), nullable=True)
    status = Column(String(20), nullable=False, default=EzCashStatus.PENDING.value)
    provider_response = Column(Text, nullable=True)
    provider_reference = Column(String(100), nullable=True)
    failure_reason = Column(Text, nullable=True)
    idempotency_key = Column(String(100), nullable=True, unique=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    pos_register = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")

