import enum
from sqlalchemy import Column, Integer, String, Boolean, Enum as SAEnum, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class UserRole(str, enum.Enum):
    ADMIN = "admin"          # صاحب المحل — كل الصلاحيات
    MANAGER = "manager"      # مدير — كل شيء عدا إعدادات النظام
    CASHIER = "cashier"      # كاشير — POS فقط + رؤية المخزون


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر (Tenant Isolation) ────────────────────
    # هاد العمود هو مصدر الحقيقة الوحيد لتحديد أي محل ينتمي له المستخدم.
    # كل عملية بالنظام لازم تفلتر بناءً عليه — أبداً لا تثق بـ store_id
    # جاي من body/query المستخدم نفسه.
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    # ملاحظة: username فريد globally حالياً. لو بدك تسمح لتاجرين مختلفين
    # يستخدموا نفس username (مثلاً "admin")، لازم تحول الـ unique constraint
    # إلى unique_together(store_id, username) بدل ما يكون unique لحاله.
    username = Column(String(50), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=True)
    phone = Column(String(20), nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.CASHIER, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)

    # Relations
    store = relationship("Store")
    employee = relationship("Employee", back_populates="user", uselist=False)
    invoices = relationship("Invoice", back_populates="created_by_user")

    def __repr__(self):
        return f"<User {self.username} store={self.store_id} ({self.role})>"