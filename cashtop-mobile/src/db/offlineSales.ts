// src/db/offlineSales.ts
//
// تخزين محلي لعمليات "بيع بالآجل" اللي تصير والجهاز أوفلاين، ومزامنتها
// لاحقاً مع /api/v1/sync/offline-sales/push. كل بيع = event مستقل
// (idempotent عبر id يتولّد بالجهاز)، مش رقم نهائي يستبدل شي.

import * as Crypto from 'expo-crypto';
import db from './database';
import { api } from '../api/client';
import { decrementCachedStock } from './productsCache';

export type LocalOfflineSaleItem = {
  product_id: number;
  quantity: number;
  unit_type: string;
  unit_price: number;
  pieces_per_carton: number; // للتحديث التفاؤلي للمخزون المحلي فقط — ما بينبعت للسيرفر
};

export type LocalOfflineSale = {
  id: string;
  customer_id: number;
  customer_name: string; // نسخة عرض محلية بس، مش مصدر حقيقة
  items: LocalOfflineSaleItem[];
  total: number;
  client_created_at: string;
  synced: number;
  needs_review: number;
  review_notes: string | null;
};

export function initOfflineSalesTable() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS pending_offline_sales (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      total REAL NOT NULL,
      client_created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_notes TEXT
    );
  `);
}

/**
 * تسجيل بيع بالآجل محلياً (الجهاز أوفلاين) + تحديث تفاؤلي فوري
 * لمخزون الكاش المحلي (تقديري بس — السيرفر هو مصدر الحقيقة النهائي
 * وقت المزامنة).
 */
export function recordOfflineSaleLocal(
  customerId: number,
  customerName: string,
  items: LocalOfflineSaleItem[],
  total: number
): string {
  const id = Crypto.randomUUID();
  const client_created_at = new Date().toISOString();

  db.runSync(
    `INSERT INTO pending_offline_sales
      (id, customer_id, customer_name, items_json, total, client_created_at, synced)
    VALUES (?, ?, ?, ?, ?, ?, 0);`,
    [id, customerId, customerName, JSON.stringify(items), total, client_created_at]
  );

  for (const item of items) {
    const qtyInPieces =
      item.unit_type === 'carton' ? item.quantity * item.pieces_per_carton : item.quantity;
    decrementCachedStock(item.product_id, qtyInPieces);
  }

  return id;
}

function rowToSale(r: any): LocalOfflineSale {
  return { ...r, items: JSON.parse(r.items_json) };
}

export function getPendingOfflineSales(): LocalOfflineSale[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM pending_offline_sales WHERE synced = 0 ORDER BY client_created_at ASC;`
  );
  return rows.map(rowToSale);
}

export function getPendingOfflineSalesCount(): number {
  const row = db.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) as c FROM pending_offline_sales WHERE synced = 0;`
  );
  return row?.c ?? 0;
}

export function getNeedsReviewOfflineSales(): LocalOfflineSale[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM pending_offline_sales WHERE needs_review = 1 ORDER BY client_created_at DESC;`
  );
  return rows.map(rowToSale);
}

function markOfflineSaleResult(id: string, needsReview: boolean, reviewNotes: string | null) {
  db.runSync(
    `UPDATE pending_offline_sales SET synced = 1, needs_review = ?, review_notes = ? WHERE id = ?;`,
    [needsReview ? 1 : 0, reviewNotes, id]
  );
}

/**
 * يبعت كل المبيعات الأوفلاين المعلّقة للسيرفر. لازم فيه نت. Idempotent
 * — إعادة الاستدعاء بعد فشل جزئي آمنة (السيرفر بيتجاهل أي id اتزامن قبل).
 */
export async function syncOfflineSales() {
  const pending = getPendingOfflineSales();
  if (pending.length === 0) {
    return { pushed: 0, needsReview: 0 };
  }

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      const { data } = await api.post('/sync/offline-sales/push', {
        sales: pending.map((s) => ({
          id: s.id,
          customer_id: s.customer_id,
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
          markOfflineSaleResult(result.id, result.needs_review, result.reason ?? null);
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