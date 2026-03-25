import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { broadcastToChat, sendToUser, isUserOnline, getChatSubscribers, trackPendingDelivery } from '../ws'
import { processAgentResponse } from '../ai/engine'
import { processTriggers } from '../ai/triggers'
import { sanitizeMessage } from '../middleware/security'
import { sendPushToOfflineUsers } from '../push'
import { encrypt, decrypt, decryptMessages } from '../security/encryption'
import { logDataAccess } from '../security/audit'
import { shouldTriggerFirstAnalysis, shouldTriggerReanalysis, saveProfileToCache } from '../ai/style/cache'
import { analyzeStyle } from '../ai/style/analyzer'
import { invalidateOnNewMessage } from '../lib/cache'

// Auto-analyze user's writing style (runs in background)
const styleAnalysisInProgress = new Set<string>()
async function checkAutoStyleAnalysis(userId: string) {
  if (styleAnalysisInProgress.has(userId)) return

  const needsFirst = shouldTriggerFirstAnalysis(userId)
  const needsRefresh = !needsFirst && shouldTriggerReanalysis(userId)

  if (!needsFirst && !needsRefresh) return

  styleAnalysisInProgress.add(userId)
  try {
    const profile = await analyzeStyle(userId) // no chatId = cross-chat
    saveProfileToCache(userId, userId, profile, undefined, 'global')

    if (needsFirst) {
      sendToUser(userId, {
        type: 'style_analyzed',
        profile: { tone: profile.tone, confidence: profile.confidence },
        isFirst: true,
      })
    }
  } finally {
    styleAnalysisInProgress.delete(userId)
  }
}

const messages = new Hono()
messages.use('*', authMiddleware)

const sendMessageSchema = z.object({
  chatId: z.string(),
  content: z.string().max(10000),
  type: z.enum(['text', 'image', 'video', 'file', 'media_group']).default('text'),
  replyToId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

messages.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = sendMessageSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { chatId, content: rawContent, type, replyToId, metadata: inMeta } = parsed.data

  // media_group requires media in metadata; content (caption) can be empty
  if (type === 'media_group') {
    if (!inMeta?.media || !Array.isArray(inMeta.media) || inMeta.media.length === 0) {
      return c.json({ error: 'media_group requires metadata.media array' }, 400)
    }
    if (inMeta.media.length > 10) {
      return c.json({ error: 'Maximum 10 media items per message' }, 400)
    }
  } else if (!rawContent || rawContent.trim().length === 0) {
    return c.json({ error: 'Content is required' }, 400)
  }

  // Sanitize message content — strip HTML/script tags
  const plaintextContent = rawContent ? sanitizeMessage(rawContent) : ''
  // Encrypt content at rest (enc:v1:... stored in DB)
  const content = plaintextContent ? await encrypt(plaintextContent) : ''

  // Parse @mentions (from plaintext, before encryption)
  const mentionRegex = /(?:^|\s)@(\w+)/g
  const mentionUsernames: string[] = []
  let mentionMatch
  while ((mentionMatch = mentionRegex.exec(plaintextContent)) !== null) {
    mentionUsernames.push(mentionMatch[1])
  }
  let mentionedUserIds: string[] = []
  if (mentionUsernames.length > 0) {
    const allUsers = db.select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users).all()
    mentionedUserIds = allUsers
      .filter(u => mentionUsernames.includes(u.username))
      .map(u => u.id)
  }

  const member = db.select({
    member: schema.chatMembers,
    chatType: schema.chats.type,
  })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    )).get()

  if (!member) {
    return c.json({ error: 'Not a member of this chat' }, 403)
  }

  // In channels, only admins can post
  if (member.chatType === 'channel' && member.member.role !== 'admin') {
    return c.json({ error: 'Only admins can post in channels' }, 403)
  }

  const messageId = crypto.randomUUID()

  // Check if disappearing messages is enabled for this chat
  const disappearTimer = (member.member as any).disappearTimer
  let messageMeta = mentionedUserIds.length > 0
    ? { ...(inMeta || {}), mentions: mentionedUserIds }
    : inMeta || undefined
  if (disappearTimer && disappearTimer > 0) {
    messageMeta = { ...(messageMeta || {}), expiresAt: Math.floor(Date.now() / 1000) + disappearTimer }
  }

  const message = {
    id: messageId,
    chatId,
    senderId: userId,
    content,
    type,
    replyToId: replyToId || null,
    status: 'sent' as const,
    ...(messageMeta ? { metadata: messageMeta } : {}),
  }

  db.insert(schema.messages).values(message).run()

  // Invalidate caches for all chat members
  const chatMemberIds = db.select({ userId: schema.chatMembers.userId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.chatId, chatId))
    .all()
    .map(m => m.userId)
  invalidateOnNewMessage(chatId, chatMemberIds)

  const sender = db.select({
    displayName: schema.users.displayName,
    avatar: schema.users.avatar,
  }).from(schema.users).where(eq(schema.users.id, userId)).get()

  const fullMessage = {
    ...message,
    content: plaintextContent,
    senderName: sender?.displayName,
    senderAvatar: sender?.avatar,
    createdAt: new Date(),
  }

  broadcastToChat(chatId, {
    type: 'new_message',
    message: fullMessage,
  })

  // Track pending delivery for offline users
  const onlineSubscribers = getChatSubscribers(chatId)
  const offlineMembers = chatMemberIds.filter(id => id !== userId && !onlineSubscribers.includes(id))
  trackPendingDelivery(messageId, offlineMembers)

  // Send push notifications to offline users
  sendPushToOfflineUsers(chatId, userId, sender?.displayName || 'Someone', plaintextContent, isUserOnline).catch(() => {})

  // Send mention notifications
  if (mentionedUserIds.length > 0) {
    for (const mentionedId of mentionedUserIds) {
      if (mentionedId === userId) continue
      sendToUser(mentionedId, {
        type: 'mention',
        chatId,
        messageId,
        mentionedBy: sender?.displayName || 'Someone',
        content: plaintextContent.length > 100 ? plaintextContent.slice(0, 100) + '...' : plaintextContent,
      })
    }
  }

  // Trigger AI agent processing (async, doesn't block response) — pass plaintext
  processAgentResponse(chatId, userId, plaintextContent).catch((err) => {
    console.error('[Agent] Failed to process response:', err?.message || err)
  })

  // Auto style analysis (async, non-blocking)
  if (type === 'text') {
    checkAutoStyleAnalysis(userId).catch(err => {
      console.error('[Style] Auto-analysis failed:', err?.message || err)
    })
  }

  // Process triggers (async, doesn't block response) — pass plaintext
  processTriggers(chatId, userId, {
    id: messageId,
    chatId,
    senderId: userId,
    content: plaintextContent,
    type,
  }).catch((err) => {
    console.error('[Triggers] Failed to process:', err?.message || err)
  })

  return c.json(fullMessage, 201)
})

