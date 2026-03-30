import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'
import { createDialog, respondToDialog, addDialogMessage } from './agent-dialog'
import type { DialogType } from './agent-dialog'
import { getDirectContacts, findMatchingOffers, getSocialDistance } from '../ai/matching'
import { getRelationshipLevel } from '../ai/consent'
import { generateEmbedding } from '../ai/embeddings'
import { sendToUser, broadcastToChat } from '../ws'
import { encrypt } from '../security/encryption'
import { logAgentActivity } from './agent-activity'
import { chatCompletion } from '../ai/openrouter'
import { getModelConfig } from '../ai/model-router'
import {
  sanitizeA2AInput,
  hasInjectionSignals,
  checkA2ARateLimit,
  trackTargetRequest,
  logSecurityEvent,
} from './security'
import { isBlockedBy, isDisclosable, getPublicProfile } from './privacy-vault'

// ── Helper ───────────────────────────────────────────────────────────────────

function getUserName(userId: string): string {
  const user = db.select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()
  return user?.displayName || 'Неизвестный'
}

function findPrivateChatBetween(userA: string, userB: string): string | null {
  const result = db.select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(and(
      eq(schema.chatMembers.userId, userA),
      eq(schema.chats.type, 'private'),
    ))
    .all()

  for (const row of result) {
    const otherMember = db.select({ userId: schema.chatMembers.userId })
      .from(schema.chatMembers)
      .where(and(
        eq(schema.chatMembers.chatId, row.chatId),
        eq(schema.chatMembers.userId, userB),
      ))
      .get()
    if (otherMember) return row.chatId
  }
  return null
}

async function insertGatherResultCard(
  chatId: string,
  senderId: string,
  data: {
    parentDialogId: string
    context: string
    plan: { what: string; when: string; where?: string }
    available: Array<{ userId: string; name: string }>
    unavailable: Array<{ userId: string; name: string }>
    initiatorName: string
  }
) {
  const cardContent = JSON.stringify({
    cardType: 'gather_result',
    ...data,
  })
  const encrypted = await encrypt(cardContent)
  const messageId = crypto.randomUUID()

  db.insert(schema.messages).values({
    id: messageId,
    chatId,
    senderId,
    content: encrypted,
    type: 'system',
    metadata: { cardType: 'gather_result', parentDialogId: data.parentDialogId },
  }).run()

  // Get sender info
  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, senderId)).get()

  broadcastToChat(chatId, {
    type: 'new_message',
    message: {
      id: messageId,
      chatId,
      senderId,
      senderName: sender?.displayName || '',
      senderAvatar: sender?.avatar || null,
      content: cardContent,
      type: 'system',
      status: 'sent',
      metadata: { cardType: 'gather_result', parentDialogId: data.parentDialogId },
      createdAt: new Date().toISOString(),
    },
  })
}

// ── 1. Who's Free? ──────────────────────────────────────────────────────────

export interface WhosFreeResult {
  parentDialogId: string
  friendsAsked: number
  childDialogIds: string[]
}

export async function handleWhosFree(
  initiatorUserId: string,
  context: string,
  timeoutMs: number = 7200000, // 2h default
): Promise<WhosFreeResult> {
  // Security: sanitize context text
  context = sanitizeA2AInput(context)
  if (hasInjectionSignals(context)) {
    logSecurityEvent({ type: 'injection_attempt', userId: initiatorUserId, details: 'whos_free context' })
  }

  const initiatorName = getUserName(initiatorUserId)

  // Get friends (not acquaintances), excluding blocked users
  const contacts = getDirectContacts(initiatorUserId)
  const friends = contacts.filter(contactId => {
    if (isBlockedBy(contactId, initiatorUserId)) return false
    const level = getRelationshipLevel(initiatorUserId, contactId)
    return level === 'friend' || level === 'close'
  })

  // Create parent dialog (for grouping) — status 'approved' means "active/tracking", not "pending approval"
  const parentDialogId = crypto.randomUUID()
  db.insert(schema.agentDialogs).values({
    id: parentDialogId,
    initiatorUserId,
    targetUserId: initiatorUserId, // self-referencing parent
    type: 'whos_free',
    status: 'approved',
    contextData: { context, friendsAsked: friends.length, isParent: true },
    expiresAt: new Date(Date.now() + timeoutMs),
  }).run()

  addDialogMessage(parentDialogId, 'initiator',
    `${initiatorName} спрашивает: "${context}" — опрос ${friends.length} друзей`)

  const childDialogIds: string[] = []

  // Create a child dialog for each friend
  for (const friendId of friends) {
    const friendName = getUserName(friendId)
    const result = await createDialog({
      initiatorUserId,
      targetUserId: friendId,
      type: 'whos_free',
      contextData: { context, parentDialogId },
      parentDialogId,
      expiresInMs: timeoutMs,
      initiatorMessage: `Агент ${initiatorName} спрашивает: "${context}"`,
    })

    childDialogIds.push(result.dialogId)

    // If auto-resolved, immediately update parent
    if (result.autoResolved) {
      const status = result.status === 'auto_approved' ? 'available' : 'declined'
      addDialogMessage(parentDialogId, 'target',
        `${friendName}: ${status === 'available' ? '✅ свободен (авто)' : '❌ отклонено (авто)'}`)

      // Notify initiator about this friend's result
      sendToUser(initiatorUserId, {
        type: 'agent_dialog_update',
        dialogId: parentDialogId,
        partialResult: {
          friendId,
          friendName,
          available: status === 'available',
          auto: true,
        },
      })
    }
  }

  return { parentDialogId, friendsAsked: friends.length, childDialogIds }
}

