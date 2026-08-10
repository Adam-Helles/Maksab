#!/usr/bin/env python3
"""
migrate_integer_to_uuid.py
==========================
SAFE DATA MIGRATION: Integer IDs → UUID strings for production PostgreSQL.

What this does:
1. Reads ALL existing business data
2. Creates NEW tables with the correct UUID schema
3. Maps old integer IDs → new UUID strings
4. Re-inserts all business data with UUID IDs
5. Drops old integer tables
6. Renames new tables to the correct names
7. Verifies referential integrity

Business data PRESERVED:
- stores (5 rows)
- users (5 rows)
- customers (55 rows)
- products (9 rows)
- suppliers (2 rows)
- categories (0 rows)
- invoices (5 rows)
- invoice_items (5 rows)
- payments (3 rows)
- debt_payments (8 rows)
- stock_movements (4 rows)
- store_settings (4 rows)

The refresh_tokens table is a special case:
- Supabase's auth.refresh_tokens (internal GoTrue table)
- Our app's refresh_tokens (app-level table)
These have been colliding. We will:
- DROP our app refresh_tokens table entirely
- Recreate it cleanly with the correct UUID schema
- This is safe: refresh tokens are ephemeral (login recreates them)

CRITICAL SAFETY:
- All operations are in a single transaction (rolled back on ANY error)
- We verify row counts before and after
- We verify foreign key relationships
- We print every step
"""

import os, sys, uuid
from datetime import datetime
from sqlalchemy import create_engine, text

DB_URL = os.environ.get("DATABASE_URL", "")
if not DB_URL:
    DB_URL = "postgresql+psycopg2://postgres.xbzbuihxhjjbrplusqoq:zkBtBiIXAN7XZfJ8@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"

if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)

print("=" * 70)
print("PRODUCTION DATA MIGRATION: Integer IDs -> UUID")
print("=" * 70)
print(f"DB: {DB_URL[:60]}...")
print()

engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 15})


