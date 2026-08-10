#!/usr/bin/env python3
"""
migrate_to_uuid.py
==================
Production-safe migration: INTEGER primary/foreign keys -> UUID VARCHAR(36)

MODES:
  --dry-run   Read all data, validate all mappings and FK references,
              check multi-tenant isolation. NO writes. Safe to run anytime.
  --execute   Run the full migration inside a single PostgreSQL transaction.
              Automatically rolls back on ANY failure.
  --verify    Post-migration read-only verification report.

SAFETY GUARANTEES:
  - All DDL + DML inside ONE transaction (shadow table strategy)
  - Original tables only dropped AFTER shadow tables are created + populated
  - PostgreSQL DDL is transactional: any failure = full automatic rollback
  - Supabase internal auth tables (auth.*) are NEVER touched
  - public.refresh_tokens (Supabase GoTrue collision) is replaced by app_refresh_tokens
  - Zero data loss verified with row counts + orphan checks inside the transaction

Usage:
  python migrate_to_uuid.py --dry-run
  python migrate_to_uuid.py --execute   # Only after --dry-run passes
  python migrate_to_uuid.py --verify    # After --execute commits
"""

import os
import sys
import uuid
import json
import argparse
from datetime import datetime
from sqlalchemy import create_engine, text

# ─── DB Connection ────────────────────────────────────────────────────────────
DB_URL = os.environ.get("DATABASE_URL", "")
if not DB_URL:
    DB_URL = (
        "postgresql+psycopg2://postgres.xbzbuihxhjjbrplusqoq:"
        "zkBtBiIXAN7XZfJ8@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"
    )
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)

REPORT_FILE = os.path.join(os.path.dirname(__file__), "migration_report.json")

# ─── Tables we own (in dependency order) ─────────────────────────────────────
# 'refresh_tokens' is intentionally excluded (Supabase GoTrue table)
OWNED_TABLES = [
    "stores", "users", "categories", "suppliers", "customers",
    "products", "invoices", "invoice_items", "payments", "debt_payments",
    "stock_movements", "employees", "product_batches", "store_settings",
    "license_keys",
]

# Drop order (reverse FK dependency)
DROP_ORDER = [
    "refresh_tokens",       # Supabase collision table — remove it
    "license_keys",
    "store_settings",
    "product_batches",
    "employees",
    "stock_movements",
    "debt_payments",
    "payments",
    "invoice_items",
    "invoices",
    "products",
    "customers",
    "suppliers",
    "categories",
    "users",
    "stores",
]

PRINT_SEP = lambda s: print(f"\n{'='*70}\n{s}\n{'='*70}")


# ─── Data loading ─────────────────────────────────────────────────────────────

def load_all_data(conn):
    """Load all business data from production. Returns a dict of table -> list of rows."""
    data = {}

    data["stores"] = conn.execute(text(
        "SELECT id, name, owner_name, phone, is_active, subscription_expires_at, "
        "allowed_device_id, created_at, updated_at FROM stores ORDER BY id"
    )).fetchall()

    # Users table is mixed with Supabase auth.users in production.
    # Select only our app user rows: they have password_hash IS NOT NULL.
    # Cast role to text to avoid enum type issues across connections.
    data["users"] = conn.execute(text(
        "SELECT DISTINCT ON (id) id, store_id, username, full_name, email, phone, "
        "password_hash, role::text AS role, is_active, last_login, created_at, updated_at "
        "FROM users "
        "WHERE password_hash IS NOT NULL AND username IS NOT NULL "
        "ORDER BY id"
    )).fetchall()

    data["categories"] = conn.execute(text(
        "SELECT id, store_id, name, name_ar, description, color, icon, is_active, "
        "created_at, updated_at FROM categories ORDER BY id"
    )).fetchall()

    data["suppliers"] = conn.execute(text(
        "SELECT id, store_id, name, company, phone, phone2, email, address, "
        "tax_number, balance, notes, is_active, is_deleted, deleted_at, "
        "created_at, updated_at FROM suppliers ORDER BY id"
    )).fetchall()

    data["customers"] = conn.execute(text(
        "SELECT id, store_id, name, phone, phone2, email, address, credit_limit, "
        "current_debt, loyalty_points, notes, is_active, is_deleted, deleted_at, "
        "created_at, updated_at FROM customers ORDER BY id"
    )).fetchall()

    data["products"] = conn.execute(text(
        "SELECT id, store_id, name, name_ar, description, image_url, barcode_piece, "
        "barcode_carton, base_unit::text AS base_unit, pieces_per_carton, cost_price, "
        "retail_price, wholesale_price, carton_price, stock_quantity, min_stock_alert, "
        "max_stock, expiry_date, has_expiry, category_id, supplier_id, is_active, "
        "is_featured, tax_rate, is_deleted, deleted_at, created_at, updated_at "
        "FROM products ORDER BY id"
    )).fetchall()

    data["invoices"] = conn.execute(text(
        "SELECT id, store_id, invoice_number, invoice_type::text AS invoice_type, "
        "status::text AS status, payment_status::text AS payment_status, "
        "payment_method::text AS payment_method, customer_id, "
        "supplier_id, created_by, subtotal, discount_percent, discount_amount, "
        "tax_percent, tax_amount, total, paid_amount, remaining_amount, notes, "
        "invoice_date, created_at, updated_at FROM invoices ORDER BY id"
    )).fetchall()

    data["invoice_items"] = conn.execute(text(
        "SELECT id, store_id, invoice_id, product_id, quantity, "
        "unit_type::text AS unit_type, unit_price, cost_price, discount_amount, "
        "tax_amount, total, notes, created_at, updated_at "
        "FROM invoice_items ORDER BY id"
    )).fetchall()

    data["payments"] = conn.execute(text(
        "SELECT id, store_id, invoice_id, amount, method::text AS method, notes, "
        "received_by, created_at, updated_at FROM payments ORDER BY id"
    )).fetchall()

    data["debt_payments"] = conn.execute(text(
        "SELECT id, store_id, customer_id, amount, method, "
        "client_created_at, server_applied_at FROM debt_payments ORDER BY id"
    )).fetchall()

    data["stock_movements"] = conn.execute(text(
        "SELECT id, store_id, product_id, movement_type::text AS movement_type, "
        "quantity, unit_type, quantity_in_pieces, stock_before, stock_after, unit_cost, "
        "invoice_id, user_id, notes, reference, created_at, updated_at "
        "FROM stock_movements ORDER BY id"
    )).fetchall()

    data["employees"] = conn.execute(text(
        "SELECT id, store_id, user_id, full_name, phone, phone2, national_id, address, "
        "birth_date, job_title, hire_date, end_date, salary_type::text AS salary_type, "
        "base_salary, commission_rate, notes, is_active, is_deleted, deleted_at, "
        "created_at, updated_at FROM employees ORDER BY id"
    )).fetchall()

    data["product_batches"] = conn.execute(text(
        "SELECT id, store_id, product_id, batch_number, barcode_override, quantity, "
        "cost_price, expiry_date, supplier_id, invoice_id, is_active, notes, "
        "created_at, updated_at FROM product_batches ORDER BY id"
    )).fetchall()

    data["store_settings"] = conn.execute(text(
        "SELECT id, store_id, store_name, logo_url, currency, phone, address, "
        "tax_number, invoice_footer_note FROM store_settings ORDER BY id"
    )).fetchall()

    data["license_keys"] = conn.execute(text(
        "SELECT id, key, days_valid, is_used, used_by_store_id, used_at, "
        "created_at, updated_at FROM license_keys ORDER BY id"
    )).fetchall()

    return data