/**
 * Called when a child "whos_free" dialog gets a response.
 * Updates the parent dialog with partial results.
 */
export function handleWhosFreeChildResponse(
  childDialogId: string,
  approved: boolean,
  message?: string,
) {
  const child = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, childDialogId))
    .get()

  if (!child || child.type !== 'whos_free' || !child.parentDialogId) return

  // Respond to child dialog
  respondToDialog(childDialogId, approved, message)

  // Update parent dialog with this response
  const friendName = getUserName(child.targetUserId)
  addDialogMessage(child.parentDialogId, 'target',
    `${friendName}: ${approved ? '✅ свободен' : '❌ занят'}${message ? ` — "${message}"` : ''}`)

  // Notify initiator about this partial result
  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, child.parentDialogId))
    .get()

  if (parent) {
    sendToUser(parent.initiatorUserId, {
      type: 'agent_dialog_update',
      dialogId: parent.id,
      partialResult: {
        friendId: child.targetUserId,
        friendName,
        available: approved,
        message,
        auto: false,
      },
    })

    // Check if all children are resolved
    const siblings = db.select({ status: schema.agentDialogs.status })
      .from(schema.agentDialogs)
      .where(eq(schema.agentDialogs.parentDialogId, child.parentDialogId))
      .all()

    const allResolved = siblings.every(s =>
      s.status !== 'pending'
    )

    if (allResolved) {
      db.update(schema.agentDialogs)
        .set({
          status: 'approved', // completed
          updatedAt: new Date(),
          result: { completed: true },
        })
        .where(eq(schema.agentDialogs.id, child.parentDialogId))
        .run()

      addDialogMessage(child.parentDialogId, 'initiator', 'Все друзья ответили на вопрос')

      sendToUser(parent.initiatorUserId, {
        type: 'agent_dialog_update',
        dialogId: parent.id,
        status: 'completed',
        allResolved: true,
      })
    }
  }
}

// ── 2. Get Interests ────────────────────────────────────────────────────────

export interface GetInterestsResult {
  dialogId: string
  autoResolved: boolean
  interests?: string[]
}

export async function handleGetInterests(
  initiatorUserId: string,
  targetUserId: string,
): Promise<GetInterestsResult> {
  // Security: check blocked + privacy vault
  if (isBlockedBy(targetUserId, initiatorUserId)) {
    logSecurityEvent({ type: 'blocked_user', userId: initiatorUserId, targetUserId })
    const dialogId = crypto.randomUUID()
    return { dialogId, autoResolved: true, interests: [] }
  }
  if (!isDisclosable(targetUserId, 'interests')) {
    const dialogId = crypto.randomUUID()
    return { dialogId, autoResolved: true, interests: [] }
  }

  // Security: anomaly tracking
  const isAnomalous = trackTargetRequest(initiatorUserId, targetUserId)
  if (isAnomalous) {
    logSecurityEvent({ type: 'anomaly_detected', userId: initiatorUserId, targetUserId, details: 'get_interests' })
  }

  const initiatorName = getUserName(initiatorUserId)
  const targetName = getUserName(targetUserId)

  const result = await createDialog({
    initiatorUserId,
    targetUserId,
    type: 'get_interests',
    contextData: {},
    expiresInMs: 24 * 60 * 60 * 1000,
    initiatorMessage: `Агент ${initiatorName} запрашивает интересы ${targetName}`,
  })

  if (result.autoResolved && (result.status === 'auto_approved')) {
    // Collect self-reported data from the target user
    const interests = collectSelfReportedInterests(targetUserId)

    // Store result
    db.update(schema.agentDialogs)
      .set({ result: { interests } })
      .where(eq(schema.agentDialogs.id, result.dialogId))
      .run()

    addDialogMessage(result.dialogId, 'target',
      `Интересы ${targetName}: ${interests.join(', ') || 'нет данных'}`,
      { interests })

    return { dialogId: result.dialogId, autoResolved: true, interests }
  }

  return { dialogId: result.dialogId, autoResolved: false }
}

/**
 * Collect SELF-REPORTED interests from a user's own data.
 * Not what others think — what the user themselves has put in.
 */
export function collectSelfReportedInterests(userId: string): string[] {
  const interests = new Set<string>()

  // 1. From user's offers (what they say they can do/want to do)
  const userOffers = db.select({ description: schema.offers.description })
    .from(schema.offers)
    .where(eq(schema.offers.userId, userId))
    .all()
  for (const o of userOffers) {
    interests.add(o.description)
  }

  // 2. From knowledge graph entities of type 'interest' (where user is the owner)
  const kgEntries = db.select({ entities: schema.contactKnowledgeGraph.entities })
    .from(schema.contactKnowledgeGraph)
    .where(eq(schema.contactKnowledgeGraph.userId, userId))
    .all()

  for (const entry of kgEntries) {
    const entities = entry.entities as Array<{ type: string; name: string }> | null
    if (entities) {
      for (const e of entities) {
        if (e.type === 'interest') interests.add(e.name)
      }
    }
  }

  // 3. From user's own contact_intelligence persona (activeTopics) where THEY are the contact
  // This represents what the system has learned about the user from their own behavior
  const selfIntels = db.select({ persona: schema.contactIntelligence.persona })
    .from(schema.contactIntelligence)
    .where(eq(schema.contactIntelligence.contactId, userId))
    .all()

  for (const intel of selfIntels) {
    const persona = intel.persona as Record<string, any> | null
    const topics = persona?.currentState?.activeTopics as string[] | undefined
    if (topics) {
      for (const t of topics) interests.add(t)
    }
  }

  return [...interests]
}

