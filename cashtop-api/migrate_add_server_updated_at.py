import os
import psycopg2
import yaml

with open("c:/my_work/cashtop/render.yaml") as f:
    cfg = yaml.safe_load(f)
db_url = next(ev["value"] for ev in cfg["services"][0]["envVars"] if ev["key"] == "DATABASE_URL")
if not db_url:
    print("No DATABASE_URL found in render.yaml")
    exit(1)

if db_url.startswith("postgresql+psycopg2://"):
    db_url = db_url.replace("postgresql+psycopg2://", "postgresql://")


tables = [
    "users", "stores", "categories", "suppliers", "customers", 
    "products", "product_batches", "invoices", "invoice_items", 
    "payments", "stock_movements", "refresh_tokens", "license_keys", "employees"
]

def migrate():
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cur = conn.cursor()
        
        for table in tables:
            try:
                # Add column
                cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS server_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;")
                # Backfill existing data
                cur.execute(f"UPDATE {table} SET server_updated_at = updated_at WHERE server_updated_at IS NULL;")
                print(f"✅ Successfully added server_updated_at to {table}")
            except psycopg2.Error as e:
                # Some tables might not exist or other errors
                print(f"⚠️ Skipped {table}: {e.pgerror or e}")
                
        cur.close()
        conn.close()
        print("🎉 Migration completed.")
    except Exception as e:
        print(f"❌ Connection failed: {e}")

if __name__ == "__main__":
    migrate()
