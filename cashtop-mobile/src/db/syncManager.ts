// src/db/syncManager.ts
//
// محرك المزامنة الذكي (Incremental Sync Engine)
// ══════════════════════════════════════════════════════════
// المبدأ الأساسي:
//   1. push: ارفع كل التغييرات المحلية غير المتزامنة (sync_status != 'synced')
//   2. pull: اسحب كل التغييرات من السيرفر منذ آخر مزامنة (last_pulled_at)
//   3. حدّث sync_meta.last_pulled_at بتاريخ استجابة السيرفر
//
// لا يمسّ هذا الملف أي state خارجي — يعمل بالكامل على SQLite.

import { api } from '../api/client';
import {
  getLastSyncTime, setLastSyncTime,
  getPendingCustomers, getPendingProducts, getPendingInvoices,
  getPendingDebtPayments, getPendingInvoiceItemsForInvoice,
  markSynced,
  upsertCustomer, upsertProduct, upsertInvoice, upsertInvoiceItem,
  upsertCategory, upsertSupplier,
  LocalCustomer, LocalProduct, LocalInvoice, LocalInvoiceItem,
  LocalCategory, LocalSupplier,
  runInTransaction,
} from './database';

// ── Pull: اسحب التغييرات من السيرفر ─────────────────────────

async function pullServerChanges() {
  const since = getLastSyncTime();
  const params: any = {};
  if (since) params.since = since;

  const { data } = await api.get('/sync/pull', { params });

  let count = 0;

  runInTransaction(() => {
    // عملاء
    for (const c of (data.customers || [])) {
      upsertCustomer({
        id: c.id,
        name: c.name,
        phone: c.phone || null,
        phone2: c.phone2 || null,
        email: c.email || null,
        address: c.address || null,
        notes: c.notes || null,
        credit_limit: c.credit_limit ?? 0,
        current_debt: c.current_debt ?? 0,
        is_active: c.is_active ? 1 : 0,
        created_at: c.created_at,
        updated_at: c.updated_at,
        deleted_at: c.deleted_at || null,
        sync_status: 'synced',
      });
      count++;
    }

    // منتجات
    for (const p of (data.products || [])) {
      upsertProduct({
        id: p.id,
        name: p.name,
        name_ar: p.name_ar || null,
        barcode_piece: p.barcode_piece || null,
        barcode_carton: p.barcode_carton || null,
        retail_price: p.retail_price ?? 0,
        carton_price: p.carton_price ?? 0,
        cost_price: p.cost_price ?? 0,
        tax_rate: p.tax_rate ?? 0,
        pieces_per_carton: p.pieces_per_carton ?? 1,
        stock_quantity: p.stock_quantity ?? 0,
        category_id: p.category_id || null,
        supplier_id: p.supplier_id || null,
        is_active: p.is_active ? 1 : 0,
        created_at: p.created_at,
        updated_at: p.updated_at,
        deleted_at: p.deleted_at || null,
        sync_status: 'synced',
      });
      count++;
    }

    // فواتير
    for (const inv of (data.invoices || [])) {
      upsertInvoice({
        id: inv.id,
        invoice_number: inv.invoice_number || null,
        invoice_type: inv.invoice_type || 'sale',
        status: inv.status || 'completed',
        payment_method: inv.payment_method || 'cash',
        payment_status: inv.payment_status || 'paid',
        customer_id: inv.customer_id || null,
        customer_name: inv.customer_name || null,
        supplier_id: inv.supplier_id || null,
        subtotal: inv.subtotal ?? 0,
        discount_amount: inv.discount_amount ?? 0,
        tax_amount: inv.tax_amount ?? 0,
        total: inv.total ?? 0,
        paid_amount: inv.paid_amount ?? 0,
        remaining_amount: inv.remaining_amount ?? 0,
        notes: inv.notes || null,
        created_at: inv.created_at,
        updated_at: inv.updated_at,
        sync_status: 'synced',
      });
      count++;
    }

    // بنود الفواتير
    for (const item of (data.invoice_items || [])) {
      upsertInvoiceItem({
        id: item.id,
        invoice_id: item.invoice_id,
        product_id: item.product_id,
        product_name: item.product_name || null,
        quantity: item.quantity,
        unit_type: item.unit_type || 'piece',
        unit_price: item.unit_price,
        cost_price: item.cost_price ?? 0,
        pieces_per_carton: item.pieces_per_carton ?? 1,
        total: item.total,
      });
      count++;
    }

    // تصنيفات
    for (const cat of (data.categories || [])) {
      upsertCategory({
        id: cat.id,
        name: cat.name,
        created_at: cat.created_at,
        updated_at: cat.updated_at,
        sync_status: 'synced',
      });
      count++;
    }

    // موردون
    for (const sup of (data.suppliers || [])) {
      upsertSupplier({
        id: sup.id,
        name: sup.name,
        phone: sup.phone || null,
        address: sup.address || null,
        notes: sup.notes || null,
        current_balance: sup.current_balance ?? 0,
        created_at: sup.created_at,
        updated_at: sup.updated_at,
        sync_status: 'synced',
      });
      count++;
    }

    // حفظ وقت آخر مزامنة
    if (data.server_time) {
      setLastSyncTime(data.server_time);
    }
  });

  return { count };
}