// ── 3. Match Proposal ────────────────────────────────────────────────────────

export interface MatchProposalResult {
  dialogId: string
  matchId: string
  autoResolved: boolean
}

export async function handleMatchProposal(
  initiatorUserId: string,
  targetUserId: string,
  needId: string,
  offerId: string,
  needDescription: string,
): Promise<MatchProposalResult> {
  // Security: sanitize need description
  needDescription = sanitizeA2AInput(needDescription)
  if (hasInjectionSignals(needDescription)) {
    logSecurityEvent({ type: 'injection_attempt', userId: initiatorUserId, details: 'match_proposal need' })
  }

  // Security: check blocked
  if (isBlockedBy(targetUserId, initiatorUserId)) {
    logSecurityEvent({ type: 'blocked_user', userId: initiatorUserId, targetUserId })
    const dialogId = crypto.randomUUID()
    const matchId = crypto.randomUUID()
    return { dialogId, matchId, autoResolved: true }
  }

  const initiatorName = getUserName(initiatorUserId)
  const { distance, via } = getSocialDistance(initiatorUserId, targetUserId)

  // Create match record
  const matchId = crypto.randomUUID()
  db.insert(schema.matches).values({
    id: matchId,
    needId,
    offerId,
    requesterId: initiatorUserId,
    providerId: targetUserId,
    similarityScore: 0,
    socialDistance: distance,
    mutualContactId: via || null,
    status: 'proposed',
  }).run()

  const contextMessage = via
    ? `Знакомый ${initiatorName} ищет: "${needDescription}". Предложить вас?`
    : `${initiatorName} ищет: "${needDescription}". Предложить вас?`

  const result = await createDialog({
    initiatorUserId,
    targetUserId,
    type: 'match_proposal',
    contextData: { matchId, needId, offerId, needDescription },
    expiresInMs: 24 * 60 * 60 * 1000,
    initiatorMessage: contextMessage,
  })

  return { dialogId: result.dialogId, matchId, autoResolved: result.autoResolved }
}

/**
 * Called when target responds to a match proposal dialog.
 */
export function handleMatchProposalResponse(
  dialogId: string,
  approved: boolean,
  message?: string,
) {
  const dialog = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, dialogId))
    .get()

  if (!dialog || dialog.type !== 'match_proposal') return

  const contextData = dialog.contextData as { matchId: string } | null
  if (!contextData?.matchId) return

  // Respond to dialog
  respondToDialog(dialogId, approved, message, { matchId: contextData.matchId })

  // Update match status
  db.update(schema.matches)
    .set({ status: approved ? 'accepted' : 'declined' })
    .where(eq(schema.matches.id, contextData.matchId))
    .run()

  // Notify initiator about match result
  sendToUser(dialog.initiatorUserId, {
    type: 'match_update',
    matchId: contextData.matchId,
    status: approved ? 'accepted' : 'declined',
    providerMessage: message,
    dialogId,
  })
}

// ── 4. Generic Consent (replaces old consent system) ─────────────────────────

export interface ConsentDialogResult {
  dialogId: string
  autoResolved: boolean
  approved?: boolean
}

export async function handleConsentDialog(
  fromUserId: string,
  toUserId: string,
  consentType: string,
  context: string,
  timeoutMs: number = 86400000,
): Promise<ConsentDialogResult> {
  // Security: sanitize context
  context = sanitizeA2AInput(context)
  if (hasInjectionSignals(context)) {
    logSecurityEvent({ type: 'injection_attempt', userId: fromUserId, details: `consent ${consentType}` })
  }

  // Security: check blocked
  if (isBlockedBy(toUserId, fromUserId)) {
    logSecurityEvent({ type: 'blocked_user', userId: fromUserId, targetUserId: toUserId })
    return { dialogId: crypto.randomUUID(), autoResolved: true, approved: false }
  }

  const fromName = getUserName(fromUserId)

  const result = await createDialog({
    initiatorUserId: fromUserId,
    targetUserId: toUserId,
    type: 'consent',
    contextData: { consentType, context },
    expiresInMs: timeoutMs,
    initiatorMessage: `Агент ${fromName}: ${context}`,
  })

  // Also create legacy consent_request record (linked via dialogId)
  db.insert(schema.consentRequests).values({
    id: crypto.randomUUID(),
    fromUserId,
    toUserId,
    type: consentType as any,
    context,
    status: result.autoResolved
      ? (result.status === 'auto_approved' ? 'approved' : 'denied')
      : 'pending',
    dialogId: result.dialogId,
    expiresAt: new Date(Date.now() + timeoutMs),
  }).run()

  return {
    dialogId: result.dialogId,
    autoResolved: result.autoResolved,
    approved: result.autoResolved
      ? result.status === 'auto_approved'
      : undefined,
  }
}

// ── 5. Gather Company (full flow) ───────────────────────────────────────────

export interface GatherResult {
  parentDialogId: string
  friendsAsked: number
  childDialogIds: string[]
}

