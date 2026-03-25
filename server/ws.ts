import type { ServerWebSocket } from 'bun'
import { verifyToken } from './middleware/auth'
import { db, schema } from './db'
import { eq } from 'drizzle-orm'

interface WSData {
  userId: string
  username: string
  authenticated: boolean
}

// Map of userId -> Set of websockets
const connections = new Map<string, Set<ServerWebSocket<WSData>>>()
// Map of chatId -> Set of userIds
const chatSubscriptions = new Map<string, Set<string>>()

// WebSocket message rate limiting per connection
const wsMessageRates = new WeakMap<ServerWebSocket<WSData>, { count: number; resetAt: number }>()

const WS_RATE_LIMIT = 30 // messages per second
const WS_RATE_WINDOW = 1000 // 1 second

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

// Accept all upgrades, but require auth via first message
export function handleWSUpgrade(req: Request): WSData | null {
  // Try token from URL for backward compat, but prefer message-based auth
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (token) {
    try {
      const payload = verifyToken(token)
      return { userId: payload.userId, username: payload.username, authenticated: true }
    } catch {
      // Invalid token in URL — still upgrade, require auth message
    }
  }

  // Allow upgrade without auth — client must send auth message first
  return { userId: '', username: '', authenticated: false }
}

export function handleWSOpen(ws: ServerWebSocket<WSData>) {
  if (ws.data.authenticated) {
    // Already authenticated via URL token (backward compat)
    setupAuthenticatedConnection(ws)
  }
  // Otherwise wait for auth message
}

function setupAuthenticatedConnection(ws: ServerWebSocket<WSData>) {
  const { userId } = ws.data

  if (!connections.has(userId)) {
    connections.set(userId, new Set())
  }
  connections.get(userId)!.add(ws)

  // Mark user online
  db.update(schema.users)
    .set({ online: true, lastSeen: new Date() })
    .where(eq(schema.users.id, userId))
    .run()

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

  // Notify contacts that user is online
  broadcastUserStatus(userId, true)

  // Send auth confirmation
  ws.send(JSON.stringify({ type: 'auth_ok', userId }))
}

export function handleWSMessage(ws: ServerWebSocket<WSData>, message: string) {
  // Rate limit check
  if (!checkWSRateLimit(ws)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
    return
  }

  try {
    const data = JSON.parse(message)

    // Handle authentication message (for message-based auth)
    if (data.type === 'auth') {
      if (ws.data.authenticated) return // Already authenticated

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
        setupAuthenticatedConnection(ws)
      } catch {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }))
        ws.close(4001, 'Invalid token')
      }
      return
    }

    // All other messages require authentication
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

      case 'subscribe':
        if (data.chatId && typeof data.chatId === 'string') {
          // Verify user is a member of this chat before subscribing
          const member = db.select()
            .from(schema.chatMembers)
            .where(eq(schema.chatMembers.chatId, data.chatId))
            .all()
            .find(m => m.userId === ws.data.userId)

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

export function handleWSClose(ws: ServerWebSocket<WSData>) {
  if (!ws.data.authenticated) return

  const { userId } = ws.data

  const userConns = connections.get(userId)
  if (userConns) {
    userConns.delete(ws)
    if (userConns.size === 0) {
      connections.delete(userId)

      // Mark user offline
      db.update(schema.users)
        .set({ online: false, lastSeen: new Date() })
        .where(eq(schema.users.id, userId))
        .run()

      // Remove from chat subscriptions
      for (const [chatId, users] of chatSubscriptions) {
        users.delete(userId)
        if (users.size === 0) chatSubscriptions.delete(chatId)
      }

      broadcastUserStatus(userId, false)
    }
  }
}

export function broadcastToChat(chatId: string, data: any, excludeUserId?: string) {
  const users = chatSubscriptions.get(chatId)
  if (!users) return

  const message = JSON.stringify(data)

  for (const userId of users) {
    if (userId === excludeUserId) continue
    const userConns = connections.get(userId)
    if (userConns) {
      for (const ws of userConns) {
        try {
          ws.send(message)
        } catch {
          // Connection might be dead
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

  for (const { chatId } of userChats) {
    broadcastToChat(chatId, {
      type: 'user_status',
      userId,
      online,
    }, userId)
  }
}

export function isUserOnline(userId: string): boolean {
  const conns = connections.get(userId)
  return !!conns && conns.size > 0
}

export function sendToUser(userId: string, data: any) {
  const userConns = connections.get(userId)
  if (!userConns) return

  const message = JSON.stringify(data)
  for (const ws of userConns) {
    try {
      ws.send(message)
    } catch {
      // Connection dead
    }
  }
}
