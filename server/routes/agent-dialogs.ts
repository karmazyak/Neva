import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import {
  getDialogsForUser,
  getDialogWithMessages,
  getPendingDialogsForUser,
  cancelDialog,
  getAutonomyRules,
  upsertAutonomyRule,
} from '../a2a/agent-dialog'
import { handleConsentResponse } from '../ai/consent'
import {
  handleWhosFree,
  handleGetInterests,
  collectSelfReportedInterests,
  handleGatherCompany,
  getGatherStatus,
  confirmGather,
  handleWarmIntro,
  handleInterestPoll,
  handleMutualMatch,
  handleMutualMatchResponse,
} from '../a2a/agent-skills-internal'
import { getActivities, handleUndo } from '../a2a/agent-activity'
import { getVault, updateVault, getPublicProfile } from '../a2a/privacy-vault'
import { checkA2ARateLimit, logSecurityEvent } from '../a2a/security'
import { findMutualMatches } from '../ai/matching'
import { generateEmbedding } from '../ai/embeddings'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'

const app = new Hono()
app.use('*', authMiddleware)

// ── List dialogs ─────────────────────────────────────────────────────────────

app.get('/dialogs', (c) => {
  const userId = c.get('userId') as string
  const status = c.req.query('status') as any
  const type = c.req.query('type') as any
  const limit = parseInt(c.req.query('limit') || '20')

  const dialogs = getDialogsForUser(userId, { status, type, limit })

  return c.json({
    dialogs: dialogs.map(d => ({
      id: d.dialog.id,
      type: d.dialog.type,
      status: d.dialog.status,
      initiatorUserId: d.dialog.initiatorUserId,
      targetUserId: d.dialog.targetUserId,
      initiatorName: d.initiatorName,
      targetName: d.targetName,
      contextData: d.dialog.contextData,
      result: d.dialog.result,
      parentDialogId: d.dialog.parentDialogId,
      messagesCount: d.messages.length,
      lastMessage: d.messages[d.messages.length - 1]?.content || null,
      createdAt: d.dialog.createdAt,
      updatedAt: d.dialog.updatedAt,
    })),
  })
})

// ── Get single dialog with messages ──────────────────────────────────────────

app.get('/dialogs/:id', (c) => {
  const userId = c.get('userId') as string
  const dialogId = c.req.param('id')

  const data = getDialogWithMessages(dialogId)
  if (!data) return c.json({ error: 'Dialog not found' }, 404)

  // Verify user is a participant
  if (data.dialog.initiatorUserId !== userId && data.dialog.targetUserId !== userId) {
    return c.json({ error: 'Not a participant' }, 403)
  }

  return c.json({
    dialog: {
      id: data.dialog.id,
      type: data.dialog.type,
      status: data.dialog.status,
      initiatorUserId: data.dialog.initiatorUserId,
      targetUserId: data.dialog.targetUserId,
      initiatorName: data.initiatorName,
      targetName: data.targetName,
      contextData: data.dialog.contextData,
      result: data.dialog.result,
      parentDialogId: data.dialog.parentDialogId,
      createdAt: data.dialog.createdAt,
      updatedAt: data.dialog.updatedAt,
    },
    messages: data.messages.map(m => ({
      id: m.id,
      agentRole: m.agentRole,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt,
    })),
  })
})

// ── Pending dialogs count ────────────────────────────────────────────────────

app.get('/pending', (c) => {
  const userId = c.get('userId') as string
  const pending = getPendingDialogsForUser(userId)

  return c.json({
    count: pending.length,
    dialogs: pending.map(d => ({
      id: d.id,
      type: d.type,
      initiatorUserId: d.initiatorUserId,
      contextData: d.contextData,
      createdAt: d.createdAt,
    })),
  })
})

// ── Respond to a dialog ──────────────────────────────────────────────────────

const respondSchema = z.object({
  approved: z.boolean(),
  message: z.string().optional(),
})

app.post('/dialogs/:id/respond', async (c) => {
  const userId = c.get('userId') as string
  const dialogId = c.req.param('id')
  const body = await c.req.json()
  const parsed = respondSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  // Use the unified consent response handler which routes by dialog type
  handleConsentResponse(dialogId, parsed.data.approved, parsed.data.message)

  // If it's a get_interests dialog and approved, attach the interests data
  const data = getDialogWithMessages(dialogId)
  if (data?.dialog.type === 'get_interests' && parsed.data.approved) {
    const interests = collectSelfReportedInterests(userId)
    // The respondToDialog already handled, but let's return the data
    return c.json({ ok: true, interests })
  }

  return c.json({ ok: true })
})