// ── Mappers: تحويل الكائنات المحلية لشكل API ─────────────────

function mapCustomerForPush(c: LocalCustomer) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    phone2: c.phone2,
    email: c.email,
    address: c.address,
    notes: c.notes,
    credit_limit: c.credit_limit,
    current_debt: c.current_debt,
    is_active: c.is_active === 1,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function mapProductForPush(p: LocalProduct) {
  return {
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
    category_id: p.category_id,
    supplier_id: p.supplier_id,
    is_active: p.is_active === 1,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function mapInvoiceForPush(inv: LocalInvoice) {
  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    invoice_type: inv.invoice_type,
    status: inv.status,
    payment_method: inv.payment_method,
    payment_status: inv.payment_status,
    customer_id: inv.customer_id,
    supplier_id: inv.supplier_id,
    subtotal: inv.subtotal,
    discount_amount: inv.discount_amount,
    tax_amount: inv.tax_amount,
    total: inv.total,
    paid_amount: inv.paid_amount,
    remaining_amount: inv.remaining_amount,
    notes: inv.notes,
    created_at: inv.created_at,
    updated_at: inv.updated_at,
  };
}

function mapInvoiceItemForPush(item: LocalInvoiceItem) {
  return {
    id: item.id,
    invoice_id: item.invoice_id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_type: item.unit_type,
    unit_price: item.unit_price,
    cost_price: item.cost_price,
    pieces_per_carton: item.pieces_per_carton,
    total: item.total,
  };
}

function mapPaymentForPush(p: any) {
  return {
    id: p.id,
    customer_id: p.customer_id,
    amount: p.amount,
    method: p.method,
    notes: p.notes,
    created_at: p.created_at,
    updated_at: p.created_at,
  };
}

// ── Push: ارفع التغييرات المحلية للسيرفر ─────────────────────

async function pushLocalChanges() {
  const customers = getPendingCustomers();
  const products = getPendingProducts();
  const invoices = getPendingInvoices();
  const payments = getPendingDebtPayments();

  // بناء invoice_items من الفواتير المعلقة
  const invoiceItems: any[] = [];
  for (const inv of invoices) {
    const items = getPendingInvoiceItemsForInvoice(inv.id);
    for (const item of items) {
      invoiceItems.push(mapInvoiceItemForPush(item));
    }
  }

  const hasChanges =
    customers.length > 0 ||
    products.length > 0 ||
    invoices.length > 0 ||
    payments.length > 0;

  if (!hasChanges) return { pushed: 0 };

  const { data } = await api.post('/sync/push', {
    customers: customers.map(mapCustomerForPush),
    products: products.map(mapProductForPush),
    invoices: invoices.map(mapInvoiceForPush),
    invoice_items: invoiceItems,
    payments: payments.map(mapPaymentForPush),
  });

  // بعد قبول السيرفر، نعلّم كل عنصر على أنه synced
  const accepted: string[] = data.accepted || [];

  for (const c of customers) {
    if (accepted.includes(c.id)) markSynced('customers', c.id);
  }
  for (const p of products) {
    if (accepted.includes(p.id)) markSynced('products', p.id);
  }
  for (const inv of invoices) {
    if (accepted.includes(inv.id)) markSynced('invoices', inv.id);
  }
  for (const pay of payments) {
    if (accepted.includes(pay.id)) markSynced('debt_payments', pay.id);
  }

  return { pushed: accepted.length };
}

// ── syncAll: الدالة الرئيسية للمزامنة الكاملة ────────────────

export async function syncAll(): Promise<{ pushed: number; pulled: number; error?: string }> {
  try {
    // 1. ارفع التغييرات المحلية أولاً
    const { pushed } = await pushLocalChanges();

    // 2. اسحب التغييرات من السيرفر
    const { count: pulled } = await pullServerChanges();

    return { pushed, pulled };
  } catch (error: any) {
    console.error('[SyncManager] Sync failed:', error?.message || error);
    return { pushed: 0, pulled: 0, error: error?.message || 'Unknown sync error' };
  }
}

// Alias للتوافق مع جميع الشاشات التي تستخدم runFullSync
export const runFullSync = syncAll;

