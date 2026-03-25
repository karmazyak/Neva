import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const folders = new Hono()
folders.use('*', authMiddleware)

folders.get('/', async (c) => {
  const userId = c.get('userId')
  const userFolders = db.select().from(schema.chatFolders)
    .where(eq(schema.chatFolders.userId, userId))
    .all()

  // If user has no folders, create defaults
  if (userFolders.length === 0) {
    const defaults = [
      { name: 'All', icon: '💬', sortOrder: 0, isDefault: true, filterRules: null as any },
      { name: 'Personal', icon: '👤', sortOrder: 1, isDefault: true, filterRules: null as any },
      { name: 'Work', icon: '💼', sortOrder: 2, isDefault: true, filterRules: null as any },
      { name: 'AI Bots', icon: '🤖', sortOrder: 3, isDefault: true, filterRules: { hasAgent: true } as any },
    ]
    for (const d of defaults) {
      db.insert(schema.chatFolders).values({
        id: crypto.randomUUID(),
        userId,
        name: d.name,
        icon: d.icon,
        sortOrder: d.sortOrder,
        isDefault: d.isDefault,
        filterRules: d.filterRules,
      }).run()
    }
    return c.json(db.select().from(schema.chatFolders).where(eq(schema.chatFolders.userId, userId)).all())
  }

  return c.json(userFolders)
})

const createFolderSchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().optional(),
})

folders.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = createFolderSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const maxOrder = db.select().from(schema.chatFolders)
    .where(eq(schema.chatFolders.userId, userId)).all()
    .reduce((max, f) => Math.max(max, f.sortOrder || 0), 0)

  const id = crypto.randomUUID()
  db.insert(schema.chatFolders).values({
    id, userId, name: parsed.data.name, icon: parsed.data.icon || null, sortOrder: maxOrder + 1,
  }).run()
  return c.json({ id }, 201)
})

folders.put('/:id', async (c) => {
  const userId = c.get('userId')
  const folderId = c.req.param('id')
  const body = await c.req.json()

  const folder = db.select().from(schema.chatFolders)
    .where(and(eq(schema.chatFolders.id, folderId), eq(schema.chatFolders.userId, userId))).get()
  if (!folder) return c.json({ error: 'Not found' }, 404)

  const updates: any = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.icon !== undefined) updates.icon = body.icon
  if (Object.keys(updates).length > 0) {
    db.update(schema.chatFolders).set(updates).where(eq(schema.chatFolders.id, folderId)).run()
  }
  return c.json({ ok: true })
})

folders.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const folderId = c.req.param('id')

  const folder = db.select().from(schema.chatFolders)
    .where(and(eq(schema.chatFolders.id, folderId), eq(schema.chatFolders.userId, userId))).get()
  if (!folder) return c.json({ error: 'Not found' }, 404)
  if (folder.isDefault) return c.json({ error: 'Cannot delete default folders' }, 400)

  // Delete folder members first
  db.delete(schema.chatFolderMembers).where(eq(schema.chatFolderMembers.folderId, folderId)).run()
  db.delete(schema.chatFolders).where(eq(schema.chatFolders.id, folderId)).run()
  return c.json({ ok: true })
})

folders.post('/:id/chats', async (c) => {
  const userId = c.get('userId')
  const folderId = c.req.param('id')
  const { chatId } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  const folder = db.select().from(schema.chatFolders)
    .where(and(eq(schema.chatFolders.id, folderId), eq(schema.chatFolders.userId, userId))).get()
  if (!folder) return c.json({ error: 'Folder not found' }, 404)

  try {
    db.insert(schema.chatFolderMembers).values({ id: crypto.randomUUID(), folderId, chatId }).run()
  } catch {} // unique constraint — already in folder
  return c.json({ ok: true })
})

folders.delete('/:id/chats/:chatId', async (c) => {
  const folderId = c.req.param('id')
  const chatId = c.req.param('chatId')
  db.delete(schema.chatFolderMembers).where(
    and(eq(schema.chatFolderMembers.folderId, folderId), eq(schema.chatFolderMembers.chatId, chatId))
  ).run()
  return c.json({ ok: true })
})

export default folders