// ── Cancel a dialog ──────────────────────────────────────────────────────────

app.post('/dialogs/:id/cancel', (c) => {
  const userId = c.get('userId') as string
  const dialogId = c.req.param('id')

  const success = cancelDialog(dialogId, userId)
  if (!success) return c.json({ error: 'Cannot cancel this dialog' }, 400)

  return c.json({ ok: true })
})

// ── Who's free? (via A2A) ────────────────────────────────────────────────────

const whosFreeSchema = z.object({
  context: z.string().min(2).max(300),
  timeoutMinutes: z.number().min(5).max(1440).default(120),
})

app.post('/whos-free', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = whosFreeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { context, timeoutMinutes } = parsed.data
  const result = await handleWhosFree(userId, context, timeoutMinutes * 60000)

  return c.json({
    dialogId: result.parentDialogId,
    friendsAsked: result.friendsAsked,
    status: 'active',
    message: `Опрашиваю ${result.friendsAsked} друзей. Результаты придут через уведомления.`,
  })
})

// ── Get interests (via A2A) ──────────────────────────────────────────────────

const getInterestsSchema = z.object({
  targetUserId: z.string(),
})

app.post('/get-interests', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = getInterestsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const result = await handleGetInterests(userId, parsed.data.targetUserId)

  if (result.autoResolved && result.interests) {
    return c.json({
      dialogId: result.dialogId,
      interests: result.interests,
      status: 'completed',
    })
  }

  return c.json({
    dialogId: result.dialogId,
    status: 'pending',
    message: 'Запрос отправлен агенту пользователя. Результат придёт через уведомления.',
  })
})

// ── Activity Feed ────────────────────────────────────────────────────────────

app.get('/activities', (c) => {
  const userId = c.get('userId') as string
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')
  const type = c.req.query('type')

  const activities = getActivities(userId, { limit, offset, type: type || undefined })

  return c.json({ activities })
})

// ── Undo auto-response ──────────────────────────────────────────────────────

app.post('/undo/:activityId', (c) => {
  const userId = c.get('userId') as string
  const activityId = c.req.param('activityId')

  const result = handleUndo(activityId, userId)

  if (!result.success) {
    const status = result.error === 'Undo window expired' ? 410
      : result.error === 'Not found' ? 404
      : 400
    return c.json({ error: result.error }, status)
  }

  return c.json({ ok: true })
})

// ── Gather Company ──────────────────────────────────────────────────────────

const gatherSchema = z.object({
  context: z.string().min(2).max(300),
  timeoutMinutes: z.number().min(5).max(1440).default(30),
  filter: z.object({
    minRelationship: z.enum(['close', 'friend']).optional(),
  }).optional(),
})

app.post('/gather', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = gatherSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { context, timeoutMinutes, filter } = parsed.data
  const result = await handleGatherCompany(
    userId,
    context,
    timeoutMinutes * 60000,
    filter,
  )

  return c.json({
    parentDialogId: result.parentDialogId,
    friendsAsked: result.friendsAsked,
    status: 'asking',
    message: `Собираю компанию: опрашиваю ${result.friendsAsked} друзей`,
  })
})

app.get('/gather/:id', (c) => {
  const userId = c.get('userId') as string
  const parentDialogId = c.req.param('id')

  const status = getGatherStatus(parentDialogId, userId)
  if (!status) return c.json({ error: 'Not found' }, 404)

  return c.json(status)
})

const confirmGatherSchema = z.object({
  plan: z.object({
    what: z.string(),
    when: z.string(),
    where: z.string().optional(),
  }),
  selectedFriends: z.array(z.string()).optional(),
  createGroup: z.boolean().optional(),
})

app.post('/gather/:id/confirm', async (c) => {
  const userId = c.get('userId') as string
  const parentDialogId = c.req.param('id')
  const body = await c.req.json()
  const parsed = confirmGatherSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const result = await confirmGather(parentDialogId, userId, parsed.data)
  if (!result.success) return c.json({ error: result.error }, 400)

  return c.json({ ok: true })
})

app.post('/gather/:id/cancel', (c) => {
  const userId = c.get('userId') as string
  const parentDialogId = c.req.param('id')

  const success = cancelDialog(parentDialogId, userId)
  return c.json({ ok: success })
})

// ── Warm Introduction ──────────────────────────────────────────────────────

const warmIntroSchema = z.object({
  targetUserId: z.string(),
  mutualContactId: z.string(),
  needDescription: z.string().min(2).max(500),
})

app.post('/warm-intro', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = warmIntroSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const result = await handleWarmIntro(
    userId,
    parsed.data.targetUserId,
    parsed.data.mutualContactId,
    parsed.data.needDescription,
  )

  return c.json(result)
})

