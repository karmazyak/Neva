import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { getVapidPublicKey } from '../push'

const push = new Hono()
push.use('*', authMiddleware)

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

push.get('/vapid-key', (c) => {
  return c.json({ publicKey: getVapidPublicKey() })
})

push.post('/subscribe', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { endpoint, keys } = parsed.data

  // Upsert: delete old subscription with same endpoint, insert new
  db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).run()

  db.insert(schema.pushSubscriptions).values({
    id: crypto.randomUUID(),
    userId,
    endpoint,
    keysP256dh: keys.p256dh,
    keysAuth: keys.auth,
  }).run()

  return c.json({ ok: true })
})

push.delete('/subscribe', async (c) => {
  const userId = c.get('userId')
  const { endpoint } = await c.req.json()

  db.delete(schema.pushSubscriptions).where(
    and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint))
  ).run()

  return c.json({ ok: true })
})

export default push
