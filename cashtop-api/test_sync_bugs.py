import asyncio
import os
import httpx
import uuid
from datetime import datetime, timezone
import sys
from unittest.mock import MagicMock

sys.modules['sentry_sdk'] = MagicMock()

os.environ["DATABASE_URL"] = "sqlite:///./test_sync.db"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "admin"

from app.database import engine, Base
from app.main import seed_admin

async def main():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    seed_admin()

    from app.main import app
    transport = httpx.ASGITransport(app=app)
    
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin", "device_id": "test_device"})
        token = resp.json()["access_token"]
        user_id = resp.json()["user"]["id"]
        headers = {"Authorization": f"Bearer {token}"}

        now = datetime.now(timezone.utc).isoformat()
        prod1_id = str(uuid.uuid4())
        cust1_id = str(uuid.uuid4())
        inv1_id = str(uuid.uuid4())

        # Test 1 & 3: New Product + Sale, New Customer + Debt
        # Initial Stock = 10, Sale = 2 -> Payload Stock = 8
        # Initial Debt = 0, Debt = 20 -> Payload Debt = 20
        push_payload = {
            "products": [{"id": prod1_id, "name": "P1", "stock_quantity": 8, "created_at": now, "updated_at": now, "retail_price":0, "cost_price":0, "pieces_per_carton":1}],
            "customers": [{"id": cust1_id, "name": "C1", "current_debt": 20, "credit_limit":100, "created_at": now, "updated_at": now}],
            "invoices": [{"id": inv1_id, "created_by": user_id, "invoice_number": "INV-1", "invoice_type": "sale", "payment_method": "credit", "remaining_amount": 20, "customer_id": cust1_id, "created_at": now, "updated_at": now}],
            "invoice_items": [{"id": str(uuid.uuid4()), "invoice_id": inv1_id, "product_id": prod1_id, "quantity": 2, "unit_type": "piece", "unit_price": 10, "total": 20, "pieces_per_carton": 1}]
        }

        resp = await client.post("/api/v1/sync/push", json=push_payload, headers=headers)
        print("Push 1 (New):", resp.json())

        # Verify
        resp = await client.get("/api/v1/sync/pull", headers=headers)
        data = resp.json()
        
        p1 = next(p for p in data["products"] if p["id"] == prod1_id)
        c1 = next(c for c in data["customers"] if c["id"] == cust1_id)
        
        print(f"Test 1 (New Prod + Sale): Expected 8, Got {p1['stock_quantity']}")
        print(f"Test 3 (New Cust + Debt): Expected 20, Got {c1['current_debt']}")
        assert p1['stock_quantity'] == 8
        assert c1['current_debt'] == 20

        # Test 2 & 4: Existing Product + Sale, Existing Customer + Debt
        # Payload Stock = 6 (Server should ignore 6 and apply -2 -> 8 - 2 = 6)
        # Payload Debt = 40 (Server should ignore 40 and apply +20 -> 20 + 20 = 40)
        inv2_id = str(uuid.uuid4())
        push_payload_2 = {
            "products": [{"id": prod1_id, "name": "P1", "stock_quantity": 6, "updated_at": now}],
            "customers": [{"id": cust1_id, "name": "C1", "current_debt": 40, "updated_at": now}],
            "invoices": [{"id": inv2_id, "created_by": user_id, "invoice_number": "INV-2", "invoice_type": "sale", "payment_method": "credit", "remaining_amount": 20, "customer_id": cust1_id, "created_at": now, "updated_at": now}],
            "invoice_items": [{"id": str(uuid.uuid4()), "invoice_id": inv2_id, "product_id": prod1_id, "quantity": 2, "unit_type": "piece", "unit_price": 10, "total": 20, "pieces_per_carton": 1}]
        }
        
        resp = await client.post("/api/v1/sync/push", json=push_payload_2, headers=headers)
        print("Push 2 (Existing):", resp.json())

        resp = await client.get("/api/v1/sync/pull", headers=headers)
        data = resp.json()
        p1 = next(p for p in data["products"] if p["id"] == prod1_id)
        c1 = next(c for c in data["customers"] if c["id"] == cust1_id)
        
        print(f"Test 2 (Existing Prod + Sale): Expected 6, Got {p1['stock_quantity']}")
        print(f"Test 4 (Existing Cust + Debt): Expected 40, Got {c1['current_debt']}")
        assert p1['stock_quantity'] == 6
        assert c1['current_debt'] == 40

        # Test 5: Retry (Idempotency)
        # Re-send push_payload_2
        resp = await client.post("/api/v1/sync/push", json=push_payload_2, headers=headers)
        print("Push 3 (Retry):", resp.json())

        resp = await client.get("/api/v1/sync/pull", headers=headers)
        data = resp.json()
        p1 = next(p for p in data["products"] if p["id"] == prod1_id)
        c1 = next(c for c in data["customers"] if c["id"] == cust1_id)
        
        print(f"Test 5 (Retry): Expected 6, Got {p1['stock_quantity']}")
        print(f"Test 5 (Retry): Expected 40, Got {c1['current_debt']}")
        assert p1['stock_quantity'] == 6
        assert c1['current_debt'] == 40

        print("All tests passed!")

if __name__ == "__main__":
    asyncio.run(main())