// ── Interest-based poll ────────────────────────────────────────────────────

const interestPollSchema = z.object({
  topic: z.string().min(2).max(300),
  timeoutMinutes: z.number().min(5).max(1440).default(120),
})

app.post('/interest-poll', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = interestPollSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const result = await handleInterestPoll(
    userId,
    parsed.data.topic,
    parsed.data.timeoutMinutes * 60000,
  )

  return c.json(result)
})

// ── Autonomy rules ───────────────────────────────────────────────────────────

app.get('/autonomy', (c) => {
  const userId = c.get('userId') as string
  const rules = getAutonomyRules(userId)

  return c.json({ rules })
})

const autonomySchema = z.object({
  rules: z.array(z.object({
    relationshipLevel: z.enum(['close', 'friend', 'acquaintance']),
    dialogType: z.enum(['whos_free', 'get_interests', 'match_proposal', 'consent', '*']),
    action: z.enum(['auto_approve', 'auto_deny', 'ask_user']),
  })),
})

app.put('/autonomy', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = autonomySchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  for (const rule of parsed.data.rules) {
    upsertAutonomyRule(userId, rule.relationshipLevel, rule.dialogType, rule.action)
  }

  return c.json({ ok: true, rules: getAutonomyRules(userId) })
})

// ── Privacy Vault ──────────────────────────────────────────────────────────

app.get('/vault', (c) => {
  const userId = c.get('userId') as string
  const vault = getVault(userId)
  const publicProfile = getPublicProfile(userId)

  return c.json({
    vault: {
      shareInterests: vault.shareInterests,
      shareExpertise: vault.shareExpertise,
      shareAvailability: vault.shareAvailability,
      shareMood: vault.shareMood,
      shareFacts: vault.shareFacts,
      publicBio: vault.publicBio,
      publicInterests: vault.publicInterests,
      publicExpertise: vault.publicExpertise,
      blockedUserIds: vault.blockedUserIds,
    },
    publicProfile,
  })
})

const vaultUpdateSchema = z.object({
  shareInterests: z.boolean().optional(),
  shareExpertise: z.boolean().optional(),
  shareAvailability: z.boolean().optional(),
  shareMood: z.boolean().optional(),
  shareFacts: z.boolean().optional(),
  publicBio: z.string().max(500).nullable().optional(),
  publicInterests: z.array(z.string().max(100)).max(20).optional(),
  publicExpertise: z.array(z.string().max(100)).max(20).optional(),
  blockedUserIds: z.array(z.string()).max(500).optional(),
})

app.put('/vault', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = vaultUpdateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const updated = updateVault(userId, parsed.data)

  return c.json({
    ok: true,
    vault: {
      shareInterests: updated.shareInterests,
      shareExpertise: updated.shareExpertise,
      shareAvailability: updated.shareAvailability,
      shareMood: updated.shareMood,
      shareFacts: updated.shareFacts,
      publicBio: updated.publicBio,
      publicInterests: updated.publicInterests,
      publicExpertise: updated.publicExpertise,
      blockedUserIds: updated.blockedUserIds,
    },
  })
})

// ── Mutual Match ───────────────────────────────────────────────────────────

const mutualMatchSearchSchema = z.object({
  description: z.string().min(2).max(500),
  category: z.enum(['professional', 'social', 'care']).default('professional'),
  visibility: z.enum(['friends', 'friends_of_friends', 'network']).default('friends_of_friends'),
})

app.post('/mutual-match/search', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = mutualMatchSearchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  // Silent rate limit
  if (!checkA2ARateLimit(userId)) {
    logSecurityEvent({ type: 'rate_limited', userId, details: 'mutual_match_search' })
    return c.json({ mutual: [], oneWay: [], message: 'Поиск не дал результатов' })
  }

  const { description, category, visibility } = parsed.data

  // Create a need
  const needId = crypto.randomUUID()
  const embedding = await generateEmbedding(description)

  db.insert(schema.needs).values({
    id: needId,
    userId,
    description,
    embedding: embedding as any,
    category,
    urgency: 'whenever',
    source: 'explicit',
    visibility,
    status: 'active',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  }).run()

  // Find mutual matches
  const { mutual, oneWay } = await findMutualMatches(
    needId, userId, description, embedding, category, visibility,
  )

  // Enrich with display names (but DON'T reveal identity for mutual — anonymize)
  const enrichOneWay = oneWay.slice(0, 10).map(m => {
    const user = db.select({ displayName: schema.users.displayName })
      .from(schema.users).where(eq(schema.users.id, m.userId)).get()
    return { ...m, displayName: user?.displayName }
  })

  // For mutual: anonymize — show only offer description and similarity
  const enrichMutual = mutual.slice(0, 10).map(m => ({
    offerId: m.offerId,
    offerDescription: m.offerDescription,
    similarity: m.similarity,
    trustScore: m.trustScore,
    socialDistance: m.socialDistance,
    hasMutualContact: !!m.mutualContactId,
    finalScore: m.finalScore,
    // NO userId, NO displayName — anonymous until double consent
  }))

  return c.json({
    needId,
    mutual: enrichMutual,
    oneWay: enrichOneWay,
  })
})

