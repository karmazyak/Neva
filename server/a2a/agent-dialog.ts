import { db, schema } from '../db'
import { eq, and, or, desc, lt, sql } from 'drizzle-orm'
import { sendToUser } from '../ws'
import { getRelationshipLevel } from '../ai/consent'
import { chatCompletion } from '../ai/openrouter'
import { getModelConfig } from '../ai/model-router'
import { decrypt } from '../security/encryption'
import { logAgentActivity } from './agent-activity'

// ── Types ────────────────────────────────────────────────────────────────────

export type DialogType = 'whos_free' | 'get_interests' | 'match_proposal' | 'consent' | 'gather'
export type DialogStatus = 'pending' | 'auto_approved' | 'approved' | 'denied' | 'expired' | 'cancelled'
export type AutonomyAction = 'auto_approve' | 'auto_deny' | 'ask_user'

export interface CreateDialogOptions {
  initiatorUserId: string
  targetUserId: string
  type: DialogType
  contextData?: Record<string, any>
  parentDialogId?: string
  expiresInMs?: number
  initiatorMessage: string
}

export interface DialogWithMessages {
  dialog: typeof schema.agentDialogs.$inferSelect
  messages: (typeof schema.agentDialogMessages.$inferSelect)[]
  initiatorName: string
  targetName: string
}

// ── Helper: get user display name ────────────────────────────────────────────

function getUserName(userId: string): string {
  const user = db.select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()
  return user?.displayName || 'Неизвестный'
}

// ── Autonomy Rules ──────────────────────────────────────────────────────────

export function getAutonomyAction(
  targetUserId: string,
  initiatorUserId: string,
  dialogType: DialogType,
): AutonomyAction {
  const relationshipLevel = getRelationshipLevel(targetUserId, initiatorUserId)

  // Check specific rule first
  const specificRule = db.select({ action: schema.agentAutonomyRules.action })
    .from(schema.agentAutonomyRules)
    .where(and(
      eq(schema.agentAutonomyRules.userId, targetUserId),
      eq(schema.agentAutonomyRules.relationshipLevel, relationshipLevel),
      eq(schema.agentAutonomyRules.dialogType, dialogType),
    ))
    .get()

  if (specificRule) return specificRule.action as AutonomyAction

  // Check wildcard rule
  const wildcardRule = db.select({ action: schema.agentAutonomyRules.action })
    .from(schema.agentAutonomyRules)
    .where(and(
      eq(schema.agentAutonomyRules.userId, targetUserId),
      eq(schema.agentAutonomyRules.relationshipLevel, relationshipLevel),
      eq(schema.agentAutonomyRules.dialogType, '*'),
    ))
    .get()

  if (wildcardRule) return wildcardRule.action as AutonomyAction

  // Defaults based on relationship + type
  if (dialogType === 'match_proposal') return 'ask_user' // always ask for matches
  if (relationshipLevel === 'close') {
    if (dialogType === 'whos_free' || dialogType === 'get_interests') return 'auto_approve'
  }
  if (relationshipLevel === 'friend') {
    if (dialogType === 'get_interests') return 'auto_approve'
  }

  return 'ask_user'
}

// ── Smart Context Analysis ──────────────────────────────────────────────────

