import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { executeVacuumInto, getStoreId } from './database';

export interface BackupInfo {
  path: string;
  filename: string;
  store_id: string;
  created_at: string;
  size: number;
}

const BACKUP_DIR = (FileSystem as any).documentDirectory + 'backups/';

// Prevent concurrent backup calls
let isBackupRunning = false;

/**
 * Creates a consistent snapshot of the current active SQLite database.
 * Uses VACUUM INTO to safely dump the database including any WAL data.
 */
export async function createLocalBackup(): Promise<BackupInfo> {
  if (isBackupRunning) {
    throw new Error('BACKUP_IN_PROGRESS: A backup operation is already running.');
  }

  isBackupRunning = true;
  let finalPath = '';
  try {
    const storeId = getStoreId();
    if (!storeId) {
      throw new Error('MISSING_TENANT_ID: Cannot create backup because store_id is missing from local database.');
    }

    // Ensure backups directory exists
    const dirInfo = await FileSystem.getInfoAsync(BACKUP_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
    const filename = `Maksab_Backup_${storeId}_${timestamp}.db`;
    finalPath = BACKUP_DIR + filename;

    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    if (fileInfo.exists) {
      throw new Error('DESTINATION_EXISTS: A backup file with this name already exists.');
    }

    // Execute VACUUM INTO on the active connection.
    // This blocks the connection momentarily but does not require closing it.
    // executeVacuumInto handles single quote escaping.
    try {
      executeVacuumInto(finalPath);
    } catch (e: any) {
      throw new Error(`VACUUM_FAILED: Failed to create snapshot - ${e.message}`);
    }

    // Verify the backup file was created
    const createdInfo = await FileSystem.getInfoAsync(finalPath);
    if (!createdInfo.exists || createdInfo.isDirectory || createdInfo.size === 0) {
      throw new Error('INVALID_BACKUP_SIZE: The generated backup file is missing or empty.');
    }

    // Verify integrity and tenant identity by opening the backup file
    let backupDb: SQLite.SQLiteDatabase | null = null;
    try {
      // In expo-sqlite@16, openDatabaseSync opens files in the document directory under 'SQLite/' by default, 
      // OR accepts a full directory path if configured, but typically it expects just a name.
      // Wait, opening a database from a specific full path might not be directly supported by openDatabaseSync in all versions.
      // Actually, expo-sqlite@16 allows overriding the directory or we can copy it to the default SQLite dir temporarily.
      // To be safe and framework-agnostic with expo-sqlite, we'll copy it to the default SQLite directory, verify, and delete.
      
      const defaultSqliteDir = (FileSystem as any).documentDirectory + 'SQLite/';
      const tempVerifyName = `verify_${filename}`;
      const tempVerifyPath = defaultSqliteDir + tempVerifyName;
      
      const sqliteDirInfo = await FileSystem.getInfoAsync(defaultSqliteDir);
      if (!sqliteDirInfo.exists) {
        await FileSystem.makeDirectoryAsync(defaultSqliteDir, { intermediates: true });
      }
      
      await FileSystem.copyAsync({ from: finalPath, to: tempVerifyPath });
      
      backupDb = SQLite.openDatabaseSync(tempVerifyName);
      
      // Check sync_meta
      const row = backupDb.getFirstSync<{value: string}>("SELECT value FROM sync_meta WHERE key = 'store_id'");
      if (!row || !row.value) {
        throw new Error('CORRUPT_BACKUP: sync_meta or store_id is missing in the generated backup.');
      }
      
      if (row.value !== storeId) {
        throw new Error(`TENANT_MISMATCH: Backup contains store_id ${row.value} but expected ${storeId}.`);
      }
      
      // Close database by removing references, and delete the temp file
      // expo-sqlite@16 might not have a close() method exposed synchronously, but we can delete the file safely
      // Some versions have db.closeSync(). We will use try/catch just in case.
      if (typeof backupDb.closeSync === 'function') {
         backupDb.closeSync();
      }
      await FileSystem.deleteAsync(tempVerifyPath, { idempotent: true });
      
    } catch (verifyError: any) {
      if (backupDb && typeof backupDb.closeSync === 'function') {
         try { backupDb.closeSync(); } catch (e) {}
      }
      throw new Error(`VERIFICATION_FAILED: ${verifyError.message}`);
    }

    // Backup validated successfully. Apply retention policy.
    try {
      await deleteOldBackups(5);
    } catch (retentionError) {
      // "If retention cleanup fails, DO NOT mark backup creation as failed. The valid newest backup must remain available."
      console.warn('Backup retention cleanup failed:', retentionError);
    }

    return {
      path: finalPath,
      filename,
      store_id: storeId,
      created_at: new Date().toISOString(),
      size: createdInfo.size,
    };

  } catch (error) {
    // If anything fails, clean up the partial backup file if it exists
    if (finalPath) {
      try {
        await FileSystem.deleteAsync(finalPath, { idempotent: true });
      } catch (e) {}
    }
    throw error;
  } finally {
    isBackupRunning = false;
  }
}

/**
 * Returns a list of all backup files, sorted from newest to oldest.
 */
export async function getBackupFiles(): Promise<BackupInfo[]> {
  const dirInfo = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!dirInfo.exists) {
    return [];
  }

  const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const backups: BackupInfo[] = [];

  for (const file of files) {
    if (!file.endsWith('.db')) continue;
    const path = BACKUP_DIR + file;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) continue;
    
    // Extract store_id from filename (Maksab_Backup_STOREID_TIMESTAMP.db)
    const parts = file.split('_');
    const store_id = parts.length >= 3 ? parts[2] : 'unknown';

    backups.push({
      path,
      filename: file,
      store_id,
      created_at: new Date(info.modificationTime! * 1000).toISOString(),
      size: info.size!,
    });
  }

  // Sort descending by actual modification time
  return backups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Deletes all but the newest 'keepCount' backups.
 */
export async function deleteOldBackups(keepCount: number = 5): Promise<void> {
  const backups = await getBackupFiles();
  
  if (backups.length <= keepCount) {
    return;
  }

  const toDelete = backups.slice(keepCount);
  
  for (const backup of toDelete) {
    await FileSystem.deleteAsync(backup.path, { idempotent: true });
  }
}

/**
 * Returns info about the most recent backup, if any.
 */
export async function getLastBackupInfo(): Promise<BackupInfo | null> {
  const backups = await getBackupFiles();
  return backups.length > 0 ? backups[0] : null;
}