const mutualMatchInitSchema = z.object({
  needId: z.string(),
  offerId: z.string(),
})

app.post('/mutual-match/initiate', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = mutualMatchInitSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { needId, offerId } = parsed.data

  // Look up the need and offer
  const need = db.select().from(schema.needs).where(eq(schema.needs.id, needId)).get()
  const offer = db.select().from(schema.offers).where(eq(schema.offers.id, offerId)).get()

  if (!need || !offer) return c.json({ error: 'Need or offer not found' }, 404)
  if (need.userId !== userId) return c.json({ error: 'Not your need' }, 403)

  const result = await handleMutualMatch(
    userId,
    offer.userId,
    needId,
    offerId,
    need.description,
    offer.description,
    0, // similarity will be recomputed
    0, // social distance will be recomputed
  )

  return c.json({
    mutualMatchId: result.mutualMatchId,
    status: result.status,
    message: result.status === 'pending'
      ? 'Запрос на взаимный матч отправлен. Ожидайте подтверждения обеих сторон.'
      : 'Матч отклонён',
  })
})

app.post('/mutual-match/:id/respond', async (c) => {
  const userId = c.get('userId') as string
  const mutualMatchId = c.req.param('id')
  const body = await c.req.json()
  const parsed = respondSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  // Find the mutual match and determine which dialog belongs to this user
  const mm = db.select().from(schema.mutualMatches)
    .where(eq(schema.mutualMatches.id, mutualMatchId)).get()

  if (!mm) return c.json({ error: 'Not found' }, 404)

  let dialogId: string | null = null
  if (mm.requesterId === userId) dialogId = mm.requesterDialogId
  else if (mm.providerId === userId) dialogId = mm.providerDialogId

  if (!dialogId) return c.json({ error: 'Not a participant' }, 403)

  handleMutualMatchResponse(dialogId, parsed.data.approved, parsed.data.message)

  return c.json({ ok: true })
})

// Get user's mutual matches
app.get('/mutual-matches', (c) => {
  const userId = c.get('userId') as string
  const status = c.req.query('status') as any

  const matches = db.select()
    .from(schema.mutualMatches)
    .where(
      status
        ? and(
            eq(schema.mutualMatches.status, status),
            eq(schema.mutualMatches.requesterId, userId),
          )
        : eq(schema.mutualMatches.requesterId, userId),
    )
    .all()

  // Also find matches where user is the provider
  const providerMatches = db.select()
    .from(schema.mutualMatches)
    .where(
      status
        ? and(
            eq(schema.mutualMatches.status, status),
            eq(schema.mutualMatches.providerId, userId),
          )
        : eq(schema.mutualMatches.providerId, userId),
    )
    .all()

  const allMatches = [...matches, ...providerMatches].map(mm => {
    const isRequester = mm.requesterId === userId
    const need = db.select({ description: schema.needs.description })
      .from(schema.needs).where(eq(schema.needs.id, mm.needId)).get()
    const offer = db.select({ description: schema.offers.description })
      .from(schema.offers).where(eq(schema.offers.id, mm.offerId)).get()

    // Only reveal partner identity if status is 'revealed'
    let partnerName: string | null = null
    let partnerId: string | null = null
    if (mm.status === 'revealed') {
      const pid = isRequester ? mm.providerId : mm.requesterId
      const partner = db.select({ displayName: schema.users.displayName })
        .from(schema.users).where(eq(schema.users.id, pid)).get()
      partnerName = partner?.displayName || null
      partnerId = pid
    }

    return {
      id: mm.id,
      side: isRequester ? 'requester' : 'provider',
      needDescription: need?.description,
      offerDescription: offer?.description,
      similarityScore: mm.similarityScore,
      socialDistance: mm.socialDistance,
      myConsent: isRequester ? mm.requesterConsent : mm.providerConsent,
      otherConsent: isRequester ? mm.providerConsent : mm.requesterConsent,
      status: mm.status,
      partnerName,
      partnerId,
      createdAt: mm.createdAt,
    }
  })

  return c.json({ matches: allMatches })
})

export default app
