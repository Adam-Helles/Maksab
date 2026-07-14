// src/api/sync.ts

import { api } from './client'; // عدّلنا الاستيراد ليتوافق مع تصدير client.ts

export async function pushDebts(storeId: string, records: any[]) {
  const response = await api.post('/sync/debts/push', {
    store_id: storeId,
    records: records.map((r) => ({
      id: r.id,
      customer_name: r.customer_name,
      amount: r.amount,
      updated_at: r.updated_at,
      is_deleted: !!r.is_deleted,
    })),
  });
  return response.data;
}

export async function pullDebts(storeId: string, since: string | null) {
  const response = await api.get('/sync/debts/pull', {
    params: { store_id: storeId, since: since ?? undefined },
  });
  return response.data;
}