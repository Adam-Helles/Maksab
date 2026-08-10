"""
check_prod_login.py
-------------------
Tests the production Render API:
1. Login with correct credentials and the ALREADY-BOUND device_id from production.
2. If login succeeds, calls GET /api/v1/admin/db-counts
3. Reports the result.

Usage:
  python check_prod_login.py
  python check_prod_login.py <device_id>   (if you know the bound device ID)
"""
import asyncio
import sys
import httpx

API_BASE = "https://maksab-api.onrender.com/api/v1"


async def run(device_id: str = None):
    async with httpx.AsyncClient(timeout=30.0) as client:

        # ── Step 1: Login ──────────────────────────────────────────────────
        payload = {"username": "admin", "password": "Admin@1234"}
        if device_id:
            payload["device_id"] = device_id

        print(f"\n[1] POST /auth/login  (device_id={device_id or 'NOT_SENT'})")
        resp = await client.post(f"{API_BASE}/auth/login", json=payload)
        print(f"    Status : {resp.status_code}")

        if resp.status_code not in (200, 201):
            print(f"    Body   : {resp.text}")
            print("\n>>> Login failed. Cannot proceed to DB inspection.")
            return

        token = resp.json()["access_token"]
        print("    Login  : SUCCESS")

        # ── Step 2: GET /admin/db-counts ───────────────────────────────────
        print("\n[2] GET /admin/db-counts")
        r2 = await client.get(
            f"{API_BASE}/admin/db-counts",
            headers={"Authorization": f"Bearer {token}"},
        )
        print(f"    Status : {r2.status_code}")
        if r2.status_code == 200:
            data = r2.json()
            print("\n" + "=" * 50)
            print("  PRODUCTION DATABASE COUNTS")
            print("=" * 50)
            for k, v in data.items():
                print(f"  {k:<30} {v}")
            print("=" * 50)
        else:
            print(f"    Error  : {r2.text}")


if __name__ == "__main__":
    device = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(run(device))
