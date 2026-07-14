from sqlalchemy import Column, Integer, String, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin, SoftDeleteMixin


class Supplier(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    name = Column(String(150), nullable=False, index=True)
    company = Column(String(150), nullable=True)
    phone = Column(String(20), nullable=True)
    phone2 = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    tax_number = Column(String(50), nullable=True)

    balance = Column(Float, default=0.0, nullable=False)

    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relations
    store = relationship("Store")
    products = relationship("Product", back_populates="supplier")
    invoices = relationship("Invoice", back_populates="supplier")

    def __repr__(self):
        return f"<Supplier {self.name} store={self.store_id}>"