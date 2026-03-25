import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  bio: text('bio'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  online: integer('online', { mode: 'boolean' }).default(false),
  statusText: text('status_text'),
  statusEmoji: text('status_emoji'),
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type', { enum: ['private', 'group', 'channel'] }).notNull().default('private'),
  name: text('name'),
  description: text('description'),
  avatar: text('avatar'),
  // Denormalized last message fields (updated by DB trigger on INSERT)
  lastMessageId: text('last_message_id'),
  lastMessageAt: integer('last_message_at', { mode: 'timestamp' }),
  lastMessagePreview: text('last_message_preview'),
  lastMessageSenderId: text('last_message_sender_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const chatMembers = sqliteTable('chat_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  chatId: text('chat_id').notNull().references(() => chats.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull().default('member'),
  disappearTimer: integer('disappear_timer'),
  relationshipType: text('relationship_type', { enum: ['family', 'friend', 'work', 'client', 'acquaintance', 'other'] }),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  chatId: text('chat_id').notNull().references(() => chats.id),
  senderId: text('sender_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  type: text('type', { enum: ['text', 'image', 'video', 'system', 'file', 'media_group'] }).notNull().default('text'),
  replyToId: text('reply_to_id'),
  status: text('status', { enum: ['sent', 'delivered', 'read'] }).notNull().default('sent'),
  visibility: text('visibility', { enum: ['normal', 'ghost'] }).notNull().default('normal'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
  editedAt: integer('edited_at', { mode: 'timestamp' }),
  forwardedFrom: text('forwarded_from', { mode: 'json' }).$type<{ chatId: string; chatName: string; senderName: string }>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  avatar: text('avatar'),
  systemPrompt: text('system_prompt').notNull(),
  model: text('model').notNull().default('openai/gpt-4o'),
  tools: text('tools', { mode: 'json' }).$type<string[]>().default([]),
  modes: text('modes', { mode: 'json' }).$type<string[]>().default(['command']),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(2048),
  isPublic: integer('is_public', { mode: 'boolean' }).default(false),
  rating: real('rating').default(0),
  downloads: integer('downloads').default(0),
  category: text('category'),
  price: real('price').default(0),
  featured: integer('featured', { mode: 'boolean' }).default(false),
  skillSettings: text('skill_settings', { mode: 'json' }).$type<Record<string, Record<string, any>>>().default({}),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const agentConfigs = sqliteTable('agent_configs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  chatId: text('chat_id').notNull().references(() => chats.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  triggerMode: text('trigger_mode', { enum: ['auto', 'mention', 'command'] }).notNull().default('auto'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Custom command aliases per user (e.g. /image → /draw)
export const agentCommandAliases = sqliteTable('agent_command_aliases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  skillId: text('skill_id').notNull(),
  customCommand: text('custom_command').notNull(), // e.g. '/draw'
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Credits system
export const userCredits = sqliteTable('user_credits', {
  userId: text('user_id').primaryKey().references(() => users.id),
  balance: integer('balance').notNull().default(1000), // Start with 1000 free credits
  totalUsed: integer('total_used').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const creditLog = sqliteTable('credit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  agentId: text('agent_id').references(() => agents.id),
  skillId: text('skill_id').notNull(),
  skillName: text('skill_name').notNull(),
  cost: integer('cost').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  chatId: text('chat_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Triggers / Pipelines — automatic actions on chat events
export const triggers = sqliteTable('triggers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  event: text('event', { enum: ['on_audio', 'on_image', 'on_message', 'on_message_from', 'on_keyword', 'on_schedule'] }).notNull(),
  condition: text('condition', { mode: 'json' }).$type<{ fromUserId?: string; keyword?: string; chatId?: string; cronExpression?: string; sourceChats?: string[] }>(),
  action: text('action', { mode: 'json' }).$type<{ type: 'skill' | 'agent_reply' | 'stt'; skillCommand?: string; agentId?: string; params?: any }>().notNull(),
  outputMode: text('output_mode', { enum: ['ghost', 'normal', 'silent'] }).notNull().default('ghost'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  chatId: text('chat_id'),
  method: text('method').default('pass_content'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  agentId: text('agent_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Background agent schedules
export const agentSchedules = sqliteTable('agent_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id),
  userId: text('user_id').notNull().references(() => users.id),
  cronExpression: text('cron_expression').notNull(),
  taskType: text('task_type', { enum: ['digest', 'custom'] }).notNull().default('digest'),
  config: text('config', { mode: 'json' }).$type<{ sourceChats: string[]; targetChatId?: string; maxMessages?: number; prompt?: string }>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// AI Assistant audit log — tracks all tool calls and actions
export const aiAuditLog = sqliteTable('ai_audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action').notNull(), // tool name or 'send_message', 'confirm_action'
  details: text('details', { mode: 'json' }).$type<Record<string, any>>(), // args, chatId, etc.
  chatIdAccessed: text('chat_id_accessed'), // which chat data was accessed
  status: text('status', { enum: ['success', 'denied', 'error'] }).notNull().default('success'),
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Per-user AI privacy settings
export const aiPrivacySettings = sqliteTable('ai_privacy_settings', {
  userId: text('user_id').primaryKey().references(() => users.id),
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).default(true),
  excludedChats: text('excluded_chats', { mode: 'json' }).$type<string[]>().default([]),
  dataMasking: integer('data_masking', { mode: 'boolean' }).default(true), // mask phones, emails, cards
  auditLogEnabled: integer('audit_log_enabled', { mode: 'boolean' }).default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Style profiles — cached writing style analysis results
export const styleProfiles = sqliteTable('style_profiles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  analyzedBy: text('analyzed_by').notNull().references(() => users.id),
  chatId: text('chat_id'),
  context: text('context').default('global'),
  profile: text('profile', { mode: 'json' }).$type<Record<string, any>>(),
  messageCount: integer('message_count').default(0),
  messageCountAtAnalysis: integer('message_count_at_analysis').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Push notification subscriptions
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  keysP256dh: text('keys_p256dh').notNull(),
  keysAuth: text('keys_auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Message reactions
export const messageReactions = sqliteTable('message_reactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text('message_id').notNull().references(() => messages.id),
  userId: text('user_id').notNull().references(() => users.id),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Pinned messages
export const pinnedMessages = sqliteTable('pinned_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  chatId: text('chat_id').notNull().references(() => chats.id),
  messageId: text('message_id').notNull().references(() => messages.id),
  pinnedBy: text('pinned_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Saved (bookmarked) messages
export const savedMessages = sqliteTable('saved_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  messageId: text('message_id').notNull().references(() => messages.id),
  chatId: text('chat_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Chat folders
export const chatFolders = sqliteTable('chat_folders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  filterRules: text('filter_rules', { mode: 'json' }).$type<{ chatTypes?: string[]; chatIds?: string[]; hasAgent?: boolean }>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export const chatFolderMembers = sqliteTable('chat_folder_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  folderId: text('folder_id').notNull().references(() => chatFolders.id),
  chatId: text('chat_id').notNull().references(() => chats.id),
})

// Scheduled messages
export const scheduledMessages = sqliteTable('scheduled_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  chatId: text('chat_id').notNull().references(() => chats.id),
  content: text('content').notNull(),
  type: text('type').notNull().default('text'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
  sendAt: integer('send_at', { mode: 'timestamp' }).notNull(),
  status: text('status', { enum: ['pending', 'sent', 'cancelled'] }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Agent reviews
export const agentReviews = sqliteTable('agent_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id),
  userId: text('user_id').notNull().references(() => users.id),
  rating: integer('rating').notNull(),
  reviewText: text('review_text'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Mission history — learn from past missions
export const missionHistory = sqliteTable('mission_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  chatId: text('chat_id'),
  contactName: text('contact_name'),
  goal: text('goal').notNull(),
  strategy: text('strategy'),
  plan: text('plan', { mode: 'json' }).$type<Record<string, any>>(),
  result: text('result', { enum: ['success', 'partial', 'failed', 'aborted'] }).notNull(),
  conversationLog: text('conversation_log'),
  lessonsLearned: text('lessons_learned'), // AI-generated insight
  replanCount: integer('replan_count').default(0),
  messagesSent: integer('messages_sent').default(0),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

export type User = typeof users.$inferSelect
export type Chat = typeof chats.$inferSelect
export type ChatMember = typeof chatMembers.$inferSelect
export type Message = typeof messages.$inferSelect
export type Agent = typeof agents.$inferSelect
export type AgentConfig = typeof agentConfigs.$inferSelect
export type UserCredits = typeof userCredits.$inferSelect
export type AgentCommandAlias = typeof agentCommandAliases.$inferSelect
export type CreditLog = typeof creditLog.$inferSelect
export type Trigger = typeof triggers.$inferSelect
export type AgentSchedule = typeof agentSchedules.$inferSelect
export type AiAuditLog = typeof aiAuditLog.$inferSelect
export type AiPrivacySettings = typeof aiPrivacySettings.$inferSelect
export type StyleProfileRow = typeof styleProfiles.$inferSelect
export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type MessageReaction = typeof messageReactions.$inferSelect
export type PinnedMessage = typeof pinnedMessages.$inferSelect
export type SavedMessage = typeof savedMessages.$inferSelect
export type ChatFolder = typeof chatFolders.$inferSelect
export type ScheduledMessage = typeof scheduledMessages.$inferSelect
export type AgentReview = typeof agentReviews.$inferSelect
export type MissionHistory = typeof missionHistory.$inferSelect
