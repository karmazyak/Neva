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

// ── SQLite Performance Tuning ────────────────────────────────────────────────
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')
sqlite.exec('PRAGMA synchronous = NORMAL')         // 2-5x write speed (safe with WAL)
sqlite.exec('PRAGMA cache_size = -64000')           // 64MB page cache (default 2MB)
sqlite.exec('PRAGMA mmap_size = 268435456')         // 256MB memory-mapped I/O
sqlite.exec('PRAGMA busy_timeout = 5000')           // Wait 5s on write lock instead of fail
sqlite.exec('PRAGMA wal_autocheckpoint = 1000')     // Checkpoint every 1000 pages
sqlite.exec('PRAGMA temp_store = MEMORY')           // Temp tables in RAM

// Security
sqlite.exec('PRAGMA secure_delete = ON')

// ── Critical Indexes ─────────────────────────────────────────────────────────
// Composite index for the primary chat history query (10-100x speedup)
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC)')
// For unread count queries
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_messages_chat_status ON messages(chat_id, status) WHERE status = \'sent\'')
// For sender lookups
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON messages(sender_id, created_at DESC)')
// Composite for chat membership lookups
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_chat_members_composite ON chat_members(user_id, chat_id)')

// ── Denormalized last_message for fast loadChats ─────────────────────────────
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_id TEXT') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_at INTEGER') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_preview TEXT') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_sender_id TEXT') } catch {}

// Trigger: auto-update chats.last_message on INSERT
sqlite.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_update_chat_last_message
  AFTER INSERT ON messages
  WHEN NEW.visibility = 'normal'
  BEGIN
    UPDATE chats SET
      last_message_id = NEW.id,
      last_message_at = NEW.created_at,
      last_message_preview = substr(NEW.content, 1, 200),
      last_message_sender_id = NEW.sender_id
    WHERE id = NEW.chat_id;
  END
`)

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
