# seed_test_debt.py
#
# شغّله من داخل مجلد cashtop-api (نفس مكان مجلد app) والـ venv مفعّل:
#   python seed_test_debt.py
#
# بيحط دين تجريبي على أول عميل بيلاقيه بهذا الاسم — مباشرة بقاعدة
# البيانات، بدون ما يمر بأي endpoint أو منطق فواتير.

from app.database import SessionLocal
from app.models.customer import Customer

CUSTOMER_NAME_CONTAINS = "أبو محمد"  # عدّل لو الاسم مختلف شوي
DEBT_AMOUNT = 150.0

db = SessionLocal()
try:
    customer = (
        db.query(Customer)
        .filter(Customer.name.ilike(f"%{CUSTOMER_NAME_CONTAINS}%"))
        .first()
    )

    if not customer:
        print(f"❌ ما لقيت عميل اسمه فيه '{CUSTOMER_NAME_CONTAINS}'")
        print("الأسماء الموجودة فعلياً:")
        for c in db.query(Customer).all():
            print(f"  - {c.name} (id={c.id})")
    else:
        customer.current_debt = DEBT_AMOUNT
        db.commit()
        print(f"✅ تم: {customer.name} (id={customer.id}) صار عنده دين {customer.current_debt} ₪")
finally:
    db.close()
