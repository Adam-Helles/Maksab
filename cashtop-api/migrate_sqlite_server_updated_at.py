import os
import sqlite3
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL", "")

tables = [
    "users", "stores", "categories", "suppliers", "customers", 
    "products", "product_batches", "invoices", "invoice_items", 
    "payments", "stock_movements", "refresh_tokens", "licenses", "employees"
]

def migrate_sqlite():
    db_path = "cashtop.db"
    if not os.path.exists(db_path):
        print(f"No {db_path} found.")
        return
        
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    for table in tables:
        try:
            # Check if exists
            cur.execute(f"PRAGMA table_info({table})")
            columns = [c[1] for c in cur.fetchall()]
            if "server_updated_at" not in columns:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN server_updated_at DATETIME;")
                cur.execute(f"UPDATE {table} SET server_updated_at = updated_at;")
                print(f"Added to {table}")
            else:
                print(f"Already in {table}")
        except Exception as e:
            print(f"Skipped {table}: {e}")
            
    conn.commit()
    conn.close()
    print("Done SQLite")

migrate_sqlite()
