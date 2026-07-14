from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (
        # كان name unique عالمياً — هاد بيمنع تاجرين مختلفين من تسمية
        # صنف "مشروبات" مثلاً بنفس الوقت. صار unique ضمن نفس المحل فقط.
        UniqueConstraint("store_id", "name", name="uq_store_category_name"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    name = Column(String(100), nullable=False, index=True)  # شلنا unique=True المفردة
    name_ar = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    color = Column(String(7), default="#3B82F6", nullable=True)
    icon = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relations
    store = relationship("Store")
    products = relationship("Product", back_populates="category")

    def __repr__(self):
        return f"<Category {self.name} store={self.store_id}>"