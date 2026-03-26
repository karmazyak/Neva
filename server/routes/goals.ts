import { Hono } from 'hono'
import { db, schema } from '../db'
import { eq, and, inArray, desc, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const app = new Hono()
app.use('*', authMiddleware)

// GET /api/goals — list user's goals (active by default, or ?status=all|completed|...)
app.get('/', async (c) => {
  const userId = (c as any).userId as string
  const statusFilter = c.req.query('status') || 'active'
  const chatId = c.req.query('chatId')

  let query = db.select().from(schema.userGoals)
    .where(eq(schema.userGoals.userId, userId))
    .orderBy(desc(schema.userGoals.updatedAt))

  const goals = query.all()

  // Filter in JS because Drizzle SQLite doesn't support OR chains cleanly
  const filtered = goals.filter(g => {
    if (chatId && g.chatId !== chatId) return false
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return ['active', 'in_progress'].includes(g.status)
    return g.status === statusFilter
  })

  return c.json({ goals: filtered })
})

// GET /api/goals/:id — get single goal
app.get('/:id', async (c) => {
  const userId = (c as any).userId as string
  const goalId = c.req.param('id')

  const goal = db.select().from(schema.userGoals)
    .where(and(eq(schema.userGoals.id, goalId), eq(schema.userGoals.userId, userId)))
    .get()

  if (!goal) return c.json({ error: 'Goal not found' }, 404)
  return c.json({ goal })
})

// POST /api/goals — create a new goal
app.post('/', async (c) => {
  const userId = (c as any).userId as string
  const body = await c.req.json<{
    goal: string
    chatId?: string
    mode?: 'strategic' | 'care'
    strategy?: string
    autonomyLevel?: 'semi' | 'autonomous'
  }>()

  if (!body.goal?.trim()) {
    return c.json({ error: 'Goal text is required' }, 400)
  }

  const id = crypto.randomUUID()

  db.insert(schema.userGoals).values({
    id,
    userId,
    chatId: body.chatId || null,
    goal: body.goal.trim(),
    mode: body.mode || 'strategic',
    status: 'active',
    strategy: body.strategy || null,
    progress: 0,
    progressNotes: [],
    autonomyLevel: body.autonomyLevel || 'semi',
  }).run()

  const goal = db.select().from(schema.userGoals)
    .where(eq(schema.userGoals.id, id)).get()

  return c.json({ goal }, 201)
})

// PATCH /api/goals/:id — update a goal (progress, status, strategy, etc.)
app.patch('/:id', async (c) => {
  const userId = (c as any).userId as string
  const goalId = c.req.param('id')
  const body = await c.req.json<{
    status?: string
    progress?: number
    strategy?: string
    autonomyLevel?: string
    lessonsLearned?: string
    addProgressNote?: string
  }>()

  const existing = db.select().from(schema.userGoals)
    .where(and(eq(schema.userGoals.id, goalId), eq(schema.userGoals.userId, userId)))
    .get()

  if (!existing) return c.json({ error: 'Goal not found' }, 404)

  // Build update object
  const updates: Record<string, any> = { updatedAt: sql`(unixepoch())` }

  if (body.status) {
    updates.status = body.status
    if (['completed', 'failed'].includes(body.status)) {
      updates.completedAt = sql`(unixepoch())`
    }
  }
  if (body.progress !== undefined) updates.progress = Math.min(100, Math.max(0, body.progress))
  if (body.strategy) updates.strategy = body.strategy
  if (body.autonomyLevel) updates.autonomyLevel = body.autonomyLevel
  if (body.lessonsLearned) updates.lessonsLearned = body.lessonsLearned

  // Add progress note
  if (body.addProgressNote) {
    const notes = (existing.progressNotes || []) as Array<{ date: string; note: string }>
    notes.push({ date: new Date().toISOString(), note: body.addProgressNote })
    updates.progressNotes = JSON.stringify(notes)
  }

  db.update(schema.userGoals)
    .set(updates)
    .where(and(eq(schema.userGoals.id, goalId), eq(schema.userGoals.userId, userId)))
    .run()

  const updated = db.select().from(schema.userGoals)
    .where(eq(schema.userGoals.id, goalId)).get()

  return c.json({ goal: updated })
})

// DELETE /api/goals/:id — delete a goal
app.delete('/:id', async (c) => {
  const userId = (c as any).userId as string
  const goalId = c.req.param('id')

  db.delete(schema.userGoals)
    .where(and(eq(schema.userGoals.id, goalId), eq(schema.userGoals.userId, userId)))
    .run()

  return c.json({ ok: true })
})

// GET /api/goals/chat/:chatId — get active goals for a specific chat
app.get('/chat/:chatId', async (c) => {
  const userId = (c as any).userId as string
  const chatId = c.req.param('chatId')

  const goals = db.select().from(schema.userGoals)
    .where(and(
      eq(schema.userGoals.userId, userId),
      eq(schema.userGoals.chatId, chatId),
      inArray(schema.userGoals.status, ['active', 'in_progress']),
    ))
    .orderBy(desc(schema.userGoals.updatedAt))
    .all()

  return c.json({ goals })
})

export default app