export async function handleGatherCompany(
  initiatorUserId: string,
  context: string,
  timeoutMs: number = 1800000, // 30 min
  filter?: { minRelationship?: string },
): Promise<GatherResult> {
  // Security: sanitize context
  context = sanitizeA2AInput(context)
  if (hasInjectionSignals(context)) {
    logSecurityEvent({ type: 'injection_attempt', userId: initiatorUserId, details: 'gather context' })
  }

  const initiatorName = getUserName(initiatorUserId)

  // Get friends, excluding blocked users
  const contacts = getDirectContacts(initiatorUserId)
  const minLevel = filter?.minRelationship || 'friend'
  const friends = contacts.filter(contactId => {
    if (isBlockedBy(contactId, initiatorUserId)) return false
    const level = getRelationshipLevel(initiatorUserId, contactId)
    if (minLevel === 'close') return level === 'close'
    return level === 'friend' || level === 'close'
  })

  // Create parent dialog
  const parentDialogId = crypto.randomUUID()
  db.insert(schema.agentDialogs).values({
    id: parentDialogId,
    initiatorUserId,
    targetUserId: initiatorUserId, // self-referencing parent
    type: 'gather',
    status: 'pending',
    contextData: {
      context,
      phase: 'asking',
      friendsAsked: friends.length,
      available: [],
      unavailable: [],
      pending: friends.length,
    },
    expiresAt: new Date(Date.now() + timeoutMs),
  }).run()

  addDialogMessage(parentDialogId, 'initiator',
    `${initiatorName} собирает компанию: "${context}" — опрос ${friends.length} друзей`)

  // Log activity
  logAgentActivity(initiatorUserId, {
    type: 'gather_started',
    title: `Собираю компанию: "${context.slice(0, 50)}"`,
    body: `Опрашиваю ${friends.length} друзей`,
    relatedDialogId: parentDialogId,
    metadata: { friendsCount: friends.length },
  })

  const childDialogIds: string[] = []

  // Create child dialogs
  for (const friendId of friends) {
    const friendName = getUserName(friendId)
    const result = await createDialog({
      initiatorUserId,
      targetUserId: friendId,
      type: 'whos_free',
      contextData: { context, parentDialogId, isGatherChild: true },
      parentDialogId,
      expiresInMs: timeoutMs,
      initiatorMessage: `${initiatorName} собирает компанию: "${context}". Ты свободен?`,
    })

    childDialogIds.push(result.dialogId)

    // If auto-resolved, update parent
    if (result.autoResolved) {
      const available = result.status === 'auto_approved'
      updateGatherParent(parentDialogId, initiatorUserId, friendId, friendName, available, undefined, true)
    }
  }

  // Check if all already resolved (e.g. all auto-approved)
  checkGatherComplete(parentDialogId, initiatorUserId)

  return { parentDialogId, friendsAsked: friends.length, childDialogIds }
}

/**
 * Update parent gather dialog with a friend's response
 */
function updateGatherParent(
  parentDialogId: string,
  initiatorUserId: string,
  friendId: string,
  friendName: string,
  available: boolean,
  message?: string,
  auto?: boolean,
) {
  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .get()

  if (!parent) return

  const ctx = (parent.contextData || {}) as any
  const entry = { userId: friendId, name: friendName, message, auto }

  if (available) {
    ctx.available = [...(ctx.available || []), entry]
  } else {
    ctx.unavailable = [...(ctx.unavailable || []), entry]
  }
  ctx.pending = Math.max(0, (ctx.pending || 0) - 1)

  db.update(schema.agentDialogs)
    .set({ contextData: ctx, updatedAt: new Date() })
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .run()

  addDialogMessage(parentDialogId, 'target',
    `${friendName}: ${available ? '✅ свободен' : '❌ занят'}${message ? ` — "${message}"` : ''}${auto ? ' (авто)' : ''}`)

  // Send progress update
  sendToUser(initiatorUserId, {
    type: 'gather_progress',
    parentDialogId,
    available: ctx.available,
    unavailable: ctx.unavailable,
    pending: ctx.pending,
    phase: ctx.phase,
  })
}

/**
 * Check if gather is complete, generate plan if so
 */
async function checkGatherComplete(parentDialogId: string, initiatorUserId: string) {
  const siblings = db.select({ status: schema.agentDialogs.status })
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.parentDialogId, parentDialogId))
    .all()

  const allResolved = siblings.length > 0 && siblings.every(s => s.status !== 'pending')
  if (!allResolved) return

  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .get()

  if (!parent) return
  const ctx = (parent.contextData || {}) as any

  if (ctx.phase !== 'asking') return // already moved past asking

  // Generate plan if there are available friends
  if ((ctx.available || []).length > 0) {
    ctx.phase = 'planning'
    db.update(schema.agentDialogs)
      .set({ contextData: ctx, updatedAt: new Date() })
      .where(eq(schema.agentDialogs.id, parentDialogId))
      .run()

    try {
      const availableNames = (ctx.available as any[]).map((a: any) =>
        `${a.name}${a.message ? ` (${a.message})` : ''}`
      ).join(', ')

      const config = getModelConfig('generation')
      const result = await chatCompletion({
        model: config.model,
        messages: [
          { role: 'system', content: 'Ты помощник для организации встреч. Отвечай ТОЛЬКО валидным JSON.' },
          { role: 'user', content: `Пользователь хочет: "${ctx.context}". Свободны: ${availableNames}. Предложи план встречи. Ответь JSON: {"what": "описание", "when": "время", "where": "место"}` },
        ],
        temperature: 0.7,
        maxTokens: 300,
      })

      const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim()
      const plan = JSON.parse(cleaned)
      ctx.plan = plan
      ctx.phase = 'confirming'
    } catch (err) {
      console.error('[Gather] Plan generation failed:', (err as Error).message)
      ctx.plan = {
        what: ctx.context,
        when: 'Договоритесь о времени',
        where: 'Договоритесь о месте',
      }
      ctx.phase = 'confirming'
    }

    db.update(schema.agentDialogs)
      .set({ contextData: ctx, updatedAt: new Date() })
      .where(eq(schema.agentDialogs.id, parentDialogId))
      .run()

    // Notify initiator
    sendToUser(initiatorUserId, {
      type: 'gather_plan_ready',
      parentDialogId,
      plan: ctx.plan,
      available: ctx.available,
      unavailable: ctx.unavailable,
    })

    logAgentActivity(initiatorUserId, {
      type: 'gather_result',
      title: `Компания собрана: ${(ctx.available || []).length} свободны`,
      body: ctx.plan ? `${ctx.plan.what} — ${ctx.plan.when}` : undefined,
      relatedDialogId: parentDialogId,
      metadata: { availableCount: (ctx.available || []).length },
    })
  } else {
    // Nobody available
    ctx.phase = 'complete'
    db.update(schema.agentDialogs)
      .set({ contextData: ctx, status: 'denied', updatedAt: new Date() })
      .where(eq(schema.agentDialogs.id, parentDialogId))
      .run()

    sendToUser(initiatorUserId, {
      type: 'gather_plan_ready',
      parentDialogId,
      plan: null,
      available: [],
      unavailable: ctx.unavailable,
    })

    logAgentActivity(initiatorUserId, {
      type: 'gather_result',
      title: 'Никто не свободен',
      relatedDialogId: parentDialogId,
    })
  }
}

