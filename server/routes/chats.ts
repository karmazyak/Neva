import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and, desc, sql, gt } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { broadcastToChat } from '../ws'
import { decrypt, decryptMessages } from '../security/encryption'
import { logDataAccess } from '../security/audit'
import { chatListCache, recentMessagesCache, invalidateChatListForUser } from '../lib/cache'

const chats = new Hono()
chats.use('*', authMiddleware)

// ── GET /chats — Optimized single-pass loadChats ─────────────────────────────
// Replaces the N+1 query pattern (was 3 queries per chat = 151 for 50 chats)
// Now: 1 query for chats + 1 batch query for members = 2 total.

chats.get('/', async (c) => {
  const userId = c.get('userId')

  // Check cache first
  const cached = chatListCache.get(userId)
  if (cached) return c.json(cached)

  // Single query: user's chats with denormalized last_message data
  const userChats = db
    .select({
      chatId: schema.chatMembers.chatId,
      chatType: schema.chats.type,
      chatName: schema.chats.name,
      chatDescription: schema.chats.description,
      chatAvatar: schema.chats.avatar,
      chatCreatedAt: schema.chats.createdAt,
      memberRole: schema.chatMembers.role,
      // Denormalized last message (from trigger)
      lastMessageId: schema.chats.lastMessageId,
      lastMessageAt: schema.chats.lastMessageAt,
      lastMessagePreview: schema.chats.lastMessagePreview,
      lastMessageSenderId: schema.chats.lastMessageSenderId,
    })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(eq(schema.chatMembers.userId, userId))
    .all()

  if (userChats.length === 0) {
    chatListCache.set(userId, [])
    return c.json([])
  }

  // Batch query: all members across all user's chats (1 query instead of N)
  const chatIds = userChats.map(c => c.chatId)
  const allMembers = db
    .select({
      chatId: schema.chatMembers.chatId,
      userId: schema.chatMembers.userId,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      online: schema.users.online,
      role: schema.chatMembers.role,
    })
    .from(schema.chatMembers)
    .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
    .where(sql`${schema.chatMembers.chatId} IN (${sql.join(chatIds.map(id => sql`${id}`), sql`,`)})`)
    .all()

  // Group members by chatId
  const membersByChat = new Map<string, typeof allMembers>()
  for (const m of allMembers) {
    let arr = membersByChat.get(m.chatId)
    if (!arr) {
      arr = []
      membersByChat.set(m.chatId, arr)
    }
    arr.push(m)
  }

  // Batch query: unread counts per chat (1 query instead of N)
  const unreadCounts = db
    .select({
      chatId: schema.messages.chatId,
      count: sql<number>`count(*)`,
    })
    .from(schema.messages)
    .where(
      and(
        sql`${schema.messages.chatId} IN (${sql.join(chatIds.map(id => sql`${id}`), sql`,`)})`,
        eq(schema.messages.status, 'sent'),
        sql`${schema.messages.senderId} != ${userId}`,
        eq(schema.messages.visibility, 'normal')
      )
    )
    .groupBy(schema.messages.chatId)
    .all()

  const unreadMap = new Map<string, number>()
  for (const row of unreadCounts) {
    unreadMap.set(row.chatId, row.count)
  }

  // Build result
  const result = await Promise.all(userChats.map(async (chat) => {
    const members = membersByChat.get(chat.chatId) || []

    let displayName = chat.chatName
    let displayAvatar = chat.chatAvatar
    if (chat.chatType === 'private') {
      const other = members.find((m) => m.userId !== userId)
      if (other) {
        displayName = other.displayName
        displayAvatar = other.avatar
      }
    }

    // Decrypt last message preview
    let lastMessageContent = chat.lastMessagePreview || null
    if (lastMessageContent) {
      try {
        lastMessageContent = await decrypt(lastMessageContent)
      } catch {
        lastMessageContent = null
      }
    }

    // Find sender name for last message
    let lastMessageSenderName: string | null = null
    if (chat.lastMessageSenderId) {
      const sender = members.find(m => m.userId === chat.lastMessageSenderId)
      lastMessageSenderName = sender?.displayName || null
    }

    return {
      id: chat.chatId,
      type: chat.chatType,
      name: displayName,
      description: chat.chatDescription,
      avatar: displayAvatar,
      members,
      myRole: chat.memberRole,
      lastMessage: chat.lastMessageId
        ? {
            id: chat.lastMessageId,
            content: lastMessageContent,
            senderId: chat.lastMessageSenderId,
            senderName: lastMessageSenderName,
            createdAt: chat.lastMessageAt,
          }
        : null,
      unreadCount: unreadMap.get(chat.chatId) || 0,
    }
  }))

  // Sort by last message time
  result.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt?.getTime?.() || 0
    const bTime = b.lastMessage?.createdAt?.getTime?.() || 0
    return bTime - aTime
  })

  chatListCache.set(userId, result)
  return c.json(result)
})

// ── GET /chats/sync — Delta sync endpoint ────────────────────────────────────
// Returns only changes since a given timestamp.
// Client calls this on reconnect instead of full loadChats + loadMessages.

