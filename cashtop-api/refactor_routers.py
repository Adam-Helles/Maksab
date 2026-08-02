import os
import re

routers_dir = 'app/routers'

for filename in os.listdir(routers_dir):
    if not filename.endswith('.py') or filename == '__init__.py':
        continue
    
    filepath = os.path.join(routers_dir, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace parameter typed as int that ends with _id to str
    # e.g. store_id: int -> store_id: str
    content = re.sub(r'([a-zA-Z0-9_]+_id):\s*int', r'\1: str', content)
    # Also just "id: int" -> "id: str" in function params
    content = re.sub(r'(\b)id:\s*int', r'\1id: str', content)
    # Also "cat_id: int" -> "cat_id: str"
    content = re.sub(r'(\b)cat_id:\s*int', r'\1cat_id: str', content)
    content = re.sub(r'(\b)sup_id:\s*int', r'\1sup_id: str', content)
    content = re.sub(r'(\b)cust_id:\s*int', r'\1cust_id: str', content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
print('Done refactoring routers')
