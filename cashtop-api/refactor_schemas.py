import os
import re

schemas_dir = 'app/schemas'

for filename in os.listdir(schemas_dir):
    if not filename.endswith('.py') or filename == '__init__.py':
        continue
    
    filepath = os.path.join(schemas_dir, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace id: int with id: str
    content = re.sub(r'id:\s*int', r'id: str', content)
    # Replace store_id: int with store_id: str
    content = re.sub(r'store_id:\s*int', r'store_id: str', content)
    # Replace customer_id: int with customer_id: str
    content = re.sub(r'customer_id:\s*int', r'customer_id: str', content)
    # Replace user_id: int with user_id: str
    content = re.sub(r'user_id:\s*int', r'user_id: str', content)
    # Replace product_id: int with product_id: str
    content = re.sub(r'product_id:\s*int', r'product_id: str', content)
    # Replace category_id: int with category_id: str
    content = re.sub(r'category_id:\s*int', r'category_id: str', content)
    # Replace supplier_id: int with supplier_id: str
    content = re.sub(r'supplier_id:\s*int', r'supplier_id: str', content)
    # Replace invoice_id: int with invoice_id: str
    content = re.sub(r'invoice_id:\s*int', r'invoice_id: str', content)
    # Replace Optional[int] with Optional[str] for IDs
    content = re.sub(r'customer_id:\s*Optional\[int\]', r'customer_id: Optional[str]', content)
    content = re.sub(r'category_id:\s*Optional\[int\]', r'category_id: Optional[str]', content)
    content = re.sub(r'supplier_id:\s*Optional\[int\]', r'supplier_id: Optional[str]', content)
    
    # Also update any List[int] if they represent IDs, but this might be risky. We'll skip for now unless needed.
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
print('Done refactoring schemas')
