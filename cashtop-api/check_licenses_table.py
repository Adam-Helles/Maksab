import os
import psycopg2
import yaml

with open('c:/my_work/cashtop/render.yaml') as f:
    cfg = yaml.safe_load(f)
DB_URL = next(ev['value'] for ev in cfg['services'][0]['envVars'] if ev['key'] == 'DATABASE_URL')
if DB_URL.startswith('postgresql+psycopg2://'):
    DB_URL = DB_URL.replace('postgresql+psycopg2://', 'postgresql://')

try:
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'licenses');")
    print('Licenses table exists:', cur.fetchone()[0])
except Exception as e:
    print('Error:', e)
