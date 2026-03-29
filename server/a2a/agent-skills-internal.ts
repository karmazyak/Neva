import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'
import { createDialog, respondToDialog, addDialogMessage } from './agent-dialog'
import type { DialogType } from './agent-dialog'
import { getDirectContacts, findMatchingOffers, getSocialDistance } from '../ai/matching'
import { getRelationshipLevel } from '../ai/consent'
import { generateEmbedding } from '../ai/embeddings'
import { sendToUser } from '../ws'
import { logAgentActivity } from './agent-activity'
import { chatCompletion } from '../ai/openrouter'
import { getModelConfig } from '../ai/model-router'

// ── Helper ───────────────────────────────────────────────────────────────────

function getUserName(userId: string): string {
  const user = db.select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()
  return user?.displayName || 'Неизвестный'
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
  const initiatorName = getUserName(initiatorUserId)

  // Get friends (not acquaintances)
  const contacts = getDirectContacts(initiatorUserId)
  const friends = contacts.filter(contactId => {
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
  const initiatorName = getUserName(initiatorUserId)

  // Get friends
  const contacts = getDirectContacts(initiatorUserId)
  const minLevel = filter?.minRelationship || 'friend'
  const friends = contacts.filter(contactId => {
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

  sendToUser(userId, {
    type: 'gather_complete',
    parentDialogId,
    plan: data.plan,
    confirmedFriends: available.length,
  })

  return { success: true }
}
