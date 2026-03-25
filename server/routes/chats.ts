import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { broadcastToChat } from '../ws'
import { decrypt, decryptMessages } from '../security/encryption'
import { logDataAccess } from '../security/audit'

const chats = new Hono()
chats.use('*', authMiddleware)

chats.get('/', async (c) => {
  const userId = c.get('userId')

  const userChats = db
    .select({
      chatId: schema.chatMembers.chatId,
      chatType: schema.chats.type,
      chatName: schema.chats.name,
      chatDescription: schema.chats.description,
      chatAvatar: schema.chats.avatar,
      chatCreatedAt: schema.chats.createdAt,
      memberRole: schema.chatMembers.role,
    })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(eq(schema.chatMembers.userId, userId))
    .all()

  const result = userChats.map((chat) => {
    const lastMessage = db
      .select()
      .from(schema.messages)
      .where(and(
        eq(schema.messages.chatId, chat.chatId),
        eq(schema.messages.visibility, 'normal')
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1)
      .get()

    const members = db
      .select({
        userId: schema.chatMembers.userId,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        online: schema.users.online,
        role: schema.chatMembers.role,
      })
      .from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(eq(schema.chatMembers.chatId, chat.chatId))
      .all()

    const unreadCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.chatId, chat.chatId),
          eq(schema.messages.status, 'sent'),
          sql`${schema.messages.senderId} != ${userId}`
        )
      )
      .get()

    let displayName = chat.chatName
    let displayAvatar = chat.chatAvatar
    if (chat.chatType === 'private') {
      const other = members.find((m) => m.userId !== userId)
      if (other) {
        displayName = other.displayName
        displayAvatar = other.avatar
      }
    }

    return {
      id: chat.chatId,
      type: chat.chatType,
      name: displayName,
      description: chat.chatDescription,
      avatar: displayAvatar,
      members,
      myRole: chat.memberRole,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            // content is decrypted below after the sync map; placeholder for now
            content: lastMessage.content,
            type: lastMessage.type,
            senderId: lastMessage.senderId,
            createdAt: lastMessage.createdAt,
          }
        : null,
      unreadCount: unreadCount?.count || 0,
    }
  })

  result.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt?.getTime?.() || 0
    const bTime = b.lastMessage?.createdAt?.getTime?.() || 0
    return bTime - aTime
  })

  // Decrypt lastMessage content for each chat
  await Promise.all(result.map(async (chat) => {
    if (chat.lastMessage) {
      chat.lastMessage.content = await decrypt(chat.lastMessage.content)
    }
  }))

  return c.json(result)
})

const createChatSchema = z.object({
  type: z.enum(['private', 'group', 'channel']).default('private'),
  name: z.string().optional(),
  description: z.string().optional(),
  avatar: z.string().optional(),
  memberIds: z.array(z.string()).min(1),
})

chats.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = createChatSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { type, name, description, avatar, memberIds } = parsed.data

  if (type === 'private' && memberIds.length === 1) {
    const existingChats = db
      .select({ chatId: schema.chatMembers.chatId })
      .from(schema.chatMembers)
      .where(eq(schema.chatMembers.userId, userId))
      .all()

    for (const ec of existingChats) {
      const chat = db.select().from(schema.chats)
        .where(and(eq(schema.chats.id, ec.chatId), eq(schema.chats.type, 'private')))
        .get()
      if (!chat) continue

      const otherMember = db.select().from(schema.chatMembers)
        .where(and(
          eq(schema.chatMembers.chatId, ec.chatId),
          eq(schema.chatMembers.userId, memberIds[0])
        )).get()

      if (otherMember) {
        return c.json({ id: ec.chatId, existing: true })
      }
    }
  }

  // Groups require a name
  if ((type === 'group' || type === 'channel') && !name) {
    return c.json({ error: 'Name is required for groups and channels' }, 400)
  }

  const chatId = crypto.randomUUID()
  db.insert(schema.chats).values({ id: chatId, type, name, description, avatar }).run()

  // Creator is always admin
  db.insert(schema.chatMembers).values({
    id: crypto.randomUUID(),
    chatId,
    userId,
    role: 'admin',
  }).run()

  for (const memberId of memberIds) {
    if (memberId !== userId) {
      db.insert(schema.chatMembers).values({
        id: crypto.randomUUID(),
        chatId,
        userId: memberId,
        role: type === 'channel' ? 'viewer' : 'member',
      }).run()
    }
  }

  return c.json({ id: chatId }, 201)
})

