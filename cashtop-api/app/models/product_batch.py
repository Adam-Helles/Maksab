from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class ProductBatch(Base, TimestampMixin):
    """
    دُفعة منتج — نفس المنتج ممكن يجي بتواريخ انتهاء مختلفة.
    """
    __tablename__ = "product_batches"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    # ضروري لأنه routers/inventory.py يستعلم عن ProductBatch مباشرة
    # (list_batches, update_batch) بدون join إجباري مع Product دايماً.
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)

    batch_number = Column(String(50), nullable=True)
    barcode_override = Column(String(50), nullable=True)

    quantity = Column(Float, nullable=False)
    cost_price = Column(Float, default=0.0)
    expiry_date = Column(Date, nullable=True)

    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)

    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)

    store = relationship("Store")
    product = relationship("Product", back_populates="batches")
    supplier = relationship("Supplier")

    @property
    def is_expired(self) -> bool:
        from datetime import date
        return bool(self.expiry_date and self.expiry_date < date.today())

    @property
    def days_until_expiry(self):
        from datetime import date
        if not self.expiry_date:
            return None
        return (self.expiry_date - date.today()).days

    def __repr__(self):
        return f"<Batch #{self.batch_number} store={self.store_id} qty={self.quantity} exp={self.expiry_date}>"