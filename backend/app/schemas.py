from datetime import datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)

from .models import Role

T = TypeVar("T")


class Paginated(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int


# ── Standard API Response ──────────────────────────────────────────────
class ApiResponse(BaseModel):
    success: bool = True
    message: str = ""
    data: Optional[dict | list] = None


# ── Auth ────────────────────────────────────────────────────────────────
class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: int
    role: str
    exp: int


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = Field(default=None, min_length=1)


class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# ── User ────────────────────────────────────────────────────────────────
class UserBase(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    role: str = "cashier"

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        if value not in {role.value for role in Role}:
            raise ValueError(f"Invalid role '{value}'")
        return value


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    is_active: bool = True
    expires_at: Optional[datetime] = None


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    role: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in {role.value for role in Role}:
            raise ValueError(f"Invalid role '{value}'")
        return value


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    expires_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserMe(UserOut):
    pass


class LoginSessionOut(BaseModel):
    id: int
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    revoked: bool
    created_at: datetime
    expires_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Master Data ─────────────────────────────────────────────────────────
class _NamedBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None


class _NamedUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None


class _NamedOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CategoryCreate(_NamedBase):
    pass


class CategoryUpdate(_NamedUpdate):
    pass


class CategoryOut(_NamedOut):
    pass


class BrandCreate(_NamedBase):
    pass


class BrandUpdate(_NamedUpdate):
    pass


class BrandOut(_NamedOut):
    pass


class DepartmentCreate(_NamedBase):
    pass


class DepartmentUpdate(_NamedUpdate):
    pass


class DepartmentOut(_NamedOut):
    pass


class WarehouseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location: Optional[str] = None
    is_default: bool = False


class WarehouseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    location: Optional[str] = None
    is_default: Optional[bool] = None


class WarehouseOut(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    is_default: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SupplierBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    company: Optional[str] = Field(default=None, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    tax_number: Optional[str] = Field(default=None, max_length=100)


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    company: Optional[str] = Field(default=None, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    tax_number: Optional[str] = Field(default=None, max_length=100)
    is_active: Optional[bool] = None


class SupplierOut(SupplierBase):
    id: int
    due_balance: float
    is_active: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CustomerBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    credit_limit: float = Field(default=0.0, ge=0)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    credit_limit: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class CustomerOut(CustomerBase):
    id: int
    loyalty_points: int
    due_balance: float
    is_active: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Ledger, Payments & Loyalty ──────────────────────────────────────────
class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=30)
    reference: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = None
    payment_date: Optional[datetime] = None


class PaymentOut(BaseModel):
    id: int
    party_type: str
    party_id: int
    amount: float
    method: str
    reference: Optional[str] = None
    note: Optional[str] = None
    payment_date: datetime
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CreditNoteIn(BaseModel):
    amount: float = Field(gt=0)
    reference: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = None
    entry_date: Optional[datetime] = None


class LedgerEntryOut(BaseModel):
    id: int
    party_type: str
    party_id: int
    entry_type: str
    direction: str
    amount: float
    reference: Optional[str] = None
    reference_id: Optional[int] = None
    note: Optional[str] = None
    entry_date: datetime
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class LoyaltyUpdate(BaseModel):
    points_delta: int = Field(ge=-1000000, le=1000000)


class PartyBalanceOut(BaseModel):
    id: int
    name: str
    due_balance: float


class SupplierReportOut(BaseModel):
    supplier_id: int
    name: str
    company: Optional[str] = None
    due_balance: float
    total_purchases: float
    purchase_count: int
    total_payments: float
    payment_count: int
    total_credit_notes: float
    products_supplied: int
    recent_entries: List[LedgerEntryOut]


class CustomerReportOut(BaseModel):
    customer_id: int
    name: str
    phone: Optional[str] = None
    due_balance: float
    credit_limit: float
    loyalty_points: int
    total_sales: float
    sale_count: int
    total_payments: float
    payment_count: int
    total_returns: float
    recent_entries: List[LedgerEntryOut]


# ── Product ─────────────────────────────────────────────────────────────
class ProductBase(BaseModel):
    name: str
    price: float = Field(ge=0)
    stock: int = Field(ge=0)
    category: str = "General"
    sku: Optional[str] = None
    barcode: Optional[str] = None
    cost_price: Optional[float] = Field(default=None, ge=0)
    min_stock: Optional[int] = Field(default=None, ge=0)
    description: Optional[str] = None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    stock: Optional[int] = Field(default=None, ge=0)
    category: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    cost_price: Optional[float] = Field(default=None, ge=0)
    min_stock: Optional[int] = Field(default=None, ge=0)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    track_imei: Optional[bool] = None
    warranty_months: Optional[int] = Field(default=None, ge=0)


class ProductOut(ProductBase):
    id: int
    image_url: Optional[str] = None
    is_active: bool
    track_imei: bool = False
    warranty_months: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PaginatedProducts(BaseModel):
    items: List[ProductOut]
    total: int
    page: int
    page_size: int
    total_pages: int


# ── Sale ────────────────────────────────────────────────────────────────
class SaleItemIn(BaseModel):
    product_id: int
    qty: int = Field(default=1, ge=1)
    price: Optional[float] = Field(default=None, ge=0)
    imeis: List[str] = Field(default=[])


class SaleIn(BaseModel):
    items: List[SaleItemIn]
    customer_id: Optional[int] = None
    discount_amount: float = Field(default=0.0, ge=0)
    tax_amount: float = Field(default=0.0, ge=0)
    payment_method: Optional[str] = Field(default=None, max_length=30)
    paid_amount: Optional[float] = Field(default=None, ge=0)
    loyalty_points_used: int = Field(default=0, ge=0)
    payments: Optional[List["SalePaymentIn"]] = None


class SaleItemOut(BaseModel):
    product_id: int
    product_name: str
    qty: int
    price: float
    line_total: float
    imeis: List[str] = []
    sku: Optional[str] = None
    barcode: Optional[str] = None
    model: Optional[str] = None
    returned_qty: int = 0
    model_config = ConfigDict(from_attributes=True)


class SaleOut(BaseModel):
    id: int
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    status: str
    subtotal: float
    discount_amount: float
    tax_amount: float
    total: float
    paid_amount: float
    due_amount: float
    payment_method: Optional[str] = None
    loyalty_points_used: int
    created_by_name: Optional[str] = None
    created_at: datetime
    items: List[SaleItemOut]
    model_config = ConfigDict(from_attributes=True)


class SalePaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=30)
    reference: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = None
    payment_date: Optional[datetime] = None


class SaleReturnItemIn(BaseModel):
    product_id: int
    qty: int = Field(ge=1)


class SaleReturnIn(BaseModel):
    reason: Optional[str] = None
    return_date: Optional[datetime] = None
    items: List[SaleReturnItemIn] = Field(min_length=1)


class SaleReturnItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    qty: int
    price: float
    line_total: float
    sku: Optional[str] = None
    barcode: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class SaleReturnOut(BaseModel):
    id: int
    return_number: str
    sale_id: int
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    return_date: datetime
    reason: Optional[str] = None
    total: float
    created_at: datetime
    items: List[SaleReturnItemOut] = []
    model_config = ConfigDict(from_attributes=True)


# ── Stock & Reports ─────────────────────────────────────────────────────
class StockSummary(BaseModel):
    id: int
    name: str
    category: str
    price: float
    stock: int
    status: str


class ReportOut(BaseModel):
    total_products: int
    total_units: int
    total_value: float
    low_stock: List[StockSummary]
    out_of_stock: List[StockSummary]


class StockTransactionOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    change_qty: int
    previous_stock: int
    new_stock: int
    reason: str
    reference_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Audit Log ───────────────────────────────────────────────────────────
class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    entity_type: str
    entity_id: Optional[int] = None
    details: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PaginatedAuditLogs(BaseModel):
    items: List[AuditLogOut]
    total: int
    page: int
    page_size: int
    total_pages: int


# ── Purchases ────────────────────────────────────────────────────────────
class PurchaseOrderItemIn(BaseModel):
    product_id: int
    qty_ordered: int = Field(ge=1)
    cost_price: float = Field(ge=0)


class PurchaseOrderIn(BaseModel):
    supplier_id: int
    warehouse_id: Optional[int] = None
    order_date: Optional[datetime] = None
    expected_date: Optional[datetime] = None
    discount_amount: float = Field(default=0.0, ge=0)
    tax_amount: float = Field(default=0.0, ge=0)
    notes: Optional[str] = None
    items: List[PurchaseOrderItemIn] = Field(min_length=1)


class PurchaseOrderItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    qty_ordered: int
    qty_received: int
    cost_price: float
    line_total: float
    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderOut(BaseModel):
    id: int
    po_number: str
    supplier_id: int
    supplier_name: str
    warehouse_id: Optional[int] = None
    status: str
    order_date: datetime
    expected_date: Optional[datetime] = None
    subtotal: float
    discount_amount: float
    tax_amount: float
    total: float
    notes: Optional[str] = None
    created_at: datetime
    items: List[PurchaseOrderItemOut] = []
    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderReceiveItem(BaseModel):
    product_id: int
    qty: int = Field(ge=1)


class PurchaseOrderReceiveIn(BaseModel):
    qty: List[PurchaseOrderReceiveItem]
    invoice_number: Optional[str] = None
    invoice_date: Optional[datetime] = None
    warehouse_id: Optional[int] = None
    notes: Optional[str] = None


class PurchaseItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    qty: int
    cost_price: float
    line_total: float
    model_config = ConfigDict(from_attributes=True)


class PurchaseOut(BaseModel):
    id: int
    purchase_number: str
    po_id: Optional[int] = None
    po_number: Optional[str] = None
    supplier_id: int
    supplier_name: str
    warehouse_id: Optional[int] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[datetime] = None
    purchase_date: datetime
    subtotal: float
    discount_amount: float
    tax_amount: float
    total: float
    paid_amount: float
    due_amount: float
    status: str
    notes: Optional[str] = None
    created_at: datetime
    items: List[PurchaseItemOut] = []
    model_config = ConfigDict(from_attributes=True)


class PurchaseReturnItemIn(BaseModel):
    product_id: int
    qty: int = Field(ge=1)


class PurchaseReturnIn(BaseModel):
    reason: Optional[str] = None
    return_date: Optional[datetime] = None
    items: List[PurchaseReturnItemIn] = Field(min_length=1)


class PurchaseReturnItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    qty: int
    cost_price: float
    line_total: float
    model_config = ConfigDict(from_attributes=True)


class PurchaseReturnOut(BaseModel):
    id: int
    return_number: str
    purchase_id: int
    purchase_number: str
    supplier_id: int
    supplier_name: str
    return_date: datetime
    reason: Optional[str] = None
    total: float
    created_at: datetime
    items: List[PurchaseReturnItemOut] = []
    model_config = ConfigDict(from_attributes=True)


class PurchasePaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=30)
    reference: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = None
    payment_date: Optional[datetime] = None


# ── Expenses & Income ───────────────────────────────────────────────────
class FinanceEntryIn(BaseModel):
    category: str = Field(default="Miscellaneous", max_length=100)
    amount: float = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=500)
    entry_date: Optional[datetime] = None


class FinanceEntryOut(BaseModel):
    id: int
    category: str
    amount: float
    note: Optional[str] = None
    entry_date: datetime
    created_at: datetime
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class FinanceSummary(BaseModel):
    total_expenses: float
    total_income: float
    net: float
    by_category: dict = {}


# ── Cheques ─────────────────────────────────────────────────────────────
class ChequeIn(BaseModel):
    direction: str = Field(default="received", pattern="^(received|issued)$")
    number: Optional[str] = Field(default=None, max_length=50)
    bank: Optional[str] = Field(default=None, max_length=100)
    account_name: Optional[str] = Field(default=None, max_length=150)
    payee: Optional[str] = Field(default=None, max_length=150)
    amount: float = Field(gt=0)
    due_date: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class ChequeStatusIn(BaseModel):
    status: str = Field(pattern="^(pending|cleared|returned)$")


class ChequeOut(BaseModel):
    id: int
    direction: str
    number: Optional[str] = None
    bank: Optional[str] = None
    account_name: Optional[str] = None
    payee: Optional[str] = None
    amount: float
    due_date: Optional[datetime] = None
    status: str
    notes: Optional[str] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    cleared_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Settings ────────────────────────────────────────────────────────────
class SettingUpdate(BaseModel):
    value: Optional[str] = None


class SettingOut(BaseModel):
    key: str
    value: Optional[str] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Quotations ──────────────────────────────────────────────────────────
class QuotationItemIn(BaseModel):
    product_id: int
    qty: int = Field(ge=1)
    price: float = Field(ge=0)


class QuotationIn(BaseModel):
    customer_id: Optional[int] = None
    status: str = Field(default="draft", pattern="^(draft|sent|converted|cancelled)$")
    discount_amount: float = Field(default=0, ge=0)
    tax_rate: float = Field(default=0, ge=0, le=100)
    notes: Optional[str] = Field(default=None, max_length=1000)
    valid_until: Optional[datetime] = None
    items: List[QuotationItemIn] = Field(min_length=1)


class QuotationItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    qty: int
    price: float
    line_total: float
    model_config = ConfigDict(from_attributes=True)


class QuotationOut(BaseModel):
    id: int
    quotation_number: str
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    status: str
    subtotal: float
    discount_amount: float
    tax_amount: float
    total: float
    notes: Optional[str] = None
    valid_until: Optional[datetime] = None
    converted_sale_id: Optional[int] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    items: List[QuotationItemOut] = []
    model_config = ConfigDict(from_attributes=True)


class QuotationStatusIn(BaseModel):
    status: str = Field(pattern="^(draft|sent|converted|cancelled)$")


class QuotationConvertIn(BaseModel):
    payment_method: str = Field(default="cash", max_length=30)
    paid: float = Field(default=0, ge=0)


# ── Stock adjustments ───────────────────────────────────────────────────
class StockAdjustmentItemIn(BaseModel):
    product_id: int
    qty_delta: int

    @field_validator("qty_delta")
    @classmethod
    def nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("qty_delta must be non-zero")
        return v


class StockAdjustmentIn(BaseModel):
    warehouse_id: Optional[int] = None
    reason: str = Field(default="stock_count", max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)
    items: List[StockAdjustmentItemIn] = Field(min_length=1)


class StockAdjustmentItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    qty_delta: int
    previous_stock: int
    new_stock: int
    model_config = ConfigDict(from_attributes=True)


class StockAdjustmentOut(BaseModel):
    id: int
    reference: str
    warehouse_id: Optional[int] = None
    warehouse_name: Optional[str] = None
    reason: str
    note: Optional[str] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    items: List[StockAdjustmentItemOut] = []


# ── Module 7: IMEI / Warranty ───────────────────────────────────────────
class ProductUnitIn(BaseModel):
    product_id: int
    imei: Optional[str] = Field(default=None, max_length=50)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    warranty_months: Optional[int] = Field(default=None, ge=0)


class ProductUnitStatusIn(BaseModel):
    status: str


class ProductUnitOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    imei: Optional[str] = None
    serial_number: Optional[str] = None
    status: str
    sale_item_id: Optional[int] = None
    sale_id: Optional[int] = None
    customer_name: Optional[str] = None
    warranty_months: Optional[int] = None
    warranty_start: Optional[datetime] = None
    warranty_expiry: Optional[datetime] = None
    sold_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ReorderItemOut(BaseModel):
    product_id: int
    name: str
    stock: int
    min_stock: int
    threshold: int
    suggested_qty: int


# ── Module 7: Repairs ───────────────────────────────────────────────────
class RepairIn(BaseModel):
    customer_id: Optional[int] = None
    product_name: str = Field(min_length=1, max_length=150)
    imei: Optional[str] = Field(default=None, max_length=50)
    issue: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[str] = None
    service_charge: float = Field(default=0.0, ge=0)
    parts_cost: float = Field(default=0.0, ge=0)
    deposit: float = Field(default=0.0, ge=0)
    paid_amount: float = Field(default=0.0, ge=0)
    technician: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=2000)