# ─── UUID Mapping ─────────────────────────────────────────────────────────────

def build_maps(data):
    """Build integer -> UUID mapping dicts for every table."""
    maps = {}

    # Standard: one UUID per integer id
    for tbl in ["stores", "users", "categories", "suppliers", "customers",
                "products", "invoices", "invoice_items", "payments",
                "stock_movements", "employees", "product_batches", "license_keys"]:
        maps[tbl] = {row[0]: str(uuid.uuid4()) for row in data[tbl]}

    # debt_payments: id is ALREADY a UUID string from the device — preserve exactly
    maps["debt_payments"] = {row[0]: str(row[0]) for row in data["debt_payments"]}

    # store_settings: integer serial id -> new UUID
    maps["store_settings"] = {row[0]: str(uuid.uuid4()) for row in data["store_settings"]}

    return maps


def fk(maps, table, old_id):
    """Resolve an integer FK to its mapped UUID. Returns None if old_id is None."""
    if old_id is None:
        return None
    result = maps[table].get(old_id)
    if result is None:
        raise ValueError(f"FK resolution failure: {table}.id={old_id!r} not in mapping")
    return result


def ts(v):
    """Return v if not None, else current UTC time."""
    return v if v is not None else datetime.utcnow()


def enum_val(v):
    """Ensure enum values are uppercase strings for PostgreSQL."""
    return str(v).upper() if v is not None else None


# ─── DRY RUN ──────────────────────────────────────────────────────────────────

def dry_run():
    PRINT_SEP("DRY RUN — Read-only validation (no writes)")

    engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 20})
    errors = []

    with engine.connect() as conn:
        print("\n[1/5] Loading all business data...")
        data = load_all_data(conn)
        for tbl, rows in data.items():
            print(f"  {tbl}: {len(rows)} rows")

        print("\n[2/5] Building UUID mappings...")
        maps = build_maps(data)
        for tbl, m in maps.items():
            print(f"  {tbl}: {len(m)} entries mapped")

        print("\n[3/5] Validating all FK references...")

        def check_fk(src_table, col_name, ref_table, rows, col_idx):
            fails = []
            ref_map = maps[ref_table]
            for row in rows:
                old_id = row[col_idx]
                if old_id is not None and old_id not in ref_map:
                    fails.append(f"  {src_table}.{col_name}={old_id!r} not in {ref_table} map")
            if fails:
                errors.extend(fails)
                print(f"  FAIL: {src_table}.{col_name} -> {ref_table}: {len(fails)} orphans")
            else:
                print(f"  OK:   {src_table}.{col_name} -> {ref_table}")

        # users.store_id -> stores
        check_fk("users", "store_id", "stores", data["users"], 1)
        # categories.store_id -> stores
        check_fk("categories", "store_id", "stores", data["categories"], 1)
        # suppliers.store_id -> stores
        check_fk("suppliers", "store_id", "stores", data["suppliers"], 1)
        # customers.store_id -> stores
        check_fk("customers", "store_id", "stores", data["customers"], 1)
        # products.store_id -> stores
        check_fk("products", "store_id", "stores", data["products"], 1)
        # products.category_id -> categories (nullable)
        check_fk("products", "category_id", "categories", data["products"], 19)
        # products.supplier_id -> suppliers (nullable)
        check_fk("products", "supplier_id", "suppliers", data["products"], 20)
        # invoices.store_id -> stores
        check_fk("invoices", "store_id", "stores", data["invoices"], 1)
        # invoices.customer_id -> customers (nullable)
        check_fk("invoices", "customer_id", "customers", data["invoices"], 7)
        # invoices.supplier_id -> suppliers (nullable)
        check_fk("invoices", "supplier_id", "suppliers", data["invoices"], 8)
        # invoices.created_by -> users (nullable)
        check_fk("invoices", "created_by", "users", data["invoices"], 9)
        # invoice_items.store_id -> stores
        check_fk("invoice_items", "store_id", "stores", data["invoice_items"], 1)
        # invoice_items.invoice_id -> invoices
        check_fk("invoice_items", "invoice_id", "invoices", data["invoice_items"], 2)
        # invoice_items.product_id -> products
        check_fk("invoice_items", "product_id", "products", data["invoice_items"], 3)
        # payments.store_id -> stores
        check_fk("payments", "store_id", "stores", data["payments"], 1)
        # payments.invoice_id -> invoices
        check_fk("payments", "invoice_id", "invoices", data["payments"], 2)
        # payments.received_by -> users (nullable)
        check_fk("payments", "received_by", "users", data["payments"], 6)
        # debt_payments.store_id -> stores
        check_fk("debt_payments", "store_id", "stores", data["debt_payments"], 1)
        # debt_payments.customer_id -> customers
        check_fk("debt_payments", "customer_id", "customers", data["debt_payments"], 2)
        # stock_movements.store_id -> stores
        check_fk("stock_movements", "store_id", "stores", data["stock_movements"], 1)
        # stock_movements.product_id -> products
        check_fk("stock_movements", "product_id", "products", data["stock_movements"], 2)
        # stock_movements.invoice_id -> invoices (nullable)
        check_fk("stock_movements", "invoice_id", "invoices", data["stock_movements"], 10)
        # stock_movements.user_id -> users
        check_fk("stock_movements", "user_id", "users", data["stock_movements"], 11)
        # employees.store_id -> stores
        check_fk("employees", "store_id", "stores", data["employees"], 1)
        # employees.user_id -> users (nullable)
        check_fk("employees", "user_id", "users", data["employees"], 2)
        # product_batches.store_id -> stores
        check_fk("product_batches", "store_id", "stores", data["product_batches"], 1)
        # product_batches.product_id -> products
        check_fk("product_batches", "product_id", "products", data["product_batches"], 2)
        # product_batches.supplier_id -> suppliers (nullable)
        check_fk("product_batches", "supplier_id", "suppliers", data["product_batches"], 8)
        # product_batches.invoice_id -> invoices (nullable)
        check_fk("product_batches", "invoice_id", "invoices", data["product_batches"], 9)
        # store_settings.store_id -> stores
        check_fk("store_settings", "store_id", "stores", data["store_settings"], 1)
        # license_keys.used_by_store_id -> stores (nullable)
        check_fk("license_keys", "used_by_store_id", "stores", data["license_keys"], 4)

        print("\n[4/5] Validating debt_payments UUIDs (id must already be UUID)...")
        for row in data["debt_payments"]:
            try:
                uuid.UUID(str(row[0]))
            except (ValueError, AttributeError):
                errors.append(f"  debt_payments.id={row[0]!r} is NOT a valid UUID")
        if not any("debt_payments" in e for e in errors):
            print(f"  OK: all {len(data['debt_payments'])} debt_payment IDs are valid UUIDs")

        print("\n[5/5] Multi-tenant isolation check...")
        store_ids_in_map = set(maps["stores"].keys())
        for tbl, col_idx in [
            ("customers", 1), ("products", 1), ("suppliers", 1),
            ("invoices", 1), ("invoice_items", 1), ("payments", 1),
            ("debt_payments", 1), ("stock_movements", 1),
        ]:
            orphans = [row[col_idx] for row in data[tbl] if row[col_idx] not in store_ids_in_map]
            if orphans:
                errors.append(f"  {tbl}: {len(orphans)} rows have store_id not in stores table!")
                print(f"  FAIL: {tbl} has {len(orphans)} orphaned store refs")
            else:
                print(f"  OK:   {tbl} — all store_id refs valid")

    PRINT_SEP("DRY RUN RESULT")
    if errors:
        print(f"\nFAILED — {len(errors)} error(s):")
        for e in errors:
            print(e)
        print("\nDo NOT run --execute until all errors are resolved.")
        sys.exit(1)
    else:
        print("\nDRY RUN PASSED — All mappings valid. Zero orphans. Safe to execute migration.")
        sys.exit(0)


