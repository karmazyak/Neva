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
} from '../a2a/agent-skills-internal'
import { getActivities, handleUndo } from '../a2a/agent-activity'

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

export default app
