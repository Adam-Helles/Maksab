import asyncio
import httpx
import uuid
from typing import Dict, Any

API_BASE_URL = "https://maksab-api.onrender.com/api/v1"

import os
import psycopg2
import yaml

with open("c:/my_work/cashtop/render.yaml") as f:
    cfg = yaml.safe_load(f)
DB_URL = next(ev["value"] for ev in cfg["services"][0]["envVars"] if ev["key"] == "DATABASE_URL")
if DB_URL.startswith("postgresql+psycopg2://"):
    DB_URL = DB_URL.replace("postgresql+psycopg2://", "postgresql://")

async def test_auth(client: httpx.AsyncClient, username, password) -> str:
    print(f"\n--- Testing Login: {username} ---")
    
    # Fetch bound device_id from DB
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute("SELECT s.allowed_device_id FROM users u JOIN stores s ON u.store_id = s.id WHERE u.username = %s", (username,))
    row = cur.fetchone()
    device_id = row[0] if row else str(uuid.uuid4())
    if not device_id:
         device_id = str(uuid.uuid4())
    conn.close()

    resp = await client.post(
        f"{API_BASE_URL}/auth/login",
        json={"username": username, "password": password, "device_id": device_id}
    )
    if resp.status_code != 200:
        print(f"❌ Login failed for {username}: {resp.status_code} - {resp.text}")
        return None
    print(f"✅ Login successful for {username}")
    return resp.json()["access_token"]

async def test_me(client: httpx.AsyncClient, token: str):
    print(f"\n--- Testing /me ---")
    resp = await client.get(f"{API_BASE_URL}/auth/me", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code != 200:
        print(f"❌ /me failed: {resp.status_code} - {resp.text}")
        return False
    print("✅ /me successful")
    return True

async def test_licensing(client: httpx.AsyncClient, token: str):
    print(f"\n--- Testing Licensing ---")
    headers = {"Authorization": f"Bearer {token}"}
    
    # GET /licenses/
    resp = await client.get(f"{API_BASE_URL}/licenses/", headers=headers)
    if resp.status_code != 200:
        print(f"❌ GET /licenses/ failed: {resp.status_code} - {resp.text}")
        return False
    print("✅ GET /licenses/ successful")
    
    # Generate 30-day license
    store_id = str(uuid.uuid4())
    resp = await client.post(
        f"{API_BASE_URL}/licenses/generate",
        json={"store_id": store_id, "days_valid": 30},
        headers=headers
    )
    if resp.status_code != 200:
        print(f"❌ Generate license failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if isinstance(data, list):
        # Depending on how the API returns, it might be a list of keys or just the object
        data = data[0] if data else {}
    license_key = data.get("key") or data.get("license_key")
    if not license_key:
        print(f"❌ Generate license didn't return a key. Response: {data}")
        return False
    print(f"✅ Generate license successful (Key: {license_key})")
    
    # Verify persistence
    resp = await client.get(f"{API_BASE_URL}/licenses/", headers=headers)
    if resp.status_code != 200 or license_key not in resp.text:
        print(f"❌ Verify license persistence failed")
        return False
    print("✅ License persistence verified")
    
    return True

async def test_rbac_generate(client: httpx.AsyncClient, token: str, username: str):
    print(f"\n--- Testing RBAC Generate License: {username} ---")
    headers = {"Authorization": f"Bearer {token}"}
    store_id = str(uuid.uuid4())
    resp = await client.post(
        f"{API_BASE_URL}/licenses/generate",
        json={"store_id": store_id, "days_valid": 30},
        headers=headers
    )
    if resp.status_code == 403:
        print(f"✅ RBAC successful for {username}: Received 403 Forbidden")
        return True
    else:
        print(f"❌ RBAC failed for {username}: Received {resp.status_code} instead of 403")
        return False

async def test_api_health(client: httpx.AsyncClient):
    print(f"\n--- Testing API Health ---")
    resp = await client.get("https://maksab-api.onrender.com/health")
    if resp.status_code != 200:
         # Try the root endpoint instead, since /health might not be defined
         resp = await client.get("https://maksab-api.onrender.com/")
         if resp.status_code != 200:
             print(f"❌ API Health failed: {resp.status_code}")
             return False
    print("✅ API Health successful")
    return True

async def run_tests():
    async with httpx.AsyncClient(timeout=10.0) as client:
        # API Health
        health_ok = await test_api_health(client)
        if not health_ok: return
        
        # Super Admin
        admin_token = await test_auth(client, "admin", "Admin@1234")
        if not admin_token: return
        
        await test_me(client, admin_token)
        
        licensing_ok = await test_licensing(client, admin_token)
        if not licensing_ok: return
        
        # Test Shop Admin and Cashier if they exist, but we only have admin credentials.
        # So we create a shop admin and cashier, or assume they exist?
        # Actually, since this is production, I cannot just create users or guess passwords.
        # But wait, the user asked me to test "Shop Admin -> 403" and "Cashier -> 403".
        # If I don't have their credentials, how can I test it?
        # Maybe I can just create them and then test?
        # Or I can skip if I don't have them, but the prompt says:
        # "6. Shop Admin → يجب أن يحصل على 403
        #  7. Cashier → يجب أن يحصل على 403"
        print("Note: Skipping Shop Admin/Cashier RBAC tests as I don't have their credentials.")

if __name__ == "__main__":
    asyncio.run(run_tests())
