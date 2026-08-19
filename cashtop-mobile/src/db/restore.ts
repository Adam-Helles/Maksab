import * as FileSystem from 'expo-file-system';
import { getDb, getStoreId } from './database';
import { runFullSync } from './syncManager';

export async function restoreLocalBackup(backupPath: string): Promise<void> {
  const db = getDb();
  let isAttached = false;
  let tempRestorePath = '';

  try {
    const storeId = getStoreId();
    if (!storeId) {
      throw new Error('NO_ACTIVE_TENANT: Cannot restore because no store is currently active.');
    }

    // 1. File Validation
    const fileInfo = await FileSystem.getInfoAsync(backupPath);
    if (!fileInfo.exists || fileInfo.isDirectory || fileInfo.size === 0) {
      throw new Error('INVALID_BACKUP_FILE: The selected backup file is missing or empty.');
    }

    // Create a temporary copy to work with safely
    tempRestorePath = (FileSystem as any).documentDirectory + 'SQLite/temp_restore_' + Date.now() + '.db';
    
    // Ensure the SQLite directory exists
    const sqliteDirInfo = await FileSystem.getInfoAsync((FileSystem as any).documentDirectory + 'SQLite/');
    if (!sqliteDirInfo.exists) {
      await FileSystem.makeDirectoryAsync((FileSystem as any).documentDirectory + 'SQLite/', { intermediates: true });
    }
    
    await FileSystem.copyAsync({ from: backupPath, to: tempRestorePath });

    const safePath = tempRestorePath.replace(/'/g, "''");

    // ATTACH
    db.execSync(`ATTACH DATABASE '${safePath}' AS backup_db;`);
    isAttached = true;

    // Integrity Check
    const integrityCheck = db.getFirstSync<{ integrity_check: string }>("PRAGMA backup_db.integrity_check;");
    if (integrityCheck?.integrity_check !== 'ok') {
      throw new Error('CORRUPT_BACKUP: Integrity check failed. Aborting restore.');
    }

    // Check required tables
    const requiredTables = [
      'sync_meta', 'products', 'customers', 'suppliers', 'categories',
      'invoices', 'invoice_items', 'debt_payments'
    ];
    
    for (const table of requiredTables) {
      const tableCheck = db.getFirstSync<{ count: number }>(`SELECT count(*) as count FROM backup_db.sqlite_master WHERE type='table' AND name='${table}';`);
      if (!tableCheck || tableCheck.count === 0) {
        throw new Error(`SCHEMA_MISMATCH: Required table '${table}' is missing from the backup.`);
      }
    }

    // 2. Tenant Validation
    const backupTenant = db.getFirstSync<{ value: string }>("SELECT value FROM backup_db.sync_meta WHERE key = 'store_id';");
    if (!backupTenant || !backupTenant.value) {
      throw new Error('MISSING_TENANT_ID: Backup does not contain a store_id.');
    }
    if (backupTenant.value !== storeId) {
      throw new Error(`TENANT_MISMATCH: Backup belongs to a different store (${backupTenant.value}).`);
    }

    // 3. Schema Version
    const backupSchema = db.getFirstSync<{ value: string }>("SELECT value FROM backup_db.sync_meta WHERE key = 'schema_version';");
    const currentSchema = db.getFirstSync<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'schema_version';");
    
    const backupVersion = parseInt(backupSchema?.value || '1', 10);
    const currentVersion = parseInt(currentSchema?.value || '1', 10);

    if (backupVersion > currentVersion) {
      throw new Error(`SCHEMA_MISMATCH: Backup was created on a newer app version (v${backupVersion}). Please update your app.`);
    }

    // 7. Transactional Merge
    db.withTransactionSync(() => {
      
      // STEP 5 — FINANCIAL RECORD MERGE (Append-only for missing records)
      db.execSync(`
        INSERT INTO invoices (id, invoice_number, invoice_type, status, payment_method, payment_status, customer_id, customer_name, supplier_id, subtotal, discount_amount, tax_amount, total, paid_amount, remaining_amount, notes, created_at, updated_at, sync_status)
        SELECT id, invoice_number, invoice_type, status, payment_method, payment_status, customer_id, customer_name, supplier_id, subtotal, discount_amount, tax_amount, total, paid_amount, remaining_amount, notes, created_at, updated_at, sync_status
        FROM backup_db.invoices
        WHERE id NOT IN (SELECT id FROM invoices);

        INSERT INTO invoice_items (id, invoice_id, product_id, product_name, quantity, unit_type, unit_price, cost_price, pieces_per_carton, total)
        SELECT id, invoice_id, product_id, product_name, quantity, unit_type, unit_price, cost_price, pieces_per_carton, total
        FROM backup_db.invoice_items
        WHERE id NOT IN (SELECT id FROM invoice_items);

        INSERT INTO debt_payments (id, customer_id, amount, method, notes, created_at, sync_status)
        SELECT id, customer_id, amount, method, notes, created_at, sync_status
        FROM backup_db.debt_payments
        WHERE id NOT IN (SELECT id FROM debt_payments);
      `);

      // STEP 6 — MASTER RECORD MERGE
      
      // Products
      db.execSync(`
        INSERT INTO products (id, name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price, cost_price, tax_rate, pieces_per_carton, stock_quantity, category_id, supplier_id, is_active, created_at, updated_at, deleted_at, sync_status)
        SELECT id, name, name_ar, barcode_piece, barcode_carton, retail_price, carton_price, cost_price, tax_rate, pieces_per_carton, stock_quantity, category_id, supplier_id, is_active, created_at, updated_at, deleted_at, sync_status
        FROM backup_db.products
        WHERE id NOT IN (SELECT id FROM products);

        UPDATE products AS a
        SET
          name = b.name,
          name_ar = b.name_ar,
          barcode_piece = b.barcode_piece,
          barcode_carton = b.barcode_carton,
          retail_price = b.retail_price,
          carton_price = b.carton_price,
          cost_price = b.cost_price,
          tax_rate = b.tax_rate,
          pieces_per_carton = b.pieces_per_carton,
          category_id = b.category_id,
          supplier_id = b.supplier_id,
          is_active = b.is_active,
          updated_at = b.updated_at,
          deleted_at = b.deleted_at,
          sync_status = b.sync_status
        FROM backup_db.products AS b
        WHERE a.id = b.id
          AND b.sync_status != 'pending_create'
          AND b.updated_at > a.updated_at;
      `);

      // Customers
      db.execSync(`
        INSERT INTO customers (id, name, phone, phone2, email, address, notes, credit_limit, current_debt, is_active, created_at, updated_at, deleted_at, sync_status)
        SELECT id, name, phone, phone2, email, address, notes, credit_limit, current_debt, is_active, created_at, updated_at, deleted_at, sync_status
        FROM backup_db.customers
        WHERE id NOT IN (SELECT id FROM customers);

        UPDATE customers AS a
        SET
          name = b.name,
          phone = b.phone,
          phone2 = b.phone2,
          email = b.email,
          address = b.address,
          notes = b.notes,
          credit_limit = b.credit_limit,
          is_active = b.is_active,
          updated_at = b.updated_at,
          deleted_at = b.deleted_at,
          sync_status = b.sync_status
        FROM backup_db.customers AS b
        WHERE a.id = b.id
          AND b.sync_status != 'pending_create'
          AND b.updated_at > a.updated_at;
      `);

      // Suppliers
      db.execSync(`
        INSERT INTO suppliers (id, name, phone, address, notes, current_balance, created_at, updated_at, sync_status)
        SELECT id, name, phone, address, notes, current_balance, created_at, updated_at, sync_status
        FROM backup_db.suppliers
        WHERE id NOT IN (SELECT id FROM suppliers);

        UPDATE suppliers AS a
        SET
          name = b.name,
          phone = b.phone,
          address = b.address,
          notes = b.notes,
          updated_at = b.updated_at,
          sync_status = b.sync_status
        FROM backup_db.suppliers AS b
        WHERE a.id = b.id
          AND b.sync_status != 'pending_create'
          AND b.updated_at > a.updated_at;
      `);

      // Categories
      db.execSync(`
        INSERT INTO categories (id, name, created_at, updated_at, sync_status)
        SELECT id, name, created_at, updated_at, sync_status
        FROM backup_db.categories
        WHERE id NOT IN (SELECT id FROM categories);

        UPDATE categories AS a
        SET
          name = b.name,
          updated_at = b.updated_at,
          sync_status = b.sync_status
        FROM backup_db.categories AS b
        WHERE a.id = b.id
          AND b.sync_status != 'pending_create'
          AND b.updated_at > a.updated_at;
      `);
    });

  } catch (error) {
    throw error;
  } finally {
    // 8. DETACH
    if (isAttached) {
      try {
        db.execSync("DETACH DATABASE backup_db;");
      } catch (detachError) {
        console.warn('Failed to detach backup_db:', detachError);
      }
    }

    // Cleanup temp file
    if (tempRestorePath) {
      try {
        await FileSystem.deleteAsync(tempRestorePath, { idempotent: true });
      } catch (deleteError) {}
    }
  }

  // 9. SYNC
  // Trigger sync manager pipeline so any restored pending records will be pushed to the backend safely.
  try {
    await runFullSync();
  } catch (e) {
    console.warn('Post-restore sync push failed, will retry later:', e);
  }
}