/**
 * Called when a child dialog of a gather gets a response
 */
export function handleGatherChildResponse(
  childDialogId: string,
  approved: boolean,
  message?: string,
) {
  const child = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, childDialogId))
    .get()

  if (!child || !child.parentDialogId) return

  // Check if parent is a gather
  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, child.parentDialogId))
    .get()

  if (!parent || parent.type !== 'gather') return

  // Respond to child
  respondToDialog(childDialogId, approved, message)

  const friendName = getUserName(child.targetUserId)
  updateGatherParent(child.parentDialogId, parent.initiatorUserId, child.targetUserId, friendName, approved, message, false)

  // Check completion
  checkGatherComplete(child.parentDialogId, parent.initiatorUserId)
}

/**
 * Get current gather status for API
 */
export function getGatherStatus(parentDialogId: string, userId: string) {
  const parent = db.select()
    .from(schema.agentDialogs)
    .where(and(
      eq(schema.agentDialogs.id, parentDialogId),
      eq(schema.agentDialogs.initiatorUserId, userId),
    ))
    .get()

  if (!parent || parent.type !== 'gather') return null

  const ctx = (parent.contextData || {}) as any

  return {
    parentDialogId,
    phase: ctx.phase || 'asking',
    context: ctx.context,
    friendsAsked: ctx.friendsAsked || 0,
    available: ctx.available || [],
    unavailable: ctx.unavailable || [],
    pending: ctx.pending || 0,
    plan: ctx.plan || null,
    status: parent.status,
  }
}

/**
 * Confirm gather plan and notify friends
 */