async function analyzeUserContext(
  targetUserId: string,
  dialogType: DialogType,
  requestContext: string,
): Promise<{ decision: 'approve' | 'deny' | 'ask'; response: string }> {
  try {
    const targetName = getUserName(targetUserId)

    // 1. Get recent messages across all chats (last 24h)
    const recentMsgs = db.select({
      content: schema.messages.content,
      chatId: schema.messages.chatId,
      createdAt: schema.messages.createdAt,
      senderId: schema.messages.senderId,
    }).from(schema.messages)
      .innerJoin(schema.chatMembers, and(
        eq(schema.messages.chatId, schema.chatMembers.chatId),
        eq(schema.chatMembers.userId, targetUserId),
      ))
      .where(eq(schema.messages.senderId, targetUserId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(15)
      .all()

    // Decrypt messages
    const decrypted: string[] = []
    for (const msg of recentMsgs) {
      try {
        const text = await decrypt(msg.content)
        if (text && text.length > 2) decrypted.push(text)
      } catch {
        if (msg.content && !msg.content.startsWith('enc:')) decrypted.push(msg.content)
      }
    }

    // 2. Get mood from contact intelligence
    let moodInfo = ''
    const ciRows = db.select({
      moodHistory: schema.contactIntelligence.moodHistory,
    }).from(schema.contactIntelligence)
      .where(eq(schema.contactIntelligence.contactId, targetUserId))
      .limit(3)
      .all()
    for (const ci of ciRows) {
      const mh = ci.moodHistory as any[]
      if (Array.isArray(mh) && mh.length > 0) {
        moodInfo = `Настроение: ${mh[0].mood}${mh[0].note ? ` (${mh[0].note})` : ''}`
        break
      }
    }

    // 3. Get active goals/plans
    const goals = db.select({ goal: schema.userGoals.goal, status: schema.userGoals.status })
      .from(schema.userGoals)
      .where(and(eq(schema.userGoals.userId, targetUserId), eq(schema.userGoals.status, 'active')))
      .limit(3)
      .all()

    // 4. LLM decision
    const config = getModelConfig('classification')
    const contextBlock = [
      `Последние сообщения ${targetName}:`,
      decrypted.length > 0 ? decrypted.slice(0, 8).join('\n') : '(нет данных)',
      moodInfo || '(настроение неизвестно)',
      goals.length > 0 ? `Активные цели: ${goals.map(g => g.goal).join('; ')}` : '',
    ].filter(Boolean).join('\n')

    const prompt = dialogType === 'whos_free'
      ? `Ты — персональный агент пользователя ${targetName}. Кто-то спрашивает: "${requestContext}".
На основе контекста определи:
- Свободен ли ${targetName}? Занят работой? В плохом настроении?
- Стоит ли соглашаться на встречу/общение?

Контекст:
${contextBlock}

Ответь JSON (без markdown):
{"decision": "approve|deny|ask", "response": "короткий ответ от лица агента на русском, 1-2 предложения"}`
      : `Ты — персональный агент пользователя ${targetName}. Поступил запрос типа "${dialogType}": "${requestContext}".
На основе контекста определи, стоит ли одобрить.

Контекст:
${contextBlock}

Ответь JSON (без markdown):
{"decision": "approve|deny|ask", "response": "короткий ответ от лица агента на русском, 1-2 предложения"}`

    const result = await chatCompletion({
      model: config.model,
      messages: [
        { role: 'system', content: 'Ты персональный AI-агент. Отвечай ТОЛЬКО валидным JSON. Принимай решение на основе контекста пользователя.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 200,
    })

    // Parse LLM response
    const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const decision = ['approve', 'deny', 'ask'].includes(parsed.decision) ? parsed.decision : 'ask'
    return { decision, response: parsed.response || `Агент ${targetName} рассмотрел запрос.` }
  } catch (err) {
    console.error('[SmartAgent] Analysis failed:', (err as Error).message)
    return { decision: 'ask', response: 'Не удалось проанализировать контекст. Запрос передан пользователю.' }
  }
}

// ── Create Dialog ────────────────────────────────────────────────────────────

export async function createDialog(opts: CreateDialogOptions): Promise<{
  dialogId: string
  status: DialogStatus
  autoResolved: boolean
  autonomyAction: AutonomyAction
}> {
  const dialogId = crypto.randomUUID()
  const expiresAt = opts.expiresInMs
    ? new Date(Date.now() + opts.expiresInMs)
    : new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h default

  // Determine autonomy
  const autonomyAction = getAutonomyAction(opts.targetUserId, opts.initiatorUserId, opts.type)

  const initiatorName = getUserName(opts.initiatorUserId)
  const targetName = getUserName(opts.targetUserId)

  // Create dialog record
  db.insert(schema.agentDialogs).values({
    id: dialogId,
    initiatorUserId: opts.initiatorUserId,
    targetUserId: opts.targetUserId,
    type: opts.type,
    status: 'pending',
    contextData: opts.contextData || {},
    parentDialogId: opts.parentDialogId || null,
    expiresAt,
  }).run()

  // Record initiator agent's message
  addDialogMessage(dialogId, 'initiator', opts.initiatorMessage)

  if (autonomyAction === 'auto_approve' || autonomyAction === 'auto_deny') {
    // Smart analysis: agent reviews user's context before deciding
    const requestContext = opts.contextData?.context || opts.initiatorMessage
    const analysis = await analyzeUserContext(opts.targetUserId, opts.type, requestContext)

    // Agent's decision may override the autonomy rule based on context
    const finalDecision = autonomyAction === 'auto_deny' ? 'deny' : analysis.decision

    if (finalDecision === 'approve') {
      db.update(schema.agentDialogs)
        .set({ status: 'auto_approved', updatedAt: new Date() })
        .where(eq(schema.agentDialogs.id, dialogId))
        .run()

      addDialogMessage(dialogId, 'target', analysis.response)
      notifyDialogUpdate(dialogId, opts.initiatorUserId, opts.targetUserId, 'auto_approved', initiatorName, targetName)

      // Log to activity feed
      logAgentActivity(opts.targetUserId, {
        type: 'auto_response',
        title: `Ответил ${initiatorName}: ${analysis.response.slice(0, 60)}`,
        body: analysis.response,
        relatedDialogId: dialogId,
        relatedUserId: opts.initiatorUserId,
        metadata: { dialogType: opts.type, decision: 'approve' },
        undoable: true,
        undoWindowMs: 300000, // 5 min
      })

      return { dialogId, status: 'auto_approved', autoResolved: true, autonomyAction }
    }

    if (finalDecision === 'deny') {
      db.update(schema.agentDialogs)
        .set({ status: 'denied', updatedAt: new Date() })
        .where(eq(schema.agentDialogs.id, dialogId))
        .run()

      addDialogMessage(dialogId, 'target', analysis.response)
      notifyDialogUpdate(dialogId, opts.initiatorUserId, opts.targetUserId, 'denied', initiatorName, targetName)

      // Log to activity feed
      logAgentActivity(opts.targetUserId, {
        type: 'auto_response',
        title: `Отклонил запрос ${initiatorName}`,
        body: analysis.response,
        relatedDialogId: dialogId,
        relatedUserId: opts.initiatorUserId,
        metadata: { dialogType: opts.type, decision: 'deny' },
        undoable: true,
        undoWindowMs: 300000,
      })

      return { dialogId, status: 'denied', autoResolved: true, autonomyAction }
    }

    // decision === 'ask' — fall through to ask_user below
  }

  // ask_user: send WebSocket notification to target
  sendToUser(opts.targetUserId, {
    type: 'agent_dialog_request',
    dialog: {
      id: dialogId,
      type: opts.type,
      initiatorUserId: opts.initiatorUserId,
      initiatorName,
      message: opts.initiatorMessage,
      contextData: opts.contextData,
      expiresAt: expiresAt.toISOString(),
    },
  })

  return { dialogId, status: 'pending', autoResolved: false, autonomyAction }
}

// ── Respond to Dialog ────────────────────────────────────────────────────────

export function respondToDialog(
  dialogId: string,
  approved: boolean,
  message?: string,
  resultData?: Record<string, any>,
): boolean {
  const dialog = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, dialogId))
    .get()

  if (!dialog) return false
  if (dialog.status !== 'pending') return false

  const newStatus: DialogStatus = approved ? 'approved' : 'denied'
  const targetName = getUserName(dialog.targetUserId)
  const initiatorName = getUserName(dialog.initiatorUserId)

  // Update dialog
  db.update(schema.agentDialogs)
    .set({
      status: newStatus,
      result: resultData || null,
      updatedAt: new Date(),
    })
    .where(eq(schema.agentDialogs.id, dialogId))
    .run()

  // Record response message
  const responseText = message || (approved
    ? `${targetName} одобрил запрос`
    : `${targetName} отклонил запрос`)
  addDialogMessage(dialogId, 'target', responseText, resultData)

  // Notify initiator
  notifyDialogUpdate(dialogId, dialog.initiatorUserId, dialog.targetUserId, newStatus, initiatorName, targetName, message, resultData)

  return true
}

// ── Add Message to Dialog ────────────────────────────────────────────────────

export function addDialogMessage(
  dialogId: string,
  agentRole: 'initiator' | 'target',
  content: string,
  metadata?: Record<string, any>,
) {
  db.insert(schema.agentDialogMessages).values({
    id: crypto.randomUUID(),
    dialogId,
    agentRole,
    content,
    metadata: metadata || null,
  }).run()
}

// ── Query Dialogs ────────────────────────────────────────────────────────────

export function getDialogsForUser(
  userId: string,
  filters?: { status?: DialogStatus; type?: DialogType; limit?: number },
): DialogWithMessages[] {
  let query = db.select()
    .from(schema.agentDialogs)
    .where(
      or(
        eq(schema.agentDialogs.initiatorUserId, userId),
        eq(schema.agentDialogs.targetUserId, userId),
      )
    )
    .orderBy(desc(schema.agentDialogs.createdAt))
    .$dynamic()

  const dialogs = query.all()

  // Filter in JS since Drizzle dynamic where chaining is tricky
  let filtered = dialogs
  if (filters?.status) filtered = filtered.filter(d => d.status === filters.status)
  if (filters?.type) filtered = filtered.filter(d => d.type === filters.type)
  if (filters?.limit) filtered = filtered.slice(0, filters.limit)

  return filtered.map(dialog => {
    const messages = db.select()
      .from(schema.agentDialogMessages)
      .where(eq(schema.agentDialogMessages.dialogId, dialog.id))
      .orderBy(schema.agentDialogMessages.createdAt)
      .all()

    return {
      dialog,
      messages,
      initiatorName: getUserName(dialog.initiatorUserId),
      targetName: getUserName(dialog.targetUserId),
    }
  })
}

export function getDialogWithMessages(dialogId: string): DialogWithMessages | null {
  const dialog = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, dialogId))
    .get()

  if (!dialog) return null

  const messages = db.select()
    .from(schema.agentDialogMessages)
    .where(eq(schema.agentDialogMessages.dialogId, dialogId))
    .orderBy(schema.agentDialogMessages.createdAt)
    .all()

  return {
    dialog,
    messages,
    initiatorName: getUserName(dialog.initiatorUserId),
    targetName: getUserName(dialog.targetUserId),
  }
}

