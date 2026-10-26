"""
backup_prod_db.py — READ-ONLY backup of all production tables to JSON.
No DROP, no DELETE, no ALTER. Pure SELECT.
"""
import os, json, sys
from datetime import datetime, date
import psycopg2
from psycopg2.extras import RealDictCursor

# Load DATABASE_URL from render.yaml so we hit Production, not local SQLite
import yaml
with open("c:/my_work/cashtop/render.yaml") as f:
    cfg = yaml.safe_load(f)
DB_URL = next(ev["value"] for ev in cfg["services"][0]["envVars"] if ev["key"] == "DATABASE_URL")

TABLES = [
    "users", "stores", "categories", "suppliers", "customers",
    "products", "product_batches", "invoices", "invoice_items",
    "payments", "stock_movements", "refresh_tokens", "licenses", "employees"
]

def json_serial(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

def backup():
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_file = f"c:/my_work/cashtop/cashtop-api/prod_backup_{ts}.json"
    
    backup_data = {"backup_timestamp": ts, "tables": {}}
    
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    total_rows = 0
    for table in TABLES:
        try:
            cur.execute(f"SELECT * FROM {table};")
            rows = [dict(r) for r in cur.fetchall()]
            backup_data["tables"][table] = rows
            total_rows += len(rows)
            print(f"  ✅ {table}: {len(rows)} rows backed up")
        except Exception as e:
            print(f"  ⚠️  {table}: {e}")
            backup_data["tables"][table] = []
    
    cur.close()
    conn.close()
    
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, default=json_serial, ensure_ascii=False, indent=2)
    
    size_kb = os.path.getsize(out_file) / 1024
    print(f"\n✅ BACKUP COMPLETE: {out_file}")
    print(f"   Total rows: {total_rows}")
    print(f"   File size: {size_kb:.1f} KB")
    return out_file

if __name__ == "__main__":
    backup()
