import sqlite3
conn = sqlite3.connect("test_sync.db")
c = conn.cursor()
c.execute("SELECT invoice_type FROM invoices")
print("Invoice Types:", c.fetchall())
c.execute("SELECT stock_quantity FROM products")
print("Stock Quantities:", c.fetchall())
conn.close()
