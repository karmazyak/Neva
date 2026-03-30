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

// Relationship type for AI context awareness
try { sqlite.exec('ALTER TABLE chat_members ADD COLUMN relationship_type TEXT') } catch {}

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

// ========== PHASE: Performance & Scalability ==========

// Performance PRAGMAs
sqlite.exec('PRAGMA synchronous = NORMAL')
sqlite.exec('PRAGMA cache_size = -64000')
sqlite.exec('PRAGMA mmap_size = 268435456')
sqlite.exec('PRAGMA busy_timeout = 5000')
sqlite.exec('PRAGMA wal_autocheckpoint = 1000')
sqlite.exec('PRAGMA temp_store = MEMORY')

// Critical composite indexes (10-100x speedup on core queries)
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC)')
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_messages_chat_status ON messages(chat_id, status) WHERE status = 'sent'")
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON messages(sender_id, created_at DESC)')
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_chat_members_composite ON chat_members(user_id, chat_id)')

// Denormalized last_message fields in chats (eliminates N+1 in loadChats)
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_id TEXT') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_at INTEGER') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_preview TEXT') } catch {}
try { sqlite.exec('ALTER TABLE chats ADD COLUMN last_message_sender_id TEXT') } catch {}

// Trigger: keep chats.last_message_* in sync on new message
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

// Backfill: populate last_message for existing chats
sqlite.exec(`
  UPDATE chats SET
    last_message_id = (SELECT id FROM messages WHERE chat_id = chats.id AND visibility = 'normal' ORDER BY created_at DESC LIMIT 1),
    last_message_at = (SELECT created_at FROM messages WHERE chat_id = chats.id AND visibility = 'normal' ORDER BY created_at DESC LIMIT 1),
    last_message_preview = (SELECT substr(content, 1, 200) FROM messages WHERE chat_id = chats.id AND visibility = 'normal' ORDER BY created_at DESC LIMIT 1),
    last_message_sender_id = (SELECT sender_id FROM messages WHERE chat_id = chats.id AND visibility = 'normal' ORDER BY created_at DESC LIMIT 1)
  WHERE last_message_id IS NULL
`)

// Mission history table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS mission_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT,
    contact_name TEXT,
    goal TEXT NOT NULL,
    strategy TEXT,
    plan TEXT, -- JSON
    result TEXT NOT NULL DEFAULT 'failed',
    conversation_log TEXT,
    lessons_learned TEXT,
    replan_count INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  )
`)

// ========== v2 AI features onboarding reset ==========
// Add onboarding_version to track tutorial version; reset all users to show new AI tutorial
try { sqlite.exec('ALTER TABLE users ADD COLUMN onboarding_version INTEGER DEFAULT 0') } catch {}
// Reset onboarding for all users so they see the new v2 AI tutorial
try {
  const currentVersion = 2
  sqlite.exec(`UPDATE users SET onboarding_completed = 0 WHERE onboarding_version < ${currentVersion} OR onboarding_version IS NULL`)
  sqlite.exec(`UPDATE users SET onboarding_version = ${currentVersion} WHERE onboarding_version < ${currentVersion} OR onboarding_version IS NULL`)
} catch {}

// ========== Persistent Goals & Proactive Actions (Strategic Advisor 2.0) ==========

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT,
    goal TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'strategic',
    status TEXT NOT NULL DEFAULT 'active',
    strategy TEXT,
    progress INTEGER DEFAULT 0,
    progress_notes TEXT DEFAULT '[]',
    autonomy_level TEXT NOT NULL DEFAULT 'semi',
    completed_at INTEGER,
    lessons_learned TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_user_goals_user ON user_goals(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_goals_status ON user_goals(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_user_goals_chat ON user_goals(user_id, chat_id);
`)

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS proactive_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    chat_id TEXT,
    goal_id TEXT,
    type TEXT NOT NULL,
    trigger TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    draft_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_proactive_actions_user ON proactive_actions(user_id, status);
`)

// ========== Demo Goals for ivan account ==========
try {
  const ivan = sqlite.prepare('SELECT id FROM users WHERE username = ?').get('ivan') as { id: string } | undefined
  if (ivan) {
    const existingGoals = sqlite.prepare('SELECT COUNT(*) as c FROM user_goals WHERE user_id = ?').get(ivan.id) as { c: number }
    if (existingGoals.c === 0) {
      // Get some chat IDs
      const chats = sqlite.prepare(`
        SELECT cm.chat_id, c.name FROM chat_members cm
        JOIN chats c ON c.id = cm.chat_id
        WHERE cm.user_id = ? AND c.type = 'private'
        LIMIT 3
      `).all(ivan.id) as Array<{ chat_id: string; name: string }>

      if (chats.length >= 2) {
        // Strategic goal
        sqlite.prepare(`INSERT INTO user_goals (id, user_id, chat_id, goal, mode, status, strategy, progress, progress_notes, autonomy_level, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'strategic', 'in_progress', ?, 35, ?, 'semi', unixepoch(), unixepoch())`).run(
          crypto.randomUUID(), ivan.id, chats[0].chat_id,
          'Договориться о встрече на следующей неделе',
          'Мягкое предложение с конкретным временем',
          JSON.stringify([
            { date: new Date(Date.now() - 86400000).toISOString(), note: 'Начал обсуждение, собеседник заинтересован' },
            { date: new Date().toISOString(), note: 'Ждём ответ на предложение времени' },
          ])
        )

        // Care goal
        sqlite.prepare(`INSERT INTO user_goals (id, user_id, chat_id, goal, mode, status, strategy, progress, progress_notes, autonomy_level, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'care', 'active', NULL, 0, '[]', 'semi', unixepoch(), unixepoch())`).run(
          crypto.randomUUID(), ivan.id, chats[1].chat_id,
          'Чаще писать и поддерживать связь'
        )

        // Proactive action demo
        sqlite.prepare(`INSERT INTO proactive_actions (id, user_id, chat_id, type, trigger, title, body, draft_message, status, created_at)
          VALUES (?, ?, ?, 'suggestion', 'silence', ?, ?, ?, 'pending', unixepoch())`).run(
          crypto.randomUUID(), ivan.id, chats[1].chat_id,
          'Давно не общались',
          'Прошло больше недели с последнего сообщения. Может, стоит написать?',
          'Привет! Как у тебя дела? Давно не общались 😊'
        )

        console.log('Demo goals seeded for ivan')
      }
    }
  }
} catch (e) { console.log('Demo goals seed skipped:', e) }

// ========== A2A Network v2: Privacy Vault + Mutual Matches ==========

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

console.log('Database migrated successfully!')
sqlite.close()
