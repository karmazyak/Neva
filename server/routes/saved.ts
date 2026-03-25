import { Hono } from 'hono'
import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { decryptMessages } from '../security/encryption'

const saved = new Hono()
saved.use('*', authMiddleware)

saved.post('/', async (c) => {
  const userId = c.get('userId')
  const { messageId, chatId } = await c.req.json()
  if (!messageId || !chatId) return c.json({ error: 'messageId and chatId required' }, 400)

  // Check not already saved
  const existing = db.select().from(schema.savedMessages)
    .where(and(eq(schema.savedMessages.userId, userId), eq(schema.savedMessages.messageId, messageId))).get()
  if (existing) return c.json({ ok: true, id: existing.id })

  const id = crypto.randomUUID()
  db.insert(schema.savedMessages).values({ id, userId, messageId, chatId }).run()
  return c.json({ ok: true, id }, 201)
})

saved.delete('/:messageId', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')
  db.delete(schema.savedMessages).where(
    and(eq(schema.savedMessages.userId, userId), eq(schema.savedMessages.messageId, messageId))
  ).run()
  return c.json({ ok: true })
})

saved.get('/', async (c) => {
  const userId = c.get('userId')
  const items = db.select({
    id: schema.savedMessages.id,
    messageId: schema.savedMessages.messageId,
    chatId: schema.savedMessages.chatId,
    savedAt: schema.savedMessages.createdAt,
    content: schema.messages.content,
    type: schema.messages.type,
    senderId: schema.messages.senderId,
    senderName: schema.users.displayName,
    messageCreatedAt: schema.messages.createdAt,
  })
    .from(schema.savedMessages)
    .innerJoin(schema.messages, eq(schema.savedMessages.messageId, schema.messages.id))
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(eq(schema.savedMessages.userId, userId))
    .orderBy(desc(schema.savedMessages.createdAt))
    .limit(100)
    .all()

  return c.json(await decryptMessages(items as any[]))
})

export default saved
