from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List
from datetime import date, datetime
from app.models.invoice import InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod


# ══════════════════════════════════════════════════════════
#  Invoice Item
# ══════════════════════════════════════════════════════════

class InvoiceItemCreate(BaseModel):
    product_id: int
    quantity: float
    unit_type: str = "piece"          # piece | carton
    unit_price: Optional[float] = None  # إذا فارغ → يأخذ السعر من المنتج
    discount_amount: float = 0.0

    @field_validator("quantity")
    @classmethod
    def qty_positive(cls, v):
        if v <= 0:
            raise ValueError("الكمية يجب أن تكون أكبر من صفر")
        return v

    @field_validator("unit_type")
    @classmethod
    def valid_unit(cls, v):
        if v not in ("piece", "carton"):
            raise ValueError("unit_type يجب أن يكون piece أو carton")
        return v


class InvoiceItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: Optional[str] = None   # مُعبَّأ من الـ service
    quantity: float
    unit_type: str
    unit_price: float
    cost_price: float
    discount_amount: float
    tax_amount: float
    total: float

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════
#  Invoice Create / Update
# ══════════════════════════════════════════════════════════

class InvoiceCreate(BaseModel):
    invoice_type: InvoiceType = InvoiceType.SALE
    customer_id: Optional[int] = None
    supplier_id: Optional[int] = None

    items: List[InvoiceItemCreate]

    discount_percent: float = 0.0
    discount_amount: float = 0.0
    tax_percent: float = 0.0

    payment_method: PaymentMethod = PaymentMethod.CASH
    paid_amount: float = 0.0

    notes: Optional[str] = None
    invoice_date: Optional[date] = None

    # إذا True → تُحفظ كـ draft (معلّقة) ولا تُخصم من المخزون
    as_draft: bool = False

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("الفاتورة يجب أن تحتوي على صنف واحد على الأقل")
        return v

    @field_validator("discount_percent")
    @classmethod
    def discount_range(cls, v):
        if not (0 <= v <= 100):
            raise ValueError("الخصم يجب أن يكون بين 0 و 100")
        return v


class InvoiceAddItem(BaseModel):
    """إضافة صنف لفاتورة draft موجودة"""
    product_id: int
    quantity: float
    unit_type: str = "piece"
    unit_price: Optional[float] = None
    discount_amount: float = 0.0


class InvoiceUpdateDiscount(BaseModel):
    discount_percent: float = 0.0
    discount_amount: float = 0.0
    tax_percent: float = 0.0


class PaymentAdd(BaseModel):
    amount: float
    method: PaymentMethod = PaymentMethod.CASH
    notes: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("المبلغ يجب أن يكون أكبر من صفر")
        return v


# ══════════════════════════════════════════════════════════
#  Invoice Response
# ══════════════════════════════════════════════════════════

class PaymentResponse(BaseModel):
    id: int
    invoice_id: int
    amount: float
    method: PaymentMethod
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class InvoiceResponse(BaseModel):
    id: int
    invoice_number: str
    unique_token: str
    invoice_type: InvoiceType
    status: InvoiceStatus
    payment_status: PaymentStatus
    payment_method: PaymentMethod

    customer_id: Optional[int]
    supplier_id: Optional[int]
    created_by: int

    subtotal: float
    discount_percent: float
    discount_amount: float
    tax_percent: float
    tax_amount: float
    total: float
    paid_amount: float
    remaining_amount: float

    notes: Optional[str]
    invoice_date: Optional[date]
    created_at: datetime

    items: List[InvoiceItemResponse] = []
    payments: List[PaymentResponse] = []

    # روابط مفيدة
    share_url: Optional[str] = None     # رابط الفاتورة الإلكترونية
    whatsapp_url: Optional[str] = None  # رابط واتساب جاهز

    model_config = {"from_attributes": True}


class InvoiceListResponse(BaseModel):
    """نسخة مختصرة لقوائم الفواتير"""
    id: int
    invoice_number: str
    invoice_type: InvoiceType
    status: InvoiceStatus
    payment_status: PaymentStatus
    customer_id: Optional[int]
    total: float
    paid_amount: float
    remaining_amount: float
    created_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════
#  Public Invoice (بدون auth - للمشاركة)
# ══════════════════════════════════════════════════════════

class PublicInvoiceItem(BaseModel):
    product_name: str
    quantity: float
    unit_type: str
    unit_price: float
    discount_amount: float
    total: float

    model_config = {"from_attributes": True}


class PublicInvoiceResponse(BaseModel):
    invoice_number: str
    invoice_date: Optional[date]
    created_at: datetime
    status: InvoiceStatus
    items: List[PublicInvoiceItem]
    subtotal: float
    discount_percent: float
    discount_amount: float
    tax_percent: float
    tax_amount: float
    total: float
    paid_amount: float
    remaining_amount: float
    payment_status: PaymentStatus
    notes: Optional[str]
    customer_name: Optional[str] = None
