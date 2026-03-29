import type { ServerWebSocket } from 'bun'
import { verifyToken } from './middleware/auth'
import { db, schema } from './db'
import { eq, and, sql, gt } from 'drizzle-orm'
import { bus } from './lib/message-bus'
import { invalidateChatListForUser } from './lib/cache'
import { decrypt } from './security/encryption'

// ── Types ────────────────────────────────────────────────────────────────────

interface WSData {
  userId: string
  username: string
  authenticated: boolean
  connectedAt: number
}

// ── Connection Management ────────────────────────────────────────────────────

const MAX_CONNECTIONS_PER_USER = 5

// Map of userId -> Set of websockets
const connections = new Map<string, Set<ServerWebSocket<WSData>>>()
// Map of chatId -> Set of userIds
const chatSubscriptions = new Map<string, Set<string>>()

// On server start, reset ALL users to offline
db.update(schema.users)
  .set({ online: false })
  .run()
console.log('[WS] Reset all users to offline on startup')

// ── Rate Limiting ────────────────────────────────────────────────────────────

const wsMessageRates = new WeakMap<ServerWebSocket<WSData>, { count: number; resetAt: number }>()
const WS_RATE_LIMIT = 30
const WS_RATE_WINDOW = 1000

function checkWSRateLimit(ws: ServerWebSocket<WSData>): boolean {
  const now = Date.now()
  let entry = wsMessageRates.get(ws)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WS_RATE_WINDOW }
    wsMessageRates.set(ws, entry)
  }
  entry.count++
  return entry.count <= WS_RATE_LIMIT
}

// ── Pending Messages Queue (store-and-forward) ──────────────────────────────
// Messages that were sent while user was offline. Delivered on reconnect.
// In Phase 2 this moves to Redis; for now in-memory is fine for <1K users.

const pendingAcks = new Map<string, Set<string>>()  // messageId -> Set<userId> who haven't ACKed

/**
 * Track that a message needs ACK from a user.
 * If user is online, we don't track (WS delivery is instant).
 * If user is offline, the message stays in DB with status='sent'.
 */
export function trackPendingDelivery(messageId: string, offlineUserIds: string[]) {
  if (offlineUserIds.length === 0) return
  pendingAcks.set(messageId, new Set(offlineUserIds))
}

/**
 * Handle ACK from a user for a batch of messages.
 */
function handleAck(userId: string, messageIds: string[]) {
  for (const msgId of messageIds) {
    const pending = pendingAcks.get(msgId)
    if (pending) {
      pending.delete(userId)
      if (pending.size === 0) pendingAcks.delete(msgId)
    }
  }
  // Mark messages as delivered for this user
  if (messageIds.length > 0) {
    try {
      db.update(schema.messages)
        .set({ status: 'delivered' })
        .where(
          and(
            sql`${schema.messages.id} IN (${sql.join(messageIds.map(id => sql`${id}`), sql`,`)})`,
            eq(schema.messages.status, 'sent')
          )
        )
        .run()
    } catch {}
  }
}

// ── Connection Setup ─────────────────────────────────────────────────────────

export function handleWSUpgrade(req: Request): WSData | null {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (token) {
    try {
      const payload = verifyToken(token)
      return { userId: payload.userId, username: payload.username, authenticated: true, connectedAt: Date.now() }
    } catch {}
  }

  return { userId: '', username: '', authenticated: false, connectedAt: Date.now() }
}

export function handleWSOpen(ws: ServerWebSocket<WSData>) {
  if (ws.data.authenticated) {
    setupAuthenticatedConnection(ws)
  }
}

