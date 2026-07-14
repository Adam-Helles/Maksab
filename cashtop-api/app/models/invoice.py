import enum
import uuid
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text, ForeignKey,
    Enum as SAEnum, Date, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class InvoiceType(str, enum.Enum):
    SALE = "sale"
    PURCHASE = "purchase"
    SALE_RETURN = "sale_return"
    PURCHASE_RETURN = "purchase_return"


class InvoiceStatus(str, enum.Enum):
    DRAFT = "draft"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PaymentStatus(str, enum.Enum):
    PAID = "paid"
    UNPAID = "unpaid"
    PARTIAL = "partial"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    CARD = "card"
    TRANSFER = "transfer"
    CREDIT = "credit"


class InvoiceItem(Base, TimestampMixin):
    __tablename__ = "invoice_items"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر (دفاع بالعمق) ──────────────────────────
    # مو ضروري نظرياً لأنه محكوم عبر invoice_id → invoice.store_id،
    # لكن وجوده مباشرة هون بيمنع أي query ناقصة join تكشف بيانات
    # بالغلط، وبيسهّل تقارير/فلاتر مباشرة على بنود الفواتير.
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    quantity = Column(Float, nullable=False)
    unit_type = Column(String(20), default="piece", nullable=False)
    unit_price = Column(Float, nullable=False)
    cost_price = Column(Float, default=0.0, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    tax_amount = Column(Float, default=0.0, nullable=False)
    total = Column(Float, nullable=False)
    notes = Column(String(200), nullable=True)

    # Relations
    invoice = relationship("Invoice", back_populates="items")
    product = relationship("Product", back_populates="invoice_items")

    @property
    def subtotal(self) -> float:
        return round(self.quantity * self.unit_price, 3)

    @property
    def profit(self) -> float:
        return round(self.total - (self.quantity * self.cost_price), 3)


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"
    __table_args__ = (
        # ⚠️ invoice_number كان unique عالمياً — بيمنع تاجرين مختلفين
        # من الوصول لنفس رقم الفاتورة (مثلاً INV-0001) بنفس الوقت،
        # وهاد شائع جداً لأنه كل تاجر بده يبلش ترقيمه من 1. صار unique
        # ضمن نفس المحل فقط.
        UniqueConstraint("store_id", "invoice_number", name="uq_store_invoice_number"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    # أهم عمود بكل الموديلات — هاد أخطر جدول (بيانات مالية).
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    # ─── معرف الفاتورة ─────────────────────────────────────
    invoice_number = Column(String(30), nullable=False, index=True)  # شلنا unique المفردة
    unique_token = Column(String(36), default=lambda: str(uuid.uuid4()), unique=True)

    # ─── النوع والحالة ─────────────────────────────────────
    invoice_type = Column(SAEnum(InvoiceType), default=InvoiceType.SALE, nullable=False)
    status = Column(SAEnum(InvoiceStatus), default=InvoiceStatus.DRAFT, nullable=False)
    payment_status = Column(SAEnum(PaymentStatus), default=PaymentStatus.UNPAID, nullable=False)
    payment_method = Column(SAEnum(PaymentMethod), default=PaymentMethod.CASH, nullable=False)

    # ─── الأطراف ───────────────────────────────────────────
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # ─── الأرقام المالية ───────────────────────────────────
    subtotal = Column(Float, default=0.0, nullable=False)
    discount_percent = Column(Float, default=0.0, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    tax_percent = Column(Float, default=0.0, nullable=False)
    tax_amount = Column(Float, default=0.0, nullable=False)
    total = Column(Float, default=0.0, nullable=False)
    paid_amount = Column(Float, default=0.0, nullable=False)
    remaining_amount = Column(Float, default=0.0, nullable=False)

    # ─── معلومات إضافية ────────────────────────────────────
    notes = Column(Text, nullable=True)
    invoice_date = Column(Date, nullable=True)

    # Relations
    store = relationship("Store")
    items = relationship("InvoiceItem", back_populates="invoice", cascade="all, delete-orphan")
    customer = relationship("Customer", back_populates="invoices")
    supplier = relationship("Supplier", back_populates="invoices")
    created_by_user = relationship("User", back_populates="invoices")
    payments = relationship("Payment", back_populates="invoice", cascade="all, delete-orphan")

    def recalculate(self):
        self.subtotal = sum(item.total for item in self.items)
        discount = (self.subtotal * self.discount_percent / 100) + self.discount_amount
        after_discount = self.subtotal - discount
        self.tax_amount = after_discount * self.tax_percent / 100
        self.total = after_discount + self.tax_amount
        self.remaining_amount = max(0, self.total - self.paid_amount)

    def __repr__(self):
        return f"<Invoice #{self.invoice_number} store={self.store_id} {self.invoice_type} {self.total}>"


class Payment(Base, TimestampMixin):
    """سجل كل دفعة على الفاتورة"""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر (دفاع بالعمق) ──────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Float, nullable=False)
    method = Column(SAEnum(PaymentMethod), default=PaymentMethod.CASH, nullable=False)
    notes = Column(String(200), nullable=True)
    received_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    invoice = relationship("Invoice", back_populates="payments")