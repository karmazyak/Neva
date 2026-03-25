import { Database } from 'bun:sqlite'
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

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    bio TEXT,
    last_seen INTEGER,
    online INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'private',
    name TEXT,
    avatar TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id),
    sender_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    reply_to_id TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    system_prompt TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'openai/gpt-4o',
    tools TEXT DEFAULT '[]',
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 2048,
    is_public INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    category TEXT,
    price REAL DEFAULT 0,
    featured INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS agent_configs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT NOT NULL REFERENCES chats(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    enabled INTEGER DEFAULT 1,
    trigger_mode TEXT NOT NULL DEFAULT 'auto',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members(chat_id);
  CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_agent_configs_chat_id ON agent_configs(chat_id);
  CREATE INDEX IF NOT EXISTS idx_agents_is_public ON agents(is_public);

  CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 1000,
    total_used INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS credit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    agent_id TEXT REFERENCES agents(id),
    skill_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    chat_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_credit_log_user_id ON credit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_credit_log_created_at ON credit_log(created_at);

  -- Agent command aliases (custom /command mappings per user)
  CREATE TABLE IF NOT EXISTS agent_command_aliases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    skill_id TEXT NOT NULL,
    custom_command TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_agent_command_aliases_user ON agent_command_aliases(user_id);
  CREATE INDEX IF NOT EXISTS idx_agent_command_aliases_agent ON agent_command_aliases(agent_id);
`)

// Add new columns if they don't exist (safe for existing DBs)
try { sqlite.exec('ALTER TABLE agents ADD COLUMN modes TEXT DEFAULT \'["command"]\'') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN description TEXT') } catch {}

// Ghost messages support
try { sqlite.exec('ALTER TABLE messages ADD COLUMN visibility TEXT NOT NULL DEFAULT \'normal\'') } catch {}
try { sqlite.exec('ALTER TABLE messages ADD COLUMN metadata TEXT') } catch {}

// Skill settings per agent
try { sqlite.exec('ALTER TABLE agents ADD COLUMN skill_settings TEXT DEFAULT \'{}\'') } catch {}

// Triggers table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    event TEXT NOT NULL,
    condition TEXT,
    action TEXT NOT NULL,
    output_mode TEXT NOT NULL DEFAULT 'ghost',
    enabled INTEGER DEFAULT 1,
    chat_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_triggers_user_id ON triggers(user_id);
`)

// Agent schedules table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agent_schedules (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    cron_expression TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'digest',
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_agent_schedules_agent_id ON agent_schedules(agent_id);
`)

// Pipeline fields for triggers (Robots v2)
try { sqlite.exec("ALTER TABLE triggers ADD COLUMN method TEXT DEFAULT 'pass_content'") } catch {}
try { sqlite.exec('ALTER TABLE triggers ADD COLUMN is_default INTEGER DEFAULT 0') } catch {}
try { sqlite.exec('ALTER TABLE triggers ADD COLUMN agent_id TEXT') } catch {}

// Style profiles table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    analyzed_by TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT,
    profile TEXT,
    message_count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_style_profiles_user_id ON style_profiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_style_profiles_analyzed_by ON style_profiles(analyzed_by);
`)

// Style profiles: add context and message_count_at_analysis columns
try { sqlite.exec("ALTER TABLE style_profiles ADD COLUMN context TEXT DEFAULT 'global'") } catch {}
try { sqlite.exec('ALTER TABLE style_profiles ADD COLUMN message_count_at_analysis INTEGER DEFAULT 0') } catch {}

// AI audit log and privacy settings
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
  CREATE INDEX IF NOT EXISTS idx_ai_audit_log_user_id ON ai_audit_log(user_id);

  CREATE TABLE IF NOT EXISTS ai_privacy_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    ai_enabled INTEGER DEFAULT 1,
    excluded_chats TEXT DEFAULT '[]',
    data_masking INTEGER DEFAULT 1,
    audit_log_enabled INTEGER DEFAULT 1,
    updated_at INTEGER DEFAULT (unixepoch())
  );
`)

// Forwarded message support
try { sqlite.exec('ALTER TABLE messages ADD COLUMN forwarded_from TEXT') } catch {}
try { sqlite.exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER') } catch {}

// ========== PHASE 1: Push Notifications & Reactions ==========

// Push notification subscriptions
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
`)

// Message reactions
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON message_reactions(message_id, user_id, emoji);
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
`)

// ========== PHASE 2: FTS5 Search, Pinned Messages ==========

// Full-text search for messages
try {
  sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, message_id UNINDEXED, chat_id UNINDEXED)`)
  // Triggers to keep FTS in sync
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages
    WHEN NEW.type = 'text' AND NEW.visibility = 'normal'
    BEGIN
      INSERT INTO messages_fts(content, message_id, chat_id) VALUES (NEW.content, NEW.id, NEW.chat_id);
    END
  `)
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages
    WHEN NEW.type = 'text' AND NEW.visibility = 'normal'
    BEGIN
      DELETE FROM messages_fts WHERE message_id = OLD.id;
      INSERT INTO messages_fts(content, message_id, chat_id) VALUES (NEW.content, NEW.id, NEW.chat_id);
    END
  `)
} catch {}

// Pinned messages
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS pinned_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id),
    message_id TEXT NOT NULL REFERENCES messages(id),
    pinned_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pinned_unique ON pinned_messages(chat_id, message_id);
`)

// ========== PHASE 3: Saved, Folders, Schedule, Status, Disappearing, Reviews ==========

// Saved (bookmarked) messages
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS saved_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    message_id TEXT NOT NULL REFERENCES messages(id),
    chat_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_unique ON saved_messages(user_id, message_id);
  CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_messages(user_id);
`)

// Chat folders
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS chat_folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    filter_rules TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(user_id);

  CREATE TABLE IF NOT EXISTS chat_folder_members (
    id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL REFERENCES chat_folders(id),
    chat_id TEXT NOT NULL REFERENCES chats(id),
    UNIQUE(folder_id, chat_id)
  );
`)

// Scheduled messages
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT NOT NULL REFERENCES chats(id),
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    metadata TEXT,
    send_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_messages_send_at ON scheduled_messages(send_at);
`)

// User custom status
try { sqlite.exec('ALTER TABLE users ADD COLUMN status_text TEXT') } catch {}
try { sqlite.exec('ALTER TABLE users ADD COLUMN status_emoji TEXT') } catch {}

// Disappearing messages timer per chat member
try { sqlite.exec('ALTER TABLE chat_members ADD COLUMN disappear_timer INTEGER') } catch {}

// Marketplace reviews
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agent_reviews (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    review_text TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique ON agent_reviews(agent_id, user_id);
`)

// Agent screenshots
try { sqlite.exec('ALTER TABLE agents ADD COLUMN screenshots TEXT') } catch {}

// Onboarding tracking
try { sqlite.exec('ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0') } catch {}

// Shared group agents
try { sqlite.exec('ALTER TABLE agent_configs ADD COLUMN shared INTEGER DEFAULT 0') } catch {}

// Make ivan's agents public for the marketplace
try {
  sqlite.exec(`UPDATE agents SET is_public = 1 WHERE owner_id IN (SELECT id FROM users WHERE username = 'ivan')`)
} catch {}

console.log('Database migrated successfully!')
sqlite.close()