async function setupAuthenticatedConnection(ws: ServerWebSocket<WSData>) {
  const { userId } = ws.data

  // ── Connection limit per user ──
  let userConns = connections.get(userId)
  if (!userConns) {
    userConns = new Set()
    connections.set(userId, userConns)
  }

  if (userConns.size >= MAX_CONNECTIONS_PER_USER) {
    // Close oldest connection
    const oldest = userConns.values().next().value
    if (oldest) {
      try { oldest.close(4000, 'Too many connections') } catch {}
      userConns.delete(oldest)
    }
  }
  userConns.add(ws)

  // Mark user online
  db.update(schema.users)
    .set({ online: true, lastSeen: new Date() })
    .where(eq(schema.users.id, userId))
    .run()
  invalidateChatListForUser(userId)

  // Subscribe to all user's chats
  const userChats = db
    .select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.userId, userId))
    .all()

  for (const { chatId } of userChats) {
    if (!chatSubscriptions.has(chatId)) {
      chatSubscriptions.set(chatId, new Set())
    }
    chatSubscriptions.get(chatId)!.add(userId)
  }

  // Notify contacts
  broadcastUserStatus(userId, true)

  // ── Deliver pending messages (store-and-forward) ──
  // Find undelivered messages for this user across all their chats
  const chatIds = userChats.map(c => c.chatId)
  let pendingMessages: any[] = []

  if (chatIds.length > 0) {
    try {
      pendingMessages = db.select({
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
            sql`${schema.messages.chatId} IN (${sql.join(chatIds.map(id => sql`${id}`), sql`,`)})`,
            eq(schema.messages.status, 'sent'),
            sql`${schema.messages.senderId} != ${userId}`,
            eq(schema.messages.visibility, 'normal')
          )
        )
        .orderBy(schema.messages.createdAt)
        .limit(200)
        .all()
    } catch {}
  }

  // Decrypt and send pending messages as a sync batch
  if (pendingMessages.length > 0) {
    const decrypted = await Promise.all(pendingMessages.map(async (msg) => {
      try {
        return { ...msg, content: await decrypt(msg.content) }
      } catch {
        return msg
      }
    }))

    ws.send(JSON.stringify({
      type: 'sync',
      messages: decrypted,
      count: decrypted.length,
    }))
  }

  ws.send(JSON.stringify({ type: 'auth_ok', userId }))
}

// ── Message Handling ─────────────────────────────────────────────────────────

export function handleWSMessage(ws: ServerWebSocket<WSData>, message: string) {
  if (!checkWSRateLimit(ws)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
    return
  }

  try {
    const data = JSON.parse(message)

    // Auth message
    if (data.type === 'auth') {
      if (ws.data.authenticated) return

      if (!data.token || typeof data.token !== 'string') {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Token required' }))
        ws.close(4001, 'Authentication required')
        return
      }

      try {
        const payload = verifyToken(data.token)
        ws.data.userId = payload.userId
        ws.data.username = payload.username
        ws.data.authenticated = true
        ws.data.connectedAt = Date.now()
        setupAuthenticatedConnection(ws)
      } catch {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }))
        ws.close(4001, 'Invalid token')
      }
      return
    }

    if (!ws.data.authenticated) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated. Send auth message first.' }))
      return
    }

    switch (data.type) {
      case 'typing':
        if (data.chatId && typeof data.chatId === 'string') {
          broadcastToChat(data.chatId, {
            type: 'typing',
            userId: ws.data.userId,
            username: ws.data.username,
          }, ws.data.userId)
        }
        break

      case 'read':
        if (data.chatId && typeof data.chatId === 'string') {
          broadcastToChat(data.chatId, {
            type: 'messages_read',
            chatId: data.chatId,
            userId: ws.data.userId,
          })
        }
        break

      case 'ack':
        // Client acknowledges receipt of messages
        if (Array.isArray(data.messageIds)) {
          handleAck(ws.data.userId, data.messageIds)
        }
        break

      case 'consent_response':
        if (data.requestId && typeof data.requestId === 'string') {
          import('./ai/consent').then(({ handleConsentResponse }) => {
            handleConsentResponse(data.requestId, !!data.approved, data.message)
          })
        }
        break

      case 'agent_dialog_respond':
        if (data.dialogId && typeof data.dialogId === 'string') {
          import('./ai/consent').then(({ handleConsentResponse }) => {
            handleConsentResponse(data.dialogId, !!data.approved, data.message)
          })
        }
        break

      case 'subscribe':
        if (data.chatId && typeof data.chatId === 'string') {
          const member = db.select()
            .from(schema.chatMembers)
            .where(and(
              eq(schema.chatMembers.chatId, data.chatId),
              eq(schema.chatMembers.userId, ws.data.userId)
            ))
            .get()

          if (member) {
            if (!chatSubscriptions.has(data.chatId)) {
              chatSubscriptions.set(data.chatId, new Set())
            }
            chatSubscriptions.get(data.chatId)!.add(ws.data.userId)
          }
        }
        break
    }
  } catch {
    // Ignore invalid messages
  }
}