messages.patch('/:messageId/status', async (c) => {
  const messageId = c.req.param('messageId')
  const { status } = await c.req.json()

  if (!['delivered', 'read'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  db.update(schema.messages)
    .set({ status })
    .where(eq(schema.messages.id, messageId))
    .run()

  return c.json({ ok: true })
})

// Edit message
const editMessageSchema = z.object({
  content: z.string().min(1).max(10000),
})

messages.patch('/:messageId', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')
  const body = await c.req.json()
  const parsed = editMessageSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const msg = db.select().from(schema.messages)
    .where(eq(schema.messages.id, messageId)).get()

  if (!msg) return c.json({ error: 'Message not found' }, 404)
  if (msg.senderId !== userId) return c.json({ error: 'Can only edit own messages' }, 403)

  // 48-hour edit window
  const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : 0
  if (Date.now() - msgTime > 48 * 60 * 60 * 1000) {
    return c.json({ error: 'Cannot edit messages older than 48 hours' }, 403)
  }

  const plaintextEdit = sanitizeMessage(parsed.data.content)
  const encryptedEdit = await encrypt(plaintextEdit)
  const editedAt = new Date()

  db.update(schema.messages)
    .set({ content: encryptedEdit, editedAt })
    .where(eq(schema.messages.id, messageId))
    .run()

  broadcastToChat(msg.chatId, {
    type: 'message_edited',
    messageId,
    chatId: msg.chatId,
    content: plaintextEdit, // plaintext for WebSocket broadcast
    editedAt: editedAt.toISOString(),
  })

  return c.json({ ok: true, content: plaintextEdit, editedAt })
})

// Forward message
const forwardSchema = z.object({
  targetChatId: z.string(),
})

messages.post('/:messageId/forward', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')
  const body = await c.req.json()
  const parsed = forwardSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { targetChatId } = parsed.data

  // Get original message
  const original = db.select({
    msg: schema.messages,
    senderName: schema.users.displayName,
  })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(eq(schema.messages.id, messageId))
    .get()

  if (!original) return c.json({ error: 'Message not found' }, 404)

  // Check user has access to source chat
  const sourceMember = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, original.msg.chatId),
      eq(schema.chatMembers.userId, userId)
    )).get()
  if (!sourceMember) return c.json({ error: 'No access to source chat' }, 403)

  // Check user has access to target chat
  const targetMember = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, targetChatId),
      eq(schema.chatMembers.userId, userId)
    )).get()
  if (!targetMember) return c.json({ error: 'No access to target chat' }, 403)

  // Get source chat name
  const sourceChat = db.select().from(schema.chats)
    .where(eq(schema.chats.id, original.msg.chatId)).get()
  let sourceChatName = sourceChat?.name || 'Unknown'
  if (sourceChat?.type === 'private') {
    const other = db.select({ displayName: schema.users.displayName })
      .from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(and(
        eq(schema.chatMembers.chatId, original.msg.chatId),
        sql`${schema.chatMembers.userId} != ${userId}`
      )).get()
    if (other) sourceChatName = other.displayName
  }

  // Create forwarded message
  const newMessageId = crypto.randomUUID()
  const sender = db.select({
    displayName: schema.users.displayName,
    avatar: schema.users.avatar,
  }).from(schema.users).where(eq(schema.users.id, userId)).get()

  const forwardedFrom = {
    chatId: original.msg.chatId,
    chatName: sourceChatName,
    senderName: original.senderName,
  }

  // Decrypt source content, then re-encrypt for the new message record
  const sourceContentPlain = await decrypt(original.msg.content)
  const forwardedContent = await encrypt(sourceContentPlain)

  db.insert(schema.messages).values({
    id: newMessageId,
    chatId: targetChatId,
    senderId: userId,
    content: forwardedContent,
    type: original.msg.type || 'text',
    status: 'sent',
    visibility: 'normal',
    forwardedFrom,
  }).run()

  const fullMessage = {
    id: newMessageId,
    chatId: targetChatId,
    senderId: userId,
    senderName: sender?.displayName,
    senderAvatar: sender?.avatar,
    content: sourceContentPlain, // plaintext for WebSocket broadcast
    type: original.msg.type || 'text',
    status: 'sent',
    forwardedFrom,
    createdAt: new Date(),
  }

  broadcastToChat(targetChatId, {
    type: 'new_message',
    message: fullMessage,
  })

  return c.json(fullMessage, 201)
})

