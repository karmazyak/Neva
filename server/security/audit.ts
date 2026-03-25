/**
 * Data-access audit log.
 *
 * Tracks every read of user message data — both by end-users (via API)
 * and by AI agents (via tool calls).  The log is write-only from the
 * application's perspective; never blocks the main request flow.
 *
 * Table: data_access_log
 *   id            — UUID
 *   user_id       — whose data was accessed
 *   accessor_type — 'user' | 'ai'
 *   action        — free-form label, e.g. 'get_chat_history', 'search_messages'
 *   resource_type — 'chat_history' | 'message_search' | 'all_chats' | 'contacts'
 *   resource_id   — chatId or search query (nullable)
 *   ip            — requester IP (nullable)
 *   created_at    — Unix timestamp (seconds)
 */

import { Database } from 'bun:sqlite'

// We obtain the underlying bun:sqlite handle from the Drizzle instance.
// This avoids a circular dependency with server/db/index.ts while still
// using the same physical database file.
let _sqlite: Database | null = null

function getSqlite(): Database {
  if (_sqlite) return _sqlite
  const dbPath = process.env.DATABASE_URL || './data/mlsendger.db'
  _sqlite = new Database(dbPath, { create: false })
  _sqlite.exec(`
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
  return _sqlite
}

export type AccessorType = 'user' | 'ai'
export type ResourceType = 'chat_history' | 'message_search' | 'all_chats' | 'contacts'

export interface DataAccessEvent {
  userId: string
  accessorType: AccessorType
  action: string
  resourceType: ResourceType
  resourceId?: string
  ip?: string
}

/**
 * Log a data-access event.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function logDataAccess(event: DataAccessEvent): void {
  try {
    const sqlite = getSqlite()
    sqlite.run(
      `INSERT INTO data_access_log
         (id, user_id, accessor_type, action, resource_type, resource_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        event.userId,
        event.accessorType,
        event.action,
        event.resourceType,
        event.resourceId ?? null,
        event.ip ?? null,
      ]
    )
  } catch {
    // Audit failures must NEVER break the main application flow.
    // Silently swallowed — in production you'd forward this to an external SIEM.
  }
}

/**
 * Initialise the table eagerly so it exists before the first request.
 * Called once from server/db/index.ts at startup.
 */
export function initAuditLog(): void {
  try {
    getSqlite()
  } catch (err) {
    console.error('[Security] Failed to initialise audit log:', (err as Error)?.message)
  }
}
