import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const triggers = new Hono()
triggers.use('*', authMiddleware)

// Get all triggers for current user
triggers.get('/', async (c) => {
  const userId = c.get('userId')
  const userTriggers = db.select().from(schema.triggers)
    .where(eq(schema.triggers.userId, userId))
    .all()
  return c.json(userTriggers)
})

const createTriggerSchema = z.object({
  name: z.string().min(1).max(100),
  event: z.enum(['on_audio', 'on_image', 'on_message', 'on_message_from', 'on_keyword']),
  condition: z.object({
    fromUserId: z.string().optional(),
    keyword: z.string().optional(),
    chatId: z.string().optional(),
  }).optional(),
  action: z.object({
    type: z.enum(['skill', 'agent_reply', 'stt']),
    skillCommand: z.string().optional(),
    agentId: z.string().optional(),
    params: z.any().optional(),
  }),
  outputMode: z.enum(['ghost', 'normal']).default('ghost'),
  chatId: z.string().nullable().optional(),
})

// Create trigger
triggers.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = createTriggerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const triggerId = crypto.randomUUID()
  db.insert(schema.triggers).values({
    id: triggerId,
    userId,
    ...parsed.data,
    chatId: parsed.data.chatId || null,
  }).run()

  const trigger = db.select().from(schema.triggers)
    .where(eq(schema.triggers.id, triggerId)).get()

  return c.json(trigger, 201)
})

// Update trigger
triggers.put('/:triggerId', async (c) => {
  const userId = c.get('userId')
  const triggerId = c.req.param('triggerId')

  const existing = db.select().from(schema.triggers)
    .where(and(eq(schema.triggers.id, triggerId), eq(schema.triggers.userId, userId)))
    .get()
  if (!existing) return c.json({ error: 'Trigger not found' }, 404)

  const body = await c.req.json()
  const parsed = createTriggerSchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  db.update(schema.triggers).set(parsed.data)
    .where(eq(schema.triggers.id, triggerId)).run()

  const updated = db.select().from(schema.triggers)
    .where(eq(schema.triggers.id, triggerId)).get()
  return c.json(updated)
})

// Delete trigger (block default pipelines)
triggers.delete('/:triggerId', async (c) => {
  const userId = c.get('userId')
  const triggerId = c.req.param('triggerId')

  const trigger = db.select().from(schema.triggers)
    .where(and(eq(schema.triggers.id, triggerId), eq(schema.triggers.userId, userId)))
    .get()

  if (!trigger) return c.json({ error: 'Trigger not found' }, 404)
  if (trigger.isDefault) return c.json({ error: 'Cannot delete default pipeline' }, 403)

  db.delete(schema.triggers)
    .where(eq(schema.triggers.id, triggerId))
    .run()

  return c.json({ ok: true })
})

// Toggle trigger enabled/disabled
triggers.post('/:triggerId/toggle', async (c) => {
  const userId = c.get('userId')
  const triggerId = c.req.param('triggerId')

  const trigger = db.select().from(schema.triggers)
    .where(and(eq(schema.triggers.id, triggerId), eq(schema.triggers.userId, userId)))
    .get()

  if (!trigger) return c.json({ error: 'Trigger not found' }, 404)

  db.update(schema.triggers)
    .set({ enabled: !trigger.enabled })
    .where(eq(schema.triggers.id, triggerId))
    .run()

  return c.json({ ok: true, enabled: !trigger.enabled })
})

export default triggers