export async function confirmGather(
  parentDialogId: string,
  userId: string,
  data: { plan: { what: string; when: string; where?: string }; selectedFriends?: string[]; createGroup?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const parent = db.select()
    .from(schema.agentDialogs)
    .where(and(
      eq(schema.agentDialogs.id, parentDialogId),
      eq(schema.agentDialogs.initiatorUserId, userId),
    ))
    .get()

  if (!parent || parent.type !== 'gather') return { success: false, error: 'Not found' }

  const ctx = (parent.contextData || {}) as any
  if (ctx.phase !== 'confirming' && ctx.phase !== 'planning') {
    return { success: false, error: 'Not in confirming phase' }
  }

  ctx.plan = data.plan
  ctx.phase = 'complete'

  db.update(schema.agentDialogs)
    .set({ contextData: ctx, status: 'approved', updatedAt: new Date() })
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .run()

  // Notify all available friends
  const available = ctx.available as any[] || []
  const initiatorName = getUserName(userId)
  const planText = `${data.plan.what} — ${data.plan.when}${data.plan.where ? `, ${data.plan.where}` : ''}`

  for (const friend of available) {
    // Find child dialog and add message
    const childDialog = db.select()
      .from(schema.agentDialogs)
      .where(and(
        eq(schema.agentDialogs.parentDialogId, parentDialogId),
        eq(schema.agentDialogs.targetUserId, friend.userId),
      ))
      .get()

    if (childDialog) {
      addDialogMessage(childDialog.id, 'initiator',
        `Встреча подтверждена! ${planText}`)
    }

    sendToUser(friend.userId, {
      type: 'gather_confirmed',
      parentDialogId,
      initiatorName,
      plan: data.plan,
    })
  }

  addDialogMessage(parentDialogId, 'initiator', `Встреча подтверждена: ${planText}`)

  // Insert gather result cards into private chats
  const cardData = {
    parentDialogId,
    context: ctx.context,
    plan: data.plan,
    available: available.map((f: any) => ({ userId: f.userId, name: f.name })),
    unavailable: (ctx.unavailable || []).map((f: any) => ({ userId: f.userId, name: f.name })),
    initiatorName,
  }

  for (const friend of available) {
    const chatId = findPrivateChatBetween(userId, friend.userId)
    if (chatId) {
      await insertGatherResultCard(chatId, userId, cardData)
    }
  }

  sendToUser(userId, {
    type: 'gather_complete',
    parentDialogId,
    plan: data.plan,
    confirmedFriends: available.length,
  })

  return { success: true }
}

// ── 6. Warm Introduction (Find & Introduce) ──────────────────────────────────

export interface WarmIntroResult {
  dialogId: string
  matchId?: string
  status: 'consent_pending' | 'consent_granted' | 'consent_denied'
}

export async function handleWarmIntro(
  seekerUserId: string,
  targetUserId: string,
  mutualContactId: string,
  needDescription: string,
): Promise<WarmIntroResult> {
  const seekerName = getUserName(seekerUserId)
  const targetName = getUserName(targetUserId)
  const mutualName = getUserName(mutualContactId)

  // Step 1: Ask mutual contact for consent to introduce
  const consentResult = await createDialog({
    initiatorUserId: seekerUserId,
    targetUserId: mutualContactId,
    type: 'consent',
    contextData: {
      consentType: 'warm_intro',
      seekerUserId,
      targetUserId,
      needDescription,
      targetName,
    },
    expiresInMs: 24 * 60 * 60 * 1000,
    initiatorMessage: `${seekerName} ищет: "${needDescription}". Можешь представить ${targetName}?`,
  })

  logAgentActivity(seekerUserId, {
    type: 'intro_requested',
    title: `Запрос знакомства с ${targetName}`,
    body: `Через ${mutualName} — "${needDescription}"`,
    relatedDialogId: consentResult.dialogId,
    relatedUserId: targetUserId,
    metadata: { mutualContactId, targetUserId, needDescription },
  })

  if (consentResult.autoResolved && consentResult.status === 'auto_approved') {
    // Mutual agreed — now ask the target
    const targetConsent = await createDialog({
      initiatorUserId: mutualContactId,
      targetUserId: targetUserId,
      type: 'consent',
      contextData: {
        consentType: 'warm_intro_target',
        seekerUserId,
        seekerName,
        mutualContactId,
        needDescription,
      },
      expiresInMs: 24 * 60 * 60 * 1000,
      initiatorMessage: `${mutualName} хочет познакомить тебя с ${seekerName}: "${needDescription}"`,
    })

    if (targetConsent.autoResolved && targetConsent.status === 'auto_approved') {
      // Both agreed — notify seeker
      sendToUser(seekerUserId, {
        type: 'intro_complete',
        targetUserId,
        targetName,
        mutualContactId,
        mutualName,
      })

      logAgentActivity(seekerUserId, {
        type: 'intro_complete',
        title: `Знакомство с ${targetName} состоялось!`,
        body: `${mutualName} вас представил`,
        relatedUserId: targetUserId,
      })

      return { dialogId: consentResult.dialogId, status: 'consent_granted' }
    }

    return { dialogId: targetConsent.dialogId, status: 'consent_pending' }
  }

  return {
    dialogId: consentResult.dialogId,
    status: consentResult.autoResolved ? 'consent_denied' : 'consent_pending',
  }
}

// ── 7. Interest-Based Matching ───────────────────────────────────────────────

export interface InterestPollResult {
  parentDialogId: string
  friendsAsked: number
  childDialogIds: string[]
}

export async function handleInterestPoll(
  initiatorUserId: string,
  topic: string,
  timeoutMs: number = 7200000,
): Promise<InterestPollResult> {
  const initiatorName = getUserName(initiatorUserId)

  // Get friends
  const contacts = getDirectContacts(initiatorUserId)
  const friends = contacts.filter(contactId => {
    const level = getRelationshipLevel(initiatorUserId, contactId)
    return level === 'friend' || level === 'close'
  })

  // Create parent dialog
  const parentDialogId = crypto.randomUUID()
  db.insert(schema.agentDialogs).values({
    id: parentDialogId,
    initiatorUserId,
    targetUserId: initiatorUserId,
    type: 'get_interests',
    status: 'pending',
    contextData: {
      topic,
      phase: 'polling',
      friendsAsked: friends.length,
      interested: [] as Array<{ userId: string; name: string; message?: string }>,
      notInterested: [] as Array<{ userId: string; name: string }>,
      pending: friends.length,
    },
    expiresAt: new Date(Date.now() + timeoutMs),
  }).run()

  addDialogMessage(parentDialogId, 'initiator',
    `${initiatorName} спрашивает: "Кто хочет ${topic}?" — опрос ${friends.length} друзей`)

  logAgentActivity(initiatorUserId, {
    type: 'interest_poll_started',
    title: `Опрос: "${topic.slice(0, 50)}"`,
    body: `Спрашиваю ${friends.length} друзей`,
    relatedDialogId: parentDialogId,
    metadata: { topic, friendsCount: friends.length },
  })

  const childDialogIds: string[] = []

  for (const friendId of friends) {
    const friendName = getUserName(friendId)
    const result = await createDialog({
      initiatorUserId,
      targetUserId: friendId,
      type: 'get_interests',
      contextData: { topic, parentDialogId, isInterestPollChild: true },
      parentDialogId,
      expiresInMs: timeoutMs,
      initiatorMessage: `${initiatorName} спрашивает: "${topic}" — тебе интересно?`,
    })

    childDialogIds.push(result.dialogId)

    if (result.autoResolved) {
      const interested = result.status === 'auto_approved'
      updateInterestPollParent(parentDialogId, initiatorUserId, friendId, friendName, interested, undefined, true)
    }
  }

  // Check if already complete
  checkInterestPollComplete(parentDialogId, initiatorUserId)

  return { parentDialogId, friendsAsked: friends.length, childDialogIds }
}

function updateInterestPollParent(
  parentDialogId: string,
  initiatorUserId: string,
  friendId: string,
  friendName: string,
  interested: boolean,
  message?: string,
  auto?: boolean,
) {
  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .get()

  if (!parent) return
  const ctx = (parent.contextData || {}) as any

  if (interested) {
    ctx.interested = [...(ctx.interested || []), { userId: friendId, name: friendName, message }]
  } else {
    ctx.notInterested = [...(ctx.notInterested || []), { userId: friendId, name: friendName }]
  }
  ctx.pending = Math.max(0, (ctx.pending || 0) - 1)

  db.update(schema.agentDialogs)
    .set({ contextData: ctx, updatedAt: new Date() })
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .run()

  sendToUser(initiatorUserId, {
    type: 'interest_poll_progress',
    parentDialogId,
    interested: ctx.interested,
    notInterested: ctx.notInterested,
    pending: ctx.pending,
  })
}

function checkInterestPollComplete(parentDialogId: string, initiatorUserId: string) {
  const siblings = db.select({ status: schema.agentDialogs.status })
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.parentDialogId, parentDialogId))
    .all()

  const allResolved = siblings.length > 0 && siblings.every(s => s.status !== 'pending')
  if (!allResolved) return

  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .get()

  if (!parent) return
  const ctx = (parent.contextData || {}) as any
  if (ctx.phase !== 'polling') return

  ctx.phase = 'complete'
  db.update(schema.agentDialogs)
    .set({ contextData: ctx, status: 'approved', updatedAt: new Date() })
    .where(eq(schema.agentDialogs.id, parentDialogId))
    .run()

  const interestedNames = (ctx.interested || []).map((f: any) => f.name).join(', ')

  sendToUser(initiatorUserId, {
    type: 'interest_poll_complete',
    parentDialogId,
    interested: ctx.interested || [],
    notInterested: ctx.notInterested || [],
    topic: ctx.topic,
  })

  logAgentActivity(initiatorUserId, {
    type: 'interest_poll_result',
    title: `Опрос завершён: ${(ctx.interested || []).length} хотят!`,
    body: interestedNames || 'Никто не заинтересовался',
    relatedDialogId: parentDialogId,
    metadata: { interestedCount: (ctx.interested || []).length, topic: ctx.topic },
  })
}

