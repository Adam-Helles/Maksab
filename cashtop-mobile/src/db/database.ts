// src/db/database.ts

import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('maksab_local.db');

export function initDatabase() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY NOT NULL,
      customer_name TEXT NOT NULL,
      amount REAL NOT NULL,
      updated_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
  `);
}

export default db;