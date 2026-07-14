from sqlalchemy import Column, Integer, String, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin, SoftDeleteMixin


class Customer(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    name = Column(String(150), nullable=False, index=True)
    phone = Column(String(20), nullable=True, index=True)
    phone2 = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)

    # نظام الديون والائتمان
    credit_limit = Column(Float, default=0.0, nullable=False)
    current_debt = Column(Float, default=0.0, nullable=False)

    loyalty_points = Column(Float, default=0.0, nullable=False)

    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relations
    store = relationship("Store")
    invoices = relationship("Invoice", back_populates="customer")

    @property
    def can_buy_on_credit(self) -> bool:
        if self.credit_limit == 0:
            return True
        return self.current_debt < self.credit_limit

    @property
    def available_credit(self) -> float:
        if self.credit_limit == 0:
            return -1.0
        return round(max(0.0, self.credit_limit - self.current_debt), 2)

    def __repr__(self):
        return f"<Customer {self.name} store={self.store_id} debt={self.current_debt}>"