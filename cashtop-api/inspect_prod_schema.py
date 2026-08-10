#!/usr/bin/env python3
"""
inspect_prod_schema.py - READ-ONLY inspection of production PostgreSQL.
"""
import os, sys
from sqlalchemy import create_engine, text

DB_URL = os.environ.get("DATABASE_URL", "")
if not DB_URL:
    DB_URL = "postgresql+psycopg2://postgres.xbzbuihxhjjbrplusqoq:zkBtBiIXAN7XZfJ8@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"

if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)

print("=" * 60)
print("READ-ONLY Production DB Inspection")
print("URL prefix:", DB_URL[:60], "...")
print("=" * 60)

try:
    engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 15})
    with engine.connect() as conn:
        # 1. List tables
        r = conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' ORDER BY table_name"
        ))
        tables = [row[0] for row in r.fetchall()]
        print(f"\nTABLES ({len(tables)}):", tables)

        # 2. Row counts
        print("\n--- Row Counts ---")
        for tbl in tables:
            try:
                cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
                print(f"  {tbl}: {cnt} rows")
            except Exception as e:
                print(f"  {tbl}: ERROR - {e}")

        # 3. Key column types for critical tables
        print("\n--- Key Column Types ---")
        check_tables = ["stores","users","customers","products","suppliers",
                        "categories","invoices","invoice_items","payments",
                        "refresh_tokens","debt_payments"]
        key_cols = ["id","user_id","store_id","customer_id","supplier_id"]
        for tbl in check_tables:
            if tbl not in tables:
                print(f"  {tbl}: TABLE MISSING")
                continue
            try:
                r2 = conn.execute(text(
                    "SELECT column_name, data_type, character_maximum_length "
                    "FROM information_schema.columns "
                    f"WHERE table_name='{tbl}' "
                    f"AND column_name = ANY(ARRAY[{','.join(repr(c) for c in key_cols)}]) "
                    "ORDER BY column_name"
                ))
                cols = r2.fetchall()
                for col in cols:
                    dtype = f"{col[1]}({col[2]})" if col[2] else col[1]
                    flag = " <-- INTEGER MISMATCH!" if "int" in col[1].lower() else ""
                    print(f"  {tbl}.{col[0]}: {dtype}{flag}")
            except Exception as e:
                print(f"  {tbl}: ERROR - {e}")

        # 4. Users
        print("\n--- Users ---")
        try:
            r3 = conn.execute(text(
                "SELECT id, username, role, store_id, is_active FROM users LIMIT 10"
            ))
            rows = r3.fetchall()
            if not rows:
                print("  (empty)")
            for row in rows:
                print(f"  id={str(row[0])!r} username={row[1]} role={row[2]} store_id={str(row[3])!r} active={row[4]}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 5. Stores
        print("\n--- Stores ---")
        try:
            r4 = conn.execute(text("SELECT id, name, is_active FROM stores LIMIT 10"))
            rows = r4.fetchall()
            if not rows:
                print("  (empty)")
            for row in rows:
                print(f"  id={str(row[0])!r} name={row[1]} active={row[2]}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 6. refresh_tokens schema
        print("\n--- refresh_tokens columns ---")
        try:
            r5 = conn.execute(text(
                "SELECT column_name, data_type, character_maximum_length "
                "FROM information_schema.columns "
                "WHERE table_name='refresh_tokens' ORDER BY ordinal_position"
            ))
            for row in r5.fetchall():
                dtype = f"{row[1]}({row[2]})" if row[2] else row[1]
                print(f"  {row[0]}: {dtype}")
        except Exception as e:
            print(f"  ERROR: {e}")

except Exception as e:
    print(f"\nCONNECTION ERROR: {e}")
    sys.exit(1)

print("\n" + "=" * 60)
print("Inspection complete (no writes performed)")
print("=" * 60)
