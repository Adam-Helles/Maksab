import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL found in .env")
    exit(1)

tables = [
    "users", "stores", "categories", "suppliers", "customers", 
    "products", "product_batches", "invoices", "invoice_items", 
    "payments", "stock_movements", "refresh_tokens", "licenses", "employees"
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
