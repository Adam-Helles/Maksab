"""
مولّد أرقام الفواتير
Format: INV-YYYYMMDD-XXXX  مثلاً: INV-20250628-0042

⚠️ إصلاح أمني/منطقي: العدّاد كان يحسب عدد فواتير اليوم بكل الجدول
(كل التجار مع بعض). هاد فيه مشكلتين:
  1. تسريب معلومة: تاجر يشوف رقم فاتورته ويقدر يخمّن حجم مبيعات
     كل المنصة (كل التجار) بهاليوم.
  2. باگ منطقي: لو تاجرين سجّلوا فواتير بنفس اليوم، الترقيم يصير
     متداخل بينهم بدل ما يكون كل تاجر يبلّش من 0001 لحاله.
الحل: العدّ صار مفلتر بـ store_id.
"""
from datetime import date
from sqlalchemy.orm import Session


def generate_invoice_number(db: Session, store_id: int, prefix: str = "INV") -> str:
    from app.models.invoice import Invoice

    today = date.today().strftime("%Y%m%d")
    pattern = f"{prefix}-{today}-%"

    # ⚠️ فلترة store_id إجبارية هون
    count = db.query(Invoice).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_number.like(pattern),
    ).count()

    seq = count + 1
    return f"{prefix}-{today}-{seq:04d}"


def generate_purchase_number(db: Session, store_id: int) -> str:
    return generate_invoice_number(db, store_id, prefix="PUR")


def generate_return_number(db: Session, store_id: int) -> str:
    return generate_invoice_number(db, store_id, prefix="RET")