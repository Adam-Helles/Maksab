import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv("c:/my_work/cashtop/cashtop-api/.env")
db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("ERROR: DATABASE_URL not found in environment.")
    exit(1)

# Do not print credentials, mask the URL
masked_url = db_url.split("@")[-1] if "@" in db_url else "LOCAL OR MASKED"
print(f"Testing connection to: {masked_url}")

try:
    engine = create_engine(db_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT version();")).fetchone()
        print("PostgreSQL Version:", result[0])
        
        # Verify it's not SQLite
        if "PostgreSQL" not in result[0]:
             print("ERROR: This is not a PostgreSQL database!")
             exit(1)
             
        # Check users count as identity check
        count_result = conn.execute(text("SELECT count(*) FROM users;")).fetchone()
        print(f"Database Identity Check (Users Count): {count_result[0]}")
        print("PHASE 1: PASS - Database Connection Successful.")
except Exception as e:
    print("ERROR:", type(e).__name__)
    exit(1)
