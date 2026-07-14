# app/models/debt_payment.py
#
# كل دفعة بتنسجل كـ "حدث" مستقل (id فريد يتولد من الجهاز)، مش كتعديل
# مباشر على current_debt — idempotent، منيع من التطبيق المزدوج.

from datetime import datetime

from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey

from app.database import Base


class DebtPayment(Base):
    __tablename__ = "debt_payments"

    id = Column(String, primary_key=True)  # UUID يتولد من الجهاز نفسه

    # ─── عزل التاجر ────────────────────────────────────────
    # دفاع بالعمق: حتى لو الراوتر نسي يتحقق من customer.store_id بمكان
    # ما، وجود store_id مباشرة هون بيسمح تعمل فلترة/تدقيق مستقل على
    # جدول الدفعات نفسه (مثلاً تقرير "كل الدفعات بمحل X" بدون join).
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    method = Column(String, default="cash")

    client_created_at = Column(DateTime, nullable=False)
    server_applied_at = Column(DateTime, default=datetime.utcnow, nullable=False)