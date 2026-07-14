import enum
from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class MovementType(str, enum.Enum):
    PURCHASE = "purchase"
    RETURN_FROM_CUSTOMER = "return_from_customer"
    ADJUSTMENT_IN = "adjustment_in"

    SALE = "sale"
    RETURN_TO_SUPPLIER = "return_to_supplier"
    ADJUSTMENT_OUT = "adjustment_out"
    DAMAGED = "damaged"
    EXPIRED = "expired"


class StockMovement(Base, TimestampMixin):
    """
    سجل حركة المخزون — كل عملية دخول أو خروج تُسجَّل هنا.
    هذا الجدول هو القلب المالي للمخزون.
    """
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    # جدول حساس جداً (القلب المالي للمخزون) — لازم يكون معزول بشكل
    # مباشر، مش بس عبر product_id → product.store_id، حتى تقارير
    # حركات المخزون تقدر تفلتر عليه مباشرة بدون join.
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)

    movement_type = Column(SAEnum(MovementType), nullable=False)
    quantity = Column(Float, nullable=False)
    unit_type = Column(String(10), default="piece")
    quantity_in_pieces = Column(Float, nullable=False)

    stock_before = Column(Float, nullable=False)
    stock_after = Column(Float, nullable=False)

    unit_cost = Column(Float, default=0.0)

    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    notes = Column(Text, nullable=True)
    reference = Column(String(100), nullable=True)

    # Relations
    store = relationship("Store")
    product = relationship("Product", back_populates="stock_movements")
    user = relationship("User")
    invoice = relationship("Invoice")

    def __repr__(self):
        return f"<StockMovement {self.movement_type} store={self.store_id} qty={self.quantity} product_id={self.product_id}>"