import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

// تهيئة قاعدة البيانات
const db = SQLite.openDatabaseSync('cashtop.db');

export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';

export type LocalCustomer = {
  id: string; // UUID
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number;
  current_debt: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type LocalProduct = {
  id: string;
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
  category_id: string | null;
  supplier_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type LocalInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_type: 'sale' | 'purchase';
  status: string;
  payment_method: 'cash' | 'card' | 'transfer' | 'credit';
  payment_status: string;
  customer_id: string | null;
  customer_name: string | null;
  supplier_id: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  remaining_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type LocalInvoiceItem = {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name: string | null;
  quantity: number;
  unit_type: string;
  unit_price: number;
  cost_price: number;
  pieces_per_carton: number;
  total: number;
};

export type LocalCategory = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type LocalSupplier = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  current_balance: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type LocalDebtPayment = {
  id: string;
  customer_id: string;
  amount: number;
  method: string;
  notes: string | null;
  created_at: string;
  sync_status: SyncStatus;
};

// ----------------------------------------------------------------------
// Transaction Wrapper
// ----------------------------------------------------------------------

export function runInTransaction<T>(callback: () => T): T {
  return db.withTransactionSync(callback);
}

// تهيئة قاعدة البيانات وإنشاء الجداول
export function initDatabase() {
  db.execSync(`
    -- Customers
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      phone2 TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      credit_limit REAL NOT NULL DEFAULT 0,
      current_debt REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    -- Products
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
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
      category_id TEXT,
      supplier_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    -- Categories
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    -- Suppliers
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      current_balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    -- Invoices (local copy of all sales/purchases)
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      invoice_number TEXT,
      invoice_type TEXT NOT NULL DEFAULT 'sale',
      status TEXT NOT NULL DEFAULT 'completed',
      payment_method TEXT NOT NULL DEFAULT 'cash',
      payment_status TEXT NOT NULL DEFAULT 'paid',
      customer_id TEXT,
      customer_name TEXT,
      supplier_id TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      remaining_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
    );

    -- Invoice Items
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY NOT NULL,
      invoice_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT,
      quantity REAL NOT NULL,
      unit_type TEXT NOT NULL DEFAULT 'piece',
      unit_price REAL NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      pieces_per_carton INTEGER NOT NULL DEFAULT 1,
      total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    -- Debt Payments
    CREATE TABLE IF NOT EXISTS debt_payments (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      notes TEXT,
      created_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
    );

    -- Sync metadata
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    -- Indexes (For Performance with large databases)
    CREATE INDEX IF NOT EXISTS idx_products_barcode_piece ON products(barcode_piece);
    CREATE INDEX IF NOT EXISTS idx_products_barcode_carton ON products(barcode_carton);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  `);

  // Migration from old tables
  try {
    const hasCustomersCache = db.getFirstSync<{1: number}>("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers_cache'");
    if (hasCustomersCache) {
      db.execSync(`
        INSERT OR IGNORE INTO customers (id, name, phone, email, address, credit_limit, current_debt, created_at, updated_at, sync_status)
        SELECT CAST(id AS TEXT), name, phone, email, address, IFNULL(credit_limit, 0), IFNULL(current_debt, 0), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'synced'
        FROM customers_cache;
      `);
    }
  } catch (err) {
    console.log("خطأ في نقل بيانات العملاء:", err);
  }

  try {
    const hasProductsCache = db.getFirstSync<{1: number}>("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products_cache'");
    if (hasProductsCache) {
      db.execSync(`
        INSERT OR IGNORE INTO products (id, name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price, cost_price, stock_quantity, created_at, updated_at, sync_status)
        SELECT CAST(id AS TEXT), name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price, cost_price, stock_quantity, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'synced'
        FROM products_cache;
      `);
    }
  } catch (err) {
    console.log("خطأ في نقل بيانات المنتجات:", err);
  }

  try {
    const hasPendingOfflineSales = db.getFirstSync<{1: number}>("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_offline_sales'");
    if (hasPendingOfflineSales) {
      // Basic migration assuming pending_offline_sales had some basic fields
      // This might fail if schema is vastly different, hence the try/catch
      db.execSync(`
        INSERT OR IGNORE INTO invoices (id, total, created_at, updated_at, sync_status)
        SELECT CAST(id AS TEXT), total, created_at, CURRENT_TIMESTAMP, 'pending_create'
        FROM pending_offline_sales;
      `);
    }
  } catch (err) {
    console.log("خطأ في نقل بيانات المبيعات غير المتصلة:", err);
  }
}

// ----------------------------------------------------------------------
// CRUD Helpers - Customers
// ----------------------------------------------------------------------

export function getAllCustomers(includeDeleted = false): LocalCustomer[] {
  let query = 'SELECT * FROM customers';
  if (!includeDeleted) {
    query += ' WHERE deleted_at IS NULL';
  }
  return db.getAllSync<LocalCustomer>(query);
}

export function searchCustomers(query: string, limit = 50): LocalCustomer[] {
  return db.getAllSync<LocalCustomer>(
    'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? LIMIT ?',
    `%${query}%`, `%${query}%`, limit
  );
}

export function getCustomerById(id: string): LocalCustomer | null {
  return db.getFirstSync<LocalCustomer>('SELECT * FROM customers WHERE id = ?', id);
}

export function upsertCustomer(data: Partial<LocalCustomer> & { id: string }): void {
  const existing = getCustomerById(data.id);
  const now = new Date().toISOString();
  
  if (existing) {
    const updated = { ...existing, ...data, updated_at: now };
    db.runSync(
      `UPDATE customers SET 
        name = ?, phone = ?, phone2 = ?, email = ?, address = ?, notes = ?,
        credit_limit = ?, current_debt = ?, is_active = ?, updated_at = ?, deleted_at = ?, sync_status = ?
      WHERE id = ?`,
      updated.name, updated.phone, updated.phone2, updated.email, updated.address, updated.notes,
      updated.credit_limit, updated.current_debt, updated.is_active, updated.updated_at, updated.deleted_at, updated.sync_status,
      updated.id
    );
  } else {
    db.runSync(
      `INSERT INTO customers (
        id, name, phone, phone2, email, address, notes, credit_limit, current_debt,
        is_active, created_at, updated_at, deleted_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.name || '', data.phone || null, data.phone2 || null, data.email || null,
      data.address || null, data.notes || null, data.credit_limit || 0, data.current_debt || 0,
      data.is_active !== undefined ? data.is_active : 1, data.created_at || now, now, data.deleted_at || null,
      data.sync_status || 'pending_create'
    );
  }
}

export function createLocalCustomer(data: Omit<LocalCustomer, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'deleted_at'>): LocalCustomer {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  
  const customer: LocalCustomer = {
    ...data,
    id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    sync_status: 'pending_create'
  };
  
  upsertCustomer(customer);
  return customer;
}

export function updateCustomerDebt(customerId: string, debtDelta: number): void {
  db.runSync(
    'UPDATE customers SET current_debt = current_debt + ?, updated_at = ? WHERE id = ?',
    debtDelta, new Date().toISOString(), customerId
  );
}

// ----------------------------------------------------------------------
// CRUD Helpers - Products
// ----------------------------------------------------------------------

export function getAllProducts(includeInactive = false): LocalProduct[] {
  let query = 'SELECT * FROM products';
  if (!includeInactive) {
    query += ' WHERE is_active = 1 AND deleted_at IS NULL';
  }
  return db.getAllSync<LocalProduct>(query);
}

export function searchProducts(query: string, limit = 50): LocalProduct[] {
  return db.getAllSync<LocalProduct>(
    'SELECT * FROM products WHERE name LIKE ? OR barcode_piece LIKE ? OR barcode_carton LIKE ? LIMIT ?',
    `%${query}%`, `%${query}%`, `%${query}%`, limit
  );
}

export function getProductById(id: string): LocalProduct | null {
  return db.getFirstSync<LocalProduct>('SELECT * FROM products WHERE id = ?', id);
}

export function getProductByBarcode(barcode: string): LocalProduct | null {
  return db.getFirstSync<LocalProduct>(
    'SELECT * FROM products WHERE barcode_piece = ? OR barcode_carton = ?',
    barcode, barcode
  );
}

export function upsertProduct(data: Partial<LocalProduct> & { id: string }): void {
  const existing = getProductById(data.id);
  const now = new Date().toISOString();
  
  if (existing) {
    const updated = { ...existing, ...data, updated_at: now };
    db.runSync(
      `UPDATE products SET 
        name = ?, name_ar = ?, barcode_piece = ?, barcode_carton = ?, retail_price = ?,
        carton_price = ?, cost_price = ?, tax_rate = ?, pieces_per_carton = ?, stock_quantity = ?,
        category_id = ?, supplier_id = ?, is_active = ?, updated_at = ?, deleted_at = ?, sync_status = ?
      WHERE id = ?`,
      updated.name, updated.name_ar, updated.barcode_piece, updated.barcode_carton, updated.retail_price,
      updated.carton_price, updated.cost_price, updated.tax_rate, updated.pieces_per_carton, updated.stock_quantity,
      updated.category_id, updated.supplier_id, updated.is_active, updated.updated_at, updated.deleted_at, updated.sync_status,
      updated.id
    );
  } else {
    db.runSync(
      `INSERT INTO products (
        id, name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price,
        cost_price, tax_rate, pieces_per_carton, stock_quantity, category_id, supplier_id,
        is_active, created_at, updated_at, deleted_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.name || '', data.name_ar || null, data.barcode_piece || null, data.barcode_carton || null,
      data.retail_price || 0, data.carton_price || 0, data.cost_price || 0, data.tax_rate || 0,
      data.pieces_per_carton || 1, data.stock_quantity || 0, data.category_id || null, data.supplier_id || null,
      data.is_active !== undefined ? data.is_active : 1, data.created_at || now, now, data.deleted_at || null,
      data.sync_status || 'pending_create'
    );
  }
}

export function updateProductStock(productId: string, delta: number): void {
  db.runSync(
    'UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?',
    delta, new Date().toISOString(), productId
  );
}

// ----------------------------------------------------------------------
// CRUD Helpers - Invoices
// ----------------------------------------------------------------------

export function createLocalInvoice(
  invoiceData: Omit<LocalInvoice, 'id' | 'created_at' | 'updated_at' | 'sync_status'> & { sync_status?: string },
  itemsData: Omit<LocalInvoiceItem, 'id' | 'invoice_id'>[]
): string {
  const invoiceId = Crypto.randomUUID();
  const now = new Date().toISOString();

  const invoice: LocalInvoice = {
    ...invoiceData,
    id: invoiceId,
    created_at: now,
    updated_at: now,
    sync_status: invoiceData.sync_status || 'pending_create'
  };

  db.runSync(
    `INSERT INTO invoices (
      id, invoice_number, invoice_type, status, payment_method, payment_status,
      customer_id, customer_name, supplier_id, subtotal, discount_amount, tax_amount,
      total, paid_amount, remaining_amount, notes, created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    invoice.id, invoice.invoice_number, invoice.invoice_type, invoice.status, invoice.payment_method, invoice.payment_status,
    invoice.customer_id, invoice.customer_name, invoice.supplier_id, invoice.subtotal, invoice.discount_amount, invoice.tax_amount,
    invoice.total, invoice.paid_amount, invoice.remaining_amount, invoice.notes, invoice.created_at, invoice.updated_at, invoice.sync_status
  );

  for (const itemData of itemsData) {
    const itemId = Crypto.randomUUID();
    db.runSync(
      `INSERT INTO invoice_items (
        id, invoice_id, product_id, product_name, quantity, unit_type, unit_price, cost_price, pieces_per_carton, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      itemId, invoiceId, itemData.product_id, itemData.product_name, itemData.quantity, itemData.unit_type,
      itemData.unit_price, itemData.cost_price, itemData.pieces_per_carton, itemData.total
    );
  }

  return invoiceId;
}

export function getInvoiceItems(invoiceId: string): LocalInvoiceItem[] {
  return db.getAllSync<LocalInvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ?', invoiceId);
}

export function getInvoicesForCustomer(customerId: string): LocalInvoice[] {
  return db.getAllSync<LocalInvoice>('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC', customerId);
}

export function getAllInvoices(limit = 100): LocalInvoice[] {
  return db.getAllSync<LocalInvoice>('SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?', limit);
}

export function getInvoiceWithItems(invoiceId: string): { invoice: LocalInvoice, items: LocalInvoiceItem[] } | null {
  const invoice = db.getFirstSync<LocalInvoice>('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!invoice) return null;

  const items = db.getAllSync<LocalInvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ?', invoiceId);
  return { invoice, items };
}

export function upsertInvoice(data: Partial<LocalInvoice> & { id: string }): void {
  const existing = db.getFirstSync<LocalInvoice>('SELECT * FROM invoices WHERE id = ?', data.id);
  const now = new Date().toISOString();
  
  if (existing) {
    const updated = { ...existing, ...data, updated_at: now };
    db.runSync(
      `UPDATE invoices SET 
        invoice_number = ?, invoice_type = ?, status = ?, payment_method = ?, payment_status = ?,
        customer_id = ?, customer_name = ?, supplier_id = ?, subtotal = ?, discount_amount = ?,
        tax_amount = ?, total = ?, paid_amount = ?, remaining_amount = ?, notes = ?,
        updated_at = ?, sync_status = ?
      WHERE id = ?`,
      updated.invoice_number, updated.invoice_type, updated.status, updated.payment_method, updated.payment_status,
      updated.customer_id, updated.customer_name, updated.supplier_id, updated.subtotal, updated.discount_amount,
      updated.tax_amount, updated.total, updated.paid_amount, updated.remaining_amount, updated.notes,
      updated.updated_at, updated.sync_status, updated.id
    );
  } else {
    db.runSync(
      `INSERT INTO invoices (
        id, invoice_number, invoice_type, status, payment_method, payment_status,
        customer_id, customer_name, supplier_id, subtotal, discount_amount,
        tax_amount, total, paid_amount, remaining_amount, notes,
        created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.invoice_number || null, data.invoice_type || 'sale', data.status || 'completed',
      data.payment_method || 'cash', data.payment_status || 'paid', data.customer_id || null,
      data.customer_name || null, data.supplier_id || null, data.subtotal || 0, data.discount_amount || 0,
      data.tax_amount || 0, data.total || 0, data.paid_amount || 0, data.remaining_amount || 0,
      data.notes || null, data.created_at || now, now, data.sync_status || 'pending_create'
    );
  }
}

export function upsertInvoiceItem(data: Partial<LocalInvoiceItem> & { id: string }): void {
  const existing = db.getFirstSync<LocalInvoiceItem>('SELECT * FROM invoice_items WHERE id = ?', data.id);
  if (existing) {
    const updated = { ...existing, ...data };
    db.runSync(
      `UPDATE invoice_items SET 
        invoice_id = ?, product_id = ?, product_name = ?, quantity = ?, unit_type = ?,
        unit_price = ?, cost_price = ?, pieces_per_carton = ?, total = ?
      WHERE id = ?`,
      updated.invoice_id, updated.product_id, updated.product_name, updated.quantity, updated.unit_type,
      updated.unit_price, updated.cost_price, updated.pieces_per_carton, updated.total, updated.id
    );
  } else {
    db.runSync(
      `INSERT INTO invoice_items (
        id, invoice_id, product_id, product_name, quantity, unit_type,
        unit_price, cost_price, pieces_per_carton, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.invoice_id, data.product_id, data.product_name || null, data.quantity || 1,
      data.unit_type || 'piece', data.unit_price || 0, data.cost_price || 0, data.pieces_per_carton || 1,
      data.total || 0
    );
  }
}

// ----------------------------------------------------------------------
// CRUD Helpers - Categories & Suppliers
// ----------------------------------------------------------------------

export function getAllCategories(): LocalCategory[] {
  return db.getAllSync<LocalCategory>('SELECT * FROM categories');
}

export function upsertCategory(data: Partial<LocalCategory> & { id: string }): void {
  const existing = db.getFirstSync<LocalCategory>('SELECT * FROM categories WHERE id = ?', data.id);
  const now = new Date().toISOString();
  if (existing) {
    db.runSync('UPDATE categories SET name = ?, updated_at = ?, sync_status = ? WHERE id = ?',
      data.name || existing.name, now, data.sync_status || existing.sync_status, data.id);
  } else {
    db.runSync('INSERT INTO categories (id, name, created_at, updated_at, sync_status) VALUES (?, ?, ?, ?, ?)',
      data.id, data.name || '', data.created_at || now, now, data.sync_status || 'synced');
  }
}

export function getAllSuppliers(): LocalSupplier[] {
  return db.getAllSync<LocalSupplier>('SELECT * FROM suppliers');
}

export function upsertSupplier(data: Partial<LocalSupplier> & { id: string }): void {
  const existing = db.getFirstSync<LocalSupplier>('SELECT * FROM suppliers WHERE id = ?', data.id);
  const now = new Date().toISOString();
  if (existing) {
    db.runSync(
      `UPDATE suppliers SET 
        name = ?, phone = ?, address = ?, notes = ?, current_balance = ?, updated_at = ?, sync_status = ?
      WHERE id = ?`,
      data.name || existing.name, data.phone !== undefined ? data.phone : existing.phone,
      data.address !== undefined ? data.address : existing.address, data.notes !== undefined ? data.notes : existing.notes,
      data.current_balance !== undefined ? data.current_balance : existing.current_balance,
      now, data.sync_status || existing.sync_status, data.id
    );
  } else {
    db.runSync(
      `INSERT INTO suppliers (
        id, name, phone, address, notes, current_balance, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.name || '', data.phone || null, data.address || null, data.notes || null,
      data.current_balance || 0, data.created_at || now, now, data.sync_status || 'synced'
    );
  }
}

// ----------------------------------------------------------------------
// CRUD Helpers - Debt Payments
// ----------------------------------------------------------------------

export function createDebtPayment(data: Omit<LocalDebtPayment, 'id' | 'created_at' | 'sync_status'>): LocalDebtPayment {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  
  const payment: LocalDebtPayment = {
    ...data,
    id,
    created_at: now,
    sync_status: 'pending_create'
  };

  db.runSync(
    'INSERT INTO debt_payments (id, customer_id, amount, method, notes, created_at, sync_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    payment.id, payment.customer_id, payment.amount, payment.method, payment.notes || null, payment.created_at, payment.sync_status
  );

  return payment;
}

export function getPendingDebtPayments(): LocalDebtPayment[] {
  return db.getAllSync<LocalDebtPayment>("SELECT * FROM debt_payments WHERE sync_status != 'synced'");
}

// ----------------------------------------------------------------------
// Sync Meta
// ----------------------------------------------------------------------

export function getLastSyncTime(): string | null {
  const row = db.getFirstSync<{value: string}>("SELECT value FROM sync_meta WHERE key = 'last_sync'");
  return row ? row.value : null;
}

export function setLastSyncTime(time: string): void {
  db.runSync("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync', ?)", time);
}

// ----------------------------------------------------------------------
// Pending Records For Sync
// ----------------------------------------------------------------------

export function getPendingCustomers(): LocalCustomer[] {
  return db.getAllSync<LocalCustomer>("SELECT * FROM customers WHERE sync_status != 'synced'");
}

export function getPendingProducts(): LocalProduct[] {
  return db.getAllSync<LocalProduct>("SELECT * FROM products WHERE sync_status != 'synced'");
}

export function getPendingInvoices(): LocalInvoice[] {
  return db.getAllSync<LocalInvoice>("SELECT * FROM invoices WHERE sync_status != 'synced'");
}

export function getPendingInvoiceItemsForInvoice(invoiceId: string): LocalInvoiceItem[] {
  return db.getAllSync<LocalInvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ?', invoiceId);
}

// ----------------------------------------------------------------------
// Mark As Synced
// ----------------------------------------------------------------------

export function markSynced(table: 'customers' | 'products' | 'invoices' | 'debt_payments', id: string): void {
  db.runSync(`UPDATE ${table} SET sync_status = 'synced' WHERE id = ?`, id);
}

// ----------------------------------------------------------------------
// Dashboard Stats (Local Offline Computation)
// ----------------------------------------------------------------------

export function getDashboardStats(): any {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthIso = startOfMonth.toISOString();

  // اليوم
  const todayInvoices = db.getAllSync<LocalInvoice>('SELECT * FROM invoices WHERE status != "cancelled" AND created_at >= ?', todayIso);
  const todaySales = todayInvoices.filter(i => i.invoice_type === 'sale');
  
  const todayRevenue = todaySales.reduce((sum, inv) => sum + inv.total, 0);
  const todayCollected = todaySales.reduce((sum, inv) => sum + inv.paid_amount, 0);
  
  let todayCost = 0;
  for (const inv of todaySales) {
    const items = getInvoiceItems(inv.id);
    todayCost += items.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
  }
  const todayProfit = todayRevenue - todayCost;
  const todayMargin = todayRevenue > 0 ? (todayProfit / todayRevenue) * 100 : 0;

  // الشهر
  const monthInvoices = db.getAllSync<LocalInvoice>('SELECT * FROM invoices WHERE status != "cancelled" AND invoice_type = "sale" AND created_at >= ?', monthIso);
  const monthRevenue = monthInvoices.reduce((sum, inv) => sum + inv.total, 0);
  
  let monthCost = 0;
  for (const inv of monthInvoices) {
    const items = getInvoiceItems(inv.id);
    monthCost += items.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
  }
  const monthProfit = monthRevenue - monthCost;
  const monthMargin = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0;

  // المخزون والتنبيهات
  const products = getAllProducts(false);
  const totalProducts = products.length;
  let stockValue = 0;
  let lowStockCount = 0;
  let outStockCount = 0;
  
  for (const p of products) {
    stockValue += p.stock_quantity * p.cost_price;
    if (p.stock_quantity <= 0) outStockCount++;
    else if (p.stock_quantity <= 5) lowStockCount++;
  }

  // التنبيهات (مسودات، فواتير غير مدفوعة)
  const drafts = db.getFirstSync<{count: number}>('SELECT COUNT(*) as count FROM invoices WHERE status = "draft" AND invoice_type = "sale"');
  const unpaid = db.getFirstSync<{count: number}>('SELECT COUNT(*) as count FROM invoices WHERE payment_status != "paid" AND invoice_type = "sale"');

  // ديون
  const customers = getAllCustomers(false);
  const customersDebt = customers.reduce((sum, c) => sum + c.current_debt, 0);
  const suppliersDebt = 0; // إذا أردت حساب ديون الموردين مستقبلا

  // أعلى المنتجات
  // سنجلب آخر 100 فاتورة لتبسيط الحسبة المحلية
  const recentItems = db.getAllSync<LocalInvoiceItem>('SELECT product_name, total FROM invoice_items ORDER BY rowid DESC LIMIT 300');
  const productRevMap: Record<string, number> = {};
  for (const item of recentItems) {
    const name = item.product_name || 'غير معروف';
    productRevMap[name] = (productRevMap[name] || 0) + item.total;
  }
  const sortedProds = Object.entries(productRevMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topLabels = sortedProds.map(p => p[0]);
  const topRevs = sortedProds.map(p => p[1]);

  return {
    summary: {
      today: {
        count: todaySales.length,
        revenue: todayRevenue,
        collected: todayCollected,
        profit: todayProfit,
        margin: todayMargin,
        revenue_change_pct: 0, profit_change_pct: 0, orders_change_pct: 0
      },
      month: {
        count: monthInvoices.length,
        revenue: monthRevenue,
        profit: monthProfit,
        margin: monthMargin
      },
      inventory: {
        total_products: totalProducts,
        low_stock_count: lowStockCount,
        out_of_stock: outStockCount,
        stock_value: stockValue
      },
      finance: {
        total_customers: customers.length,
        customers_debt: customersDebt,
        suppliers_debt: suppliersDebt,
        net_receivable: customersDebt - suppliersDebt
      },
      alerts: {
        drafts: drafts?.count || 0,
        unpaid: unpaid?.count || 0,
        low_stock: lowStockCount,
        out_stock: outStockCount
      }
    },
    topProducts: {
      labels: topLabels,
      revenue: topRevs
    }
  };
}

export default db;
export { db };