// Add members to group/channel
chats.post('/:chatId/members', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

  // Verify admin
  const myMember = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId),
      eq(schema.chatMembers.role, 'admin')
    )).get()

  if (!myMember) return c.json({ error: 'Admin access required' }, 403)

  const chat = db.select().from(schema.chats)
    .where(eq(schema.chats.id, chatId)).get()
  if (!chat) return c.json({ error: 'Chat not found' }, 404)

  const { memberIds } = await c.req.json()
  if (!Array.isArray(memberIds)) return c.json({ error: 'memberIds required' }, 400)

  for (const memberId of memberIds) {
    // Check not already a member
    const existing = db.select().from(schema.chatMembers)
      .where(and(
        eq(schema.chatMembers.chatId, chatId),
        eq(schema.chatMembers.userId, memberId)
      )).get()

    if (!existing) {
      db.insert(schema.chatMembers).values({
        id: crypto.randomUUID(),
        chatId,
        userId: memberId,
        role: chat.type === 'channel' ? 'viewer' : 'member',
      }).run()
    }
  }

  return c.json({ ok: true })
})

// Remove member from group/channel
chats.delete('/:chatId/members/:memberId', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')
  const memberId = c.req.param('memberId')

  // Verify admin or self-removal
  const myMember = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    )).get()

  if (!myMember) return c.json({ error: 'Not a member' }, 403)
  if (myMember.role !== 'admin' && userId !== memberId) {
    return c.json({ error: 'Admin access required' }, 403)
  }

  db.delete(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, memberId)
    )).run()

  return c.json({ ok: true })
})

// Update group/channel info
chats.put('/:chatId', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

  const myMember = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId),
      eq(schema.chatMembers.role, 'admin')
    )).get()

  if (!myMember) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const updates: any = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.avatar !== undefined) updates.avatar = body.avatar

  if (Object.keys(updates).length > 0) {
    db.update(schema.chats).set(updates)
      .where(eq(schema.chats.id, chatId)).run()
  }

  return c.json({ ok: true })
})

chats.get('/:chatId/messages', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')
  const limit = parseInt(c.req.query('limit') || '50')
  const includeGhost = c.req.query('include_ghost') === 'true'

  const member = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    )).get()

  if (!member) {
    return c.json({ error: 'Not a member of this chat' }, 403)
  }

  // Build conditions: always include normal messages
  // Include ghost messages ONLY if requested AND only user's own ghost messages
  const conditions = [eq(schema.messages.chatId, chatId)]

  if (!includeGhost) {
    conditions.push(eq(schema.messages.visibility, 'normal'))
  }

  let query = db
    .select({
      id: schema.messages.id,
      chatId: schema.messages.chatId,
      senderId: schema.messages.senderId,
      senderName: schema.users.displayName,
      senderAvatar: schema.users.avatar,
      content: schema.messages.content,
      type: schema.messages.type,
      replyToId: schema.messages.replyToId,
      status: schema.messages.status,
      visibility: schema.messages.visibility,
      metadata: schema.messages.metadata,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit)

  let messages = query.all().reverse()

  // Filter: ghost messages are ONLY visible to the message sender (owner)
  if (includeGhost) {
    messages = messages.filter(m =>
      m.visibility === 'normal' || m.senderId === userId
    )
  }

  // Add reactions to messages
  const messageIds = messages.map(m => m.id)
  if (messageIds.length > 0) {
    const allReactions = db.select().from(schema.messageReactions)
      .where(sql`${schema.messageReactions.messageId} IN (${sql.join(messageIds.map(id => sql`${id}`), sql`,`)})`)
      .all()

    // Group reactions by message
    const reactionsByMessage = new Map<string, Map<string, { count: number; userIds: string[] }>>()
    for (const r of allReactions) {
      if (!reactionsByMessage.has(r.messageId)) reactionsByMessage.set(r.messageId, new Map())
      const emojiMap = reactionsByMessage.get(r.messageId)!
      if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, { count: 0, userIds: [] })
      const entry = emojiMap.get(r.emoji)!
      entry.count++
      entry.userIds.push(r.userId)
    }

    messages = messages.map(m => ({
      ...m,
      reactions: reactionsByMessage.has(m.id)
        ? Array.from(reactionsByMessage.get(m.id)!.entries()).map(([emoji, data]) => ({
            emoji, count: data.count, userIds: data.userIds, reacted: data.userIds.includes(userId),
          }))
        : [],
    }))
  }

  db.update(schema.messages)
    .set({ status: 'read' })
    .where(
      and(
        eq(schema.messages.chatId, chatId),
        sql`${schema.messages.senderId} != ${userId}`,
        eq(schema.messages.status, 'sent'),
        eq(schema.messages.visibility, 'normal')
      )
    )
    .run()

  // Decrypt message content before returning to client
  const decryptedMessages = await decryptMessages(messages as any[])

  // Audit log — track all user reads of chat history
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined
  logDataAccess({
    userId,
    accessorType: 'user',
    action: 'get_chat_history',
    resourceType: 'chat_history',
    resourceId: chatId,
    ip,
  })

  return c.json(decryptedMessages)
})

