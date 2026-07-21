import sqlite3

conn = sqlite3.connect('cashtop-api/cashtop.db')

# Show current state
rows = conn.execute(
    "SELECT customer_id, SUM(remaining_amount) "
    "FROM invoices "
    "WHERE status='COMPLETED' AND invoice_type='SALE' AND remaining_amount>0 "
    "GROUP BY customer_id"
).fetchall()
print("Debt by customer (from invoices):", rows)

# Repair: recalculate current_debt for every customer
conn.execute(
    "UPDATE customers SET current_debt = ("
    "  SELECT COALESCE(SUM(i.remaining_amount), 0)"
    "  FROM invoices i"
    "  WHERE i.customer_id = customers.id"
    "    AND i.status = 'COMPLETED'"
    "    AND i.invoice_type = 'SALE'"
    "    AND i.remaining_amount > 0"
    ")"
)
conn.commit()

updated = conn.execute("SELECT id, current_debt FROM customers").fetchall()
print("Updated customer debts:", updated)
conn.close()
print("Done!")
