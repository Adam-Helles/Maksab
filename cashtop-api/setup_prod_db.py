import os
from sqlalchemy import create_engine
from app.database import Base

# Import all models to ensure they are registered with Base.metadata
from app.models import *

# Supabase connection string from the user
DATABASE_URL = "postgresql+psycopg2://postgres:zkBtBiIXAN7XZfJ8@db.xbzbuihxhjjbrplusqoq.supabase.co:5432/postgres"

def init_prod_db():
    print("Connecting to Supabase production database...")
    engine = create_engine(DATABASE_URL)
    
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)
    
    print("Tables created successfully!")

if __name__ == "__main__":
    init_prod_db()
