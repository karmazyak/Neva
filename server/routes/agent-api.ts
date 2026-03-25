// Agent API — allows background agents to perform actions on behalf of their owner
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { broadcastToChat } from '../ws'
import { encrypt } from '../security/encryption'

const agentApi = new Hono()
agentApi.use('*', authMiddleware)

// Verify agent has background mode and user owns it
function verifyBackgroundAgent(userId: string, agentId: string) {
  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)))
    .get()

  if (!agent) return null

  const modes = (agent.modes as string[]) || ['command']
  if (!modes.includes('background')) return null

  return agent
}

// Send message to any chat (as the owner)
agentApi.post('/send-message', async (c) => {
  const userId = c.get('userId')
  const { agentId, chatId, content, type } = await c.req.json()

  const agent = verifyBackgroundAgent(userId, agentId)
  if (!agent) return c.json({ error: 'Agent not found or lacks background mode' }, 403)

  // Verify owner is member of chat
  const member = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    )).get()

  if (!member) return c.json({ error: 'Not a member of this chat' }, 403)

  const messageId = crypto.randomUUID()
  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  db.insert(schema.messages).values({
    id: messageId,
    chatId,
    senderId: userId,
    content: await encrypt(content),
    type: type || 'text',
    status: 'sent',
  }).run()

  broadcastToChat(chatId, {
    type: 'new_message',
    message: {
      id: messageId,
      chatId,
      senderId: userId,
      senderName: sender?.displayName || 'Unknown',
      senderAvatar: sender?.avatar || null,
      content, // plaintext for WebSocket
      type: type || 'text',
      status: 'sent',
      createdAt: new Date(),
    },
  })

  return c.json({ ok: true, messageId })
})

// Create a chat (as the owner)
agentApi.post('/create-chat', async (c) => {
  const userId = c.get('userId')
  const { agentId, type, name, memberIds } = await c.req.json()

  const agent = verifyBackgroundAgent(userId, agentId)
  if (!agent) return c.json({ error: 'Agent not found or lacks background mode' }, 403)

  const chatId = crypto.randomUUID()
  db.insert(schema.chats).values({
    id: chatId,
    type: type || 'private',
    name,
  }).run()

  db.insert(schema.chatMembers).values({
    id: crypto.randomUUID(),
    chatId,
    userId,
    role: 'admin',
  }).run()

  if (memberIds && Array.isArray(memberIds)) {
    for (const memberId of memberIds) {
      if (memberId !== userId) {
        db.insert(schema.chatMembers).values({
          id: crypto.randomUUID(),
          chatId,
          userId: memberId,
          role: 'member',
        }).run()
      }
    }
  }

  return c.json({ ok: true, chatId })
})

// Search users (as the owner)
agentApi.get('/search-users', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.query('agentId')
  const q = c.req.query('q') || ''

  if (!agentId) return c.json({ error: 'agentId required' }, 400)
  const agent = verifyBackgroundAgent(userId, agentId)
  if (!agent) return c.json({ error: 'Agent not found or lacks background mode' }, 403)

  if (q.length < 2) return c.json([])

  const users = db.select({
    id: schema.users.id,
    username: schema.users.username,
    displayName: schema.users.displayName,
    avatar: schema.users.avatar,
  })
    .from(schema.users)
    .where(sql`${schema.users.username} LIKE ${'%' + q + '%'} OR ${schema.users.displayName} LIKE ${'%' + q + '%'}`)
    .limit(20)
    .all()

  return c.json(users)
})

// List owner's chats (for agent to pick)
agentApi.get('/chats', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.query('agentId')

  if (!agentId) return c.json({ error: 'agentId required' }, 400)
  const agent = verifyBackgroundAgent(userId, agentId)
  if (!agent) return c.json({ error: 'Agent not found or lacks background mode' }, 403)

  const userChats = db.select({
    chatId: schema.chatMembers.chatId,
    chatName: schema.chats.name,
    chatType: schema.chats.type,
  })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(eq(schema.chatMembers.userId, userId))
    .all()

  return c.json(userChats)
})

// Delete a message (as the owner)
agentApi.delete('/messages/:messageId', async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('messageId')
  const agentId = c.req.query('agentId')

  if (!agentId) return c.json({ error: 'agentId required' }, 400)
  const agent = verifyBackgroundAgent(userId, agentId)
  if (!agent) return c.json({ error: 'Agent not found or lacks background mode' }, 403)

  // Only delete own messages
  const message = db.select().from(schema.messages)
    .where(and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.senderId, userId)
    )).get()

  if (!message) return c.json({ error: 'Message not found' }, 404)

  db.delete(schema.messages).where(eq(schema.messages.id, messageId)).run()

  return c.json({ ok: true })
})

export default agentApi
