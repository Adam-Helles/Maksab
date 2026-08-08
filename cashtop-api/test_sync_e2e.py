import asyncio
import os
import httpx
import uuid
from datetime import datetime, timezone

import sys
from unittest.mock import MagicMock
sys.modules['sentry_sdk'] = MagicMock()

# Set backend to test locally
os.environ["DATABASE_URL"] = "sqlite:///./test_sync.db"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "admin"

from app.database import engine, Base
from app.main import seed_admin

async def main():
    print("1. Rebuilding local test database...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    seed_admin()
    print("✅ Local DB created with UUID schema.")

    # Start FastAPI app in a background thread or just use httpx.ASGITransport
    from app.main import app
    transport = httpx.ASGITransport(app=app)
    
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        print("2. Logging in...")
        resp = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin", "device_id": "test_device"})
        assert resp.status_code == 200, resp.text
        token = resp.json()["access_token"]
        user_id = resp.json()["user"]["id"]
        headers = {"Authorization": f"Bearer {token}"}

        print("3. Pushing data (Sync Push)...")
        # Generate UUIDs
        cust_id = str(uuid.uuid4())
        prod_id = str(uuid.uuid4())
        sup_id = str(uuid.uuid4())
        inv_id = str(uuid.uuid4())
        item_id = str(uuid.uuid4())
        pay_id = str(uuid.uuid4())

        now = datetime.now(timezone.utc).isoformat()

        push_payload = {
            "customers": [{
                "id": cust_id,
                "name": "Test Customer",
                "phone": "123456789",
                "credit_limit": 1000,
                "current_debt": 0,
                "is_active": True,
                "created_at": now,
                "updated_at": now
            }],
            "suppliers": [{
                "id": sup_id,
                "name": "Test Supplier",
                "current_balance": 0,
                "created_at": now,
                "updated_at": now
            }],
            "products": [{
                "id": prod_id,
                "name": "Test Product",
                "retail_price": 100,
                "carton_price": 1000,
                "cost_price": 80,
                "tax_rate": 0,
                "pieces_per_carton": 10,
                "stock_quantity": 50,
                "category_id": None,
                "supplier_id": sup_id,
                "is_active": True,
                "created_at": now,
                "updated_at": now
            }],
            "invoices": [{
                "id": inv_id,
                "invoice_number": "INV-1001",
                "invoice_type": "sale",
                "status": "completed",
                "payment_method": "cash",
                "payment_status": "paid",
                "customer_id": cust_id,
                "supplier_id": None,
                "created_by": user_id,
                "subtotal": 100,
                "discount_amount": 0,
                "tax_amount": 0,
                "total": 100,
                "paid_amount": 100,
                "remaining_amount": 0,
                "notes": "Test invoice",
                "created_at": now,
                "updated_at": now
            }],
            "invoice_items": [{
                "id": item_id,
                "invoice_id": inv_id,
                "product_id": prod_id,
                "quantity": 1,
                "unit_type": "piece",
                "unit_price": 100,
                "cost_price": 80,
                "pieces_per_carton": 10,
                "total": 100
            }],
            "payments": [{
                "id": pay_id,
                "invoice_id": inv_id,
                "amount": 100,
                "method": "cash",
                "notes": "Test payment",
                "created_at": now,
                "updated_at": now
            }]
        }

        resp = await client.post("/api/v1/sync/push", json=push_payload, headers=headers)
        if resp.status_code != 200:
            print("❌ Push failed:", resp.text)
            return
        
        print("✅ Push succeeded:", resp.json())

        print("4. Pulling data (Sync Pull)...")
        resp = await client.get("/api/v1/sync/pull", headers=headers)
        if resp.status_code != 200:
            print("❌ Pull failed:", resp.text)
            return

        data = resp.json()
        print(f"✅ Pull succeeded.")
        print(f"   Customers: {len(data['customers'])}")
        print(f"   Products: {len(data['products'])}")
        print(f"   Invoices: {len(data['invoices'])}")
        print(f"   Invoice Items: {len(data['invoice_items'])}")
        print(f"   Suppliers: {len(data['suppliers'])}")

        assert len(data['customers']) == 1
        assert data['customers'][0]['id'] == cust_id

        assert len(data['products']) == 1
        assert data['products'][0]['id'] == prod_id
        
        assert len(data['invoices']) == 1
        assert data['invoices'][0]['id'] == inv_id

        assert len(data['invoice_items']) == 1
        assert data['invoice_items'][0]['id'] == item_id

        print("🎉 ALL TESTS PASSED! No INTEGER/UUID mismatches remain.")

if __name__ == "__main__":
    asyncio.run(main())
