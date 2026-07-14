// src/db/customerSync.ts

import * as Crypto from 'expo-crypto';
import db from './database';
import { api } from '../api/client';

export type LocalCustomer = {
  id: number;
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number;
  current_debt: number;
  is_active: number;
  updated_at: string;
  profile_dirty: number;
};

export type LocalPendingPayment = {
  id: string;
  customer_id: number;
  amount: number;
  method: string;
  client_created_at: string;
  synced: number;
};

export function initCustomerTables() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS customers_cache (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      phone2 TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      credit_limit REAL NOT NULL DEFAULT 0,
      current_debt REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      profile_dirty INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_payments (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
}

// ── قراءة/تخزين محلي ─────────────────────────────────────────

export function upsertCustomerCache(c: {
  id: number; name: string; phone?: string | null; phone2?: string | null;
  email?: string | null; address?: string | null; notes?: string | null;
  credit_limit: number; current_debt: number; is_active: boolean; updated_at: string;
}) {
  db.runSync(
    `INSERT INTO customers_cache
       (id, name, phone, phone2, email, address, notes, credit_limit, current_debt, is_active, updated_at, profile_dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       phone = excluded.phone,
       phone2 = excluded.phone2,
       email = excluded.email,
       address = excluded.address,
       notes = excluded.notes,
       credit_limit = excluded.credit_limit,
       current_debt = excluded.current_debt,
       is_active = excluded.is_active,
       updated_at = excluded.updated_at,
       profile_dirty = 0;`,
    [
      c.id, c.name, c.phone ?? null, c.phone2 ?? null, c.email ?? null,
      c.address ?? null, c.notes ?? null, c.credit_limit, c.current_debt,
      c.is_active ? 1 : 0, c.updated_at,
    ]
  );
}

export function getCustomerCache(id: number): LocalCustomer | null {
  return (
    db.getFirstSync<LocalCustomer>(`SELECT * FROM customers_cache WHERE id = ?;`, [id]) ?? null
  );
}

// بحث محلي بالاسم أو الهاتف — يُستخدم لما التطبيق يكون أوفلاين
// (مثلاً بمودال اختيار العميل بشاشة POS)
export function searchCustomersCache(query: string, limit = 20): LocalCustomer[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return db.getAllSync<LocalCustomer>(
      `SELECT * FROM customers_cache WHERE is_active = 1 ORDER BY name ASC LIMIT ?;`,
      [limit]
    );
  }
  const q = `%${trimmed}%`;
  return db.getAllSync<LocalCustomer>(
    `SELECT * FROM customers_cache
     WHERE is_active = 1 AND (name LIKE ? OR phone LIKE ?)
     ORDER BY name ASC
     LIMIT ?;`,
    [q, q, limit]
  );
}

// تعديل بيانات وصفية محلياً (اسم/هاتف/عنوان...) — جاهزة لو عندك/رح تضيف شاشة تعديل
export function updateCustomerProfileLocal(
  id: number,
  fields: Partial<Pick<LocalCustomer, 'name' | 'phone' | 'phone2' | 'email' | 'address' | 'notes'>>
) {
  const updated_at = new Date().toISOString();
  const keys = Object.keys(fields);
  if (keys.length === 0) return;

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (fields as any)[k]);

  db.runSync(
    `UPDATE customers_cache SET ${setClause}, updated_at = ?, profile_dirty = 1 WHERE id = ?;`,
    [...values, updated_at, id]
  );
}

// ── تسجيل دفعة محلياً (event) + تحديث تفاؤلي فوري للرصيد ──────
export function recordPaymentLocal(customerId: number, amount: number, method = 'cash') {
  const id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();

  db.runSync(
    `INSERT INTO pending_payments (id, customer_id, amount, method, client_created_at, synced)
     VALUES (?, ?, ?, ?, ?, 0);`,
    [id, customerId, amount, method, client_created_at]
  );

  db.runSync(
    `UPDATE customers_cache SET current_debt = MAX(0, current_debt - ?) WHERE id = ?;`,
    [amount, customerId]
  );

  return id;
}

export function getPendingPayments(customerId?: number): LocalPendingPayment[] {
  if (customerId != null) {
    return db.getAllSync<LocalPendingPayment>(
      `SELECT * FROM pending_payments WHERE synced = 0 AND customer_id = ? ORDER BY client_created_at DESC;`,
      [customerId]
    );
  }
  return db.getAllSync<LocalPendingPayment>(`SELECT * FROM pending_payments WHERE synced = 0;`);
}

function getUnsyncedProfiles(): LocalCustomer[] {
  return db.getAllSync<LocalCustomer>(`SELECT * FROM customers_cache WHERE profile_dirty = 1;`);
}

function markProfilesSynced(ids: number[]) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`UPDATE customers_cache SET profile_dirty = 0 WHERE id IN (${placeholders});`, ids);
}

function markPaymentsSynced(ids: string[]) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`UPDATE pending_payments SET synced = 1 WHERE id IN (${placeholders});`, ids);
}

function getLastCustomerSync(): string | null {
  const row = db.getFirstSync<{ value: string }>(
    `SELECT value FROM sync_meta WHERE key = 'last_customer_sync';`
  );
  return row?.value ?? null;
}

function setLastCustomerSync(value: string) {
  db.runSync(
    `INSERT INTO sync_meta (key, value) VALUES ('last_customer_sync', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [value]
  );
}

// ── دورة المزامنة الكاملة: دفعات أولاً (فلوس) → بروفايل → سحب ──
export async function runCustomerSync() {
  const pendingPayments = getPendingPayments();
  if (pendingPayments.length > 0) {
    const result = await api.post('/sync/customers/payments/push', {
      payments: pendingPayments.map((p) => ({
        id: p.id,
        customer_id: p.customer_id,
        amount: p.amount,
        method: p.method,
        client_created_at: p.client_created_at,
      })),
    });
    markPaymentsSynced([...result.data.accepted, ...result.data.already_applied]);
  }

  const dirtyProfiles = getUnsyncedProfiles();
  if (dirtyProfiles.length > 0) {
    const result = await api.post('/sync/customers/profile/push', {
      profiles: dirtyProfiles.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        phone2: c.phone2,
        email: c.email,
        address: c.address,
        notes: c.notes,
        updated_at: c.updated_at,
      })),
    });
    markProfilesSynced(result.data.accepted);
  }

  const since = getLastCustomerSync();
  const { data: pullResult } = await api.get('/sync/customers/pull', {
    params: { since: since ?? undefined },
  });

  for (const c of pullResult.customers) {
    upsertCustomerCache(c);
  }
  setLastCustomerSync(pullResult.server_time);

  return {
    paymentsPushed: pendingPayments.length,
    profilesPushed: dirtyProfiles.length,
    pulled: pullResult.customers.length,
  };
}