// Search users (must be before /:chatId/search to avoid routing conflict)
chats.get('/users/search', async (c) => {
  const query = c.req.query('q') || ''
  if (query.length < 2) return c.json([])

  const users = db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      online: schema.users.online,
    })
    .from(schema.users)
    .where(sql`${schema.users.username} LIKE ${'%' + query + '%'} OR ${schema.users.displayName} LIKE ${'%' + query + '%'}`)
    .limit(20)
    .all()

  return c.json(users)
})

// Search messages in chat
chats.get('/:chatId/search', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')
  const query = c.req.query('q') || ''
  const limit = parseInt(c.req.query('limit') || '20')
  if (query.length < 2) return c.json([])

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  // Fetch all messages in chat then decrypt + filter in-memory.
  // SQL LIKE cannot search encrypted ciphertext.
  const allMessages = db.select({
    id: schema.messages.id,
    chatId: schema.messages.chatId,
    senderId: schema.messages.senderId,
    senderName: schema.users.displayName,
    content: schema.messages.content,
    type: schema.messages.type,
    createdAt: schema.messages.createdAt,
  }).from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(
      eq(schema.messages.chatId, chatId),
      eq(schema.messages.visibility, 'normal'),
    ))
    .orderBy(desc(schema.messages.createdAt))
    .all()

  const decrypted = await decryptMessages(allMessages as any[])
  const queryLower = query.toLowerCase()
  const results = decrypted
    .filter(m => m.content.toLowerCase().includes(queryLower))
    .slice(0, limit)

  return c.json(results)
})

// Get pinned messages
chats.get('/:chatId/pinned', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  const pinned = db.select({
    id: schema.pinnedMessages.id,
    messageId: schema.pinnedMessages.messageId,
    pinnedBy: schema.pinnedMessages.pinnedBy,
    pinnedAt: schema.pinnedMessages.createdAt,
    content: schema.messages.content,
    type: schema.messages.type,
    senderId: schema.messages.senderId,
    senderName: schema.users.displayName,
    messageCreatedAt: schema.messages.createdAt,
  })
    .from(schema.pinnedMessages)
    .innerJoin(schema.messages, eq(schema.pinnedMessages.messageId, schema.messages.id))
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(eq(schema.pinnedMessages.chatId, chatId))
    .orderBy(desc(schema.pinnedMessages.createdAt))
    .all()

  const decryptedPinned = await decryptMessages(pinned as any[])
  return c.json(decryptedPinned)
})

// Set disappearing messages timer
chats.put('/:chatId/disappear', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')
  const { timer } = await c.req.json()

  db.update(schema.chatMembers)
    .set({ disappearTimer: timer || null })
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId)))
    .run()

  const { broadcastToChat } = await import('../ws')
  broadcastToChat(chatId, { type: 'chat_settings_updated', chatId, disappearTimer: timer || null })
  return c.json({ ok: true })
})

export default chats