class RepairUpdateIn(BaseModel):
    customer_id: Optional[int] = None
    product_name: Optional[str] = None
    imei: Optional[str] = None
    issue: Optional[str] = None
    service_charge: Optional[float] = Field(default=None, ge=0)
    parts_cost: Optional[float] = Field(default=None, ge=0)
    deposit: Optional[float] = Field(default=None, ge=0)
    paid_amount: Optional[float] = Field(default=None, ge=0)
    technician: Optional[str] = None
    notes: Optional[str] = None


class RepairStatusIn(BaseModel):
    status: str


class RepairPaymentIn(BaseModel):
    amount: float = Field(gt=0)


class RepairOut(BaseModel):
    id: int
    repair_number: str
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    product_name: str
    imei: Optional[str] = None
    issue: Optional[str] = None
    status: str
    service_charge: float
    parts_cost: float
    deposit: float
    paid_amount: float
    total: float
    technician: Optional[str] = None
    notes: Optional[str] = None
    received_by: Optional[int] = None
    received_by_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Unified Transactions & History ───────────────────────────────────────
class TransactionRecord(BaseModel):
    """One row in the unified transaction feed."""

    type: str  # sale | purchase | sale_return | purchase_return
    db_id: int
    key: str  # stable composite key, e.g. "SALE-126"
    reference: str  # INV-000126 / PUR-20260805-001 / SRT-... / PRT-...
    date: datetime
    party_type: Optional[str] = None  # customer | supplier | None (walk-in)
    party_id: Optional[int] = None
    party_name: Optional[str] = None
    party_phone: Optional[str] = None
    subtotal: float = 0.0
    discount: float = 0.0
    tax: float = 0.0
    total: float = 0.0
    paid: float = 0.0
    due: float = 0.0
    payment_method: Optional[str] = None
    status: str
    item_count: int = 0
    created_by: Optional[str] = None