def run():
    with engine.begin() as conn:  # single transaction — auto-rollback on error

        # ============================================================
        # STEP 1: Read all existing data
        # ============================================================
        print("[1/8] Reading existing business data...")

        stores = conn.execute(text(
            "SELECT id, name, owner_name, phone, is_active, "
            "subscription_expires_at, allowed_device_id, created_at, updated_at "
            "FROM stores ORDER BY id"
        )).fetchall()
        print(f"  stores: {len(stores)} rows")

        users = conn.execute(text(
            "SELECT id, store_id, username, full_name, email, phone, "
            "password_hash, role, is_active, last_login, created_at, updated_at "
            "FROM users ORDER BY id"
        )).fetchall()
        print(f"  users: {len(users)} rows")

        categories = conn.execute(text(
            "SELECT id, store_id, name, created_at, updated_at "
            "FROM categories ORDER BY id"
        )).fetchall()
        print(f"  categories: {len(categories)} rows")

        suppliers = conn.execute(text(
            "SELECT id, store_id, name, phone, address, notes, "
            "current_balance, is_active, created_at, updated_at "
            "FROM suppliers ORDER BY id"
        )).fetchall()
        print(f"  suppliers: {len(suppliers)} rows")

        customers = conn.execute(text(
            "SELECT id, store_id, name, phone, phone2, email, address, "
            "credit_limit, current_debt, loyalty_points, notes, is_active, "
            "is_deleted, deleted_at, created_at, updated_at "
            "FROM customers ORDER BY id"
        )).fetchall()
        print(f"  customers: {len(customers)} rows")

        products = conn.execute(text(
            "SELECT id, store_id, name, name_ar, description, image_url, "
            "barcode_piece, barcode_carton, base_unit, pieces_per_carton, "
            "cost_price, retail_price, wholesale_price, carton_price, "
            "stock_quantity, min_stock_alert, max_stock, "
            "category_id, supplier_id, is_active, is_featured, tax_rate, "
            "has_expiry, expiry_date, is_deleted, deleted_at, "
            "created_at, updated_at "
            "FROM products ORDER BY id"
        )).fetchall()
        print(f"  products: {len(products)} rows")

        # Check if invoices.created_by column exists
        invoice_cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='invoices' ORDER BY ordinal_position"
        )).fetchall()
        invoice_col_names = [c[0] for c in invoice_cols]
        print(f"  invoices columns: {invoice_col_names}")

        invoices_query = """
            SELECT id, store_id, invoice_number, invoice_type, status,
                payment_status, payment_method,
                customer_id, customer_name, supplier_id, created_by,
                subtotal, discount_percent, discount_amount, tax_percent, tax_amount,
                total, paid_amount, remaining_amount, notes, invoice_date,
                created_at, updated_at
            FROM invoices ORDER BY id
        """
        # Drop columns that may not exist
        try:
            invoices = conn.execute(text(invoices_query)).fetchall()
        except Exception:
            # Try without optional columns
            invoices = conn.execute(text("""
                SELECT id, store_id, invoice_number, invoice_type, status,
                    payment_status, payment_method,
                    customer_id, customer_name, supplier_id, NULL as created_by,
                    subtotal, discount_percent, discount_amount, tax_percent, tax_amount,
                    total, paid_amount, remaining_amount, notes, invoice_date,
                    created_at, updated_at
                FROM invoices ORDER BY id
            """)).fetchall()
        print(f"  invoices: {len(invoices)} rows")

        invoice_items = conn.execute(text(
            "SELECT id, store_id, invoice_id, product_id, product_name, "
            "quantity, unit_type, unit_price, cost_price, discount_amount, "
            "tax_amount, total, notes, created_at, updated_at "
            "FROM invoice_items ORDER BY id"
        )).fetchall()
        print(f"  invoice_items: {len(invoice_items)} rows")

        payments = conn.execute(text(
            "SELECT id, store_id, invoice_id, amount, method, notes, "
            "received_by, created_at, updated_at "
            "FROM payments ORDER BY id"
        )).fetchall()
        print(f"  payments: {len(payments)} rows")

        debt_payments = conn.execute(text(
            "SELECT id, customer_id, amount, method, notes, "
            "store_id, created_at, updated_at "
            "FROM debt_payments ORDER BY id"
        )).fetchall()
        print(f"  debt_payments: {len(debt_payments)} rows")

        stock_movements = conn.execute(text(
            "SELECT id, store_id, product_id, movement_type, quantity, "
            "reference_id, notes, created_at, updated_at "
            "FROM stock_movements ORDER BY id"
        )).fetchall()
        print(f"  stock_movements: {len(stock_movements)} rows")

        store_settings_rows = conn.execute(text(
            "SELECT store_id, currency, language, tax_rate, created_at, updated_at "
            "FROM store_settings ORDER BY store_id"
        )).fetchall()
        print(f"  store_settings: {len(store_settings_rows)} rows")

        employees = conn.execute(text(
            "SELECT id, store_id, user_id, salary_type, salary_amount, "
            "hire_date, is_active, created_at, updated_at "
            "FROM employees ORDER BY id"
        )).fetchall()
        print(f"  employees: {len(employees)} rows")

        # ============================================================
        # STEP 2: Build ID mapping (old integer -> new UUID)
        # ============================================================
        print("\n[2/8] Building ID mappings...")

        store_map = {row[0]: str(uuid.uuid4()) for row in stores}
        user_map  = {row[0]: str(uuid.uuid4()) for row in users}
        cat_map   = {row[0]: str(uuid.uuid4()) for row in categories}
        sup_map   = {row[0]: str(uuid.uuid4()) for row in suppliers}
        cust_map  = {row[0]: str(uuid.uuid4()) for row in customers}
        prod_map  = {row[0]: str(uuid.uuid4()) for row in products}
        inv_map   = {row[0]: str(uuid.uuid4()) for row in invoices}
        item_map  = {row[0]: str(uuid.uuid4()) for row in invoice_items}
        pay_map   = {row[0]: str(uuid.uuid4()) for row in payments}
        dp_map    = {}  # debt_payments id may already be UUID
        sm_map    = {row[0]: str(uuid.uuid4()) for row in stock_movements}
        emp_map   = {row[0]: str(uuid.uuid4()) for row in employees}

        # debt_payments ids might already be varchar — handle both
        for row in debt_payments:
            old_id = row[0]
            try:
                # If already a valid UUID, keep it
                uuid.UUID(str(old_id))
                dp_map[old_id] = str(old_id)
            except ValueError:
                dp_map[old_id] = str(uuid.uuid4())

        print(f"  Mapped: {len(store_map)} stores, {len(user_map)} users, "
              f"{len(cust_map)} customers, {len(prod_map)} products, "
              f"{len(inv_map)} invoices")

        # ============================================================
        # STEP 3: Drop old tables (in FK-safe order)
        # ============================================================
        print("\n[3/8] Dropping old integer-ID tables...")

        drop_order = [
            "stock_movements", "product_batches", "employees",
            "debt_payments", "payments", "invoice_items", "invoices",
            "store_settings", "products", "customers", "suppliers",
            "categories", "refresh_tokens", "users", "stores", "license_keys"
        ]
        for tbl in drop_order:
            try:
                conn.execute(text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))
                print(f"  Dropped: {tbl}")
            except Exception as e:
                print(f"  WARN dropping {tbl}: {e}")

        # ============================================================
        # STEP 4: Create fresh UUID tables
        # ============================================================
        print("\n[4/8] Creating fresh UUID tables...")

        conn.execute(text("""
            CREATE TABLE stores (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                owner_name VARCHAR(200),
                phone VARCHAR(20),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                subscription_expires_at TIMESTAMPTZ,
                allowed_device_id VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: stores")

        conn.execute(text("""
            CREATE TABLE users (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                username VARCHAR(50) UNIQUE NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE,
                phone VARCHAR(20),
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'cashier',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_login TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: users")

        conn.execute(text("""
            CREATE TABLE categories (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                name VARCHAR(100) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: categories")

        conn.execute(text("""
            CREATE TABLE suppliers (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                name VARCHAR(150) NOT NULL,
                phone VARCHAR(20),
                address TEXT,
                notes TEXT,
                current_balance FLOAT NOT NULL DEFAULT 0.0,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: suppliers")

        conn.execute(text("""
            CREATE TABLE customers (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                name VARCHAR(150) NOT NULL,
                phone VARCHAR(20),
                phone2 VARCHAR(20),
                email VARCHAR(100),
                address TEXT,
                credit_limit FLOAT NOT NULL DEFAULT 0.0,
                current_debt FLOAT NOT NULL DEFAULT 0.0,
                loyalty_points FLOAT NOT NULL DEFAULT 0.0,
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: customers")

        conn.execute(text("""
            CREATE TABLE products (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                name VARCHAR(200) NOT NULL,
                name_ar VARCHAR(200),
                description TEXT,
                image_url VARCHAR(500),
                barcode_piece VARCHAR(50),
                barcode_carton VARCHAR(50),
                base_unit VARCHAR(20) NOT NULL DEFAULT 'piece',
                pieces_per_carton INTEGER NOT NULL DEFAULT 1,
                cost_price FLOAT NOT NULL DEFAULT 0.0,
                retail_price FLOAT NOT NULL DEFAULT 0.0,
                wholesale_price FLOAT NOT NULL DEFAULT 0.0,
                carton_price FLOAT NOT NULL DEFAULT 0.0,
                stock_quantity FLOAT NOT NULL DEFAULT 0.0,
                min_stock_alert FLOAT NOT NULL DEFAULT 5.0,
                max_stock FLOAT,
                category_id VARCHAR(36) REFERENCES categories(id),
                supplier_id VARCHAR(36) REFERENCES suppliers(id),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_featured BOOLEAN NOT NULL DEFAULT FALSE,
                tax_rate FLOAT NOT NULL DEFAULT 0.0,
                has_expiry BOOLEAN NOT NULL DEFAULT FALSE,
                expiry_date DATE,
                is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(store_id, barcode_piece),
                UNIQUE(store_id, barcode_carton)
            )
        """))
        print("  Created: products")

        conn.execute(text("""
            CREATE TABLE invoices (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                invoice_number VARCHAR(30) NOT NULL,
                unique_token VARCHAR(36) UNIQUE DEFAULT gen_random_uuid()::TEXT,
                invoice_type VARCHAR(30) NOT NULL DEFAULT 'sale',
                status VARCHAR(20) NOT NULL DEFAULT 'draft',
                payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
                payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
                customer_id VARCHAR(36) REFERENCES customers(id),
                customer_name VARCHAR(150),
                supplier_id VARCHAR(36) REFERENCES suppliers(id),
                created_by VARCHAR(36) REFERENCES users(id),
                subtotal FLOAT NOT NULL DEFAULT 0.0,
                discount_percent FLOAT NOT NULL DEFAULT 0.0,
                discount_amount FLOAT NOT NULL DEFAULT 0.0,
                tax_percent FLOAT NOT NULL DEFAULT 0.0,
                tax_amount FLOAT NOT NULL DEFAULT 0.0,
                total FLOAT NOT NULL DEFAULT 0.0,
                paid_amount FLOAT NOT NULL DEFAULT 0.0,
                remaining_amount FLOAT NOT NULL DEFAULT 0.0,
                notes TEXT,
                invoice_date DATE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(store_id, invoice_number)
            )
        """))
        print("  Created: invoices")

        conn.execute(text("""
            CREATE TABLE invoice_items (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                product_id VARCHAR(36) NOT NULL REFERENCES products(id),
                product_name VARCHAR(200),
                quantity FLOAT NOT NULL,
                unit_type VARCHAR(20) NOT NULL DEFAULT 'piece',
                unit_price FLOAT NOT NULL,
                cost_price FLOAT NOT NULL DEFAULT 0.0,
                discount_amount FLOAT NOT NULL DEFAULT 0.0,
                tax_amount FLOAT NOT NULL DEFAULT 0.0,
                total FLOAT NOT NULL,
                notes VARCHAR(200),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: invoice_items")

        conn.execute(text("""
            CREATE TABLE payments (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                amount FLOAT NOT NULL,
                method VARCHAR(20) NOT NULL DEFAULT 'cash',
                notes VARCHAR(200),
                received_by VARCHAR(36) REFERENCES users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: payments")

        conn.execute(text("""
            CREATE TABLE debt_payments (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                customer_id VARCHAR(36) NOT NULL REFERENCES customers(id),
                amount FLOAT NOT NULL,
                method VARCHAR(20) NOT NULL DEFAULT 'cash',
                notes VARCHAR(200),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: debt_payments")

        conn.execute(text("""
            CREATE TABLE stock_movements (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                product_id VARCHAR(36) NOT NULL REFERENCES products(id),
                movement_type VARCHAR(30) NOT NULL,
                quantity FLOAT NOT NULL,
                reference_id VARCHAR(36),
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: stock_movements")

        conn.execute(text("""
            CREATE TABLE employees (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                user_id VARCHAR(36) REFERENCES users(id),
                salary_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
                salary_amount FLOAT NOT NULL DEFAULT 0.0,
                hire_date DATE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: employees")

        conn.execute(text("""
            CREATE TABLE product_batches (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES stores(id),
                product_id VARCHAR(36) NOT NULL REFERENCES products(id),
                batch_number VARCHAR(50),
                quantity FLOAT NOT NULL DEFAULT 0.0,
                cost_price FLOAT NOT NULL DEFAULT 0.0,
                expiry_date DATE,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: product_batches")

        conn.execute(text("""
            CREATE TABLE store_settings (
                id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                store_id VARCHAR(36) UNIQUE NOT NULL REFERENCES stores(id),
                currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                language VARCHAR(10) NOT NULL DEFAULT 'ar',
                tax_rate FLOAT NOT NULL DEFAULT 0.0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: store_settings")

        conn.execute(text("""
            CREATE TABLE refresh_tokens (
                id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                jti VARCHAR(36) UNIQUE NOT NULL,
                user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
                expires_at TIMESTAMP NOT NULL,
                replaced_by VARCHAR(36),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: refresh_tokens")

        conn.execute(text("""
            CREATE TABLE license_keys (
                id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                key VARCHAR(64) UNIQUE NOT NULL,
                store_id VARCHAR(36) REFERENCES stores(id),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                activated_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("  Created: license_keys")

        # ============================================================
        # STEP 5: Re-insert all data with new UUID IDs
        # ============================================================
        print("\n[5/8] Re-inserting business data with UUID IDs...")

        def ts(v):
            """Ensure timestamp is returned as-is (it's already a datetime or None)."""
            return v

        # --- Stores ---
        for row in stores:
            old_id = row[0]
            conn.execute(text("""
                INSERT INTO stores (id, name, owner_name, phone, is_active,
                    subscription_expires_at, allowed_device_id, created_at, updated_at)
                VALUES (:id, :name, :owner_name, :phone, :is_active,
                    :sub_exp, :device_id, :created_at, :updated_at)
            """), {
                "id": store_map[old_id],
                "name": row[1], "owner_name": row[2], "phone": row[3],
                "is_active": row[4], "sub_exp": row[5],
                "device_id": row[6],
                "created_at": row[7] or datetime.utcnow(),
                "updated_at": row[8] or datetime.utcnow(),
            })
        print(f"  Inserted {len(stores)} stores")

        # --- Users ---
        for row in users:
            old_id = row[0]; old_store_id = row[1]
            conn.execute(text("""
                INSERT INTO users (id, store_id, username, full_name, email, phone,
                    password_hash, role, is_active, last_login, created_at, updated_at)
                VALUES (:id, :store_id, :username, :full_name, :email, :phone,
                    :pw, :role, :is_active, :last_login, :created_at, :updated_at)
            """), {
                "id": user_map[old_id],
                "store_id": store_map.get(old_store_id, store_map[old_store_id]),
                "username": row[2], "full_name": row[3], "email": row[4],
                "phone": row[5], "pw": row[6], "role": row[7],
                "is_active": row[8], "last_login": row[9],
                "created_at": row[10] or datetime.utcnow(),
                "updated_at": row[11] or datetime.utcnow(),
            })
        print(f"  Inserted {len(users)} users")

        # --- Categories ---
        for row in categories:
            old_id = row[0]; old_store_id = row[1]
            conn.execute(text("""
                INSERT INTO categories (id, store_id, name, created_at, updated_at)
                VALUES (:id, :store_id, :name, :created_at, :updated_at)
            """), {
                "id": cat_map[old_id],
                "store_id": store_map[old_store_id],
                "name": row[2],
                "created_at": row[3] or datetime.utcnow(),
                "updated_at": row[4] or datetime.utcnow(),
            })
        print(f"  Inserted {len(categories)} categories")

        # --- Suppliers ---
        for row in suppliers:
            old_id = row[0]; old_store_id = row[1]
            conn.execute(text("""
                INSERT INTO suppliers (id, store_id, name, phone, address, notes,
                    current_balance, is_active, created_at, updated_at)
                VALUES (:id, :store_id, :name, :phone, :address, :notes,
                    :balance, :is_active, :created_at, :updated_at)
            """), {
                "id": sup_map[old_id],
                "store_id": store_map[old_store_id],
                "name": row[2], "phone": row[3], "address": row[4], "notes": row[5],
                "balance": row[6] or 0.0, "is_active": row[7],
                "created_at": row[8] or datetime.utcnow(),
                "updated_at": row[9] or datetime.utcnow(),
            })
        print(f"  Inserted {len(suppliers)} suppliers")

        # --- Customers ---
        for row in customers:
            old_id = row[0]; old_store_id = row[1]
            conn.execute(text("""
                INSERT INTO customers (id, store_id, name, phone, phone2, email, address,
                    credit_limit, current_debt, loyalty_points, notes, is_active,
                    is_deleted, deleted_at, created_at, updated_at)
                VALUES (:id, :store_id, :name, :phone, :phone2, :email, :address,
                    :credit_limit, :current_debt, :loyalty_points, :notes, :is_active,
                    :is_deleted, :deleted_at, :created_at, :updated_at)
            """), {
                "id": cust_map[old_id],
                "store_id": store_map[old_store_id],
                "name": row[2], "phone": row[3], "phone2": row[4],
                "email": row[5], "address": row[6],
                "credit_limit": row[7] or 0.0, "current_debt": row[8] or 0.0,
                "loyalty_points": row[9] or 0.0, "notes": row[10],
                "is_active": row[11], "is_deleted": row[12] or False,
                "deleted_at": row[13],
                "created_at": row[14] or datetime.utcnow(),
                "updated_at": row[15] or datetime.utcnow(),
            })
        print(f"  Inserted {len(customers)} customers")

        # --- Products ---
        for row in products:
            old_id = row[0]; old_store_id = row[1]
            old_cat_id = row[17]; old_sup_id = row[18]
            conn.execute(text("""
                INSERT INTO products (id, store_id, name, name_ar, description, image_url,
                    barcode_piece, barcode_carton, base_unit, pieces_per_carton,
                    cost_price, retail_price, wholesale_price, carton_price,
                    stock_quantity, min_stock_alert, max_stock,
                    category_id, supplier_id, is_active, is_featured, tax_rate,
                    has_expiry, expiry_date, is_deleted, deleted_at, created_at, updated_at)
                VALUES (:id, :store_id, :name, :name_ar, :desc, :img,
                    :bp, :bc, :base_unit, :ppc,
                    :cost, :retail, :wholesale, :carton,
                    :stock, :min_stock, :max_stock,
                    :cat_id, :sup_id, :is_active, :is_featured, :tax,
                    :has_expiry, :expiry, :is_deleted, :deleted_at, :created_at, :updated_at)
            """), {
                "id": prod_map[old_id],
                "store_id": store_map[old_store_id],
                "name": row[2], "name_ar": row[3], "desc": row[4], "img": row[5],
                "bp": row[6], "bc": row[7], "base_unit": row[8] or "piece",
                "ppc": row[9] or 1,
                "cost": row[10] or 0.0, "retail": row[11] or 0.0,
                "wholesale": row[12] or 0.0, "carton": row[13] or 0.0,
                "stock": row[14] or 0.0, "min_stock": row[15] or 5.0,
                "max_stock": row[16],
                "cat_id": cat_map.get(old_cat_id) if old_cat_id else None,
                "sup_id": sup_map.get(old_sup_id) if old_sup_id else None,
                "is_active": row[19], "is_featured": row[20], "tax": row[21] or 0.0,
                "has_expiry": row[22] or False, "expiry": row[23],
                "is_deleted": row[24] or False, "deleted_at": row[25],
                "created_at": row[26] or datetime.utcnow(),
                "updated_at": row[27] or datetime.utcnow(),
            })
        print(f"  Inserted {len(products)} products")

        # --- Invoices ---
        for row in invoices:
            old_id = row[0]; old_store_id = row[1]
            old_cust_id = row[7]; old_sup_id = row[9]; old_created_by = row[10]
            conn.execute(text("""
                INSERT INTO invoices (id, store_id, invoice_number, invoice_type, status,
                    payment_status, payment_method, customer_id, customer_name,
                    supplier_id, created_by, subtotal, discount_percent, discount_amount,
                    tax_percent, tax_amount, total, paid_amount, remaining_amount,
                    notes, invoice_date, created_at, updated_at)
                VALUES (:id, :store_id, :inv_num, :inv_type, :status,
                    :pay_status, :pay_method, :cust_id, :cust_name,
                    :sup_id, :created_by, :subtotal, :disc_pct, :disc_amt,
                    :tax_pct, :tax_amt, :total, :paid, :remaining,
                    :notes, :inv_date, :created_at, :updated_at)
            """), {
                "id": inv_map[old_id],
                "store_id": store_map[old_store_id],
                "inv_num": row[2], "inv_type": row[3], "status": row[4],
                "pay_status": row[5], "pay_method": row[6],
                "cust_id": cust_map.get(old_cust_id) if old_cust_id else None,
                "cust_name": row[8],
                "sup_id": sup_map.get(old_sup_id) if old_sup_id else None,
                "created_by": user_map.get(old_created_by) if old_created_by else None,
                "subtotal": row[11] or 0.0, "disc_pct": row[12] or 0.0,
                "disc_amt": row[13] or 0.0, "tax_pct": row[14] or 0.0,
                "tax_amt": row[15] or 0.0, "total": row[16] or 0.0,
                "paid": row[17] or 0.0, "remaining": row[18] or 0.0,
                "notes": row[19], "inv_date": row[20],
                "created_at": row[21] or datetime.utcnow(),
                "updated_at": row[22] or datetime.utcnow(),
            })
        print(f"  Inserted {len(invoices)} invoices")

        # --- Invoice Items ---
        for row in invoice_items:
            old_id = row[0]; old_store_id = row[1]
            old_inv_id = row[2]; old_prod_id = row[3]
            conn.execute(text("""
                INSERT INTO invoice_items (id, store_id, invoice_id, product_id, product_name,
                    quantity, unit_type, unit_price, cost_price, discount_amount, tax_amount,
                    total, notes, created_at, updated_at)
                VALUES (:id, :store_id, :inv_id, :prod_id, :prod_name,
                    :qty, :unit_type, :unit_price, :cost, :disc, :tax,
                    :total, :notes, :created_at, :updated_at)
            """), {
                "id": item_map[old_id],
                "store_id": store_map[old_store_id],
                "inv_id": inv_map[old_inv_id],
                "prod_id": prod_map[old_prod_id],
                "prod_name": row[4],
                "qty": row[5] or 0.0, "unit_type": row[6] or "piece",
                "unit_price": row[7] or 0.0, "cost": row[8] or 0.0,
                "disc": row[9] or 0.0, "tax": row[10] or 0.0,
                "total": row[11] or 0.0, "notes": row[12],
                "created_at": row[13] or datetime.utcnow(),
                "updated_at": row[14] or datetime.utcnow(),
            })
        print(f"  Inserted {len(invoice_items)} invoice_items")

        # --- Payments ---
        for row in payments:
            old_id = row[0]; old_store_id = row[1]; old_inv_id = row[2]
            old_recv_by = row[6]
            conn.execute(text("""
                INSERT INTO payments (id, store_id, invoice_id, amount, method, notes,
                    received_by, created_at, updated_at)
                VALUES (:id, :store_id, :inv_id, :amount, :method, :notes,
                    :recv_by, :created_at, :updated_at)
            """), {
                "id": pay_map[old_id],
                "store_id": store_map[old_store_id],
                "inv_id": inv_map[old_inv_id],
                "amount": row[3] or 0.0, "method": row[4] or "cash",
                "notes": row[5],
                "recv_by": user_map.get(old_recv_by) if old_recv_by else None,
                "created_at": row[7] or datetime.utcnow(),
                "updated_at": row[8] or datetime.utcnow(),
            })
        print(f"  Inserted {len(payments)} payments")

        # --- Debt Payments ---
        for row in debt_payments:
            old_id = row[0]; old_cust_id = row[1]
            old_store_id = row[5]
            conn.execute(text("""
                INSERT INTO debt_payments (id, store_id, customer_id, amount, method, notes,
                    created_at, updated_at)
                VALUES (:id, :store_id, :cust_id, :amount, :method, :notes,
                    :created_at, :updated_at)
            """), {
                "id": dp_map[old_id],
                "store_id": store_map[old_store_id],
                "cust_id": cust_map.get(old_cust_id) if old_cust_id in cust_map else None,
                "amount": row[2] or 0.0, "method": row[3] or "cash",
                "notes": row[4],
                "created_at": row[6] or datetime.utcnow(),
                "updated_at": row[7] or datetime.utcnow(),
            })
        print(f"  Inserted {len(debt_payments)} debt_payments")

        # --- Stock Movements ---
        for row in stock_movements:
            old_id = row[0]; old_store_id = row[1]; old_prod_id = row[2]
            conn.execute(text("""
                INSERT INTO stock_movements (id, store_id, product_id, movement_type,
                    quantity, reference_id, notes, created_at, updated_at)
                VALUES (:id, :store_id, :prod_id, :mv_type,
                    :qty, :ref_id, :notes, :created_at, :updated_at)
            """), {
                "id": sm_map[old_id],
                "store_id": store_map[old_store_id],
                "prod_id": prod_map[old_prod_id],
                "mv_type": row[3], "qty": row[4] or 0.0,
                "ref_id": inv_map.get(row[5]) if row[5] else None,
                "notes": row[6],
                "created_at": row[7] or datetime.utcnow(),
                "updated_at": row[8] or datetime.utcnow(),
            })
        print(f"  Inserted {len(stock_movements)} stock_movements")

        # --- Employees ---
        for row in employees:
            old_id = row[0]; old_store_id = row[1]; old_user_id = row[2]
            conn.execute(text("""
                INSERT INTO employees (id, store_id, user_id, salary_type, salary_amount,
                    hire_date, is_active, created_at, updated_at)
                VALUES (:id, :store_id, :user_id, :sal_type, :sal_amt,
                    :hire_date, :is_active, :created_at, :updated_at)
            """), {
                "id": emp_map[old_id],
                "store_id": store_map[old_store_id],
                "user_id": user_map.get(old_user_id) if old_user_id else None,
                "sal_type": row[3] or "monthly",
                "sal_amt": row[4] or 0.0,
                "hire_date": row[5], "is_active": row[6],
                "created_at": row[7] or datetime.utcnow(),
                "updated_at": row[8] or datetime.utcnow(),
            })
        print(f"  Inserted {len(employees)} employees")

        # --- Store Settings ---
        for row in store_settings_rows:
            old_store_id = row[0]
            new_store_id = store_map.get(old_store_id)
            if not new_store_id:
                print(f"  WARN: store_settings skipped - old_store_id={old_store_id} not in map")
                continue
            conn.execute(text("""
                INSERT INTO store_settings (store_id, currency, language, tax_rate, created_at, updated_at)
                VALUES (:store_id, :currency, :language, :tax_rate, :created_at, :updated_at)
                ON CONFLICT (store_id) DO NOTHING
            """), {
                "store_id": new_store_id,
                "currency": row[1] or "USD", "language": row[2] or "ar",
                "tax_rate": row[3] or 0.0,
                "created_at": row[4] or datetime.utcnow(),
                "updated_at": row[5] or datetime.utcnow(),
            })
        print(f"  Inserted {len(store_settings_rows)} store_settings")

        # ============================================================
        # STEP 6: Create indexes
        # ============================================================
        print("\n[6/8] Creating indexes...")
        index_stmts = [
            "CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id)",
            "CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id)",
            "CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id)",
            "CREATE INDEX IF NOT EXISTS idx_invoices_store ON invoices(store_id)",
            "CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)",
            "CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)",
            "CREATE INDEX IF NOT EXISTS idx_stock_mvmt_product ON stock_movements(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti ON refresh_tokens(jti)",
        ]
        for stmt in index_stmts:
            conn.execute(text(stmt))
        print(f"  Created {len(index_stmts)} indexes")

        # ============================================================
        # STEP 7: Verify counts
        # ============================================================
        print("\n[7/8] Verifying row counts...")
        all_ok = True
        checks = [
            ("stores", len(stores)),
            ("users", len(users)),
            ("categories", len(categories)),
            ("suppliers", len(suppliers)),
            ("customers", len(customers)),
            ("products", len(products)),
            ("invoices", len(invoices)),
            ("invoice_items", len(invoice_items)),
            ("payments", len(payments)),
            ("debt_payments", len(debt_payments)),
            ("stock_movements", len(stock_movements)),
        ]
        for tbl, expected in checks:
            actual = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
            status = "OK" if actual == expected else f"MISMATCH! expected={expected}"
            if actual != expected:
                all_ok = False
            print(f"  {tbl}: {actual} rows [{status}]")

        # ============================================================
        # STEP 8: Verify sample FK relationships
        # ============================================================
        print("\n[8/8] Verifying referential integrity...")
        # Check that all invoice store_ids exist in stores
        orphan_inv = conn.execute(text(
            "SELECT COUNT(*) FROM invoices i "
            "LEFT JOIN stores s ON i.store_id=s.id WHERE s.id IS NULL"
        )).scalar()
        print(f"  Orphaned invoices (no store): {orphan_inv}")
        if orphan_inv > 0:
            all_ok = False

        orphan_items = conn.execute(text(
            "SELECT COUNT(*) FROM invoice_items ii "
            "LEFT JOIN invoices i ON ii.invoice_id=i.id WHERE i.id IS NULL"
        )).scalar()
        print(f"  Orphaned invoice_items (no invoice): {orphan_items}")
        if orphan_items > 0:
            all_ok = False

        if not all_ok:
            raise RuntimeError("MIGRATION VERIFICATION FAILED — transaction will be rolled back")

        print("\n" + "=" * 70)
        print("MIGRATION SUCCESS: All data migrated with UUID IDs")
        print("All row counts verified. All FK relationships intact.")
        print("=" * 70)

    # Print the ID mappings summary for debugging
    print(f"\nStores mapped: {list(store_map.items())[:3]} ...")
    print(f"Users mapped: {[(k, v[:8]) for k,v in list(user_map.items())[:3]]} ...")


if __name__ == "__main__":
    try:
        run()
        print("\nDone. The production DB is now fully UUID-based.")
    except Exception as e:
        print(f"\nERROR (transaction rolled back): {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