// ── Connection Close ─────────────────────────────────────────────────────────

export function handleWSClose(ws: ServerWebSocket<WSData>) {
  if (!ws.data.authenticated) return

  const { userId } = ws.data

  const userConns = connections.get(userId)
  if (userConns) {
    userConns.delete(ws)
    if (userConns.size === 0) {
      connections.delete(userId)

      db.update(schema.users)
        .set({ online: false, lastSeen: new Date() })
        .where(eq(schema.users.id, userId))
        .run()
      invalidateChatListForUser(userId)

      // Remove from chat subscriptions
      for (const [chatId, users] of chatSubscriptions) {
        users.delete(userId)
        if (users.size === 0) chatSubscriptions.delete(chatId)
      }

      broadcastUserStatus(userId, false)
    }
  }
}

// ── Broadcasting ─────────────────────────────────────────────────────────────

export function broadcastToChat(chatId: string, data: any, excludeUserId?: string) {
  const users = chatSubscriptions.get(chatId)
  if (!users) return

  // Serialize ONCE
  const payload = JSON.stringify(data)

  for (const userId of users) {
    if (userId === excludeUserId) continue
    const userConns = connections.get(userId)
    if (userConns) {
      for (const ws of userConns) {
        try {
          // cork() batches multiple sends into one syscall
          ws.cork(() => {
            ws.send(payload)
          })
        } catch {
          // Connection dead
        }
      }
    }
  }
}

function broadcastUserStatus(userId: string, online: boolean) {
  const userChats = db
    .select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.userId, userId))
    .all()

  const payload = JSON.stringify({ type: 'user_status', userId, online })

  for (const { chatId } of userChats) {
    const users = chatSubscriptions.get(chatId)
    if (!users) continue
    for (const uid of users) {
      if (uid === userId) continue
      const userConns = connections.get(uid)
      if (userConns) {
        for (const ws of userConns) {
          try { ws.cork(() => { ws.send(payload) }) } catch {}
        }
      }
    }
  }
}

export function isUserOnline(userId: string): boolean {
  const conns = connections.get(userId)
  return !!conns && conns.size > 0
}

export function sendToUser(userId: string, data: any) {
  const userConns = connections.get(userId)
  if (!userConns) return

  const payload = JSON.stringify(data)
  for (const ws of userConns) {
    try {
      ws.cork(() => { ws.send(payload) })
    } catch {
      userConns.delete(ws)
    }
  }

  if (userConns.size === 0) {
    connections.delete(userId)
    db.update(schema.users)
      .set({ online: false, lastSeen: new Date() })
      .where(eq(schema.users.id, userId))
      .run()

    for (const [chatId, users] of chatSubscriptions) {
      users.delete(userId)
      if (users.size === 0) chatSubscriptions.delete(chatId)
    }

    broadcastUserStatus(userId, false)
  }
}

/**
 * Get list of subscribed user IDs for a chat.
 * Used by routes to know who is online in a chat.
 */
export function getChatSubscribers(chatId: string): string[] {
  const users = chatSubscriptions.get(chatId)
  return users ? Array.from(users) : []
}

// ── Periodic Cleanup ─────────────────────────────────────────────────────────

setInterval(() => {
  const onlineUsers = db.select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.online, true))
    .all()

  for (const { id } of onlineUsers) {
    const conns = connections.get(id)
    if (!conns || conns.size === 0) {
      db.update(schema.users)
        .set({ online: false, lastSeen: new Date() })
        .where(eq(schema.users.id, id))
        .run()
    }
  }
}, 30_000)
