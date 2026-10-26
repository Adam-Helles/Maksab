"""
Comprehensive test for UUID migration fixes.
Tests: Auth (Super Admin, Shop Admin, Cashier), Licensing, Offline schemas.
"""
import os, uuid, sys
sys.stdout.reconfigure(encoding='utf-8')

# Force SQLite for local testing
DB_PATH = 'test_uuid_fix.db'
os.environ['DATABASE_URL'] = f'sqlite:///./{DB_PATH}'

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

from fastapi.testclient import TestClient
from app.main import app, seed_admin, create_tables
from app.database import engine, Base, SessionLocal
from app.config import settings
from app.models.user import User, UserRole
from app.models.store import Store
from app.models.license import LicenseKey
from app.core.security import hash_password

# Fresh DB
Base.metadata.create_all(bind=engine)
seed_admin()

client = TestClient(app)
db = SessionLocal()

# Create test users
store = db.query(Store).first()
shop_admin = User(
    id=str(uuid.uuid4()), username='shopadmin', full_name='Shop Admin',
    password_hash=hash_password('123456'), role=UserRole.ADMIN,
    is_active=True, store_id=store.id
)
cashier = User(
    id=str(uuid.uuid4()), username='cashier1', full_name='Cashier',
    password_hash=hash_password('123456'), role=UserRole.CASHIER,
    is_active=True, store_id=store.id
)
db.add_all([shop_admin, cashier])
db.commit()

results = {}
all_pass = True

def check(name, actual, expected):
    global all_pass
    results[name] = actual
    ok = actual == expected
    if not ok:
        all_pass = False
    tag = "PASS" if ok else "FAIL"
    print(f"  [{tag}] {name}: {actual} (expected {expected})")
    return ok

print("=" * 60)
print("AUTHENTICATION TESTS")
print("=" * 60)

# Super Admin
r = client.post('/api/v1/auth/login', json={
    'username': settings.ADMIN_USERNAME, 'password': settings.ADMIN_PASSWORD
})
check("super_admin_login", r.status_code, 200)
token_sa = r.json().get('access_token', '')
u = r.json().get('user', {})
print(f"    store_id={u.get('store_id')}, role={u.get('role')}")

headers_sa = {'Authorization': f'Bearer {token_sa}'}
r = client.get('/api/v1/auth/me', headers=headers_sa)
check("super_admin_me", r.status_code, 200)

# Shop Admin
r = client.post('/api/v1/auth/login', json={'username': 'shopadmin', 'password': '123456'})
check("shop_admin_login", r.status_code, 200)
token_na = r.json().get('access_token', '')
u = r.json().get('user', {})
print(f"    store_id={u.get('store_id')}, role={u.get('role')}")

headers_na = {'Authorization': f'Bearer {token_na}'}
r = client.get('/api/v1/auth/me', headers=headers_na)
check("shop_admin_me", r.status_code, 200)

# Cashier
r = client.post('/api/v1/auth/login', json={'username': 'cashier1', 'password': '123456'})
check("cashier_login", r.status_code, 200)
token_c = r.json().get('access_token', '')

headers_c = {'Authorization': f'Bearer {token_c}'}
r = client.get('/api/v1/auth/me', headers=headers_c)
check("cashier_me", r.status_code, 200)

print()
print("=" * 60)
print("LICENSING TESTS")
print("=" * 60)

# List licenses
r = client.get('/api/v1/licenses/', headers=headers_sa)
check("list_licenses", r.status_code, 200)

# Generate valid keys
for days in [1, 30, 365]:
    r = client.post('/api/v1/licenses/generate', headers=headers_sa,
                    json={'days_valid': days, 'count': 1})
    check(f"generate_{days}_days", r.status_code, 200)
    if r.status_code == 200:
        key = r.json()[0]
        print(f"    key={key['key']}, days_valid={key['days_valid']} (type={type(key['days_valid']).__name__})")

# Invalid values
r = client.post('/api/v1/licenses/generate', headers=headers_sa,
                json={'days_valid': 0, 'count': 1})
check("generate_0_days", r.status_code, 400)

r = client.post('/api/v1/licenses/generate', headers=headers_sa,
                json={'days_valid': -1, 'count': 1})
check("generate_neg1_days", r.status_code, 400)

r = client.post('/api/v1/licenses/generate', headers=headers_sa,
                json={'days_valid': 'invalid', 'count': 1})
check("generate_invalid_str", r.status_code, 422)

# Authorization: cashier cannot generate
r = client.post('/api/v1/licenses/generate', headers=headers_c,
                json={'days_valid': 30, 'count': 1})
check("cashier_cannot_generate", r.status_code, 403)

# Authorization: shop admin (non-ADMIN_USERNAME) cannot generate
r = client.post('/api/v1/licenses/generate', headers=headers_na,
                json={'days_valid': 30, 'count': 1})
check("shop_admin_cannot_generate", r.status_code, 403)

# Verify keys exist in DB
keys_in_db = db.query(LicenseKey).all()
check("keys_created_in_db", len(keys_in_db), 3)
for k in keys_in_db:
    print(f"    id={k.id[:8]}... type(id)={type(k.id).__name__}, "
          f"days={k.days_valid} type(days)={type(k.days_valid).__name__}, "
          f"used_by={k.used_by_store_id}")

# Verify serialization roundtrip
r = client.get('/api/v1/licenses/', headers=headers_sa)
if r.status_code == 200:
    items = r.json()
    first = items[0]
    id_ok = isinstance(first['id'], str)
    days_ok = isinstance(first['days_valid'], int)
    store_ok = first.get('used_by_store_id') is None or isinstance(first['used_by_store_id'], str)
    serial_ok = id_ok and days_ok and store_ok
    check("serialization_types_correct", serial_ok, True)
    if not serial_ok:
        print(f"    id: {type(first['id'])}, days: {type(first['days_valid'])}, store: {type(first.get('used_by_store_id'))}")

print()
print("=" * 60)
print("OFFLINE SCHEMA TESTS")
print("=" * 60)

from app.schemas.offline_purchase import OfflinePurchaseResult
from app.schemas.offline_sale import OfflineSaleResult

test_uuid = str(uuid.uuid4())

# UUID invoice ID
try:
    r1 = OfflinePurchaseResult(id=test_uuid, server_invoice_id=test_uuid, status='accepted')
    check("purchase_result_uuid", True, True)
except Exception as e:
    check("purchase_result_uuid", False, True)
    print(f"    Error: {e}")

try:
    r2 = OfflineSaleResult(id=test_uuid, server_invoice_id=test_uuid, status='accepted')
    check("sale_result_uuid", True, True)
except Exception as e:
    check("sale_result_uuid", False, True)
    print(f"    Error: {e}")

# None invoice ID
try:
    r3 = OfflinePurchaseResult(id=test_uuid, server_invoice_id=None, status='rejected')
    check("purchase_result_none", True, True)
except Exception as e:
    check("purchase_result_none", False, True)

try:
    r4 = OfflineSaleResult(id=test_uuid, server_invoice_id=None, status='rejected')
    check("sale_result_none", True, True)
except Exception as e:
    check("sale_result_none", False, True)

print()
print("=" * 60)
print("FINAL SUMMARY")
print("=" * 60)
passed = sum(1 for v in results.values() if v in [200, 400, 422, 403, 3, True])
total = len(results)
print(f"Tests: {passed}/{total}")
if all_pass:
    print("*** ALL TESTS PASSED ***")
else:
    print("*** SOME TESTS FAILED ***")
    for k, v in results.items():
        print(f"  {k}: {v}")
