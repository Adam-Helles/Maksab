// src/db/offlinePurchases.ts
//
// تخزين محلي لعمليات "بيع بالآجل" اللي تصير والجهاز أوفلاين، ومزامنتها
// لاحقاً مع /api/v1/sync/offline-Purchases/push. كل بيع = event مستقل
// (idempotent عبر id يتولّد بالجهاز)، مش رقم نهائي يستبدل شي.

import * as Crypto from 'expo-crypto';
import db from './database';
import { api } from '../api/client';
import { incrementCachedStock } from './productsCache';

export type LocalOfflinePurchaseItem = {
  product_id: number;
  quantity: number;
  unit_type: string;
  unit_price: number;
  pieces_per_carton: number; // للتحديث التفاؤلي للمخزون المحلي فقط — ما بينبعت للسيرفر
};

export type LocalOfflinePurchase = {
  id: string;
  Supplier_id: number | null;
  Supplier_name: string | null; // نسخة عرض محلية بس، مش مصدر حقيقة
  payment_method: string;
  items: LocalOfflinePurchaseItem[];
  total: number;
  client_created_at: string;
  synced: number;
  needs_review: number;
  review_notes: string | null;
};

export function initOfflinePurchasesTable() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_offline_Purchases (
      id TEXT PRIMARY KEY NOT NULL,
      Supplier_id INTEGER,
      Supplier_name TEXT,
      items_json TEXT NOT NULL,
      total REAL NOT NULL,
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_notes TEXT,
      payment_method TEXT NOT NULL DEFAULT 'credit'
    );
  `);
  // ترقية الجدول القديم إذا لم يكن يحتوي على payment_method
  try {
    db.execSync(`ALTER TABLE pending_offline_Purchases ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'credit';`);
  } catch (e) {
    // العمود موجود مسبقاً (الخطأ متوقع)
  }
}

/**
 * تسجيل بيع بالآجل محلياً (الجهاز أوفلاين) + تحديث تفاؤلي فوري
 * لمخزون الكاش المحلي (تقديري بس — السيرفر هو مصدر الحقيقة النهائي
 * وقت المزامنة).
 */
export function recordOfflinePurchaseLocal(
  SupplierId: number | null,
  SupplierName: string | null,
  items: LocalOfflinePurchaseItem[],
  total: number,
  paymentMethod: string = 'credit'
): string {
  const id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();

  db.runSync(
    `INSERT INTO pending_offline_Purchases
      (id, Supplier_id, Supplier_name, items_json, total, client_created_at, synced, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?);`,
    [id, SupplierId, SupplierName, JSON.stringify(items), total, client_created_at, paymentMethod]
  );

  for (const item of items) {
    const qtyInPieces =
      item.unit_type === 'carton' ? item.quantity * item.pieces_per_carton : item.quantity;
    incrementCachedStock(item.product_id, qtyInPieces);
  }

  return id;
}

function rowToPurchase(r: any): LocalOfflinePurchase {
  return { ...r, items: JSON.parse(r.items_json) };
}

export function getPendingOfflinePurchases(): LocalOfflinePurchase[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM pending_offline_Purchases WHERE synced = 0 ORDER BY client_created_at ASC;`
  );
  return rows.map(rowToPurchase);
}

export function getPendingOfflinePurchasesCount(): number {
  const row = db.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) as c FROM pending_offline_Purchases WHERE synced = 0;`
  );
  return row?.c ?? 0;
}

export function getNeedsReviewOfflinePurchases(): LocalOfflinePurchase[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM pending_offline_Purchases WHERE needs_review = 1 ORDER BY client_created_at DESC;`
  );
  return rows.map(rowToPurchase);
}

function markOfflinePurchaseResult(id: string, needsReview: boolean, reviewNotes: string | null) {
  db.runSync(
    `UPDATE pending_offline_Purchases SET synced = 1, needs_review = ?, review_notes = ? WHERE id = ?;`,
    [needsReview ? 1 : 0, reviewNotes, id]
  );
}

/**
 * يبعت كل المبيعات الأوفلاين المعلّقة للسيرفر. لازم فيه نت. Idempotent
 * — إعادة الاستدعاء بعد فشل جزئي آمنة (السيرفر بيتجاهل أي id اتزامن قبل).
 */
export async function syncOfflinePurchases() {
  const pending = getPendingOfflinePurchases();
  if (pending.length === 0) {
    return { pushed: 0, needsReview: 0 };
  }

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      console.log(`Pushing ${pending.length} offline Purchases...`);
      const { data } = await api.post('/sync/offline-Purchases/push', {
        Purchases: pending.map((s) => ({
          id: s.id,
          Supplier_id: s.Supplier_id,
          payment_method: s.payment_method,
          items: s.items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_type: i.unit_type,
            unit_price: i.unit_price,
          })),
          client_created_at: s.client_created_at,
        })),
      });

      let needsReviewCount = 0;
      for (const result of data.results as Array<{
        id: string; status: string; needs_review: boolean; reason: string | null;
      }>) {
        if (result.status === 'accepted' || result.status === 'already_applied') {
          markOfflinePurchaseResult(result.id, result.needs_review, result.reason ?? null);
          if (result.needs_review) needsReviewCount++;
        }
        // status === 'rejected' → منسيبها synced=0 قصداً، لتترجع للمراجعة اليدوية بدل ما تُفقد
      }

      return { pushed: pending.length, needsReview: needsReviewCount };
    } catch (e: any) {
      attempt++;
      // إذا كان الخطأ بسبب أن السيرفر لسه بيصحى من السكون (Render Cold Start)
      if (e?.message?.startsWith('⏳') && attempt < maxAttempts) {
        // ننتظر 10 ثواني ثم نحاول مرة تانية
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }
      // إذا استنفدنا المحاولات أو كان الخطأ لسبب آخر، نرميه
      throw e;
    }
  }

  return { pushed: 0, needsReview: 0 };
}
