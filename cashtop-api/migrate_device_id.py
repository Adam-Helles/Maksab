import sqlite3

def run():
    print("Migrating cashtop.db...")
    conn = sqlite3.connect("c:/my_work/cashtop/cashtop-api/cashtop.db")
    c = conn.cursor()
    try:
        c.execute("ALTER TABLE stores ADD COLUMN allowed_device_id VARCHAR(255)")
        print("Success: Added allowed_device_id to stores")
    except sqlite3.OperationalError as e:
        print(f"OperationalError (maybe column exists?): {e}")
    finally:
        conn.commit()
        conn.close()

if __name__ == "__main__":
    run()