// Add reaction
messages.post('/:messageId/reactions', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')
  const { emoji } = await c.req.json()
  if (!emoji || typeof emoji !== 'string') return c.json({ error: 'emoji required' }, 400)

  const msg = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get()
  if (!msg) return c.json({ error: 'Message not found' }, 404)

  // Check user has access to the chat
  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, msg.chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  try {
    db.insert(schema.messageReactions).values({
      id: crypto.randomUUID(), messageId, userId, emoji
    }).run()
  } catch {
    // Unique constraint — already reacted with this emoji
    return c.json({ ok: true, action: 'exists' })
  }

  const user = db.select({ displayName: schema.users.displayName })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  broadcastToChat(msg.chatId, {
    type: 'reaction_added',
    messageId, chatId: msg.chatId, emoji,
    userId, username: user?.displayName || 'User',
  })

  return c.json({ ok: true, action: 'added' })
})

// Remove reaction
messages.delete('/:messageId/reactions/:emoji', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')
  const emoji = decodeURIComponent(c.req.param('emoji'))

  db.delete(schema.messageReactions).where(
    and(
      eq(schema.messageReactions.messageId, messageId),
      eq(schema.messageReactions.userId, userId),
      eq(schema.messageReactions.emoji, emoji)
    )
  ).run()

  const msg = db.select({ chatId: schema.messages.chatId }).from(schema.messages)
    .where(eq(schema.messages.id, messageId)).get()

  if (msg) {
    broadcastToChat(msg.chatId, {
      type: 'reaction_removed',
      messageId, chatId: msg.chatId, emoji, userId,
    })
  }

  return c.json({ ok: true })
})

// Pin message
messages.post('/:messageId/pin', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')

  const msg = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get()
  if (!msg) return c.json({ error: 'Message not found' }, 404)

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, msg.chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  try {
    db.insert(schema.pinnedMessages).values({
      id: crypto.randomUUID(), chatId: msg.chatId, messageId, pinnedBy: userId,
    }).run()
  } catch {
    return c.json({ ok: true, action: 'already_pinned' })
  }

  broadcastToChat(msg.chatId, { type: 'message_pinned', chatId: msg.chatId, messageId, pinnedBy: userId })
  return c.json({ ok: true })
})

// Unpin message
messages.delete('/:messageId/pin', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')

  const msg = db.select({ chatId: schema.messages.chatId }).from(schema.messages)
    .where(eq(schema.messages.id, messageId)).get()
  if (!msg) return c.json({ error: 'Message not found' }, 404)

  db.delete(schema.pinnedMessages).where(
    and(eq(schema.pinnedMessages.chatId, msg.chatId), eq(schema.pinnedMessages.messageId, messageId))
  ).run()

  broadcastToChat(msg.chatId, { type: 'message_unpinned', chatId: msg.chatId, messageId })
  return c.json({ ok: true })
})