export function getPendingDialogsForUser(userId: string) {
  return db.select()
    .from(schema.agentDialogs)
    .where(and(
      eq(schema.agentDialogs.targetUserId, userId),
      eq(schema.agentDialogs.status, 'pending'),
    ))
    .orderBy(desc(schema.agentDialogs.createdAt))
    .all()
}

// ── Expire Stale Dialogs ─────────────────────────────────────────────────────

export function checkExpiredDialogs(): number {
  const now = new Date()
  const expired = db.select({ id: schema.agentDialogs.id, initiatorUserId: schema.agentDialogs.initiatorUserId })
    .from(schema.agentDialogs)
    .where(and(
      eq(schema.agentDialogs.status, 'pending'),
      lt(schema.agentDialogs.expiresAt, now),
    ))
    .all()

  for (const dialog of expired) {
    db.update(schema.agentDialogs)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(schema.agentDialogs.id, dialog.id))
      .run()

    addDialogMessage(dialog.id, 'target', 'Время ожидания ответа истекло')

    sendToUser(dialog.initiatorUserId, {
      type: 'agent_dialog_update',
      dialogId: dialog.id,
      status: 'expired',
    })
  }

  return expired.length
}

// ── Cancel Dialog ────────────────────────────────────────────────────────────

export function cancelDialog(dialogId: string, userId: string): boolean {
  const dialog = db.select()
    .from(schema.agentDialogs)
    .where(and(
      eq(schema.agentDialogs.id, dialogId),
      eq(schema.agentDialogs.initiatorUserId, userId),
      eq(schema.agentDialogs.status, 'pending'),
    ))
    .get()

  if (!dialog) return false

  db.update(schema.agentDialogs)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(schema.agentDialogs.id, dialogId))
    .run()

  addDialogMessage(dialogId, 'initiator', 'Запрос отменён')

  sendToUser(dialog.targetUserId, {
    type: 'agent_dialog_update',
    dialogId,
    status: 'cancelled',
  })

  return true
}

