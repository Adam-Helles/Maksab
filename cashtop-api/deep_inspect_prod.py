#!/usr/bin/env python3
"""
deep_inspect_prod.py
Full read-only column-level inspection of every table in production.
Outputs exact column names, types, nullable, and defaults.
"""
import os, sys
from sqlalchemy import create_engine, text

DB_URL = os.environ.get("DATABASE_URL", "")
if not DB_URL:
    DB_URL = "postgresql+psycopg2://postgres.xbzbuihxhjjbrplusqoq:zkBtBiIXAN7XZfJ8@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)

engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 15})

with engine.connect() as conn:
    tables = [r[0] for r in conn.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' ORDER BY table_name"
    )).fetchall()]

    print(f"ALL TABLES ({len(tables)}): {tables}\n")

    for tbl in tables:
        print(f"=== {tbl} ===")
        cols = conn.execute(text(
            "SELECT column_name, data_type, character_maximum_length, "
            "is_nullable, column_default "
            "FROM information_schema.columns "
            f"WHERE table_name='{tbl}' ORDER BY ordinal_position"
        )).fetchall()
        for c in cols:
            dtype = c[1]
            if c[2]:
                dtype += f"({c[2]})"
            nullable = "NULL" if c[3] == "YES" else "NOT NULL"
            default = f" DEFAULT {c[4]}" if c[4] else ""
            print(f"  {c[0]}: {dtype} {nullable}{default}")

        # FK info
        fks = conn.execute(text(f"""
            SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='{tbl}'
        """)).fetchall()
        if fks:
            print("  FKs:")
            for fk in fks:
                print(f"    {fk[0]} -> {fk[1]}.{fk[2]}")

        # Row count
        cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
        print(f"  ROWS: {cnt}")

        # Sample first row (safe — no sensitive display)
        if cnt > 0:
            try:
                sample = conn.execute(text(f"SELECT * FROM {tbl} LIMIT 1")).fetchone()
                col_names = [c[0] for c in cols]
                sample_dict = {}
                for i, name in enumerate(col_names):
                    val = sample[i]
                    # Mask password fields
                    if "password" in name.lower() or "hash" in name.lower() or "secret" in name.lower():
                        val = "***"
                    elif isinstance(val, str) and len(val) > 60:
                        val = val[:60] + "..."
                    sample_dict[name] = val
                print(f"  SAMPLE: {sample_dict}")
            except Exception as e:
                print(f"  SAMPLE ERROR: {e}")
        print()
