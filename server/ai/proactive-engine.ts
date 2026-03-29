/**
 * Proactive Engine — background scanner that generates proactive actions.
 * Runs every 15 minutes from scheduler.ts.
 *
 * NOT an agent per user. One cron job scans all users sequentially.
 * Rule-based triggers (no LLM) → one haiku call per triggered action.
 */

import { db, schema } from '../db'
import { eq, and, desc, inArray, sql, gt, lt } from 'drizzle-orm'
import { sendToUser } from '../ws'
import { decrypt } from '../security/encryption'
import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'
import { getMoodTrend, getContactIntel, getBaseline, calculateBaseline, updateBaseline } from './contact-intelligence'
import { getActiveMemories } from './memory-manager'
import { quickMoodSignal } from './mood-detector'

// Track last scan time per user (in-memory, resets on restart — OK for MVP)
const lastScanAt = new Map<string, number>()

// Dedup: don't create same action twice in 24h
const DEDUP_WINDOW = 24 * 60 * 60 * 1000

interface ProactiveTrigger {
  userId: string
  chatId: string
  chatName: string
  type: 'silence' | 'unanswered' | 'goal_stall' | 'burst' | 'mood' | 'behavior_change' | 'upcoming_date' | 'detected_need' | 'fraud_suspicion'
  context: string // brief description for LLM
}

/**
 * Main scan function — called from scheduler every 15 minutes
 */
export async function runProactiveScan() {
  const startTime = Date.now()

  // Get users who have active goals OR care-type contacts
  const usersWithGoals = db.selectDistinct({ userId: schema.userGoals.userId })
    .from(schema.userGoals)
    .where(inArray(schema.userGoals.status, ['active', 'in_progress']))
    .all()
    .map(r => r.userId)

  const usersWithCareContacts = db.selectDistinct({ userId: schema.chatMembers.userId })
    .from(schema.chatMembers)
    .where(inArray(schema.chatMembers.relationshipType, ['family', 'friend']))
    .all()
    .map(r => r.userId)

  const allUserIds = [...new Set([...usersWithGoals, ...usersWithCareContacts])]

  if (allUserIds.length === 0) {
    return
  }

  let totalActions = 0

  for (const userId of allUserIds) {
    try {
      const triggers = await scanUserTriggers(userId)
      if (triggers.length === 0) continue

      for (const trigger of triggers) {
        if (isDuplicateAction(userId, trigger.chatId, trigger.type)) continue

        const action = await generateAction(trigger)
        if (action) {
          totalActions++
        }
      }
    } catch (err) {
      console.error(`[PROACTIVE] Error scanning user ${userId}:`, err)
    }

    lastScanAt.set(userId, Date.now())
  }

  if (totalActions > 0) {
    console.log(`[PROACTIVE] Scan complete: ${totalActions} actions for ${allUserIds.length} users (${Date.now() - startTime}ms)`)
  }
}

/**
 * Run proactive scan for a single user (Phase 6: force-refresh from /nudges)
 */
export async function runProactiveScanForUser(userId: string): Promise<number> {
  let actionsCreated = 0
  try {
    const triggers = await scanUserTriggers(userId)
    for (const trigger of triggers) {
      if (isDuplicateAction(userId, trigger.chatId, trigger.type)) continue
      const ok = await generateAction(trigger)
      if (ok) actionsCreated++
    }
    lastScanAt.set(userId, Date.now())
  } catch (err) {
    console.error(`[PROACTIVE] Error scanning user ${userId}:`, err)
  }
  return actionsCreated
}

/**
 * Centralized dedup check: prevent (userId, chatId, trigger) duplicates within 24h.
 * Uses raw SQL to avoid Drizzle timestamp mode issues.
 */
function isDuplicateAction(userId: string, chatId: string, triggerType: string): boolean {
  const oneDayAgoSec = Math.floor((Date.now() - DEDUP_WINDOW) / 1000)
  // Use raw SQL for reliable integer comparison against the created_at column
  const existing = db.select({ id: schema.proactiveActions.id })
    .from(schema.proactiveActions)
    .where(and(
      eq(schema.proactiveActions.userId, userId),
      chatId
        ? eq(schema.proactiveActions.chatId, chatId)
        : sql`${schema.proactiveActions.chatId} IS NULL`,
      eq(schema.proactiveActions.trigger, triggerType),
      sql`${schema.proactiveActions.createdAt} > ${oneDayAgoSec}`,
    ))
    .get()
  return !!existing
}

