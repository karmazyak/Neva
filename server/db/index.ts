import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as schema from './schema'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const dbPath = process.env.DATABASE_URL || './data/mlsendger.db'
const dir = dirname(dbPath)
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

const sqlite = new Database(dbPath)
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')

// Harden SQLite: delete on close to avoid leaving temp files, enable secure delete
sqlite.exec('PRAGMA secure_delete = ON')

export const db = drizzle(sqlite, { schema })
export { schema }

// ── Audit log table ──────────────────────────────────────────────────────────
// Initialised here alongside the other security tables so it exists before the
// first request.  The audit module opens its own connection to avoid circular
// imports, but we also create the table here as a safety net.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS data_access_log (
    id            TEXT    PRIMARY KEY,
    user_id       TEXT    NOT NULL,
    accessor_type TEXT    NOT NULL DEFAULT 'user',
    action        TEXT    NOT NULL,
    resource_type TEXT    NOT NULL,
    resource_id   TEXT,
    ip            TEXT,
    created_at    INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_dal_user    ON data_access_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_dal_created ON data_access_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_dal_type    ON data_access_log(accessor_type, created_at);
`)

// Create security tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS ai_audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    chat_id_accessed TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    ip TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS ai_privacy_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    ai_enabled INTEGER DEFAULT 1,
    excluded_chats TEXT DEFAULT '[]',
    data_masking INTEGER DEFAULT 1,
    audit_log_enabled INTEGER DEFAULT 1,
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_ai_audit_created ON ai_audit_log(created_at);
`)