// Handle child response for interest poll
export function handleInterestPollChildResponse(
  childDialogId: string,
  approved: boolean,
  message?: string,
) {
  const child = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, childDialogId))
    .get()

  if (!child || !child.parentDialogId) return

  const parent = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, child.parentDialogId))
    .get()

  if (!parent) return
  const ctx = (parent.contextData || {}) as any
  if (!ctx.topic) return // Not an interest poll

  respondToDialog(childDialogId, approved, message)
  const friendName = getUserName(child.targetUserId)
  updateInterestPollParent(child.parentDialogId, parent.initiatorUserId, child.targetUserId, friendName, approved, message, false)
  checkInterestPollComplete(child.parentDialogId, parent.initiatorUserId)
}

// ── 8. Mutual Match (Bidirectional Anonymous Matching) ─────────────────────

export interface MutualMatchResult {
  mutualMatchId: string
  requesterDialogId: string
  providerDialogId: string
  status: 'pending' | 'revealed' | 'declined'
}

/**
 * Create a mutual match: both sides must consent before identities are revealed.
 * Until both approve, they only see anonymized descriptions.
 */
export async function handleMutualMatch(
  requesterId: string,
  providerId: string,
  needId: string,
  offerId: string,
  needDescription: string,
  offerDescription: string,
  similarityScore: number,
  socialDistance: number,
  mutualContactId?: string,
): Promise<MutualMatchResult> {
  // Security
  needDescription = sanitizeA2AInput(needDescription)
  offerDescription = sanitizeA2AInput(offerDescription)

  // Rate limit check
  if (!checkA2ARateLimit(requesterId)) {
    logSecurityEvent({ type: 'rate_limited', userId: requesterId, details: 'mutual_match' })
    return {
      mutualMatchId: crypto.randomUUID(),
      requesterDialogId: crypto.randomUUID(),
      providerDialogId: crypto.randomUUID(),
      status: 'declined',
    }
  }

  const mutualMatchId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48h

  // Create the mutual match record
  db.insert(schema.mutualMatches).values({
    id: mutualMatchId,
    needId,
    requesterId,
    offerId,
    providerId,
    similarityScore,
    socialDistance,
    mutualContactId: mutualContactId || null,
    requesterConsent: 'pending',
    providerConsent: 'pending',
    status: 'pending',
    expiresAt,
  }).run()

  // Create dialog for requester (they see anonymized offer)
  const requesterDialog = await createDialog({
    initiatorUserId: requesterId,
    targetUserId: requesterId, // self-dialog — requester confirms their side
    type: 'match_proposal',
    contextData: {
      mutualMatchId,
      side: 'requester',
      anonymizedOffer: offerDescription,
      needDescription,
      socialDistance,
      hasMutualContact: !!mutualContactId,
    },
    expiresInMs: 48 * 60 * 60 * 1000,
    initiatorMessage: `Найден взаимный матч! Кто-то предлагает: "${offerDescription}". Совпадение: ${Math.round(similarityScore * 100)}%. Подтвердить знакомство?`,
  })

  // Create dialog for provider (they see anonymized need)
  const providerDialog = await createDialog({
    initiatorUserId: providerId,
    targetUserId: providerId, // self-dialog — provider confirms their side
    type: 'match_proposal',
    contextData: {
      mutualMatchId,
      side: 'provider',
      anonymizedNeed: needDescription,
      offerDescription,
      socialDistance,
      hasMutualContact: !!mutualContactId,
    },
    expiresInMs: 48 * 60 * 60 * 1000,
    initiatorMessage: `Найден взаимный матч! Кто-то ищет: "${needDescription}". Совпадение: ${Math.round(similarityScore * 100)}%. Подтвердить знакомство?`,
  })

  // Update mutual match with dialog IDs
  db.update(schema.mutualMatches)
    .set({
      requesterDialogId: requesterDialog.dialogId,
      providerDialogId: providerDialog.dialogId,
    })
    .where(eq(schema.mutualMatches.id, mutualMatchId))
    .run()

  // Log activities
  logAgentActivity(requesterId, {
    type: 'mutual_match_found',
    title: 'Найден взаимный матч!',
    body: `Кто-то предлагает: "${offerDescription.slice(0, 80)}"`,
    relatedDialogId: requesterDialog.dialogId,
    metadata: { mutualMatchId, side: 'requester' },
  })

  logAgentActivity(providerId, {
    type: 'mutual_match_found',
    title: 'Найден взаимный матч!',
    body: `Кто-то ищет: "${needDescription.slice(0, 80)}"`,
    relatedDialogId: providerDialog.dialogId,
    metadata: { mutualMatchId, side: 'provider' },
  })

  return {
    mutualMatchId,
    requesterDialogId: requesterDialog.dialogId,
    providerDialogId: providerDialog.dialogId,
    status: 'pending',
  }
}