/**
 * Detect suspicious/scam chats that should NOT receive proactive nudges.
 * Rule-based: phone numbers as names, known scam keywords in chat ID/name.
 */
function isSuspiciousChat(chatName: string, chatId: string): boolean {
  const name = chatName.toLowerCase()
  const id = chatId.toLowerCase()

  // Phone number as chat name (e.g. "+7 999 123-45-67", "+79991234567")
  if (/^\+?\d[\d\s\-()]{6,}$/.test(chatName.trim())) return true

  // Chat ID or name contains scam/fraud indicators
  const suspiciousPatterns = ['fraud', 'scam', 'spam', 'фрод', 'мошен', 'спам']
  for (const pat of suspiciousPatterns) {
    if (name.includes(pat) || id.includes(pat)) return true
  }

  return false
}

/**
 * Scan one user's chats for triggers (rule-based, no LLM)
 */
async function scanUserTriggers(userId: string): Promise<ProactiveTrigger[]> {
  const triggers: ProactiveTrigger[] = []
  const now = Date.now()

  // Get user's chats with relationship types
  const userChats = db.select({
    chatId: schema.chatMembers.chatId,
    relationshipType: schema.chatMembers.relationshipType,
    chatName: schema.chats.name,
    chatType: schema.chats.type,
  })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(and(
      eq(schema.chatMembers.userId, userId),
      eq(schema.chats.type, 'private'),
    ))
    .all()

  for (const chat of userChats) {
    const chatName = chat.chatName || 'Chat'

    // ── SCAM/FRAUD FILTER: Skip suspicious chats ──
    if (isSuspiciousChat(chatName, chat.chatId)) continue

    const isPersonal = chat.relationshipType === 'family' || chat.relationshipType === 'friend'

    // Get last few messages
    const recentMsgs = db.select({
      senderId: schema.messages.senderId,
      createdAt: schema.messages.createdAt,
      content: schema.messages.content,
    })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.chatId, chat.chatId),
        eq(schema.messages.visibility, 'normal'),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(5)
      .all()

    if (recentMsgs.length === 0) continue

    const lastMsg = recentMsgs[0]
    const lastMsgTime = lastMsg.createdAt ? new Date(lastMsg.createdAt).getTime() : 0
    const hoursSinceLastMsg = (now - lastMsgTime) / (1000 * 60 * 60)

    // ── SILENCE TRIGGER (personal chats only) — v2: personalized threshold ──
    const baseline = getBaseline(userId, chat.chatId)
    const silenceThresholdHours = (baseline && baseline.avgMessagesPerDay > 0)
      ? Math.max(72, (3 / baseline.avgMessagesPerDay) * 24) // 3x their normal interval, min 3 days
      : 7 * 24 // fallback: 7 days

    if (isPersonal && hoursSinceLastMsg > silenceThresholdHours) {
      triggers.push({
        userId, chatId: chat.chatId, chatName,
        type: 'silence',
        context: `Молчание ${Math.floor(hoursSinceLastMsg / 24)} дней с ${chatName} (${chat.relationshipType}). Обычно общаетесь чаще.`,
      })
    }

    // ── UNANSWERED TRIGGER ──
    if (lastMsg.senderId !== userId && hoursSinceLastMsg > 24) {
      // Last message is from the OTHER person, and user hasn't replied in 24h+
      let decryptedPreview = ''
      try { decryptedPreview = (await decrypt(lastMsg.content)).slice(0, 100) } catch {}

      triggers.push({
        userId, chatId: chat.chatId, chatName,
        type: 'unanswered',
        context: `${chatName} написал ${Math.floor(hoursSinceLastMsg)} ч. назад, нет ответа. Превью: "${decryptedPreview}"`,
      })
    }

    // ── BURST TRIGGER ──
    // 3+ messages from contact in last 2 hours without user reply
    const twoHoursAgo = now - 2 * 60 * 60 * 1000
    const recentFromContact = recentMsgs.filter(m =>
      m.senderId !== userId &&
      m.createdAt && new Date(m.createdAt).getTime() > twoHoursAgo
    )
    const recentFromUser = recentMsgs.filter(m =>
      m.senderId === userId &&
      m.createdAt && new Date(m.createdAt).getTime() > twoHoursAgo
    )
    if (recentFromContact.length >= 3 && recentFromUser.length === 0) {
      triggers.push({
        userId, chatId: chat.chatId, chatName,
        type: 'burst',
        context: `${chatName} написал ${recentFromContact.length} сообщений за 2 часа, нет ответа`,
      })
    }

    // ── MOOD TRIGGER (Phase 4) ──
    if (isPersonal) {
      try {
        const trend = getMoodTrend(userId, chat.chatId)
        if (trend && trend.significantChange && trend.trend === 'declining') {
          triggers.push({
            userId, chatId: chat.chatId, chatName,
            type: 'mood',
            context: `Настроение ${chatName} ухудшилось: ${trend.current}. Тренд: ${trend.trend}. Возможно, стоит проявить заботу.`,
          })
        }
      } catch {}
    }

    // ── BEHAVIOR CHANGE TRIGGER (v2: baseline deviation) ──
    if (baseline && baseline.sampleSize >= 20 && recentMsgs.length >= 3) {
      try {
        const recentTexts: string[] = []
        for (const m of recentMsgs.filter(m => m.senderId !== userId)) {
          try { recentTexts.push(await decrypt(m.content)) } catch {}
        }
        if (recentTexts.length >= 2) {
          const mood = quickMoodSignal(recentTexts, 'neutral', baseline)
          if (mood.deviations.length >= 2) {
            triggers.push({
              userId, chatId: chat.chatId, chatName,
              type: 'behavior_change',
              context: `Поведение ${chatName} изменилось: ${mood.deviations.join('; ')}. Возможно, что-то происходит.`,
            })
          }
        }
      } catch {}
    }

    // ── UPCOMING DATE TRIGGER (v2: anticipatory calendar) ──
    try {
      const memories = getActiveMemories(userId, chat.chatId)
      const dateMemories = memories.filter(m => m.category === 'date')
      for (const dm of dateMemories) {
        // Try to detect dates like "18 апреля", "день рождения 5 марта" etc.
        const dateMatch = dm.fact.match(/(\d{1,2})\s*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i)
        if (dateMatch) {
          const months: Record<string, number> = {
            'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5,
            'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
          }
          const day = parseInt(dateMatch[1])
          const month = months[dateMatch[2].toLowerCase()]
          if (month !== undefined) {
            const now = new Date()
            const thisYear = new Date(now.getFullYear(), month, day)
            // If the date already passed this year, check next year
            if (thisYear.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
              thisYear.setFullYear(thisYear.getFullYear() + 1)
            }
            const daysUntil = Math.ceil((thisYear.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
            if (daysUntil > 0 && daysUntil <= 7) {
              triggers.push({
                userId, chatId: chat.chatId, chatName,
                type: 'upcoming_date',
                context: `У ${chatName} скоро важная дата: "${dm.fact}" (через ${daysUntil} дн.). Подготовьтесь!`,
              })
            }
          }
        }
      }
    } catch {}
  }

  // ── GOAL STALL TRIGGER ──
  const stalledGoals = db.select()
    .from(schema.userGoals)
    .where(and(
      eq(schema.userGoals.userId, userId),
      inArray(schema.userGoals.status, ['active', 'in_progress']),
    ))
    .all()

  for (const goal of stalledGoals) {
    const updatedAt = goal.updatedAt ? new Date(goal.updatedAt).getTime() : 0
    const hoursSinceUpdate = (now - updatedAt) / (1000 * 60 * 60)

    if (hoursSinceUpdate > 48) {
      triggers.push({
        userId,
        chatId: goal.chatId || '',
        chatName: goal.chatId ? 'связанный чат' : 'без чата',
        type: 'goal_stall',
        context: `Цель "${goal.goal}" не обновлялась ${Math.floor(hoursSinceUpdate)} ч. Прогресс: ${goal.progress}%`,
      })
    }
  }

  return triggers
}

/**
 * v2: Quick event-driven proactive check — called on every incoming message.
 * Rule-based only (no LLM), <1ms. If trigger found, enqueues LLM generation.
 */
export async function quickProactiveCheck(userId: string, chatId: string, senderId: string): Promise<void> {
  if (senderId === userId) return // only check for incoming messages from others

  try {
    const chat = db.select({ name: schema.chats.name, type: schema.chats.type })
      .from(schema.chats).where(eq(schema.chats.id, chatId)).get()
    if (!chat || chat.type !== 'private') return

    const chatName = chat.name || 'Chat'

    // Skip suspicious/scam chats
    if (isSuspiciousChat(chatName, chatId)) return

    // Check burst: 3+ messages in 2h without user reply
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const recentMsgs = db.select({ senderId: schema.messages.senderId })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal'),
        gt(schema.messages.createdAt, twoHoursAgo),
      ))
      .all()

    const fromContact = recentMsgs.filter(m => m.senderId !== userId).length
    const fromUser = recentMsgs.filter(m => m.senderId === userId).length

    if (fromContact >= 3 && fromUser === 0) {
      if (!isDuplicateAction(userId, chatId, 'burst')) {
        // Non-blocking LLM generation
        generateAction({
          userId, chatId, chatName,
          type: 'burst',
          context: `${chatName} написал ${fromContact} сообщений за 2 часа, нет ответа`,
        }).catch(() => {})
      }
    }
  } catch {}
}

