import os
import re

models_dir = 'app/models'

for filename in os.listdir(models_dir):
    if not filename.endswith('.py') or filename == 'base.py' or filename == '__init__.py':
        continue
    
    filepath = os.path.join(models_dir, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Add import uuid if not present
    if 'import uuid' not in content:
        content = 'import uuid\n' + content
        
    # Replace id = Column(Integer, primary_key=True, index=True)
    # with id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    content = re.sub(
        r'id = Column\(Integer,\s*primary_key=True(?:,\s*index=True)?\)',
        r'id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))',
        content
    )
    
    # Replace Column(Integer, ForeignKey(...)
    # with Column(String(36), ForeignKey(...)
    content = re.sub(
        r'Column\(Integer,\s*ForeignKey',
        r'Column(String(36), ForeignKey',
        content
    )
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
print('Done refactoring models')