class SourcePurchaseOut(BaseModel):
    """Traceability: which purchase/supplier supplied a sold product."""

    purchase_id: int
    purchase_number: str
    purchase_date: Optional[datetime] = None
    supplier_id: int
    supplier_name: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_email: Optional[str] = None
    cost_price: float = 0.0
    line_total: float = 0.0
    qty_purchased: int = 0
    invoice_number: Optional[str] = None


class TransactionItemOut(BaseModel):
    product_id: int
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    qty: int
    unit_price: float
    line_total: float
    source_purchase: Optional[SourcePurchaseOut] = None


class TransactionPaymentOut(BaseModel):
    amount: float
    method: str
    reference: Optional[str] = None
    date: datetime


class TransactionMovementOut(BaseModel):
    product_id: int
    product_name: str
    change_qty: int
    previous_stock: int
    new_stock: int
    reason: str
    created_at: datetime


class RelatedTransactionOut(BaseModel):
    type: str
    db_id: int
    key: str
    reference: str
    date: Optional[datetime] = None
    total: float = 0.0
    status: str


class TransactionDetailOut(BaseModel):
    type: str
    db_id: int
    key: str
    reference: str
    date: datetime
    party_type: Optional[str] = None
    party_id: Optional[int] = None
    party_name: Optional[str] = None
    party_phone: Optional[str] = None
    party_email: Optional[str] = None
    subtotal: float = 0.0
    discount: float = 0.0
    tax: float = 0.0
    total: float = 0.0
    paid: float = 0.0
    due: float = 0.0
    payment_method: Optional[str] = None
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    items: List[TransactionItemOut] = []
    payments: List[TransactionPaymentOut] = []
    movements: List[TransactionMovementOut] = []
    related_returns: List[RelatedTransactionOut] = []
    original: Optional[RelatedTransactionOut] = None


