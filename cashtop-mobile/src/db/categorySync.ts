import * as Crypto from 'expo-crypto';
import db from './database';
import { api } from '../api/client';
import { Category } from '../types';

export type LocalCategory = {
  id: number;
  name: string;
  name_ar: string | null;
  color: string | null;
  icon: string | null;
  is_active: number;
  updated_at: string;
  profile_dirty: number;
};

export type LocalPendingCategory = {
  local_id: string;
  name: string;
  name_ar: string | null;
  color: string | null;
  icon: string | null;
  client_created_at: string;
  synced: number;
};

export function localCategoryToCategory(c: LocalCategory): Category {
  return {
    id: c.id,
    name: c.name,
    name_ar: c.name_ar || undefined,
    color: c.color || undefined,
    icon: c.icon || undefined,
    is_active: c.is_active === 1,
  };
}

export function initCategoryTables() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS categories_cache (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT,
      color TEXT,
      icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      profile_dirty INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_new_categories (
      local_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT,
      color TEXT,
      icon TEXT,
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function searchCategoriesCache(): Category[] {
  const local = db.getAllSync<LocalCategory>(`SELECT * FROM categories_cache WHERE is_active = 1 ORDER BY name ASC`).map(localCategoryToCategory);
  
  const pending = db.getAllSync<LocalPendingCategory>(`SELECT * FROM pending_new_categories WHERE synced = 0 ORDER BY client_created_at ASC`)
    .map(p => ({
      id: -1 * parseInt(p.local_id.substring(0, 8), 16),
      name: p.name,
      name_ar: p.name_ar || undefined,
      color: p.color || undefined,
      icon: p.icon || undefined,
      is_active: true,
      isPending: true
    } as Category & { isPending: true }));
    
  return [...local, ...pending]; // Keep standard categories first, then pending
}

export function getCategoryCache(id: number): LocalCategory | null {
  return db.getFirstSync<LocalCategory>(`SELECT * FROM categories_cache WHERE id = ?;`, [id]);
}

export function upsertCategoryCache(c: any) {
  const is_active = c.is_active === false ? 0 : 1;
  const updated_at = c.updated_at || new Date().toISOString();
  db.runSync(
    `INSERT INTO categories_cache (id, name, name_ar, color, icon, is_active, updated_at, profile_dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       name_ar = excluded.name_ar,
       color = excluded.color,
       icon = excluded.icon,
       is_active = excluded.is_active,
       updated_at = excluded.updated_at,
       profile_dirty = 0;`,
    [c.id, c.name, c.name_ar ?? null, c.color ?? null, c.icon ?? null, is_active, updated_at]
  );
}

export function updateCategoryProfileLocal(id: number, data: Partial<Category>) {
  const current = getCategoryCache(id);
  if (!current) throw new Error("الفئة غير موجودة محلياً");
  const updated_at = new Date().toISOString();
  db.runSync(
    `UPDATE categories_cache 
     SET name = ?, name_ar = ?, color = ?, icon = ?, updated_at = ?, profile_dirty = 1
     WHERE id = ?;`,
    [data.name ?? current.name, data.name_ar ?? current.name_ar, data.color ?? current.color, data.icon ?? current.icon, updated_at, id]
  );
}

export function recordNewCategoryLocal(data: { name: string, name_ar?: string, color?: string, icon?: string }) {
  const local_id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();
  db.runSync(
    `INSERT INTO pending_new_categories (local_id, name, name_ar, color, icon, client_created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0);`,
    [local_id, data.name, data.name_ar ?? null, data.color ?? null, data.icon ?? null, client_created_at]
  );
  return local_id;
}

function getLastCategorySync(): string | null {
  const row = db.getFirstSync<{ value: string }>(`SELECT value FROM sync_meta WHERE key = 'last_category_sync';`);
  return row?.value ?? null;
}

function setLastCategorySync(value: string) {
  db.runSync(
    `INSERT INTO sync_meta (key, value) VALUES ('last_category_sync', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [value]
  );
}

export async function runCategorySync() {
  // 1. Push new categories
  const pendingNew = db.getAllSync<LocalPendingCategory>(`SELECT * FROM pending_new_categories WHERE synced = 0;`);
  let newSynced = 0;
  for (const pc of pendingNew) {
    try {
      await api.post('/categories/', {
        name: pc.name,
        name_ar: pc.name_ar,
        color: pc.color,
        icon: pc.icon,
      });
      db.runSync(`UPDATE pending_new_categories SET synced = 1 WHERE local_id = ?;`, [pc.local_id]);
      newSynced++;
    } catch (e) {
      // Ignore individually
    }
  }

  // 2. Push profile updates
  const dirtyProfiles = db.getAllSync<LocalCategory>(`SELECT * FROM categories_cache WHERE profile_dirty = 1;`);
  if (dirtyProfiles.length > 0) {
    const result = await api.post('/sync/categories/profile/push', {
      profiles: dirtyProfiles.map((c) => ({
        id: c.id,
        name: c.name,
        name_ar: c.name_ar,
        color: c.color,
        icon: c.icon,
        updated_at: c.updated_at,
      })),
    });
    if (result.data.accepted?.length > 0) {
      const placeholders = result.data.accepted.map(() => '?').join(',');
      db.runSync(`UPDATE categories_cache SET profile_dirty = 0 WHERE id IN (${placeholders});`, result.data.accepted);
    }
  }

  // 3. Pull updates
  const since = getLastCategorySync();
  const { data: pullResult } = await api.get('/sync/categories/pull', {
    params: { since: since ?? undefined },
  });

  for (const c of pullResult.categories) {
    upsertCategoryCache(c);
  }
  setLastCategorySync(pullResult.server_time);

  return {
    newCategoriesPushed: newSynced,
    profilesPushed: dirtyProfiles.length,
    pulled: pullResult.categories.length,
  };
}
