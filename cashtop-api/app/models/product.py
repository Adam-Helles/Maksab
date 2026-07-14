import enum
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, Text, ForeignKey,
    Enum as SAEnum, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin, SoftDeleteMixin


class UnitType(str, enum.Enum):
    PIECE = "piece"      # قطعة
    CARTON = "carton"    # كرتونة
    KG = "kg"            # كيلوغرام
    LITER = "liter"      # لتر
    METER = "meter"      # متر


class Product(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "products"
    __table_args__ = (
        # الباركود كان unique عالميًا — هاد غلط بنظام multi-tenant لأنه
        # بيمنع تاجرين مختلفين من استخدام نفس الباركود (وارد جداً لو
        # نفس المنتج التجاري). صار unique ضمن نفس المحل فقط.
        UniqueConstraint("store_id", "barcode_piece", name="uq_store_barcode_piece"),
        UniqueConstraint("store_id", "barcode_carton", name="uq_store_barcode_carton"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    # ─── معلومات أساسية ───────────────────────────────────
    name = Column(String(200), nullable=False, index=True)
    name_ar = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)

    # ─── الباركود (قطعة + كرتونة) ─────────────────────────
    # لاحظ: شلنا unique=True و index=True المفردة من هون لأنها انتقلت
    # لـ UniqueConstraint فوق (composite مع store_id)
    barcode_piece = Column(String(50), nullable=True)
    barcode_carton = Column(String(50), nullable=True)

    # ─── وحدات القياس ─────────────────────────────────────
    base_unit = Column(SAEnum(UnitType), default=UnitType.PIECE, nullable=False)
    pieces_per_carton = Column(Integer, default=1, nullable=False)

    # ─── الأسعار ──────────────────────────────────────────
    cost_price = Column(Float, default=0.0, nullable=False)
    retail_price = Column(Float, default=0.0, nullable=False)
    wholesale_price = Column(Float, default=0.0, nullable=False)
    carton_price = Column(Float, default=0.0, nullable=False)

    # ─── المخزون ──────────────────────────────────────────
    stock_quantity = Column(Float, default=0.0, nullable=False)
    min_stock_alert = Column(Float, default=5.0, nullable=False)
    max_stock = Column(Float, nullable=True)

    # ─── الصلاحية ─────────────────────────────────────────
    expiry_date = Column(Date, nullable=True)
    has_expiry = Column(Boolean, default=False, nullable=False)

    # ─── تصنيف وعلاقات ────────────────────────────────────
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    # إعدادات إضافية
    is_active = Column(Boolean, default=True, nullable=False)
    is_featured = Column(Boolean, default=False, nullable=False)
    tax_rate = Column(Float, default=0.0, nullable=False)

    # Relations
    store = relationship("Store")
    category = relationship("Category", back_populates="products")
    supplier = relationship("Supplier", back_populates="products")
    invoice_items = relationship("InvoiceItem", back_populates="product")
    stock_movements = relationship("StockMovement", back_populates="product", order_by="StockMovement.created_at.desc()")
    batches = relationship("ProductBatch", back_populates="product", order_by="ProductBatch.expiry_date")

    @property
    def piece_price_from_carton(self) -> float:
        if self.pieces_per_carton and self.pieces_per_carton > 0:
            return round(self.carton_price / self.pieces_per_carton, 3)
        return 0.0

    @property
    def stock_in_cartons(self) -> float:
        if self.pieces_per_carton and self.pieces_per_carton > 0:
            return self.stock_quantity / self.pieces_per_carton
        return 0.0

    @property
    def is_low_stock(self) -> bool:
        return self.stock_quantity <= self.min_stock_alert

    @property
    def profit_margin(self) -> float:
        if self.cost_price > 0:
            return round(((self.retail_price - self.cost_price) / self.cost_price) * 100, 2)
        return 0.0

    def __repr__(self):
        return f"<Product {self.name} store={self.store_id} stock={self.stock_quantity}>"