import requests
import uuid
import yaml
from datetime import datetime

with open("c:/my_work/cashtop/render.yaml") as f:
    cfg = yaml.safe_load(f)
DB_URL = next(ev["value"] for ev in cfg["services"][0]["envVars"] if ev["key"] == "DATABASE_URL")

API_URL = "http://localhost:8000"
LOGIN_URL = f"{API_URL}/auth/token"
SYNC_URL = f"{API_URL}/sync/push"

def login():
    r = requests.post(LOGIN_URL, data={"username": "admin", "password": "Maksab@Admin2025"})
    return r.json()["access_token"]

def push_sync(token, data):
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.post(SYNC_URL, json=data, headers=headers)
    print(r.status_code, r.text)
    return r.json()

token = login()
print("Token:", token)

product_id = str(uuid.uuid4())
invoice_id = str(uuid.uuid4())

print("\n--- Initial Push (Product creation) ---")
push_sync(token, {
    "products": [{
        "id": product_id,
        "name": "Test Product",
        "stock_quantity": 100.0,
        "is_active": True,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "created_at": datetime.utcnow().isoformat() + "Z"
    }]
})

print("\n--- Push Invoice + Updated Product (Simulating Manual Stock Update) ---")
push_sync(token, {
    "invoices": [{
        "id": invoice_id,
        "invoice_number": "INV-TEST-001",
        "invoice_type": "sale",
        "status": "completed",
        "payment_method": "cash",
        "payment_status": "paid",
        "subtotal": 10,
        "total": 10,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }],
    "invoice_items": [{
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "product_id": product_id,
        "quantity": 1.0,
        "unit_type": "piece",
        "unit_price": 10,
        "total": 10
    }],
    "products": [{
        "id": product_id,
        "name": "Test Product",
        "stock_quantity": 90.0,  # Absolute manual value
        "is_active": True,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "created_at": datetime.utcnow().isoformat() + "Z"
    }]
})

print("\n--- Pull to verify stock ---")
r = requests.get(f"{API_URL}/sync/pull", headers={"Authorization": f"Bearer {token}"})
prods = r.json().get("products", [])
for p in prods:
    if p["id"] == product_id:
        print(f"Final Stock on Server: {p['stock_quantity']} (Expected: 90.0)")
