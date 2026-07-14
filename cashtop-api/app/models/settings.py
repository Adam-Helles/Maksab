from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class StoreSettings(Base):
    """
    إعدادات المحل العامة.

    ⚠️ إصلاح جوهري: كانت صف واحد ثابت بكل الجدول (id=1) يتشاركه كل
    التجار المسجلين بالمنصة — أي تاجر يعدّل اسم محله أو عملته كان
    فعلياً يغيّرها لكل التجار الآخرين بنفس اللحظة. صار كل محل له صف
    خاص فيه، مربوط بـ store_id (unique — صف واحد بالضبط لكل محل).
    """
    __tablename__ = "store_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # ─── عزل التاجر ────────────────────────────────────────
    store_id = Column(Integer, ForeignKey("stores.id"), unique=True, nullable=False, index=True)
    store_name = Column(String(200), default="محلي")
    logo_url = Column(String(500), nullable=True)
    currency = Column(String(10), default="₪")
    phone = Column(String(50), nullable=True)
    address = Column(String(300), nullable=True)
    tax_number = Column(String(100), nullable=True)
    invoice_footer_note = Column(String(300), nullable=True)

    store = relationship("Store")