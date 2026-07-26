import * as Crypto from 'expo-crypto';
import db from './database';
import { api } from '../api/client';
import { Supplier } from '../types';

export type LocalSupplier = {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  balance: number;
  is_active: number;
  updated_at: string;
  profile_dirty: number;
};

export function localSupplierToSupplier(c: LocalSupplier): Supplier {
  return {
    id: c.id,
    name: c.name,
    company: c.company || undefined,
    phone: c.phone || undefined,
    email: c.email || undefined,
    balance: c.balance,
    is_active: c.is_active === 1,
    created_at: c.updated_at, // Approximate
  };
}

export type LocalPendingSupplierPayment = {
  id: string;
  supplier_id: number;
  amount: number;
  method: string;
  client_created_at: string;
  synced: number;
};

export type LocalPendingSupplierDebt = {
  id: string;
  supplier_id: number;
  amount: number;
  notes: string | null;
  client_created_at: string;
  synced: number;
};

export type LocalPendingSupplier = {
  local_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  client_created_at: string;
  synced: number;
};

export function initSupplierTables() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS suppliers_cache (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      balance REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      profile_dirty INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_supplier_payments (
      id TEXT PRIMARY KEY NOT NULL,
      supplier_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_new_suppliers (
      local_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_supplier_debts (
      id TEXT PRIMARY KEY NOT NULL,
      supplier_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function searchSuppliersCache(query: string, limit = 20): (Supplier | (LocalPendingSupplier & { isPending: true }))[] {
  let sql = `SELECT * FROM suppliers_cache WHERE is_active = 1`;
  const params: any[] = [];
  if (query) {
    sql += ` AND name LIKE ?`;
    params.push(`%${query}%`);
  }
  sql += ` ORDER BY name ASC LIMIT ?`;
  params.push(limit);

  const local = db.getAllSync<LocalSupplier>(sql, params).map(localSupplierToSupplier);
  
  // Mix in pending offline suppliers
  let pendingSql = `SELECT * FROM pending_new_suppliers WHERE synced = 0`;
  const pendingParams: any[] = [];
  if (query) {
    pendingSql += ` AND name LIKE ?`;
    pendingParams.push(`%${query}%`);
  }
  const pending = db.getAllSync<LocalPendingSupplier>(pendingSql, pendingParams)
    .map(p => ({ ...p, isPending: true } as any));
    
  return [...pending, ...local].slice(0, limit);
}

export function getSupplierCache(id: number): LocalSupplier | null {
  return db.getFirstSync<LocalSupplier>(`SELECT * FROM suppliers_cache WHERE id = ?;`, [id]);
}

export function upsertSupplierCache(s: Supplier) {
  const is_active = s.is_active ? 1 : 0;
  const updated_at = new Date().toISOString();
  db.runSync(
    `INSERT INTO suppliers_cache (id, name, company, phone, email, balance, is_active, updated_at, profile_dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       company = excluded.company,
       phone = excluded.phone,
       email = excluded.email,
       balance = excluded.balance,
       is_active = excluded.is_active,
       updated_at = excluded.updated_at,
       profile_dirty = 0;`,
    [s.id, s.name, s.company ?? null, s.phone ?? null, s.email ?? null, s.balance, is_active, updated_at]
  );
}

export function updateSupplierProfileLocal(id: number, data: Partial<Supplier>) {
  const current = getSupplierCache(id);
  if (!current) throw new Error("المورد غير موجود محلياً");
  const updated_at = new Date().toISOString();
  db.runSync(
    `UPDATE suppliers_cache 
     SET name = ?, company = ?, phone = ?, email = ?, updated_at = ?, profile_dirty = 1
     WHERE id = ?;`,
    [data.name ?? current.name, data.company ?? current.company, data.phone ?? current.phone, data.email ?? current.email, updated_at, id]
  );
}

export function recordSupplierPaymentLocal(supplierId: number, amount: number, method: string = 'cash') {
  const id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();
  db.runSync(
    `INSERT INTO pending_supplier_payments (id, supplier_id, amount, method, client_created_at, synced)
     VALUES (?, ?, ?, ?, ?, 0);`,
    [id, supplierId, amount, method, client_created_at]
  );
  db.runSync(`UPDATE suppliers_cache SET balance = balance - ? WHERE id = ?;`, [amount, supplierId]);
  return id;
}

export function recordSupplierDebtLocal(supplierId: number, amount: number, notes: string | null) {
  const id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();
  db.runSync(
    `INSERT INTO pending_supplier_debts (id, supplier_id, amount, notes, client_created_at, synced)
     VALUES (?, ?, ?, ?, ?, 0);`,
    [id, supplierId, amount, notes, client_created_at]
  );
  db.runSync(`UPDATE suppliers_cache SET balance = balance + ? WHERE id = ?;`, [amount, supplierId]);
  return id;
}

export function recordNewSupplierLocal(data: { name: string, company?: string, phone?: string, email?: string }) {
  const local_id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();
  db.runSync(
    `INSERT INTO pending_new_suppliers (local_id, name, company, phone, email, client_created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0);`,
    [local_id, data.name, data.company ?? null, data.phone ?? null, data.email ?? null, client_created_at]
  );
  return local_id;
}

export function getPendingSupplierPayments(supplierId?: number): LocalPendingSupplierPayment[] {
  if (supplierId != null) {
    return db.getAllSync<LocalPendingSupplierPayment>(
      `SELECT * FROM pending_supplier_payments WHERE synced = 0 AND supplier_id = ? ORDER BY client_created_at DESC;`,
      [supplierId]
    );
  }
  return db.getAllSync<LocalPendingSupplierPayment>(`SELECT * FROM pending_supplier_payments WHERE synced = 0;`);
}

export function getPendingSupplierDebts(supplierId?: number): LocalPendingSupplierDebt[] {
  if (supplierId != null) {
    return db.getAllSync<LocalPendingSupplierDebt>(
      `SELECT * FROM pending_supplier_debts WHERE synced = 0 AND supplier_id = ? ORDER BY client_created_at DESC;`,
      [supplierId]
    );
  }
  return db.getAllSync<LocalPendingSupplierDebt>(`SELECT * FROM pending_supplier_debts WHERE synced = 0;`);
}

function getLastSupplierSync(): string | null {
  const row = db.getFirstSync<{ value: string }>(`SELECT value FROM sync_meta WHERE key = 'last_supplier_sync';`);
  return row?.value ?? null;
}

function setLastSupplierSync(value: string) {
  db.runSync(
    `INSERT INTO sync_meta (key, value) VALUES ('last_supplier_sync', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [value]
  );
}

export async function runSupplierSync() {
  // 1. Push new suppliers
  const pendingNew = db.getAllSync<LocalPendingSupplier>(`SELECT * FROM pending_new_suppliers WHERE synced = 0;`);
  let newSynced = 0;
  for (const pc of pendingNew) {
    try {
      await api.post('/suppliers/', {
        name: pc.name,
        company: pc.company,
        phone: pc.phone,
        email: pc.email,
      });
      db.runSync(`UPDATE pending_new_suppliers SET synced = 1 WHERE local_id = ?;`, [pc.local_id]);
      newSynced++;
    } catch (e) {
      // Ignore individually
    }
  }

  // 2. Push debts and payments
  const pendingPayments = getPendingSupplierPayments();
  const pendingDebts = getPendingSupplierDebts();
  
  if (pendingPayments.length > 0) {
    const result = await api.post('/sync/suppliers/payments/push', {
      payments: pendingPayments.map((p) => ({
        id: p.id,
        supplier_id: p.supplier_id,
        amount: p.amount,
        method: p.method,
        client_created_at: p.client_created_at,
      })),
    });
    if (result.data.accepted?.length > 0) {
      const placeholders = result.data.accepted.map(() => '?').join(',');
      db.runSync(`UPDATE pending_supplier_payments SET synced = 1 WHERE id IN (${placeholders});`, result.data.accepted);
    }
  }

  if (pendingDebts.length > 0) {
    const result = await api.post('/sync/suppliers/debts/push', {
      debts: pendingDebts.map((d) => ({
        id: d.id,
        supplier_id: d.supplier_id,
        amount: d.amount,
        notes: d.notes,
        client_created_at: d.client_created_at,
      })),
    });
    if (result.data.accepted?.length > 0) {
      const placeholders = result.data.accepted.map(() => '?').join(',');
      db.runSync(`UPDATE pending_supplier_debts SET synced = 1 WHERE id IN (${placeholders});`, result.data.accepted);
    }
  }

  // 3. Push profile updates
  const dirtyProfiles = db.getAllSync<LocalSupplier>(`SELECT * FROM suppliers_cache WHERE profile_dirty = 1;`);
  if (dirtyProfiles.length > 0) {
    const result = await api.post('/sync/suppliers/profile/push', {
      profiles: dirtyProfiles.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        phone: c.phone,
        email: c.email,
        updated_at: c.updated_at,
      })),
    });
    if (result.data.accepted?.length > 0) {
      const placeholders = result.data.accepted.map(() => '?').join(',');
      db.runSync(`UPDATE suppliers_cache SET profile_dirty = 0 WHERE id IN (${placeholders});`, result.data.accepted);
    }
  }

  // 4. Pull updates
  const since = getLastSupplierSync();
  const { data: pullResult } = await api.get('/sync/suppliers/pull', {
    params: { since: since ?? undefined },
  });

  for (const c of pullResult.suppliers) {
    upsertSupplierCache(c);
  }
  setLastSupplierSync(pullResult.server_time);

  return {
    newSuppliersPushed: newSynced,
    paymentsPushed: pendingPayments.length,
    debtsPushed: pendingDebts.length,
    profilesPushed: dirtyProfiles.length,
    pulled: pullResult.suppliers.length,
  };
}
