import os
import sys
import uuid
import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# Setup test DB
os.environ["DATABASE_URL"] = "sqlite:///./test_e2e.db"

from app.main import app
from app.database import Base, get_db
from app.models.user import User, UserRole
from app.models.store import Store
from app.models.customer import Customer
from app.models.debt_payment import DebtPayment
from app.models.invoice import Invoice, InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod

engine = create_engine("sqlite:///./test_e2e.db", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

db = TestingSessionLocal()

# Setup test data
store_id = str(uuid.uuid4())
store2_id = str(uuid.uuid4())
db.add(Store(id=store_id, name="Test Store 1"))
db.add(Store(id=store2_id, name="Test Store 2"))

user_id = str(uuid.uuid4())
user = User(id=user_id, username="testadmin", role=UserRole.ADMIN, store_id=store_id, is_active=True)
from app.core.security import get_password_hash
user.hashed_password = get_password_hash("password")
db.add(user)
db.commit()

# Login
response = client.post("/auth/login", data={"username": "testadmin", "password": "password"})
token = response.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

print("--- STARTING E2E BACKEND TESTS ---")

# Create a customer with 100 debt via /sync/customers/profile/push
cust_id = str(uuid.uuid4())
client.post("/sync/customers/profile/push", headers=headers, json={
    "profiles": [{
        "id": cust_id,
        "name": "E2E Customer",
        "current_debt": 100.0,
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z"
    }]
})
# Wait, /sync/customers/profile/push doesn't allow setting current_debt directly if it doesn't exist?
# Profile push checks if customer exists.
db.add(Customer(id=cust_id, store_id=store_id, name="E2E Customer", current_debt=100.0))
db.commit()

# TEST 1 & 8: Online payment and Accounting Integrity
pay_id_1 = str(uuid.uuid4())
pay_data_1 = {
    "payments": [{
        "id": pay_id_1,
        "customer_id": cust_id,
        "amount": 30.0,
        "method": "cash",
        "client_created_at": datetime.datetime.utcnow().isoformat() + "Z"
    }]
}
res1 = client.post("/sync/customers/payments/push", headers=headers, json=pay_data_1)
print("Test 1 Push:", res1.status_code, res1.json())
db.refresh(db.query(Customer).filter_by(id=cust_id).first())
c = db.query(Customer).filter_by(id=cust_id).first()
print(f"Customer balance after 30 payment: {c.current_debt} (Expected 70)")
if c.current_debt == 70.0:
    print("TEST 1/8: PASS")
else:
    print("TEST 1/8: FAIL")

# TEST 3: Multiple payments
pay_id_2 = str(uuid.uuid4())
pay_id_3 = str(uuid.uuid4())
pay_id_4 = str(uuid.uuid4())
pay_data_multi = {
    "payments": [
        {"id": pay_id_2, "customer_id": cust_id, "amount": 20.0, "method": "cash", "client_created_at": datetime.datetime.utcnow().isoformat() + "Z"},
        {"id": pay_id_3, "customer_id": cust_id, "amount": 30.0, "method": "cash", "client_created_at": datetime.datetime.utcnow().isoformat() + "Z"},
        {"id": pay_id_4, "customer_id": cust_id, "amount": 15.0, "method": "cash", "client_created_at": datetime.datetime.utcnow().isoformat() + "Z"}
    ]
}
res3 = client.post("/sync/customers/payments/push", headers=headers, json=pay_data_multi)
db.refresh(c)
print(f"Customer balance after 20+30+15 payments: {c.current_debt} (Expected 5)")
payments_count = db.query(DebtPayment).filter_by(customer_id=cust_id).count()
print(f"Total payments stored for customer: {payments_count} (Expected 4)")
if c.current_debt == 5.0 and payments_count == 4:
    print("TEST 3: PASS")
else:
    print("TEST 3: FAIL")

# TEST 4: Repeated Sync / Idempotency
res4 = client.post("/sync/customers/payments/push", headers=headers, json=pay_data_multi)
db.refresh(c)
print(f"Customer balance after duplicate sync: {c.current_debt} (Expected 5)")
payments_count_after = db.query(DebtPayment).filter_by(customer_id=cust_id).count()
print(f"Total payments stored after duplicate sync: {payments_count_after} (Expected 4)")
if payments_count_after == 4 and c.current_debt == 5.0 and pay_id_2 in res4.json()["already_applied"]:
    print("TEST 4: PASS")
else:
    print("TEST 4: FAIL")

# TEST 5: Pull / Restore
res5 = client.get("/sync/pull", headers=headers)
pulled_data = res5.json()
payments_pulled = pulled_data.get("payments", [])
print(f"Pulled payments count: {len(payments_pulled)} (Expected 4)")
if len(payments_pulled) == 4 and payments_pulled[0]["amount"] in [30.0, 20.0, 15.0]:
    print("TEST 5: PASS")
else:
    print("TEST 5: FAIL", payments_pulled)

# TEST 6: Customer Isolation
cust2_id = str(uuid.uuid4())
db.add(Customer(id=cust2_id, store_id=store2_id, name="Other Store Customer", current_debt=50.0))
db.commit()

pay_id_isolate = str(uuid.uuid4())
pay_data_isolate = {
    "payments": [{
        "id": pay_id_isolate,
        "customer_id": cust2_id,
        "amount": 10.0,
        "method": "cash",
        "client_created_at": datetime.datetime.utcnow().isoformat() + "Z"
    }]
}
res6 = client.post("/sync/customers/payments/push", headers=headers, json=pay_data_isolate)
print("Isolation push result:", res6.json())
if pay_id_isolate in res6.json().get("rejected_wrong_store", []):
    print("TEST 6: PASS")
else:
    print("TEST 6: FAIL")