// ── Notifications ────────────────────────────────────────────────────────────

function notifyDialogUpdate(
  dialogId: string,
  initiatorUserId: string,
  targetUserId: string,
  status: DialogStatus,
  initiatorName: string,
  targetName: string,
  message?: string,
  resultData?: Record<string, any>,
) {
  // Notify initiator about the result
  sendToUser(initiatorUserId, {
    type: 'agent_dialog_update',
    dialogId,
    status,
    targetName,
    message,
    result: resultData,
  })

  // Notify target about auto-actions (so they see what their agent did)
  if (status === 'auto_approved' || status === 'denied') {
    sendToUser(targetUserId, {
      type: 'agent_dialog_auto',
      dialogId,
      status,
      initiatorName,
      message: status === 'auto_approved'
        ? `Ваш агент автоматически одобрил запрос от ${initiatorName}`
        : `Ваш агент автоматически отклонил запрос от ${initiatorName}`,
    })
  }
}

// ── Autonomy Rules CRUD ──────────────────────────────────────────────────────

export function getAutonomyRules(userId: string) {
  return db.select()
    .from(schema.agentAutonomyRules)
    .where(eq(schema.agentAutonomyRules.userId, userId))
    .all()
}

export function upsertAutonomyRule(
  userId: string,
  relationshipLevel: string,
  dialogType: string,
  action: AutonomyAction,
) {
  const existing = db.select({ id: schema.agentAutonomyRules.id })
    .from(schema.agentAutonomyRules)
    .where(and(
      eq(schema.agentAutonomyRules.userId, userId),
      eq(schema.agentAutonomyRules.relationshipLevel, relationshipLevel),
      eq(schema.agentAutonomyRules.dialogType, dialogType),
    ))
    .get()

  if (existing) {
    db.update(schema.agentAutonomyRules)
      .set({ action })
      .where(eq(schema.agentAutonomyRules.id, existing.id))
      .run()
  } else {
    db.insert(schema.agentAutonomyRules).values({
      userId,
      relationshipLevel,
      dialogType,
      action,
    }).run()
  }
}
