// src/db/productsCache.ts
//
// كاش محلي للمنتجات — بنفس روح customers_cache. لازم يكون موجود قبل
// ما نقدر نبني بيع أوفلاين (بدونه التاجر ما بيقدر حتى يبحث عن منتج
// وهو مقطوع عن النت).

import db from './database';
import { productsApi } from '../api';
import type { Product } from '../types';

export type LocalProduct = {
  id: number;
  name: string;
  name_ar: string | null;
  barcode_piece: string | null;
  barcode_carton: string | null;
  retail_price: number;
  carton_price: number;
  cost_price: number;
  tax_rate: number;
  pieces_per_carton: number;
  stock_quantity: number;
  is_active: number;
  updated_at: string;
  profile_dirty: number;
};

export type LocalPendingProduct = {
  local_id: string;
  name: string;
  name_ar: string | null;
  barcode_piece: string | null;
  barcode_carton: string | null;
  retail_price: number;
  carton_price: number;
  cost_price: number;
  tax_rate: number;
  pieces_per_carton: number;
  stock_quantity: number;
  category_id: number | null;
  supplier_id: number | null;
  client_created_at: string;
  synced: number;
};

export function initProductsCache() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS products_cache (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT,
      barcode_piece TEXT,
      barcode_carton TEXT,
      retail_price REAL NOT NULL DEFAULT 0,
      carton_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      pieces_per_carton INTEGER NOT NULL DEFAULT 1,
      stock_quantity REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      profile_dirty INTEGER NOT NULL DEFAULT 0
    );
  `);

  try {
    db.execSync(`ALTER TABLE products_cache ADD COLUMN profile_dirty INTEGER NOT NULL DEFAULT 0;`);
  } catch (e) {
    // Column might already exist
  }

  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_new_products (
      local_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT,
      barcode_piece TEXT,
      barcode_carton TEXT,
      retail_price REAL NOT NULL DEFAULT 0,
      carton_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      pieces_per_carton INTEGER NOT NULL DEFAULT 1,
      stock_quantity REAL NOT NULL DEFAULT 0,
      category_id INTEGER,
      supplier_id INTEGER,
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function upsertProductCache(p: LocalProduct) {
  db.runSync(
    `INSERT INTO products_cache
       (id, name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price,
        cost_price, tax_rate, pieces_per_carton, stock_quantity, is_active, updated_at, profile_dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       name_ar = excluded.name_ar,
       barcode_piece = excluded.barcode_piece,
       barcode_carton = excluded.barcode_carton,
       retail_price = excluded.retail_price,
       carton_price = excluded.carton_price,
       cost_price = excluded.cost_price,
       tax_rate = excluded.tax_rate,
       pieces_per_carton = excluded.pieces_per_carton,
       stock_quantity = excluded.stock_quantity,
       is_active = excluded.is_active,
       updated_at = excluded.updated_at,
       profile_dirty = 0;`,
    [
      p.id, p.name, p.name_ar, p.barcode_piece, p.barcode_carton,
      p.retail_price, p.carton_price, p.cost_price, p.tax_rate,
      p.pieces_per_carton, p.stock_quantity, p.is_active, p.updated_at,
    ]
  );
}

// حد الباكيند الأقصى لكل صفحة (GET /products/ → limit: Query(50, ge=1, le=200)).
// لازم يطابق هاد الرقم بالضبط، وإلا كل طلب برجع 422.
const PAGE_SIZE = 200;

/**
 * يسحب كل المنتجات النشطة من السيرفر ويحدّث الكاش المحلي بالكامل.
 * لازم فيه نت. بينادى وقت فتح التطبيق (لو متصل) وبعد كل مزامنة ناجحة
 * عشان الكاش يضل قريب من الواقع.
 *
 * ⚠️ الباكيند بيحدد limit بحد أقصى 200 لكل طلب (raises 422 لو تجاوزناه)،
 * فمش ممكن نسحب كل شي بطلب وحد. بنعمل pagination حقيقي: نستمر نسحب
 * صفحات بحجم PAGE_SIZE (بزيادة skip) لحد ما نستلم صفحة عدد عناصرها
 * أقل من PAGE_SIZE — هاد معناه وصلنا لآخر صفحة. ما فيه حد أقصى لعدد
 * المنتجات الكلي (يشتغل صح لأي عدد).
 */
export async function refreshProductsCache(): Promise<number> {
  let skip = 0;
  let totalCached = 0;
  const now = new Date().toISOString();

  while (true) {
    const products = await productsApi.list({ skip, limit: PAGE_SIZE });

    for (const p of products) {
      upsertProductCache({
        id: p.id,
        name: p.name,
        name_ar: p.name_ar ?? null,
        barcode_piece: p.barcode_piece ?? null,
        barcode_carton: p.barcode_carton ?? null,
        retail_price: p.retail_price,
        carton_price: p.carton_price,
        cost_price: p.cost_price,
        tax_rate: p.tax_rate,
        pieces_per_carton: p.pieces_per_carton,
        stock_quantity: p.stock_quantity,
        is_active: p.is_active ? 1 : 0,
        updated_at: now,
        profile_dirty: 0,
      });
    }

    totalCached += products.length;

    // آخر صفحة: رجعت أقل من PAGE_SIZE (أو صفر)
    if (products.length < PAGE_SIZE) break;

    skip += PAGE_SIZE;
  }

  return totalCached;
}

export function searchProductsCache(query: string, limit = 8): (LocalProduct | (LocalPendingProduct & { isPending: true }))[] {
  const trimmed = query.trim();
  const q = `%${trimmed}%`;
  
  const local = db.getAllSync<LocalProduct>(
    `SELECT * FROM products_cache
     WHERE is_active = 1 AND (name LIKE ? OR name_ar LIKE ? OR barcode_piece = ? OR barcode_carton = ?)
     ORDER BY name ASC
     LIMIT ?;`,
    [q, q, trimmed, trimmed, limit]
  );

  // We should also search pending products for offline creation completeness
  const pending = db.getAllSync<LocalPendingProduct>(
    `SELECT * FROM pending_new_products
     WHERE synced = 0 AND (name LIKE ? OR name_ar LIKE ? OR barcode_piece = ? OR barcode_carton = ?)
     ORDER BY name ASC
     LIMIT ?;`,
    [q, q, trimmed, trimmed, limit]
  ).map(p => ({
    id: -1 * parseInt(p.local_id.substring(0, 8), 16),
    name: p.name,
    name_ar: p.name_ar,
    barcode_piece: p.barcode_piece,
    barcode_carton: p.barcode_carton,
    retail_price: p.retail_price,
    carton_price: p.carton_price,
    cost_price: p.cost_price,
    tax_rate: p.tax_rate,
    pieces_per_carton: p.pieces_per_carton,
    stock_quantity: p.stock_quantity,
    is_active: 1,
    updated_at: p.client_created_at,
    profile_dirty: 0,
    isPending: true
  } as LocalProduct & { isPending: true }));

  return [...local, ...pending].slice(0, limit);
}

/** تحديث تفاؤلي فوري للمخزون المحلي بعد بيع أوفلاين — تقديري بس، مش رسمي (السيرفر هو مصدر الحقيقة). */
export function decrementCachedStock(productId: number, qtyInPieces: number) {
  db.runSync(
    `UPDATE products_cache SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?;`,
    [qtyInPieces, productId]
  );
}

export function incrementCachedStock(productId: number, qtyInPieces: number) {
  db.runSync(
    `UPDATE products_cache SET stock_quantity = stock_quantity + ? WHERE id = ?;`,
    [qtyInPieces, productId]
  );
}

/**
 * يحوّل LocalProduct (كاش مبسّط) لشكل Product الكامل عشان يتوافق مع
 * أنواع cartStore/CartItem الموجودة. الحقول غير المخزّنة محلياً
 * (description, image_url, base_unit...) بتتعبى بقيم افتراضية آمنة —
 * مش معروضة أو مستخدمة فعلياً بشاشة POS.
 */
export function localProductToProduct(lp: LocalProduct): Product {
  return {
    id: lp.id,
    name: lp.name,
    name_ar: lp.name_ar ?? undefined,
    barcode_piece: lp.barcode_piece ?? undefined,
    barcode_carton: lp.barcode_carton ?? undefined,
    base_unit: 'piece',
    pieces_per_carton: lp.pieces_per_carton,
    cost_price: lp.cost_price,
    retail_price: lp.retail_price,
    wholesale_price: 0,
    carton_price: lp.carton_price,
    piece_price_from_carton:
      lp.pieces_per_carton > 0 ? Math.round((lp.carton_price / lp.pieces_per_carton) * 1000) / 1000 : 0,
    stock_quantity: lp.stock_quantity,
    stock_in_cartons: lp.pieces_per_carton > 0 ? lp.stock_quantity / lp.pieces_per_carton : 0,
    min_stock_alert: 0,
    is_low_stock: false,
    profit_margin: 0,
    has_expiry: false,
    category_id: undefined,
    supplier_id: undefined,
    tax_rate: lp.tax_rate,
    is_active: !!lp.is_active,
    is_featured: false,
    created_at: lp.updated_at,
  };
}

import * as Crypto from 'expo-crypto';

export function getProductCache(id: number): LocalProduct | null {
  return db.getFirstSync<LocalProduct>(`SELECT * FROM products_cache WHERE id = ?;`, [id]);
}

export function recordNewProductLocal(data: Partial<LocalPendingProduct>) {
  const local_id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();
  db.runSync(
    `INSERT INTO pending_new_products (local_id, name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price, cost_price, tax_rate, pieces_per_carton, stock_quantity, category_id, supplier_id, client_created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);`,
    [
      local_id, data.name || '', data.name_ar ?? null, data.barcode_piece ?? null, data.barcode_carton ?? null,
      data.retail_price ?? 0, data.carton_price ?? 0, data.cost_price ?? 0, data.tax_rate ?? 0,
      data.pieces_per_carton ?? 1, data.stock_quantity ?? 0, data.category_id ?? null, data.supplier_id ?? null,
      client_created_at
    ]
  );
  return local_id;
}

export function updateProductLocal(id: number, data: Partial<LocalProduct>) {
  const current = getProductCache(id);
  if (!current) throw new Error("المنتج غير موجود محلياً");
  const updated_at = new Date().toISOString();
  
  // Get non-null values if not provided
  const name = data.name !== undefined ? data.name : current.name;
  const name_ar = data.name_ar !== undefined ? data.name_ar : current.name_ar;
  const barcode_piece = data.barcode_piece !== undefined ? data.barcode_piece : current.barcode_piece;
  const barcode_carton = data.barcode_carton !== undefined ? data.barcode_carton : current.barcode_carton;
  const retail_price = data.retail_price !== undefined ? data.retail_price : current.retail_price;
  const carton_price = data.carton_price !== undefined ? data.carton_price : current.carton_price;
  const cost_price = data.cost_price !== undefined ? data.cost_price : current.cost_price;
  const tax_rate = data.tax_rate !== undefined ? data.tax_rate : current.tax_rate;
  const pieces_per_carton = data.pieces_per_carton !== undefined ? data.pieces_per_carton : current.pieces_per_carton;
  const stock_quantity = data.stock_quantity !== undefined ? data.stock_quantity : current.stock_quantity;
  const is_active = data.is_active !== undefined ? data.is_active : current.is_active;

  db.runSync(
    `UPDATE products_cache 
     SET name = ?, name_ar = ?, barcode_piece = ?, barcode_carton = ?, retail_price = ?, carton_price = ?, cost_price = ?, tax_rate = ?, pieces_per_carton = ?, stock_quantity = ?, is_active = ?, updated_at = ?, profile_dirty = 1
     WHERE id = ?;`,
    [
      name, name_ar, barcode_piece, barcode_carton,
      retail_price, carton_price, cost_price, tax_rate,
      pieces_per_carton, stock_quantity, is_active, updated_at, id
    ]
  );
}

import { api } from '../api/client';

export async function runProductSync() {
  // 1. Push new products
  const pendingNew = db.getAllSync<LocalPendingProduct>(`SELECT * FROM pending_new_products WHERE synced = 0;`);
  let newSynced = 0;
  for (const pp of pendingNew) {
    try {
      await productsApi.create({
        name: pp.name,
        name_ar: pp.name_ar || undefined,
        barcode_piece: pp.barcode_piece || undefined,
        barcode_carton: pp.barcode_carton || undefined,
        retail_price: pp.retail_price,
        carton_price: pp.carton_price,
        cost_price: pp.cost_price,
        tax_rate: pp.tax_rate,
        pieces_per_carton: pp.pieces_per_carton,
        stock_quantity: pp.stock_quantity,
        category_id: pp.category_id || undefined,
        supplier_id: pp.supplier_id || undefined,
        base_unit: 'piece',
      } as any);
      db.runSync(`UPDATE pending_new_products SET synced = 1 WHERE local_id = ?;`, [pp.local_id]);
      newSynced++;
    } catch (e) {
      // Ignore individually
    }
  }

  // 2. Push profile updates
  const dirtyProfiles = db.getAllSync<LocalProduct>(`SELECT * FROM products_cache WHERE profile_dirty = 1;`);
  if (dirtyProfiles.length > 0) {
    try {
      const result = await api.post('/sync/products/profile/push', {
        profiles: dirtyProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          name_ar: p.name_ar,
          barcode_piece: p.barcode_piece,
          barcode_carton: p.barcode_carton,
          retail_price: p.retail_price,
          carton_price: p.carton_price,
          cost_price: p.cost_price,
          tax_rate: p.tax_rate,
          pieces_per_carton: p.pieces_per_carton,
          stock_quantity: p.stock_quantity,
          is_active: p.is_active === 1,
          updated_at: p.updated_at,
        })),
      });
      if (result.data.accepted?.length > 0) {
        const placeholders = result.data.accepted.map(() => '?').join(',');
        db.runSync(`UPDATE products_cache SET profile_dirty = 0 WHERE id IN (${placeholders});`, result.data.accepted);
      }
    } catch (e) {}
  }

  // 3. Pull updates is already handled by refreshProductsCache() but we call it here to sync down
  const pulled = await refreshProductsCache();

  return {
    newProductsPushed: newSynced,
    profilesPushed: dirtyProfiles.length,
    pulled: pulled,
  };
}