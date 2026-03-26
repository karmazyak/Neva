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

// Track last scan time per user (in-memory, resets on restart — OK for MVP)
const lastScanAt = new Map<string, number>()

// Dedup: don't create same action twice in 24h
const DEDUP_WINDOW = 24 * 60 * 60 * 1000

interface ProactiveTrigger {
  userId: string
  chatId: string
  chatName: string
  type: 'silence' | 'unanswered' | 'goal_stall' | 'burst' | 'mood'
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
        // Dedup check
        const existing = db.select({ id: schema.proactiveActions.id })
          .from(schema.proactiveActions)
          .where(and(
            eq(schema.proactiveActions.userId, userId),
            eq(schema.proactiveActions.chatId, trigger.chatId),
            eq(schema.proactiveActions.trigger, trigger.type),
            eq(schema.proactiveActions.status, 'pending'),
          ))
          .get()

        if (existing) continue // already have a pending action for this

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

    // ── SILENCE TRIGGER (personal chats only) ──
    if (isPersonal && hoursSinceLastMsg > 7 * 24) { // 7 days
      triggers.push({
        userId, chatId: chat.chatId, chatName,
        type: 'silence',
        context: `Молчание ${Math.floor(hoursSinceLastMsg / 24)} дней с ${chatName} (${chat.relationshipType})`,
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
  }

  try {
    const result = await chatCompletion({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `Ты помощник который генерирует короткие проактивные уведомления для мессенджера.
Контекст: ${trigger.context}
Тип: ${typeLabels[trigger.type] || trigger.type}

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