/**
 * Handle response to a mutual match dialog.
 * Only reveals identities when BOTH sides approve.
 */
export function handleMutualMatchResponse(
  dialogId: string,
  approved: boolean,
  message?: string,
) {
  const dialog = db.select()
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, dialogId))
    .get()

  if (!dialog) return

  const ctx = dialog.contextData as any
  if (!ctx?.mutualMatchId || !ctx?.side) return

  const mutualMatch = db.select()
    .from(schema.mutualMatches)
    .where(eq(schema.mutualMatches.id, ctx.mutualMatchId))
    .get()

  if (!mutualMatch || mutualMatch.status !== 'pending') return

  // Update this side's consent
  respondToDialog(dialogId, approved, message)

  const isRequester = ctx.side === 'requester'
  const consentField = isRequester ? 'requesterConsent' : 'providerConsent'

  db.update(schema.mutualMatches)
    .set({ [consentField]: approved ? 'approved' : 'declined' })
    .where(eq(schema.mutualMatches.id, ctx.mutualMatchId))
    .run()

  if (!approved) {
    // One side declined → entire match is declined
    db.update(schema.mutualMatches)
      .set({ status: 'declined' })
      .where(eq(schema.mutualMatches.id, ctx.mutualMatchId))
      .run()

    // Notify both sides (without revealing identity)
    const otherUserId = isRequester ? mutualMatch.providerId : mutualMatch.requesterId
    const otherDialogId = isRequester ? mutualMatch.providerDialogId : mutualMatch.requesterDialogId

    if (otherDialogId) {
      addDialogMessage(otherDialogId, 'target', 'Другая сторона отклонила матч')
    }

    sendToUser(otherUserId, {
      type: 'mutual_match_update',
      mutualMatchId: ctx.mutualMatchId,
      status: 'declined',
    })
    return
  }

  // Check if both sides approved
  const updated = db.select()
    .from(schema.mutualMatches)
    .where(eq(schema.mutualMatches.id, ctx.mutualMatchId))
    .get()

  if (!updated) return

  if (updated.requesterConsent === 'approved' && updated.providerConsent === 'approved') {
    // BOTH APPROVED → Reveal identities!
    db.update(schema.mutualMatches)
      .set({ status: 'revealed', revealedAt: new Date() })
      .where(eq(schema.mutualMatches.id, ctx.mutualMatchId))
      .run()

    const requesterName = getUserName(updated.requesterId)
    const providerName = getUserName(updated.providerId)

    // Notify requester with provider's identity
    if (updated.requesterDialogId) {
      addDialogMessage(updated.requesterDialogId, 'target',
        `🎉 Матч состоялся! Это ${providerName}`)
    }
    sendToUser(updated.requesterId, {
      type: 'mutual_match_revealed',
      mutualMatchId: ctx.mutualMatchId,
      partnerId: updated.providerId,
      partnerName: providerName,
    })

    // Notify provider with requester's identity
    if (updated.providerDialogId) {
      addDialogMessage(updated.providerDialogId, 'target',
        `🎉 Матч состоялся! Это ${requesterName}`)
    }
    sendToUser(updated.providerId, {
      type: 'mutual_match_revealed',
      mutualMatchId: ctx.mutualMatchId,
      partnerId: updated.requesterId,
      partnerName: requesterName,
    })

    logAgentActivity(updated.requesterId, {
      type: 'mutual_match_revealed',
      title: `Взаимный матч с ${providerName}!`,
      body: `Теперь можете написать друг другу`,
      relatedUserId: updated.providerId,
      metadata: { mutualMatchId: ctx.mutualMatchId },
    })

    logAgentActivity(updated.providerId, {
      type: 'mutual_match_revealed',
      title: `Взаимный матч с ${requesterName}!`,
      body: `Теперь можете написать друг другу`,
      relatedUserId: updated.requesterId,
      metadata: { mutualMatchId: ctx.mutualMatchId },
    })
  } else {
    // One side approved, waiting for the other
    const otherUserId = isRequester ? mutualMatch.providerId : mutualMatch.requesterId
    sendToUser(otherUserId, {
      type: 'mutual_match_update',
      mutualMatchId: ctx.mutualMatchId,
      status: 'waiting_for_you',
      message: 'Другая сторона уже подтвердила! Ваш ход.',
    })
  }
}
