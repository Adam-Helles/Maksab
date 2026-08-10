import asyncio
import httpx
from datetime import datetime, timedelta
from jose import jwt

API_BASE = "https://maksab-api.onrender.com/api/v1"
SECRET_KEY = "your-super-secret-key-change-in-production-at-least-32-chars"
ALGORITHM = "HS256"

def create_access_token(user_id: int):
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": str(user_id), "role": "admin", "type": "access", "exp": expire}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def check_data():
    token = create_access_token(1)
    print(f"Generated Token: {token}")
    
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        print("Pulling Sync Data...")
        resp = await client.get(f"{API_BASE}/sync/pull", headers=headers)
        
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            customers = data.get("customers", [])
            suppliers = data.get("suppliers", [])
            products = data.get("products", [])
            invoices = data.get("invoices", [])
            
            print(f"Customers: {len(customers)}")
            print(f"Suppliers: {len(suppliers)}")
            print(f"Products: {len(products)}")
            print(f"Invoices: {len(invoices)}")
            
            print("\nSample Data Inspection:")
            if customers:
                print(f"Customer 1: {customers[0].get('name')}")
            if products:
                print(f"Product 1: {products[0].get('name')}")
            if invoices:
                print(f"Invoice 1: {invoices[0].get('invoice_number')} (Total: {invoices[0].get('total')})")
        else:
            print(f"Error: {resp.text}")

if __name__ == "__main__":
    asyncio.run(check_data())