// Batch forward
messages.post('/batch/forward', async (c) => {
  const userId = c.get('userId')
  const { messageIds, targetChatId } = await c.req.json()
  if (!Array.isArray(messageIds) || !targetChatId) return c.json({ error: 'messageIds and targetChatId required' }, 400)

  // Verify access to target chat
  const targetMember = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, targetChatId), eq(schema.chatMembers.userId, userId))).get()
  if (!targetMember) return c.json({ error: 'No access to target chat' }, 403)

  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  const forwarded = []
  for (const mid of messageIds.slice(0, 20)) {
    const original = db.select({
      msg: schema.messages,
      senderName: schema.users.displayName,
    }).from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.id, mid)).get()
    if (!original) continue

    const sourceChat = db.select({ name: schema.chats.name }).from(schema.chats)
      .where(eq(schema.chats.id, original.msg.chatId)).get()

    const newId = crypto.randomUUID()
    const forwardedFrom = { chatId: original.msg.chatId, chatName: sourceChat?.name || 'Unknown', senderName: original.senderName }

    // Decrypt source then re-encrypt for the new record
    const srcPlain = await decrypt(original.msg.content)
    const srcEncrypted = await encrypt(srcPlain)

    db.insert(schema.messages).values({
      id: newId, chatId: targetChatId, senderId: userId, content: srcEncrypted,
      type: original.msg.type || 'text', status: 'sent', visibility: 'normal', forwardedFrom,
    }).run()

    const fullMsg = {
      id: newId, chatId: targetChatId, senderId: userId, senderName: sender?.displayName,
      senderAvatar: sender?.avatar, content: srcPlain, type: original.msg.type || 'text',
      status: 'sent', forwardedFrom, createdAt: new Date(),
    }
    broadcastToChat(targetChatId, { type: 'new_message', message: fullMsg })
    forwarded.push(fullMsg)
  }

  return c.json({ forwarded, count: forwarded.length })
})

// Schedule message
messages.post('/schedule', async (c) => {
  const userId = c.get('userId')
  const { chatId, content, type, sendAt } = await c.req.json()
  if (!chatId || !content || !sendAt) return c.json({ error: 'chatId, content, sendAt required' }, 400)

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  const id = crypto.randomUUID()
  db.insert(schema.scheduledMessages).values({
    id, userId, chatId, content, type: type || 'text', sendAt: new Date(sendAt), status: 'pending',
  }).run()
  return c.json({ id }, 201)
})

messages.get('/scheduled', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.query('chatId')

  const conditions = [eq(schema.scheduledMessages.userId, userId), eq(schema.scheduledMessages.status, 'pending')]
  if (chatId) conditions.push(eq(schema.scheduledMessages.chatId, chatId))

  const items = db.select().from(schema.scheduledMessages)
    .where(and(...conditions)).all()
  return c.json(items)
})

messages.delete('/scheduled/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  db.update(schema.scheduledMessages)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.scheduledMessages.id, id), eq(schema.scheduledMessages.userId, userId)))
    .run()
  return c.json({ ok: true })
})

// Delete message (own messages only)
messages.delete('/:messageId', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')

  const msg = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get()
  if (!msg) return c.json({ error: 'Message not found' }, 404)
  if (msg.senderId !== userId) return c.json({ error: 'Can only delete own messages' }, 403)

  db.delete(schema.messages).where(eq(schema.messages.id, messageId)).run()
  broadcastToChat(msg.chatId, { type: 'message_deleted', chatId: msg.chatId, messageId })
  return c.json({ ok: true })
})

// Transcribe voice message
messages.post('/:messageId/transcribe', async (c) => {
  const messageId = c.req.param('messageId')

  const msg = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get()
  if (!msg) return c.json({ error: 'Message not found' }, 404)
  if (msg.type !== 'voice' && msg.type !== 'file') return c.json({ error: 'Not a voice message' }, 400)

  // Check if already transcribed
  const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {})
  if (meta.transcription) return c.json({ transcription: meta.transcription })

  try {
    const { transcribeAudio } = await import('../ai/stt')
    const transcription = await transcribeAudio(msg.content)

    // Save transcription to metadata
    const newMeta = { ...meta, transcription }
    db.update(schema.messages).set({ metadata: newMeta }).where(eq(schema.messages.id, messageId)).run()

    return c.json({ transcription })
  } catch (err: any) {
    return c.json({ error: err.message || 'Transcription failed' }, 500)
  }
})

export default messages
