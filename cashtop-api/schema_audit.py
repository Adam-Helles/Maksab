#!/usr/bin/env python3
"""
schema_audit.py
Full schema dependency audit of every object in the public schema.
READ-ONLY. Never modifies anything.
"""
import os, sys
from sqlalchemy import create_engine, text

DB_URL = os.environ.get("DATABASE_URL", "")
if not DB_URL:
    DB_URL = "postgresql+psycopg2://postgres.xbzbuihxhjjbrplusqoq:zkBtBiIXAN7XZfJ8@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)

engine = create_engine(DB_URL, echo=False, connect_args={"connect_timeout": 20})

SECTION = lambda s: print(f"\n{'='*70}\n{s}\n{'='*70}")

with engine.connect() as conn:

    # ── 1. All public tables ──────────────────────────────────────────────
    SECTION("1. ALL PUBLIC TABLES")
    tables = [r[0] for r in conn.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' ORDER BY table_name"
    ))]
    print(tables)

    # ── 2. Full column dump per table ─────────────────────────────────────
    SECTION("2. COLUMNS (name | type | nullable | default)")
    for tbl in tables:
        cols = conn.execute(text(
            "SELECT column_name, data_type, character_maximum_length, "
            "is_nullable, column_default "
            "FROM information_schema.columns "
            f"WHERE table_schema='public' AND table_name='{tbl}' "
            "ORDER BY ordinal_position"
        )).fetchall()
        print(f"\n  -- {tbl} --")
        for c in cols:
            dtype = c[1] + (f"({c[2]})" if c[2] else "")
            print(f"    {c[0]}: {dtype}  {'NULL' if c[3]=='YES' else 'NOT NULL'}  {'DEFAULT '+c[4] if c[4] else ''}")

    # ── 3. All PRIMARY KEYS ───────────────────────────────────────────────
    SECTION("3. PRIMARY KEYS")
    pks = conn.execute(text("""
        SELECT tc.table_name, kcu.column_name, tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.ordinal_position
    """)).fetchall()
    for r in pks:
        print(f"  {r[0]}.{r[1]}  [{r[2]}]")

    # ── 4. All FOREIGN KEYS ───────────────────────────────────────────────
    SECTION("4. FOREIGN KEYS (table.col -> ref_table.ref_col)")
    fks = conn.execute(text("""
        SELECT
            tc.table_name, kcu.column_name,
            ccu.table_name AS foreign_table, ccu.column_name AS foreign_column,
            tc.constraint_name,
            rc.update_rule, rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
    """)).fetchall()
    for r in fks:
        print(f"  {r[0]}.{r[1]} -> {r[2]}.{r[3]}  [{r[4]}]  ON UPDATE {r[5]} ON DELETE {r[6]}")

    # ── 5. All UNIQUE constraints ─────────────────────────────────────────
    SECTION("5. UNIQUE CONSTRAINTS")
    uqs = conn.execute(text("""
        SELECT tc.table_name, kcu.column_name, tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
    """)).fetchall()
    for r in uqs:
        print(f"  {r[0]}.{r[1]}  [{r[2]}]")

    # ── 6. All INDEXES ────────────────────────────────────────────────────
    SECTION("6. INDEXES")
    idxs = conn.execute(text("""
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
    """)).fetchall()
    for r in idxs:
        print(f"  {r[0]}  [{r[1]}]: {r[2]}")

    # ── 7. Sequences ──────────────────────────────────────────────────────
    SECTION("7. SEQUENCES")
    seqs = conn.execute(text("""
        SELECT sequence_name FROM information_schema.sequences
        WHERE sequence_schema = 'public' ORDER BY sequence_name
    """)).fetchall()
    for r in seqs:
        print(f"  {r[0]}")

    # ── 8. Triggers ───────────────────────────────────────────────────────
    SECTION("8. TRIGGERS")
    trigs = conn.execute(text("""
        SELECT trigger_name, event_object_table, event_manipulation, action_timing
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY event_object_table, trigger_name
    """)).fetchall()
    if trigs:
        for r in trigs:
            print(f"  {r[1]}.{r[0]}  {r[3]} {r[2]}")
    else:
        print("  (none)")

    # ── 9. Views ──────────────────────────────────────────────────────────
    SECTION("9. VIEWS")
    views = conn.execute(text("""
        SELECT table_name, view_definition
        FROM information_schema.views
        WHERE table_schema = 'public'
        ORDER BY table_name
    """)).fetchall()
    if views:
        for r in views:
            print(f"  {r[0]}: {str(r[1])[:200]}")
    else:
        print("  (none)")

    # ── 10. Row counts ────────────────────────────────────────────────────
    SECTION("10. ROW COUNTS (baseline)")
    for tbl in tables:
        cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
        print(f"  {tbl}: {cnt}")

    # ── 11. Supabase auth schema check ────────────────────────────────────
    SECTION("11. SUPABASE AUTH SCHEMA TABLES (read-only verification)")
    try:
        auth_tables = [r[0] for r in conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='auth' ORDER BY table_name"
        ))]
        print(f"  auth schema tables: {auth_tables}")
    except Exception as e:
        print(f"  Cannot access auth schema: {e}")

    # ── 12. Check for any cross-schema FK references ──────────────────────
    SECTION("12. CROSS-SCHEMA FOREIGN KEY REFERENCES")
    try:
        cross = conn.execute(text("""
            SELECT tc.table_schema, tc.table_name, kcu.column_name,
                   ccu.table_schema AS ref_schema, ccu.table_name AS ref_table
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND (tc.table_schema != ccu.table_schema)
            ORDER BY tc.table_name
        """)).fetchall()
        if cross:
            for r in cross:
                print(f"  {r[0]}.{r[1]}.{r[2]} -> {r[3]}.{r[4]}")
        else:
            print("  (none)")
    except Exception as e:
        print(f"  Error: {e}")

    # ── 13. Check for USER-DEFINED types (enums) ─────────────────────────
    SECTION("13. USER-DEFINED TYPES (ENUMS)")
    enums = conn.execute(text("""
        SELECT t.typname, e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        ORDER BY t.typname, e.enumsortorder
    """)).fetchall()
    current_enum = None
    for r in enums:
        if r[0] != current_enum:
            current_enum = r[0]
            print(f"\n  ENUM {r[0]}:")
        print(f"    '{r[1]}'")

    # ── 14. Check for any integer FK references INTO public tables ─────────
    SECTION("14. INTEGER FK DETAIL (which cols are INT referencing which tables)")
    int_fks = conn.execute(text("""
        SELECT
            tc.table_name, kcu.column_name, col.data_type,
            ccu.table_name AS ref_table, ccu.column_name AS ref_col,
            ref_col_info.data_type AS ref_col_type
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        JOIN information_schema.columns col
          ON col.table_schema = 'public' AND col.table_name = tc.table_name
          AND col.column_name = kcu.column_name
        JOIN information_schema.columns ref_col_info
          ON ref_col_info.table_schema = 'public' AND ref_col_info.table_name = ccu.table_name
          AND ref_col_info.column_name = ccu.column_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
    """)).fetchall()
    for r in int_fks:
        flag = " <-- NEEDS MIGRATION" if "int" in r[2].lower() else ""
        print(f"  {r[0]}.{r[1]} ({r[2]}) -> {r[3]}.{r[4]} ({r[5]}){flag}")

print("\n\nAUDIT COMPLETE.")