# ─── EXECUTE ──────────────────────────────────────────────────────────────────

def execute():
    PRINT_SEP("EXECUTE — Full migration (single transaction)")
    print("\nWARNING: This will migrate ALL production data from INTEGER to UUID IDs.")
    print("The entire operation runs in ONE transaction. Any failure = automatic rollback.")
    print("\nStarting in 3 seconds... (Ctrl+C to cancel)")
    import time; time.sleep(3)

    engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 30})

    # ── Pre-transaction: load all data ────────────────────────────────────────
    PRINT_SEP("Phase 1: Loading all data (pre-transaction)")
    with engine.connect() as conn:
        data = load_all_data(conn)
        before_counts = {tbl: len(rows) for tbl, rows in data.items()}

    print("\nBefore row counts:")
    for tbl, cnt in before_counts.items():
        print(f"  {tbl}: {cnt}")

    # Build UUID maps
    maps = build_maps(data)
    print(f"\nUUID maps built. {sum(len(m) for m in maps.values())} total entries.")

    # Snapshot representative rows for report
    snapshots = {}
    for tbl in ["stores", "users", "customers", "products", "invoices"]:
        if data[tbl]:
            row = data[tbl][0]
            snapshots[tbl] = {"old_id": row[0], "new_id": maps[tbl].get(row[0], row[0])}

    # ── Single transaction ────────────────────────────────────────────────────
    PRINT_SEP("Phase 2: Migration transaction")
    print("Creating shadow tables, re-inserting data, dropping old tables, renaming...")

    with engine.begin() as conn:

        # ── Create shadow tables ──────────────────────────────────────────────
        print("\n[1/8] Creating shadow tables with UUID schema...")

        conn.execute(text("""
            CREATE TABLE _new_stores (
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

        conn.execute(text("""
            CREATE TABLE _new_users (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                username VARCHAR(50) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                phone VARCHAR(20),
                password_hash VARCHAR(255) NOT NULL,
                role userrole NOT NULL DEFAULT 'CASHIER',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_login TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_categories (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                name VARCHAR(100) NOT NULL,
                name_ar VARCHAR(100),
                description TEXT,
                color VARCHAR(7),
                icon VARCHAR(50),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(store_id, name)
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_suppliers (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                name VARCHAR(150) NOT NULL,
                company VARCHAR(150),
                phone VARCHAR(20),
                phone2 VARCHAR(20),
                email VARCHAR(100),
                address TEXT,
                tax_number VARCHAR(50),
                balance FLOAT NOT NULL DEFAULT 0.0,
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_customers (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
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

        conn.execute(text("""
            CREATE TABLE _new_products (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                name VARCHAR(200) NOT NULL,
                name_ar VARCHAR(200),
                description TEXT,
                image_url VARCHAR(500),
                barcode_piece VARCHAR(50),
                barcode_carton VARCHAR(50),
                base_unit unittype NOT NULL DEFAULT 'PIECE',
                pieces_per_carton INTEGER NOT NULL DEFAULT 1,
                cost_price FLOAT NOT NULL DEFAULT 0.0,
                retail_price FLOAT NOT NULL DEFAULT 0.0,
                wholesale_price FLOAT NOT NULL DEFAULT 0.0,
                carton_price FLOAT NOT NULL DEFAULT 0.0,
                stock_quantity FLOAT NOT NULL DEFAULT 0.0,
                min_stock_alert FLOAT NOT NULL DEFAULT 5.0,
                max_stock FLOAT,
                expiry_date DATE,
                has_expiry BOOLEAN NOT NULL DEFAULT FALSE,
                category_id VARCHAR(36) REFERENCES _new_categories(id),
                supplier_id VARCHAR(36) REFERENCES _new_suppliers(id),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_featured BOOLEAN NOT NULL DEFAULT FALSE,
                tax_rate FLOAT NOT NULL DEFAULT 0.0,
                is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(store_id, barcode_piece),
                UNIQUE(store_id, barcode_carton)
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_invoices (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                invoice_number VARCHAR(30) NOT NULL,
                invoice_type invoicetype NOT NULL DEFAULT 'SALE',
                status invoicestatus NOT NULL DEFAULT 'DRAFT',
                payment_status paymentstatus NOT NULL DEFAULT 'UNPAID',
                payment_method paymentmethod NOT NULL DEFAULT 'CASH',
                customer_id VARCHAR(36) REFERENCES _new_customers(id),
                customer_name VARCHAR(150),
                supplier_id VARCHAR(36) REFERENCES _new_suppliers(id),
                created_by VARCHAR(36) REFERENCES _new_users(id),
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

        conn.execute(text("""
            CREATE TABLE _new_invoice_items (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                invoice_id VARCHAR(36) NOT NULL REFERENCES _new_invoices(id) ON DELETE CASCADE,
                product_id VARCHAR(36) NOT NULL REFERENCES _new_products(id),
                product_name VARCHAR(200),
                quantity FLOAT NOT NULL,
                unit_type unittype NOT NULL DEFAULT 'PIECE',
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

        conn.execute(text("""
            CREATE TABLE _new_payments (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                invoice_id VARCHAR(36) NOT NULL REFERENCES _new_invoices(id) ON DELETE CASCADE,
                amount FLOAT NOT NULL,
                method paymentmethod NOT NULL DEFAULT 'CASH',
                notes VARCHAR(200),
                received_by VARCHAR(36) REFERENCES _new_users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_debt_payments (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                customer_id VARCHAR(36) NOT NULL REFERENCES _new_customers(id),
                amount FLOAT NOT NULL,
                method VARCHAR(30) NOT NULL DEFAULT 'cash',
                client_created_at TIMESTAMP NOT NULL,
                server_applied_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_stock_movements (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                product_id VARCHAR(36) NOT NULL REFERENCES _new_products(id),
                movement_type movementtype NOT NULL,
                quantity FLOAT NOT NULL,
                unit_type VARCHAR(10) DEFAULT 'piece',
                quantity_in_pieces FLOAT NOT NULL,
                stock_before FLOAT NOT NULL,
                stock_after FLOAT NOT NULL,
                unit_cost FLOAT DEFAULT 0.0,
                invoice_id VARCHAR(36) REFERENCES _new_invoices(id),
                user_id VARCHAR(36) NOT NULL REFERENCES _new_users(id),
                notes TEXT,
                reference VARCHAR(100),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_employees (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                user_id VARCHAR(36) REFERENCES _new_users(id),
                full_name VARCHAR(150) NOT NULL,
                phone VARCHAR(20),
                phone2 VARCHAR(20),
                national_id VARCHAR(50),
                address TEXT,
                birth_date DATE,
                job_title VARCHAR(100),
                hire_date DATE,
                end_date DATE,
                salary_type salarytype NOT NULL DEFAULT 'MONTHLY',
                base_salary FLOAT NOT NULL DEFAULT 0.0,
                commission_rate FLOAT NOT NULL DEFAULT 0.0,
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_product_batches (
                id VARCHAR(36) PRIMARY KEY,
                store_id VARCHAR(36) NOT NULL REFERENCES _new_stores(id),
                product_id VARCHAR(36) NOT NULL REFERENCES _new_products(id),
                batch_number VARCHAR(50),
                barcode_override VARCHAR(50),
                quantity FLOAT NOT NULL,
                cost_price FLOAT DEFAULT 0.0,
                expiry_date DATE,
                supplier_id VARCHAR(36) REFERENCES _new_suppliers(id),
                invoice_id VARCHAR(36) REFERENCES _new_invoices(id),
                is_active BOOLEAN DEFAULT TRUE,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_store_settings (
                id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                store_id VARCHAR(36) UNIQUE NOT NULL REFERENCES _new_stores(id),
                store_name VARCHAR(200),
                logo_url VARCHAR(500),
                currency VARCHAR(10),
                phone VARCHAR(50),
                address VARCHAR(300),
                tax_number VARCHAR(100),
                invoice_footer_note VARCHAR(300)
            )
        """))

        conn.execute(text("""
            CREATE TABLE _new_license_keys (
                id VARCHAR(36) PRIMARY KEY,
                key VARCHAR(50) UNIQUE NOT NULL,
                days_valid INTEGER NOT NULL,
                is_used BOOLEAN NOT NULL DEFAULT FALSE,
                used_by_store_id VARCHAR(36) REFERENCES _new_stores(id),
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        # app_refresh_tokens: created without FK to users initially (users being rebuilt)
        # FK added after rename
        conn.execute(text("""
            CREATE TABLE app_refresh_tokens (
                id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                jti VARCHAR(36) UNIQUE NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
                expires_at TIMESTAMP NOT NULL,
                replaced_by VARCHAR(36),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        print("  Shadow tables created.")

        # ── Insert data ───────────────────────────────────────────────────────
        print("\n[2/8] Re-inserting all data with UUID IDs...")

        # Stores
        for r in data["stores"]:
            conn.execute(text("""
                INSERT INTO _new_stores
                    (id, name, owner_name, phone, is_active,
                     subscription_expires_at, allowed_device_id, created_at, updated_at)
                VALUES
                    (:id, :name, :owner_name, :phone, :is_active,
                     :sub_exp, :device_id, :created_at, :updated_at)
            """), {
                "id": maps["stores"][r[0]],
                "name": r[1], "owner_name": r[2], "phone": r[3],
                "is_active": r[4], "sub_exp": r[5], "device_id": r[6],
                "created_at": ts(r[7]), "updated_at": ts(r[8]),
            })
        print(f"  Inserted {len(data['stores'])} stores")

        # Users
        for r in data["users"]:
            conn.execute(text("""
                INSERT INTO _new_users
                    (id, store_id, username, full_name, email, phone,
                     password_hash, role, is_active, last_login, created_at, updated_at)
                VALUES
                    (:id, :store_id, :username, :full_name, :email, :phone,
                     :pw, :role, :is_active, :last_login, :created_at, :updated_at)
            """), {
                "id": maps["users"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "username": r[2], "full_name": r[3], "email": r[4], "phone": r[5],
                "pw": r[6],
                "role": enum_val(r[7]),
                "is_active": r[8], "last_login": r[9],
                "created_at": ts(r[10]), "updated_at": ts(r[11]),
            })
        print(f"  Inserted {len(data['users'])} users")

        # Categories
        for r in data["categories"]:
            conn.execute(text("""
                INSERT INTO _new_categories
                    (id, store_id, name, name_ar, description, color, icon, is_active,
                     created_at, updated_at)
                VALUES
                    (:id, :store_id, :name, :name_ar, :desc, :color, :icon, :is_active,
                     :created_at, :updated_at)
            """), {
                "id": maps["categories"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "name": r[2], "name_ar": r[3], "desc": r[4], "color": r[5], "icon": r[6],
                "is_active": r[7],
                "created_at": ts(r[8]), "updated_at": ts(r[9]),
            })
        print(f"  Inserted {len(data['categories'])} categories")

        # Suppliers
        for r in data["suppliers"]:
            conn.execute(text("""
                INSERT INTO _new_suppliers
                    (id, store_id, name, company, phone, phone2, email, address,
                     tax_number, balance, notes, is_active, is_deleted, deleted_at,
                     created_at, updated_at)
                VALUES
                    (:id, :store_id, :name, :company, :phone, :phone2, :email, :address,
                     :tax_num, :balance, :notes, :is_active, :is_deleted, :deleted_at,
                     :created_at, :updated_at)
            """), {
                "id": maps["suppliers"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "name": r[2], "company": r[3], "phone": r[4], "phone2": r[5],
                "email": r[6], "address": r[7], "tax_num": r[8],
                "balance": r[9] or 0.0, "notes": r[10],
                "is_active": r[11], "is_deleted": r[12] or False, "deleted_at": r[13],
                "created_at": ts(r[14]), "updated_at": ts(r[15]),
            })
        print(f"  Inserted {len(data['suppliers'])} suppliers")

        # Customers
        for r in data["customers"]:
            conn.execute(text("""
                INSERT INTO _new_customers
                    (id, store_id, name, phone, phone2, email, address,
                     credit_limit, current_debt, loyalty_points, notes,
                     is_active, is_deleted, deleted_at, created_at, updated_at)
                VALUES
                    (:id, :store_id, :name, :phone, :phone2, :email, :address,
                     :credit_limit, :current_debt, :loyalty_points, :notes,
                     :is_active, :is_deleted, :deleted_at, :created_at, :updated_at)
            """), {
                "id": maps["customers"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "name": r[2], "phone": r[3], "phone2": r[4], "email": r[5], "address": r[6],
                "credit_limit": r[7] or 0.0, "current_debt": r[8] or 0.0,
                "loyalty_points": r[9] or 0.0, "notes": r[10],
                "is_active": r[11], "is_deleted": r[12] or False, "deleted_at": r[13],
                "created_at": ts(r[14]), "updated_at": ts(r[15]),
            })
        print(f"  Inserted {len(data['customers'])} customers")

        # Products
        for r in data["products"]:
            conn.execute(text("""
                INSERT INTO _new_products
                    (id, store_id, name, name_ar, description, image_url,
                     barcode_piece, barcode_carton, base_unit, pieces_per_carton,
                     cost_price, retail_price, wholesale_price, carton_price,
                     stock_quantity, min_stock_alert, max_stock, expiry_date, has_expiry,
                     category_id, supplier_id, is_active, is_featured, tax_rate,
                     is_deleted, deleted_at, created_at, updated_at)
                VALUES
                    (:id, :store_id, :name, :name_ar, :desc, :img,
                     :bp, :bc, :base_unit, :ppc,
                     :cost, :retail, :wholesale, :carton,
                     :stock, :min_stock, :max_stock, :expiry, :has_expiry,
                     :cat_id, :sup_id, :is_active, :is_featured, :tax,
                     :is_deleted, :deleted_at, :created_at, :updated_at)
            """), {
                "id": maps["products"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "name": r[2], "name_ar": r[3], "desc": r[4], "img": r[5],
                "bp": r[6], "bc": r[7],
                "base_unit": enum_val(r[8]) or "PIECE",
                "ppc": r[9] or 1,
                "cost": r[10] or 0.0, "retail": r[11] or 0.0,
                "wholesale": r[12] or 0.0, "carton": r[13] or 0.0,
                "stock": r[14] or 0.0, "min_stock": r[15] or 5.0, "max_stock": r[16],
                "expiry": r[17], "has_expiry": r[18] or False,
                "cat_id": fk(maps, "categories", r[19]) if r[19] else None,
                "sup_id": fk(maps, "suppliers", r[20]) if r[20] else None,
                "is_active": r[21], "is_featured": r[22], "tax": r[23] or 0.0,
                "is_deleted": r[24] or False, "deleted_at": r[25],
                "created_at": ts(r[26]), "updated_at": ts(r[27]),
            })
        print(f"  Inserted {len(data['products'])} products")

        # Invoices
        for r in data["invoices"]:
            conn.execute(text("""
                INSERT INTO _new_invoices
                    (id, store_id, invoice_number, invoice_type, status, payment_status,
                     payment_method, customer_id, customer_name, supplier_id, created_by,
                     subtotal, discount_percent, discount_amount, tax_percent, tax_amount,
                     total, paid_amount, remaining_amount, notes, invoice_date,
                     created_at, updated_at)
                VALUES
                    (:id, :store_id, :inv_num, :inv_type, :status, :pay_status,
                     :pay_method, :cust_id, :cust_name, :sup_id, :created_by,
                     :subtotal, :disc_pct, :disc_amt, :tax_pct, :tax_amt,
                     :total, :paid, :remaining, :notes, :inv_date,
                     :created_at, :updated_at)
            """), {
                "id": maps["invoices"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "inv_num": r[2],
                "inv_type": enum_val(r[3]) or "SALE",
                "status": enum_val(r[4]) or "DRAFT",
                "pay_status": enum_val(r[5]) or "UNPAID",
                "pay_method": enum_val(r[6]) or "CASH",
                "cust_id": fk(maps, "customers", r[7]) if r[7] else None,
                "cust_name": None, # customer_name didn't exist in old schema
                "sup_id": fk(maps, "suppliers", r[8]) if r[8] else None,
                "created_by": fk(maps, "users", r[9]) if r[9] else None,
                "subtotal": r[10] or 0.0, "disc_pct": r[11] or 0.0,
                "disc_amt": r[12] or 0.0, "tax_pct": r[13] or 0.0,
                "tax_amt": r[14] or 0.0, "total": r[15] or 0.0,
                "paid": r[16] or 0.0, "remaining": r[17] or 0.0,
                "notes": r[18], "inv_date": r[19],
                "created_at": ts(r[20]), "updated_at": ts(r[21]),
            })
        print(f"  Inserted {len(data['invoices'])} invoices")

        # Invoice Items
        for r in data["invoice_items"]:
            conn.execute(text("""
                INSERT INTO _new_invoice_items
                    (id, store_id, invoice_id, product_id, product_name,
                     quantity, unit_type, unit_price, cost_price, discount_amount,
                     tax_amount, total, notes, created_at, updated_at)
                VALUES
                    (:id, :store_id, :inv_id, :prod_id, :prod_name,
                     :qty, :unit_type, :unit_price, :cost, :disc,
                     :tax, :total, :notes, :created_at, :updated_at)
            """), {
                "id": maps["invoice_items"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "inv_id": fk(maps, "invoices", r[2]),
                "prod_id": fk(maps, "products", r[3]),
                "prod_name": None, # product_name didn't exist in old schema
                "qty": r[4] or 0.0,
                "unit_type": enum_val(r[5]) or "PIECE",
                "unit_price": r[6] or 0.0, "cost": r[7] or 0.0,
                "disc": r[8] or 0.0, "tax": r[9] or 0.0,
                "total": r[10] or 0.0, "notes": r[11],
                "created_at": ts(r[12]), "updated_at": ts(r[13]),
            })
        print(f"  Inserted {len(data['invoice_items'])} invoice_items")

        # Payments
        for r in data["payments"]:
            conn.execute(text("""
                INSERT INTO _new_payments
                    (id, store_id, invoice_id, amount, method, notes,
                     received_by, created_at, updated_at)
                VALUES
                    (:id, :store_id, :inv_id, :amount, :method, :notes,
                     :recv_by, :created_at, :updated_at)
            """), {
                "id": maps["payments"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "inv_id": fk(maps, "invoices", r[2]),
                "amount": r[3] or 0.0,
                "method": enum_val(r[4]) or "CASH",
                "notes": r[5],
                "recv_by": fk(maps, "users", r[6]) if r[6] else None,
                "created_at": ts(r[7]), "updated_at": ts(r[8]),
            })
        print(f"  Inserted {len(data['payments'])} payments")

        # Debt Payments
        for r in data["debt_payments"]:
            conn.execute(text("""
                INSERT INTO _new_debt_payments
                    (id, store_id, customer_id, amount, method,
                     client_created_at, server_applied_at)
                VALUES
                    (:id, :store_id, :cust_id, :amount, :method,
                     :client_ts, :server_ts)
            """), {
                "id": maps["debt_payments"][r[0]],  # preserved as-is (already UUID)
                "store_id": fk(maps, "stores", r[1]),
                "cust_id": fk(maps, "customers", r[2]),
                "amount": r[3] or 0.0,
                "method": r[4] or "cash",
                "client_ts": ts(r[5]),
                "server_ts": ts(r[6]),
            })
        print(f"  Inserted {len(data['debt_payments'])} debt_payments")

        # Stock Movements
        for r in data["stock_movements"]:
            conn.execute(text("""
                INSERT INTO _new_stock_movements
                    (id, store_id, product_id, movement_type, quantity,
                     unit_type, quantity_in_pieces, stock_before, stock_after,
                     unit_cost, invoice_id, user_id, notes, reference,
                     created_at, updated_at)
                VALUES
                    (:id, :store_id, :prod_id, :mv_type, :qty,
                     :unit_type, :qty_pieces, :stock_before, :stock_after,
                     :unit_cost, :inv_id, :user_id, :notes, :reference,
                     :created_at, :updated_at)
            """), {
                "id": maps["stock_movements"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "prod_id": fk(maps, "products", r[2]),
                "mv_type": enum_val(r[3]),
                "qty": r[4] or 0.0,
                "unit_type": r[5] or "piece",
                "qty_pieces": r[6] or 0.0,
                "stock_before": r[7] or 0.0, "stock_after": r[8] or 0.0,
                "unit_cost": r[9] or 0.0,
                "inv_id": fk(maps, "invoices", r[10]) if r[10] else None,
                "user_id": fk(maps, "users", r[11]),
                "notes": r[12], "reference": r[13],
                "created_at": ts(r[14]), "updated_at": ts(r[15]),
            })
        print(f"  Inserted {len(data['stock_movements'])} stock_movements")

        # Employees
        for r in data["employees"]:
            conn.execute(text("""
                INSERT INTO _new_employees
                    (id, store_id, user_id, full_name, phone, phone2, national_id,
                     address, birth_date, job_title, hire_date, end_date,
                     salary_type, base_salary, commission_rate, notes, is_active,
                     is_deleted, deleted_at, created_at, updated_at)
                VALUES
                    (:id, :store_id, :user_id, :full_name, :phone, :phone2, :national_id,
                     :address, :birth_date, :job_title, :hire_date, :end_date,
                     :sal_type, :sal_amt, :comm_rate, :notes, :is_active,
                     :is_deleted, :deleted_at, :created_at, :updated_at)
            """), {
                "id": maps["employees"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "user_id": fk(maps, "users", r[2]) if r[2] else None,
                "full_name": r[3], "phone": r[4], "phone2": r[5],
                "national_id": r[6], "address": r[7], "birth_date": r[8],
                "job_title": r[9], "hire_date": r[10], "end_date": r[11],
                "sal_type": enum_val(r[12]) or "MONTHLY",
                "sal_amt": r[13] or 0.0, "comm_rate": r[14] or 0.0,
                "notes": r[15], "is_active": r[16],
                "is_deleted": r[17] or False, "deleted_at": r[18],
                "created_at": ts(r[19]), "updated_at": ts(r[20]),
            })
        print(f"  Inserted {len(data['employees'])} employees")

        # Product Batches
        for r in data["product_batches"]:
            conn.execute(text("""
                INSERT INTO _new_product_batches
                    (id, store_id, product_id, batch_number, barcode_override,
                     quantity, cost_price, expiry_date, supplier_id, invoice_id,
                     is_active, notes, created_at, updated_at)
                VALUES
                    (:id, :store_id, :prod_id, :batch_num, :barcode_override,
                     :qty, :cost, :expiry, :sup_id, :inv_id,
                     :is_active, :notes, :created_at, :updated_at)
            """), {
                "id": maps["product_batches"][r[0]],
                "store_id": fk(maps, "stores", r[1]),
                "prod_id": fk(maps, "products", r[2]),
                "batch_num": r[3], "barcode_override": r[4],
                "qty": r[5] or 0.0, "cost": r[6] or 0.0, "expiry": r[7],
                "sup_id": fk(maps, "suppliers", r[8]) if r[8] else None,
                "inv_id": fk(maps, "invoices", r[9]) if r[9] else None,
                "is_active": r[10] if r[10] is not None else True,
                "notes": r[11],
                "created_at": ts(r[12]), "updated_at": ts(r[13]),
            })
        print(f"  Inserted {len(data['product_batches'])} product_batches")

        # Store Settings
        for r in data["store_settings"]:
            new_store_id = fk(maps, "stores", r[1])
            conn.execute(text("""
                INSERT INTO _new_store_settings
                    (store_id, store_name, logo_url, currency, phone, address,
                     tax_number, invoice_footer_note)
                VALUES
                    (:store_id, :store_name, :logo_url, :currency, :phone, :address,
                     :tax_num, :footer)
                ON CONFLICT (store_id) DO NOTHING
            """), {
                "store_id": new_store_id,
                "store_name": r[2], "logo_url": r[3], "currency": r[4],
                "phone": r[5], "address": r[6], "tax_num": r[7], "footer": r[8],
            })
        print(f"  Inserted {len(data['store_settings'])} store_settings")

        # License Keys
        for r in data["license_keys"]:
            conn.execute(text("""
                INSERT INTO _new_license_keys
                    (id, key, days_valid, is_used, used_by_store_id, used_at,
                     created_at, updated_at)
                VALUES
                    (:id, :key, :days_valid, :is_used, :used_by_store_id, :used_at,
                     :created_at, :updated_at)
            """), {
                "id": maps["license_keys"][r[0]],
                "key": r[1], "days_valid": r[2], "is_used": r[3],
                "used_by_store_id": fk(maps, "stores", r[4]) if r[4] else None,
                "used_at": r[5],
                "created_at": ts(r[6]), "updated_at": ts(r[7]),
            })
        print(f"  Inserted {len(data['license_keys'])} license_keys")

        # ── Drop old tables ───────────────────────────────────────────────────
        print("\n[3/8] Dropping old integer-ID tables (CASCADE)...")
        for tbl in DROP_ORDER:
            try:
                conn.execute(text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))
                print(f"  Dropped: {tbl}")
            except Exception as e:
                print(f"  WARN dropping {tbl}: {e}")

        # ── Rename shadow tables ──────────────────────────────────────────────
        print("\n[4/8] Renaming shadow tables to production names...")
        rename_pairs = [
            ("_new_stores", "stores"),
            ("_new_users", "users"),
            ("_new_categories", "categories"),
            ("_new_suppliers", "suppliers"),
            ("_new_customers", "customers"),
            ("_new_products", "products"),
            ("_new_invoices", "invoices"),
            ("_new_invoice_items", "invoice_items"),
            ("_new_payments", "payments"),
            ("_new_debt_payments", "debt_payments"),
            ("_new_stock_movements", "stock_movements"),
            ("_new_employees", "employees"),
            ("_new_product_batches", "product_batches"),
            ("_new_store_settings", "store_settings"),
            ("_new_license_keys", "license_keys"),
        ]
        for old_name, new_name in rename_pairs:
            conn.execute(text(f"ALTER TABLE {old_name} RENAME TO {new_name}"))
            print(f"  {old_name} -> {new_name}")

        # ── Add FK from app_refresh_tokens to users (now that users exists) ──
        conn.execute(text("""
            ALTER TABLE app_refresh_tokens
            ADD CONSTRAINT fk_art_user_id
            FOREIGN KEY (user_id) REFERENCES users(id)
        """))
        print("\n  Added FK: app_refresh_tokens.user_id -> users.id")

        # ── Create indexes ────────────────────────────────────────────────────
        print("\n[5/8] Creating indexes...")
        indexes = [
            "CREATE INDEX ix_users_store_id ON users(store_id)",
            "CREATE UNIQUE INDEX ix_users_username ON users(username)",
            "CREATE INDEX ix_categories_store_id ON categories(store_id)",
            "CREATE INDEX ix_suppliers_store_id ON suppliers(store_id)",
            "CREATE INDEX ix_customers_store_id ON customers(store_id)",
            "CREATE INDEX ix_customers_phone ON customers(phone)",
            "CREATE INDEX ix_products_store_id ON products(store_id)",
            "CREATE INDEX ix_products_name ON products(name)",
            "CREATE INDEX ix_invoices_store_id ON invoices(store_id)",
            "CREATE INDEX ix_invoice_items_invoice_id ON invoice_items(invoice_id)",
            "CREATE INDEX ix_payments_invoice_id ON payments(invoice_id)",
            "CREATE INDEX ix_debt_payments_store_id ON debt_payments(store_id)",
            "CREATE INDEX ix_debt_payments_customer_id ON debt_payments(customer_id)",
            "CREATE INDEX ix_stock_movements_store_id ON stock_movements(store_id)",
            "CREATE INDEX ix_stock_movements_product_id ON stock_movements(product_id)",
            "CREATE UNIQUE INDEX ix_store_settings_store_id ON store_settings(store_id)",
            "CREATE UNIQUE INDEX ix_app_refresh_tokens_jti ON app_refresh_tokens(jti)",
            "CREATE INDEX ix_app_refresh_tokens_user_id ON app_refresh_tokens(user_id)",
        ]
        for stmt in indexes:
            conn.execute(text(stmt))
        print(f"  Created {len(indexes)} indexes")

        # ── In-transaction verification ───────────────────────────────────────
        print("\n[6/8] In-transaction verification...")
        verification_errors = []

        # Row counts
        print("\n  Row count verification:")
        for tbl in OWNED_TABLES:
            actual = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
            expected = before_counts[tbl]
            status = "OK" if actual == expected else f"MISMATCH (expected {expected})"
            if actual != expected:
                verification_errors.append(f"{tbl}: {actual} != {expected}")
            print(f"    {tbl}: {actual} [{status}]")

        # app_refresh_tokens should be 0 (no migration, fresh)
        art_count = conn.execute(text("SELECT COUNT(*) FROM app_refresh_tokens")).scalar()
        print(f"    app_refresh_tokens: {art_count} [OK - fresh, users will re-login]")

        # Orphan checks
        print("\n  Orphan checks:")
        orphan_checks = [
            ("customers orphaned from stores",
             "SELECT COUNT(*) FROM customers c LEFT JOIN stores s ON c.store_id=s.id WHERE s.id IS NULL"),
            ("products orphaned from stores",
             "SELECT COUNT(*) FROM products p LEFT JOIN stores s ON p.store_id=s.id WHERE s.id IS NULL"),
            ("invoices orphaned from stores",
             "SELECT COUNT(*) FROM invoices i LEFT JOIN stores s ON i.store_id=s.id WHERE s.id IS NULL"),
            ("invoice_items orphaned from invoices",
             "SELECT COUNT(*) FROM invoice_items ii LEFT JOIN invoices i ON ii.invoice_id=i.id WHERE i.id IS NULL"),
            ("invoice_items orphaned from products",
             "SELECT COUNT(*) FROM invoice_items ii LEFT JOIN products p ON ii.product_id=p.id WHERE p.id IS NULL"),
            ("payments orphaned from invoices",
             "SELECT COUNT(*) FROM payments p LEFT JOIN invoices i ON p.invoice_id=i.id WHERE i.id IS NULL"),
            ("debt_payments orphaned from customers",
             "SELECT COUNT(*) FROM debt_payments dp LEFT JOIN customers c ON dp.customer_id=c.id WHERE c.id IS NULL"),
            ("stock_movements orphaned from products",
             "SELECT COUNT(*) FROM stock_movements sm LEFT JOIN products p ON sm.product_id=p.id WHERE p.id IS NULL"),
            ("stock_movements orphaned from users",
             "SELECT COUNT(*) FROM stock_movements sm LEFT JOIN users u ON sm.user_id=u.id WHERE u.id IS NULL"),
        ]
        for desc, sql in orphan_checks:
            cnt = conn.execute(text(sql)).scalar()
            status = "OK" if cnt == 0 else f"FAIL ({cnt} orphans)"
            if cnt > 0:
                verification_errors.append(f"Orphan check failed: {desc}: {cnt}")
            print(f"    {desc}: {cnt} [{status}]")

        # Column type checks (all id columns must be varchar now)
        print("\n  ID column type checks:")
        for tbl in OWNED_TABLES:
            dtype = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                f"WHERE table_name='{tbl}' AND column_name='id' "
                "AND table_schema='public' LIMIT 1"
            )).scalar()
            ok = dtype and ("varchar" in dtype.lower() or "character" in dtype.lower())
            status = "OK" if ok else f"FAIL (type={dtype})"
            if not ok:
                verification_errors.append(f"{tbl}.id type is {dtype}, not VARCHAR")
            print(f"    {tbl}.id: {dtype} [{status}]")

        if verification_errors:
            err_str = "; ".join(verification_errors)
            raise RuntimeError(f"VERIFICATION FAILED — rolling back. Errors: {err_str}")

        print("\n[7/8] All verifications passed.")
        # Transaction commits here automatically when exiting the 'with engine.begin()' block

    # ── Post-commit ───────────────────────────────────────────────────────────
    PRINT_SEP("MIGRATION COMPLETE")
    print("\nAfter row counts:")
    with engine.connect() as conn:
        after_counts = {}
        for tbl in OWNED_TABLES + ["app_refresh_tokens"]:
            try:
                cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
                after_counts[tbl] = cnt
                print(f"  {tbl}: {cnt}")
            except Exception as e:
                print(f"  {tbl}: ERROR {e}")

    # Write report
    report = {
        "migration_time": datetime.utcnow().isoformat(),
        "before_counts": before_counts,
        "after_counts": after_counts,
        "snapshots": snapshots,
        "status": "SUCCESS",
    }
    with open(REPORT_FILE, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nReport written to: {REPORT_FILE}")
    print("\nNext steps:")
    print("  1. Run: python migrate_to_uuid.py --verify")
    print("  2. Push code to GitHub: git push")
    print("  3. Render will redeploy automatically")
    print("  4. Verify login with new credentials")


# ─── VERIFY ───────────────────────────────────────────────────────────────────

def verify():
    PRINT_SEP("VERIFY — Post-migration read-only report")

    engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 20})
    results = {}

    # Load expected counts from report if available
    expected_counts = {}
    if os.path.exists(REPORT_FILE):
        with open(REPORT_FILE) as f:
            report = json.load(f)
        expected_counts = report.get("before_counts", {})
        print(f"  Loaded baseline from {REPORT_FILE}")
    else:
        print(f"  No {REPORT_FILE} found — skipping count baseline comparison")

    with engine.connect() as conn:

        print("\n[1/4] Row counts:")
        for tbl in OWNED_TABLES + ["app_refresh_tokens"]:
            try:
                actual = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
                expected = expected_counts.get(tbl)
                if expected is not None:
                    ok = actual == expected
                    status = "OK" if ok else f"MISMATCH (expected {expected})"
                else:
                    ok = True
                    status = f"{actual} rows (no baseline)"
                results[f"count_{tbl}"] = ok
                print(f"  {tbl}: {actual} [{status}]")
            except Exception as e:
                results[f"count_{tbl}"] = False
                print(f"  {tbl}: ERROR {e}")

        print("\n[2/4] ID column types (all must be VARCHAR):")
        for tbl in OWNED_TABLES:
            try:
                dtype = conn.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    f"WHERE table_name='{tbl}' AND column_name='id' "
                    "AND table_schema='public' LIMIT 1"
                )).scalar()
                ok = dtype and ("varchar" in dtype.lower() or "character" in dtype.lower())
                results[f"type_{tbl}"] = ok
                print(f"  {tbl}.id: {dtype} [{'OK' if ok else 'FAIL'}]")
            except Exception as e:
                results[f"type_{tbl}"] = False
                print(f"  {tbl}.id: ERROR {e}")

        print("\n[3/4] Orphan checks:")
        orphan_checks = [
            ("customers.store_id",
             "SELECT COUNT(*) FROM customers c LEFT JOIN stores s ON c.store_id=s.id WHERE s.id IS NULL"),
            ("invoice_items.invoice_id",
             "SELECT COUNT(*) FROM invoice_items ii LEFT JOIN invoices i ON ii.invoice_id=i.id WHERE i.id IS NULL"),
            ("payments.invoice_id",
             "SELECT COUNT(*) FROM payments p LEFT JOIN invoices i ON p.invoice_id=i.id WHERE i.id IS NULL"),
            ("debt_payments.customer_id",
             "SELECT COUNT(*) FROM debt_payments dp LEFT JOIN customers c ON dp.customer_id=c.id WHERE c.id IS NULL"),
            ("stock_movements.user_id",
             "SELECT COUNT(*) FROM stock_movements sm LEFT JOIN users u ON sm.user_id=u.id WHERE u.id IS NULL"),
        ]
        for desc, sql in orphan_checks:
            try:
                cnt = conn.execute(text(sql)).scalar()
                ok = cnt == 0
                results[f"orphan_{desc}"] = ok
                print(f"  {desc}: {cnt} orphans [{'OK' if ok else 'FAIL'}]")
            except Exception as e:
                results[f"orphan_{desc}"] = False
                print(f"  {desc}: ERROR {e}")

        print("\n[4/4] Multi-tenant isolation spot check:")
        for tbl in ["customers", "products", "invoices"]:
            try:
                cnt = conn.execute(text(
                    f"SELECT COUNT(*) FROM {tbl} t LEFT JOIN stores s ON t.store_id=s.id WHERE s.id IS NULL"
                )).scalar()
                ok = cnt == 0
                results[f"isolation_{tbl}"] = ok
                print(f"  {tbl} isolated: {cnt} broken refs [{'OK' if ok else 'FAIL'}]")
            except Exception as e:
                results[f"isolation_{tbl}"] = False
                print(f"  {tbl}: ERROR {e}")

    PRINT_SEP("VERIFY RESULT")
    failed = [k for k, v in results.items() if not v]
    if failed:
        print(f"\nFAILED checks ({len(failed)}):")
        for k in failed:
            print(f"  - {k}")
        sys.exit(1)
    else:
        print(f"\nALL {len(results)} CHECKS PASSED.")
        print("Production database is fully migrated to UUID architecture.")


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="CashTop production UUID migration tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Modes:
  --dry-run   Validate all mappings and FK references. Read-only. No writes.
  --execute   Run the full migration in one PostgreSQL transaction.
  --verify    Post-migration verification report. Read-only.

Run order:
  python migrate_to_uuid.py --dry-run
  python migrate_to_uuid.py --execute   # only after dry-run passes
  python migrate_to_uuid.py --verify
        """,
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate only, no writes")
    parser.add_argument("--execute", action="store_true", help="Run migration transaction")
    parser.add_argument("--verify", action="store_true", help="Post-migration verify")
    args = parser.parse_args()

    if args.dry_run:
        dry_run()
    elif args.execute:
        execute()
    elif args.verify:
        verify()
    else:
        parser.print_help()
        sys.exit(1)
