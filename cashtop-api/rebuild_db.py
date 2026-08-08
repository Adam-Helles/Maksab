#!/usr/bin/env python3
"""
rebuild_db.py  --  Run this ONCE on Render Shell to fix UUID schema.

Usage (on Render Shell):
    python rebuild_db.py

What it does:
  1. Drops ALL old tables (integer IDs era)
  2. Recreates ALL tables fresh with correct VARCHAR(36) UUID columns
  3. Verifies column types
  4. Reports success or failure

WARNING: Destroys all data. Safe only because there is no real
production data to preserve at this stage.
"""

import sys
import os

# Ensure we can import the app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text, inspect
from app.database import Base

# Import all models to register them with Base.metadata
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

# Read DB URL from environment (Render sets DATABASE_URL)
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    # Fallback hardcoded for emergency use only
    DATABASE_URL = "postgresql+psycopg2://postgres:zkBtBiIXAN7XZfJ8@db.xbzbuihxhjjbrplusqoq.supabase.co:5432/postgres"

# SQLAlchemy requires postgresql+psycopg2:// scheme
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)


def rebuild():
    print("=" * 60)
    print("DB REBUILD: Drop all tables + Recreate with UUID schema")
    print("=" * 60)

    engine = create_engine(DATABASE_URL, echo=False)

    # Step 1: Drop all tables
    print("\n[1/3] Dropping all old tables...")
    try:
        Base.metadata.drop_all(bind=engine)
        print("  OK - All tables dropped.")
    except Exception as e:
        print(f"  WARN - drop_all error (may be first run): {e}")

    # Step 2: Create fresh tables
    print("\n[2/3] Creating tables with correct UUID schema...")
    Base.metadata.create_all(bind=engine)
    print("  OK - All tables created.")

    # Step 3: Verify UUID columns
    print("\n[3/3] Verifying column types...")
    inspector = inspect(engine)
    tables_to_check = [
        "stores", "users", "customers", "products", "suppliers",
        "categories", "invoices", "invoice_items", "payments",
        "debt_payments", "stock_movements",
    ]

    all_ok = True
    for table_name in tables_to_check:
        try:
            columns = inspector.get_columns(table_name)
            id_col = next((c for c in columns if c["name"] == "id"), None)
            if id_col:
                dtype = str(id_col["type"])
                is_str = "VARCHAR" in dtype.upper() or "CHAR" in dtype.upper()
                status = "OK" if is_str else "FAIL - Still INTEGER!"
                if not is_str:
                    all_ok = False
                print(f"  {table_name}.id: {dtype} -> {status}")
            else:
                print(f"  {table_name}: no 'id' column found")
        except Exception as e:
            print(f"  {table_name}: ERROR - {e}")
            all_ok = False

    print("\n" + "=" * 60)
    if all_ok:
        print("SUCCESS: All tables use VARCHAR(36) UUID primary keys.")
        print("Next: Run 'python create_test_store.py' to create store + admin user.")
    else:
        print("FAILURE: Some tables still have wrong types. Check errors above.")
    print("=" * 60)
    return all_ok


if __name__ == "__main__":
    success = rebuild()
    sys.exit(0 if success else 1)
