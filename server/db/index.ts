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

// ── Contact Intelligence & Memory tables ─────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS contact_intelligence (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    contact_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT NOT NULL REFERENCES chats(id),
    persona TEXT,
    their_style TEXT,
    my_style_for_them TEXT,
    mood_history TEXT DEFAULT '[]',
    relationship_type TEXT,
    last_analyzed_at INTEGER,
    message_count_at_analysis INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_intel_unique ON contact_intelligence(user_id, chat_id);
  CREATE INDEX IF NOT EXISTS idx_contact_intel_contact ON contact_intelligence(contact_id);
`)

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS contact_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    contact_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT NOT NULL REFERENCES chats(id),
    fact TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT,
    confidence REAL DEFAULT 0.8,
    extracted_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER,
    is_active INTEGER DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_contact_memory_user_chat ON contact_memory(user_id, chat_id, is_active);
`)

// Add priority column to proactive_actions (Phase 6 prep)
try { sqlite.exec('ALTER TABLE proactive_actions ADD COLUMN priority TEXT DEFAULT \'medium\'') } catch {}

// ── Personal Agent Network tables ───────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS needs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT,
    description TEXT NOT NULL,
    embedding TEXT,
    category TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'whenever',
    source TEXT NOT NULL DEFAULT 'explicit',
    visibility TEXT NOT NULL DEFAULT 'friends',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_needs_user_status ON needs(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_needs_category_status ON needs(category, status);

  CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    description TEXT NOT NULL,
    embedding TEXT,
    category TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'explicit',
    availability TEXT NOT NULL DEFAULT 'available',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_offers_user ON offers(user_id);
  CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category, availability);

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL REFERENCES needs(id),
    offer_id TEXT NOT NULL REFERENCES offers(id),
    requester_id TEXT NOT NULL REFERENCES users(id),
    provider_id TEXT NOT NULL REFERENCES users(id),
    similarity_score REAL,
    social_distance INTEGER,
    mutual_contact_id TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    requester_rating INTEGER,
    provider_rating INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_matches_requester ON matches(requester_id, status);
  CREATE INDEX IF NOT EXISTS idx_matches_provider ON matches(provider_id, status);

  CREATE TABLE IF NOT EXISTS consent_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id),
    to_user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    context TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    response_message TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_consent_to_status ON consent_requests(to_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_consent_from ON consent_requests(from_user_id);
`)

// Add dialog_id column to consent_requests
try { sqlite.exec('ALTER TABLE consent_requests ADD COLUMN dialog_id TEXT') } catch {}

// ── Agent Dialogs (A2A inter-user) ──────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agent_dialogs (
    id TEXT PRIMARY KEY,
    initiator_user_id TEXT NOT NULL REFERENCES users(id),
    target_user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    context_data TEXT,
    result TEXT,
    parent_dialog_id TEXT,
    expires_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_agent_dialogs_initiator ON agent_dialogs(initiator_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_agent_dialogs_target ON agent_dialogs(target_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_agent_dialogs_parent ON agent_dialogs(parent_dialog_id);

  CREATE TABLE IF NOT EXISTS agent_dialog_messages (
    id TEXT PRIMARY KEY,
    dialog_id TEXT NOT NULL REFERENCES agent_dialogs(id),
    agent_role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_agent_dialog_msgs_dialog ON agent_dialog_messages(dialog_id);

  CREATE TABLE IF NOT EXISTS agent_autonomy_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    relationship_level TEXT NOT NULL,
    dialog_type TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'ask_user',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomy_unique ON agent_autonomy_rules(user_id, relationship_level, dialog_type);
`)

// ── A2A Protocol tables ─────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS a2a_tasks (
    id TEXT PRIMARY KEY,
    context_id TEXT,
    state TEXT NOT NULL DEFAULT 'pending',
    data TEXT NOT NULL,
    caller_app_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_a2a_tasks_context ON a2a_tasks(context_id);
  CREATE INDEX IF NOT EXISTS idx_a2a_tasks_state ON a2a_tasks(state);

  CREATE TABLE IF NOT EXISTS a2a_apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL,
    permissions TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS agent_activities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    related_dialog_id TEXT,
    related_chat_id TEXT,
    related_user_id TEXT,
    metadata TEXT,
    undoable INTEGER DEFAULT 0,
    undone_at INTEGER,
    undo_deadline INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_activities_user_created ON agent_activities(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activities_user_type ON agent_activities(user_id, type);
`)

// ── Privacy Vault (user-controlled agent disclosure rules) ─────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS privacy_vault (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    share_interests INTEGER DEFAULT 1,
    share_expertise INTEGER DEFAULT 1,
    share_availability INTEGER DEFAULT 1,
    share_mood INTEGER DEFAULT 0,
    share_facts INTEGER DEFAULT 0,
    public_bio TEXT,
    public_interests TEXT DEFAULT '[]',
    public_expertise TEXT DEFAULT '[]',
    blocked_user_ids TEXT DEFAULT '[]',
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_privacy_vault_user ON privacy_vault(user_id);
`)

// ── Mutual Matches (bidirectional anonymous matching) ──────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS mutual_matches (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL REFERENCES needs(id),
    requester_id TEXT NOT NULL REFERENCES users(id),
    offer_id TEXT NOT NULL REFERENCES offers(id),
    provider_id TEXT NOT NULL REFERENCES users(id),
    similarity_score REAL,
    social_distance INTEGER,
    mutual_contact_id TEXT,
    requester_consent TEXT NOT NULL DEFAULT 'pending',
    provider_consent TEXT NOT NULL DEFAULT 'pending',
    requester_dialog_id TEXT,
    provider_dialog_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    revealed_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_mutual_matches_requester ON mutual_matches(requester_id, status);
  CREATE INDEX IF NOT EXISTS idx_mutual_matches_provider ON mutual_matches(provider_id, status);
`)
