import os
import sys

# Ensure we can import the app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.customer import Customer
from app.models.invoice import Invoice
from app.models.product import Product

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql+psycopg2://postgres:zkBtBiIXAN7XZfJ8@db.xbzbuihxhjjbrplusqoq.supabase.co:5432/postgres"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

def inspect_db():
    print("=" * 50)
    print("INSPECTING PRODUCTION DATABASE")
    print("=" * 50)
    
    try:
        engine = create_engine(DATABASE_URL)
        Session = sessionmaker(bind=engine)
        db = Session()
        
        customers_count = db.query(Customer).count()
        products_count = db.query(Product).count()
        invoices_count = db.query(Invoice).count()
        
        print(f"Total Customers: {customers_count}")
        print(f"Total Products:  {products_count}")
        print(f"Total Invoices:  {invoices_count}")
        
        if customers_count == 0 and products_count == 0 and invoices_count == 0:
            print("\n✅ Database appears to be EMPTY / TEST ONLY.")
            print("You can safely run `python rebuild_db.py`.")
        else:
            print("\n⚠️ WARNING: Database contains REAL data!")
            print("DO NOT RUN rebuild_db.py! This data must be migrated carefully.")
            
    except Exception as e:
        print(f"Error connecting to the database: {e}")

if __name__ == "__main__":
    inspect_db()