class TransactionSummaryOut(BaseModel):
    total: int
    sales_total: float
    purchases_total: float
    returns_total: float
    balance_total: float


class ProductHistorySummaryOut(BaseModel):
    product_id: int
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    opening_stock: int = 0
    purchased: int = 0
    sold: int = 0
    sale_returns: int = 0
    purchase_returns: int = 0
    adjustments: int = 0
    current_stock: int = 0


class GlobalSearchHit(BaseModel):
    kind: str  # customer | supplier | product | transaction
    id: int
    title: str
    subtitle: Optional[str] = None
    meta: Optional[str] = None


class GlobalSearchOut(BaseModel):
    customers: List[GlobalSearchHit] = []
    suppliers: List[GlobalSearchHit] = []
    products: List[GlobalSearchHit] = []
    transactions: List[TransactionRecord] = []


# ── EZ Cash Reload ────────────────────────────────────────────────────────
class EzCashReloadIn(BaseModel):
    phone_number: str = Field(min_length=10, max_length=20)
    amount: float = Field(gt=0)
    payment_method: str = Field(default="cash", max_length=30)
    carrier: Optional[str] = Field(default=None, max_length=30)
    idempotency_key: Optional[str] = None
    pos_register: Optional[str] = None


class EzCashReloadOut(BaseModel):
    id: int
    reference_number: str
    phone_number: str
    normalized_phone: str
    amount: float
    payment_method: Optional[str] = None
    carrier: Optional[str] = None
    operator_id: Optional[int] = None
    operator_name: Optional[str] = None
    status: str
    provider_response: Optional[str] = None
    provider_reference: Optional[str] = None
    failure_reason: Optional[str] = None
    delivered_amount: Optional[float] = None
    delivered_currency: Optional[str] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    pos_register: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class EzCashReloadSummary(BaseModel):
    date_from: str
    date_to: str
    total_reloads: int
    successful: int
    failed: int
    cancelled: int
    pending: int
    total_amount: float
    successful_amount: float


class EzCashCashierSummary(BaseModel):
    user_id: int
    name: str
    total_reloads: int
    successful: int
    failed: int
    total_amount: float