chats.get('/sync', async (c) => {
  const userId = c.get('userId')
  const sinceParam = c.req.query('since')
  if (!sinceParam) return c.json({ error: 'since parameter required' }, 400)

  const sinceTs = parseInt(sinceParam)
  if (isNaN(sinceTs)) return c.json({ error: 'since must be a unix timestamp' }, 400)

  // Get user's chats
  const userChatIds = db
    .select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.userId, userId))
    .all()
    .map(c => c.chatId)

  if (userChatIds.length === 0) {
    return c.json({ messages: { new: [], edited: [], deleted: [] }, timestamp: Math.floor(Date.now() / 1000) })
  }

  // New messages since timestamp
  const newMessages = db.select({
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
    editedAt: schema.messages.editedAt,
    forwardedFrom: schema.messages.forwardedFrom,
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(
      and(
        sql`${schema.messages.chatId} IN (${sql.join(userChatIds.map(id => sql`${id}`), sql`,`)})`,
        gt(schema.messages.createdAt, new Date(sinceTs * 1000)),
        eq(schema.messages.visibility, 'normal')
      )
    )
    .orderBy(schema.messages.createdAt)
    .limit(500)
    .all()

  // Edited messages since timestamp
  const editedMessages = db.select({
    id: schema.messages.id,
    chatId: schema.messages.chatId,
    content: schema.messages.content,
    editedAt: schema.messages.editedAt,
  })
    .from(schema.messages)
    .where(
      and(
        sql`${schema.messages.chatId} IN (${sql.join(userChatIds.map(id => sql`${id}`), sql`,`)})`,
        gt(schema.messages.editedAt, new Date(sinceTs * 1000))
      )
    )
    .limit(200)
    .all()

  // Decrypt all messages
  const decryptedNew = await decryptMessages(newMessages as any[])
  const decryptedEdited = await decryptMessages(editedMessages as any[])

  // Add reactions to new messages
  if (decryptedNew.length > 0) {
    const messageIds = decryptedNew.map(m => m.id)
    const allReactions = db.select().from(schema.messageReactions)
      .where(sql`${schema.messageReactions.messageId} IN (${sql.join(messageIds.map(id => sql`${id}`), sql`,`)})`)
      .all()

    const reactionsByMessage = new Map<string, Map<string, { count: number; userIds: string[] }>>()
    for (const r of allReactions) {
      if (!reactionsByMessage.has(r.messageId)) reactionsByMessage.set(r.messageId, new Map())
      const emojiMap = reactionsByMessage.get(r.messageId)!
      if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, { count: 0, userIds: [] })
      const entry = emojiMap.get(r.emoji)!
      entry.count++
      entry.userIds.push(r.userId)
    }

    for (const msg of decryptedNew) {
      const msgReactions = reactionsByMessage.get(msg.id)
      if (msgReactions) {
        (msg as any).reactions = Array.from(msgReactions.entries()).map(([emoji, data]) => ({
          emoji, count: data.count, userIds: data.userIds, reacted: data.userIds.includes(userId),
        }))
      } else {
        (msg as any).reactions = []
      }
    }
  }

  return c.json({
    messages: {
      new: decryptedNew,
      edited: decryptedEdited,
    },
    timestamp: Math.floor(Date.now() / 1000),
  })
})

// ── POST /chats — Create chat ────────────────────────────────────────────────

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

  if ((type === 'group' || type === 'channel') && !name) {
    return c.json({ error: 'Name is required for groups and channels' }, 400)
  }

  const chatId = crypto.randomUUID()
  db.insert(schema.chats).values({ id: chatId, type, name, description, avatar }).run()

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

  // Invalidate cache for all members
  invalidateChatListForUser(userId)
  for (const memberId of memberIds) {
    invalidateChatListForUser(memberId)
  }

  return c.json({ id: chatId }, 201)
})

// ── POST /:chatId/members — Add members ──────────────────────────────────────

chats.post('/:chatId/members', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

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
      invalidateChatListForUser(memberId)
    }
  }

  return c.json({ ok: true })
})

// ── DELETE /:chatId/members/:memberId — Remove member ────────────────────────

chats.delete('/:chatId/members/:memberId', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')
  const memberId = c.req.param('memberId')

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

  invalidateChatListForUser(memberId)

  return c.json({ ok: true })
})

// ── PUT /:chatId — Update chat info ──────────────────────────────────────────

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

// ── GET /:chatId/messages — Chat history ─────────────────────────────────────

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

  // Check cache for non-ghost queries
  if (!includeGhost) {
    const cached = recentMessagesCache.get(chatId)
    if (cached) return c.json(cached)
  }

  const conditions = [eq(schema.messages.chatId, chatId)]
  if (!includeGhost) {
    conditions.push(eq(schema.messages.visibility, 'normal'))
  }

  let messages = db
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
    .all()
    .reverse()

  // Filter ghost messages
  if (includeGhost) {
    messages = messages.filter(m =>
      m.visibility === 'normal' || m.senderId === userId
    )
  }

  // Batch load reactions
  const messageIds = messages.map(m => m.id)
  if (messageIds.length > 0) {
    const allReactions = db.select().from(schema.messageReactions)
      .where(sql`${schema.messageReactions.messageId} IN (${sql.join(messageIds.map(id => sql`${id}`), sql`,`)})`)
      .all()

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

  // Mark as read
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

  // Decrypt
  const decryptedMessages = await decryptMessages(messages as any[])

  // Cache non-ghost results
  if (!includeGhost) {
    recentMessagesCache.set(chatId, decryptedMessages)
  }

  // Audit log
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

// ── GET /users/search — Search users ─────────────────────────────────────────

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

// ── GET /:chatId/search — Search messages ────────────────────────────────────

chats.get('/:chatId/search', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')
  const query = c.req.query('q') || ''
  const limit = parseInt(c.req.query('limit') || '20')
  if (query.length < 2) return c.json([])

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  // Fetch all messages in chat then decrypt + filter in-memory
  // (encrypted content can't be searched with SQL LIKE)
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

// ── GET /:chatId/pinned — Pinned messages ────────────────────────────────────

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

// ── PUT /:chatId/disappear — Disappearing messages ──────────────────────────

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
