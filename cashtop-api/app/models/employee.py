import enum
from sqlalchemy import Column, Integer, String, Float, Boolean, Date, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin, SoftDeleteMixin


class SalaryType(str, enum.Enum):
    MONTHLY = "monthly"
    DAILY = "daily"
    HOURLY = "hourly"
    COMMISSION = "commission"


class Employee(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)

    # ─── عزل التاجر ────────────────────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    # ربط بالمستخدم (اختياري — موظف قد لا يملك حساب دخول)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, unique=True)

    # ─── المعلومات الشخصية ─────────────────────────────────
    full_name = Column(String(150), nullable=False, index=True)
    phone = Column(String(20), nullable=True)
    phone2 = Column(String(20), nullable=True)
    national_id = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    birth_date = Column(Date, nullable=True)

    # ─── معلومات التوظيف ───────────────────────────────────
    job_title = Column(String(100), nullable=True)
    hire_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    # ─── الراتب ────────────────────────────────────────────
    salary_type = Column(SAEnum(SalaryType), default=SalaryType.MONTHLY, nullable=False)
    base_salary = Column(Float, default=0.0, nullable=False)
    commission_rate = Column(Float, default=0.0, nullable=False)

    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relations
    store = relationship("Store")
    user = relationship("User", back_populates="employee")

    def __repr__(self):
        return f"<Employee {self.full_name} store={self.store_id}>"