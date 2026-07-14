# app/models/store.py
#
# جدول المحلات (Tenants). كل محل = صف واحد هون.
# هاد الجدول هو أساس عزل البيانات بين التجار (multi-tenant isolation).

from sqlalchemy import Column, Integer, String, Boolean, DateTime
from app.database import Base
from app.models.base import TimestampMixin


class Store(Base, TimestampMixin):
    __tablename__ = "stores"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    owner_name = Column(String(200), nullable=True)
    phone = Column(String(20), nullable=True)

    # للتحكم بالاشتراك — لو انتهى الاشتراك أو انعلّق، بدك تقفل الوصول
    # فوراً بدون ما تنتظر انتهاء صلاحية التوكن (access token عمره قصير أصلاً،
    # لكن هاد بيغطي حالة تعليق فوري لأي سبب: عدم دفع، إساءة استخدام، الخ)
    is_active = Column(Boolean, default=True, nullable=False)
    subscription_expires_at = Column(DateTime(timezone=True), nullable=True)

    def __repr__(self):
        return f"<Store {self.name} active={self.is_active}>"