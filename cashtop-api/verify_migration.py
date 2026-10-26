import os
import psycopg2
import yaml

with open("c:/my_work/cashtop/render.yaml") as f:
    cfg = yaml.safe_load(f)
db_url = next(ev["value"] for ev in cfg["services"][0]["envVars"] if ev["key"] == "DATABASE_URL")
if db_url.startswith("postgresql+psycopg2://"):
    db_url = db_url.replace("postgresql+psycopg2://", "postgresql://")

tables = [
    "users", "stores", "categories", "suppliers", "customers", 
    "products", "product_batches", "invoices", "invoice_items", 
    "payments", "stock_movements", "refresh_tokens", "employees"
]

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    print("--- Database Verification ---")
    for table in tables:
        # Check column existence and type
        cur.execute(f"""
            SELECT data_type 
            FROM information_schema.columns 
            WHERE table_name = '{table}' AND column_name = 'server_updated_at';
        """)
        row = cur.fetchone()
        if not row:
            print(f"❌ {table}: server_updated_at NOT FOUND")
            continue
            
        data_type = row[0]
        if "timestamp with time zone" not in data_type.lower():
            print(f"❌ {table}: server_updated_at has wrong type: {data_type}")
        else:
            # Check for unexpected NULLs
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE server_updated_at IS NULL;")
            null_count = cur.fetchone()[0]
            if null_count > 0:
                 print(f"❌ {table}: {null_count} rows have NULL server_updated_at")
            else:
                 print(f"✅ {table}: Verified (Type: {data_type}, Nulls: 0)")
                 
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
