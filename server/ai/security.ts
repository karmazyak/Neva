import { db, schema } from '../db'
import { eq, sql } from 'drizzle-orm'

// ── Rate Limiting ──

const AI_RATE_LIMIT = 30 // requests per window
const AI_RATE_WINDOW = 60 * 60 * 1000 // 1 hour

const rateLimits = new Map<string, { count: number; resetAt: number }>()

export function checkAiRateLimit(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  let entry = rateLimits.get(userId)

  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + AI_RATE_WINDOW }
    rateLimits.set(userId, entry)
  }

  entry.count++

  if (entry.count > AI_RATE_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  return {
    allowed: true,
    remaining: AI_RATE_LIMIT - entry.count,
    resetIn: Math.ceil((entry.resetAt - now) / 1000),
  }
}

// ── Audit Logging ──

export function logAiAction(params: {
  userId: string
  action: string
  details?: Record<string, any>
  chatIdAccessed?: string
  status?: 'success' | 'denied' | 'error'
  ip?: string
}) {
  try {
    db.insert(schema.aiAuditLog).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      action: params.action,
      details: params.details || null,
      chatIdAccessed: params.chatIdAccessed || null,
      status: params.status || 'success',
      ip: params.ip || null,
    }).run()
  } catch (e) {
    console.error('Audit log error:', e)
  }
}

// ── Privacy Settings ──

export function getPrivacySettings(userId: string) {
  let settings = db.select()
    .from(schema.aiPrivacySettings)
    .where(eq(schema.aiPrivacySettings.userId, userId))
    .get()

  if (!settings) {
    // Create default settings
    db.insert(schema.aiPrivacySettings).values({
      userId,
      aiEnabled: true,
      excludedChats: [],
      dataMasking: true,
      auditLogEnabled: true,
    }).run()

    settings = {
      userId,
      aiEnabled: true,
      excludedChats: [] as string[],
      dataMasking: true,
      auditLogEnabled: true,
      updatedAt: new Date(),
    }
  }

  return settings
}

export function isChatAccessAllowed(userId: string, chatId: string): boolean {
  const settings = getPrivacySettings(userId)
  if (!settings.aiEnabled) return false
  const excluded = (settings.excludedChats as string[]) || []
  return !excluded.includes(chatId)
}

// ── Data Sanitization ──

// Patterns for sensitive data masking
const SENSITIVE_PATTERNS = [
  { regex: /\b\d{13,19}\b/g, label: '[CARD]' },                        // Credit card numbers
  { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, label: '[PHONE]' },       // Phone numbers (US)
  { regex: /\+\d{1,3}\s?\(?\d+\)?[\s.-]?\d+[\s.-]?\d+/g, label: '[PHONE]' }, // International phones
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, label: '[EMAIL]' }, // Emails
  { regex: /\b\d{3}-?\d{2}-?\d{4}\b/g, label: '[SSN]' },               // SSN
  { regex: /\b(?:пароль|password|пасс|pwd)\s*[:=]\s*\S+/gi, label: '[PASSWORD]' }, // Passwords
  { regex: /\b(?:токен|token|api.?key|секрет|secret)\s*[:=]\s*\S+/gi, label: '[SECRET]' }, // Tokens/keys
]

export function sanitizeForAi(text: string, maskingEnabled: boolean): string {
  if (!maskingEnabled) return text

  let sanitized = text
  for (const { regex, label } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(regex, label)
  }
  return sanitized
}

// ── Pending Actions TTL ──

const ACTION_TTL = 5 * 60 * 1000 // 5 minutes

interface TimedAction {
  id: string
  type: 'send_message'
  chatId: string
  chatName: string
  content: string
  createdAt: number
}

const pendingActionsSecure = new Map<string, TimedAction[]>()

export function storePendingAction(userId: string, action: { id: string; type: 'send_message'; chatId: string; chatName: string; content: string }) {
  const existing = pendingActionsSecure.get(userId) || []
  // Clean expired
  const now = Date.now()
  const valid = existing.filter(a => (now - a.createdAt) < ACTION_TTL)
  valid.push({ ...action, createdAt: now })
  pendingActionsSecure.set(userId, valid)
}

export function consumePendingAction(userId: string, actionId: string): TimedAction | null {
  const actions = pendingActionsSecure.get(userId) || []
  const now = Date.now()

  const action = actions.find(a => a.id === actionId && (now - a.createdAt) < ACTION_TTL)
  if (!action) return null

  // Remove consumed action
  pendingActionsSecure.set(userId, actions.filter(a => a.id !== actionId))
  return action
}

export function clearPendingActions(userId: string) {
  pendingActionsSecure.delete(userId)
}
