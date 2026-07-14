# migrate_add_offline_sale_columns.py
#
# يضيف 3 أعمدة جديدة لجدول invoices الموجود مسبقاً (client_uuid,
# needs_review, review_notes) بدون ما يمسح أي بيانات موجودة.
# شغّله مرة وحدة بس، من جذر cashtop-api:
#
#     python migrate_add_offline_sale_columns.py

import sqlite3
from app.config import settings

# استخراج مسار ملف SQLite من DATABASE_URL (شكلها sqlite:///./cashtop.db)
db_path = settings.DATABASE_URL.replace("sqlite:///", "")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("PRAGMA table_info(invoices);")
existing_columns = {row[1] for row in cursor.fetchall()}

added = []

if "client_uuid" not in existing_columns:
    cursor.execute("ALTER TABLE invoices ADD COLUMN client_uuid VARCHAR(36);")
    cursor.execute("CREATE UNIQUE INDEX ix_invoices_client_uuid ON invoices (client_uuid);")
    added.append("client_uuid")

if "needs_review" not in existing_columns:
    cursor.execute("ALTER TABLE invoices ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT 0;")
    added.append("needs_review")

if "review_notes" not in existing_columns:
    cursor.execute("ALTER TABLE invoices ADD COLUMN review_notes TEXT;")
    added.append("review_notes")

conn.commit()
conn.close()

if added:
    print(f"✅ تمت إضافة الأعمدة: {', '.join(added)}")
else:
    print("ℹ️ كل الأعمدة موجودة مسبقاً — ما في شي للإضافة.")