/**
 * Generate a proactive action using haiku (one cheap LLM call per trigger)
 */
async function generateAction(trigger: ProactiveTrigger): Promise<boolean> {
  const config = getModelConfig('analysis')

  const typeLabels: Record<string, string> = {
    silence: 'давно не общались',
    unanswered: 'не ответили на сообщение',
    goal_stall: 'цель застопорилась',
    burst: 'много сообщений без ответа',
    mood: 'изменение настроения',
    behavior_change: 'изменение поведения в общении',
    upcoming_date: 'приближается важная дата',
    detected_need: 'обнаружена потребность в переписке',
    fraud_suspicion: 'подозрение на мошенничество',
  }

  try {
    // Get user display name for gender-correct drafts
    const user = db.select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, trigger.userId))
      .get()
    const userName = user?.displayName || ''
    const genderHint = userName ? `\nОТПРАВИТЕЛЬ сообщения — ${userName}. Используй правильный род глаголов для отправителя (${userName} — мужское имя = "не ответил", "забыл"; женское = "не ответила", "забыла").` : ''

    const result = await chatCompletion({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `Ты помощник который генерирует короткие проактивные уведомления для мессенджера.
Контекст: ${trigger.context}
Тип: ${typeLabels[trigger.type] || trigger.type}${genderHint}

Ответь ТОЛЬКО валидным JSON:
{
  "title": "Короткий заголовок (до 40 символов)",
  "body": "Одно предложение почему стоит обратить внимание",
  "draftMessage": "Готовое сообщение для отправки (тёплое, естественное, без AI-штампов)"
}

Пиши по-русски. Будь человечным, не корпоративным.`,
        },
        { role: 'user', content: trigger.context },
      ],
      temperature: 0.7,
      maxTokens: 200,
    })

    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    const actionId = crypto.randomUUID()

    // Save to DB
    db.insert(schema.proactiveActions).values({
      id: actionId,
      userId: trigger.userId,
      chatId: trigger.chatId || null,
      type: 'suggestion',
      trigger: trigger.type,
      title: parsed.title || 'Требует внимания',
      body: parsed.body || trigger.context,
      draftMessage: parsed.draftMessage || null,
      status: 'pending',
    }).run()

    // Send to user via WebSocket (if online)
    sendToUser(trigger.userId, {
      type: 'proactive_action',
      action: {
        id: actionId,
        chatId: trigger.chatId,
        chatName: trigger.chatName,
        title: parsed.title,
        body: parsed.body,
        draftMessage: parsed.draftMessage,
        type: 'suggestion',
        trigger: trigger.type,
      },
    })

    return true
  } catch (err) {
    console.error(`[PROACTIVE] Failed to generate action for ${trigger.type}:`, err)
    return false
  }
}
