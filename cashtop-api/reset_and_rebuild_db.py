"""
reset_and_rebuild_db.py
=======================
يحذف جميع الجداول القديمة ويعيد بناءها نظيفة بالأنواع الصحيحة.

⚠️ هذا السكريبت يحذف كل البيانات — استخدمه فقط إذا تأكدت أنه لا
توجد بيانات إنتاج تستحق الحفاظ عليها.

الغرض: تصحيح خطأ DataError بسبب أعمدة INTEGER في PostgreSQL بينما
الكود أصبح يستخدم UUID (String) كمعرفات أساسية.
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ─── استيراد كل النماذج لضمان تسجيلها مع Base.metadata ───────────
from app.database import Base

# ترتيب الاستيراد مهم لضمان تسجيل كل الجداول
from app.models.store import Store
from app.models.user import User
from app.models.category import Category
from app.models.supplier import Supplier
from app.models.customer import Customer
from app.models.product import Product
from app.models.product_batch import ProductBatch
from app.models.stock_movement import StockMovement
from app.models.invoice import Invoice, InvoiceItem, Payment
from app.models.debt_payment import DebtPayment
from app.models.license import LicenseKey
from app.models.settings import StoreSettings
from app.models.employee import Employee
from app.models.refresh_token import RefreshToken

DATABASE_URL = "postgresql+psycopg2://postgres:zkBtBiIXAN7XZfJ8@db.xbzbuihxhjjbrplusqoq.supabase.co:5432/postgres"


def reset_and_rebuild():
    print("=" * 60)
    print("⚠️  إعادة بناء قاعدة البيانات (DROP ALL + CREATE ALL)")
    print("=" * 60)

    engine = create_engine(DATABASE_URL, echo=True)

    # ─── حذف جميع الجداول بترتيب آمن (يراعي الـ foreign keys) ────
    print("\n[1/3] حذف جميع الجداول القديمة...")
    Base.metadata.drop_all(bind=engine)
    print("✅ تم حذف الجداول القديمة.")

    # ─── إنشاء الجداول الجديدة بالأنواع الصحيحة ─────────────────
    print("\n[2/3] إنشاء الجداول بأنواع UUID صحيحة...")
    Base.metadata.create_all(bind=engine)
    print("✅ تم إنشاء الجداول الجديدة.")

    # ─── التحقق من أنواع الأعمدة ─────────────────────────────────
    print("\n[3/3] التحقق من أنواع الأعمدة الرئيسية...")
    with engine.connect() as conn:
        tables_to_check = [
            "stores", "users", "customers", "products", "suppliers",
            "categories", "invoices", "invoice_items", "debt_payments",
            "stock_movements", "product_batches", "payments"
        ]
        for table in tables_to_check:
            try:
                result = conn.execute(text(f"""
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_name = '{table}'
                    AND column_name = 'id'
                """))
                row = result.fetchone()
                if row:
                    col_name, data_type = row
                    status = "✅" if "character" in data_type else "❌ INTEGER! يجب إصلاحه"
                    print(f"  {table}.id: {data_type} {status}")
                else:
                    print(f"  {table}: لم يتم العثور عليه")
            except Exception as e:
                print(f"  {table}: خطأ - {e}")

    print("\n" + "=" * 60)
    print("✅ اكتملت إعادة البناء. قاعدة البيانات جاهزة.")
    print("الخطوة التالية: أنشئ المتجر والمستخدم عبر create_test_store.py")
    print("=" * 60)


if __name__ == "__main__":
    reset_and_rebuild()
