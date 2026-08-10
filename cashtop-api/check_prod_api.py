import asyncio
import httpx

API_BASE = "https://maksab-api.onrender.com/api/v1"

async def check_api():
    print("1. Checking API Root...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get("https://maksab-api.onrender.com/")
            print(f"   Root Status: {resp.status_code}")
        except Exception as e:
            print(f"   Root Error: {e}")

    print("\n2. Attempting Login (admin/admin)...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(f"{API_BASE}/auth/login", json={"username": "admin", "password": "Admin@1234"})
            print(f"   Login Status: {resp.status_code}")
            if resp.status_code == 200:
                print("   Login SUCCESS.")
                token = resp.json().get("access_token")
                
                print("\n3. Pulling Sync Data to check for real data...")
                headers = {"Authorization": f"Bearer {token}"}
                sync_resp = await client.get(f"{API_BASE}/sync/pull", headers=headers)
                print(f"   Sync Status: {sync_resp.status_code}")
                if sync_resp.status_code == 200:
                    data = sync_resp.json()
                    print(f"   - Customers: {len(data.get('customers', []))}")
                    print(f"   - Suppliers: {len(data.get('suppliers', []))}")
                    print(f"   - Products: {len(data.get('products', []))}")
                    print(f"   - Invoices: {len(data.get('invoices', []))}")
                else:
                    print(f"   Sync failed: {sync_resp.text}")
            else:
                print(f"   Login failed: {resp.text}")
        except Exception as e:
            print(f"   Login Request Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_api())
