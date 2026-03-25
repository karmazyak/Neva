// Simple cron-like scheduler for background agents
// Checks every minute if any schedule should run

import { db, schema } from './db'
import { eq, and, desc, gt } from 'drizzle-orm'
import { chatCompletion, type ChatMessage } from './ai/openrouter'
import { sendToUser, broadcastToChat } from './ws'
import { sql } from 'drizzle-orm'
import { encrypt, decrypt } from './security/encryption'

let schedulerInterval: ReturnType<typeof setInterval> | null = null

export function startScheduler() {
  if (schedulerInterval) return
  console.log('Scheduler started (checking every 60s)')

  schedulerInterval = setInterval(() => {
    checkSchedules().catch(err => console.error('Scheduler error:', err))
  }, 60_000) // every minute
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

async function checkScheduledMessages() {
  const now = Math.floor(Date.now() / 1000)
  const pending = db.select().from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.status, 'pending'),
      sql`${schema.scheduledMessages.sendAt} <= ${now}`
    )).all()

  for (const sm of pending) {
    try {
      const messageId = crypto.randomUUID()
      // sm.content may be plaintext (legacy) or already encrypted — normalise
      const plaintextContent = await decrypt(sm.content)
      const encryptedContent = await encrypt(plaintextContent)

      db.insert(schema.messages).values({
        id: messageId, chatId: sm.chatId, senderId: sm.userId,
        content: encryptedContent, type: sm.type || 'text', status: 'sent',
      } as any).run()

      const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
        .from(schema.users).where(eq(schema.users.id, sm.userId)).get()

      broadcastToChat(sm.chatId, {
        type: 'new_message',
        message: {
          id: messageId, chatId: sm.chatId, senderId: sm.userId,
          senderName: sender?.displayName, senderAvatar: sender?.avatar,
          content: plaintextContent, // plaintext for WebSocket
          type: sm.type || 'text', status: 'sent', createdAt: new Date(),
        },
      })

      db.update(schema.scheduledMessages).set({ status: 'sent' }).where(eq(schema.scheduledMessages.id, sm.id)).run()
      console.log(`Scheduled message ${sm.id} sent`)
    } catch (err) {
      console.error(`Scheduled message ${sm.id} failed:`, err)
    }
  }
}

async function cleanupExpiredMessages() {
  const now = Math.floor(Date.now() / 1000)
  try {
    const expired = db.select({ id: schema.messages.id, chatId: schema.messages.chatId })
      .from(schema.messages)
      .where(sql`json_extract(${schema.messages.metadata}, '$.expiresAt') IS NOT NULL AND json_extract(${schema.messages.metadata}, '$.expiresAt') < ${now}`)
      .all()

    for (const msg of expired) {
      db.delete(schema.messages).where(eq(schema.messages.id, msg.id)).run()
      broadcastToChat(msg.chatId, { type: 'message_deleted', messageId: msg.id, chatId: msg.chatId })
    }
    if (expired.length > 0) console.log(`Cleaned up ${expired.length} expired messages`)
  } catch {}
}

async function checkSchedules() {
  const now = new Date()

  // Check scheduled messages
  await checkScheduledMessages()
  // Clean up expired (disappearing) messages
  await cleanupExpiredMessages()

  // Check agent_schedules table (legacy)
  const schedules = db.select({
    schedule: schema.agentSchedules,
    agent: schema.agents,
  })
    .from(schema.agentSchedules)
    .innerJoin(schema.agents, eq(schema.agentSchedules.agentId, schema.agents.id))
    .where(eq(schema.agentSchedules.enabled, true))
    .all()

  for (const { schedule, agent } of schedules) {
    if (shouldRun(schedule.cronExpression, now, schedule.lastRunAt)) {
      console.log(`Running scheduled task: ${agent.name} (${schedule.id})`)
      try {
        await runDigestTask(schedule, agent)
      } catch (err) {
        console.error(`Schedule ${schedule.id} failed:`, err)
      }
    }
  }

  // Check on_schedule triggers (pipelines)
  const scheduleTriggers = db.select()
    .from(schema.triggers)
    .where(and(
      eq(schema.triggers.event, 'on_schedule'),
      eq(schema.triggers.enabled, true)
    ))
    .all()

  for (const trigger of scheduleTriggers) {
    const condition = trigger.condition as any
    const cronExpr = condition?.cronExpression
    if (!cronExpr) continue

    // Use createdAt as lastRunAt proxy (triggers don't have lastRunAt, so check by minute)
    if (shouldRun(cronExpr, now, null)) {
      console.log(`Running scheduled pipeline: ${trigger.name} (${trigger.id})`)
      try {
        const { processTriggerSchedule } = await import('./ai/triggers')
        await processTriggerSchedule(trigger)
      } catch (err) {
        console.error(`Scheduled pipeline ${trigger.id} failed:`, err)
      }
    }
  }
}

function shouldRun(cronExpr: string, now: Date, lastRunAt: Date | null): boolean {
  // Simple cron check: minute hour dom month dow
  const [cronMin, cronHour] = cronExpr.split(' ')
  const currentMin = now.getMinutes()
  const currentHour = now.getHours()

  const minMatch = cronMin === '*' || parseInt(cronMin) === currentMin
  const hourMatch = cronHour === '*' || parseInt(cronHour) === currentHour

  if (!minMatch || !hourMatch) return false

  // Don't run if already ran this minute
  if (lastRunAt) {
    const lastRun = new Date(lastRunAt)
    if (lastRun.getHours() === currentHour && lastRun.getMinutes() === currentMin &&
        lastRun.getDate() === now.getDate()) {
      return false
    }
  }

  return true
}

export async function runDigestTask(
  schedule: typeof schema.agentSchedules.$inferSelect,
  agent: typeof schema.agents.$inferSelect
) {
  const config = schedule.config as { sourceChats: string[]; targetChatId?: string; maxMessages?: number; prompt?: string }
  const maxMessages = config.maxMessages || 50

  // Collect messages from source chats since last run
  const since = schedule.lastRunAt || new Date(Date.now() - 24 * 60 * 60 * 1000) // default: last 24h

  let allMessages: { content: string; senderName: string; chatName: string; createdAt: Date | null }[] = []

  for (const chatId of config.sourceChats) {
    const chat = db.select({ name: schema.chats.name }).from(schema.chats)
      .where(eq(schema.chats.id, chatId)).get()

    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      createdAt: schema.messages.createdAt,
    })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal'),
        gt(schema.messages.createdAt, since)
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(maxMessages)
      .all()
      .reverse()

    const decryptedMsgs = await Promise.all(msgs.map(async m => ({
      ...m,
      content: await decrypt(m.content),
    })))
    allMessages.push(...decryptedMsgs.map(m => ({
      ...m,
      chatName: chat?.name || 'Unknown',
    })))
  }

  if (allMessages.length === 0) {
    console.log('No new messages for digest, skipping.')
    // Update lastRunAt even if no messages
    db.update(schema.agentSchedules)
      .set({ lastRunAt: new Date() })
      .where(eq(schema.agentSchedules.id, schedule.id))
      .run()
    return
  }

  // Format messages for LLM with sender names and timestamps
  const chatText = allMessages
    .map(m => {
      const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      return `[${m.chatName}] ${time} ${m.senderName}: ${m.content}`
    })
    .join('\n')

  const digestSystemPrompt = agent.systemPrompt || `You are a news digest assistant. Create a comprehensive, well-structured summary of messages from channels.`

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${digestSystemPrompt}

IMPORTANT RULES:
- Create a detailed, structured digest from the channel messages below
- Group by channel/topic, use headers and bullet points
- Include key facts, numbers, and important details — don't just say "discussed X"
- If messages are short, still extract and present the actual content
- Write in the same language as the messages
- Make the digest useful — someone reading it should understand what happened without reading the original messages`,
    },
    { role: 'user', content: `Here are ${allMessages.length} messages from ${config.sourceChats.length} channel(s):\n\n${chatText}` },
  ]

  const response = await chatCompletion({
    model: agent.model,
    messages,
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 4096,
  })

  if (!response.trim()) return

  // Send digest to target chat or create a self-chat
  let targetChatId = config.targetChatId

  if (!targetChatId) {
    // Find or create a private chat for digest delivery
    // For now, send to user via sendToUser as a ghost message in the first source chat
    targetChatId = config.sourceChats[0]
  }

  // Save message (encrypt before writing to DB)
  const messageId = crypto.randomUUID()
  db.insert(schema.messages).values({
    id: messageId,
    chatId: targetChatId,
    senderId: schedule.userId,
    content: await encrypt(response),
    type: 'text',
    status: 'sent',
    visibility: 'normal',
    metadata: { agentName: agent.name, scheduled: true },
  }).run()

  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, schedule.userId)).get()

  // Send to user (plaintext for WebSocket)
  sendToUser(schedule.userId, {
    type: 'new_message',
    message: {
      id: messageId,
      chatId: targetChatId,
      senderId: schedule.userId,
      senderName: sender?.displayName || 'News Radar',
      senderAvatar: sender?.avatar || null,
      content: response,
      type: 'text',
      status: 'sent',
      visibility: 'normal',
      metadata: { agentName: agent.name, scheduled: true },
      createdAt: new Date(),
    },
  })

  // Update lastRunAt
  db.update(schema.agentSchedules)
    .set({ lastRunAt: new Date() })
    .where(eq(schema.agentSchedules.id, schedule.id))
    .run()

  console.log(`Digest sent: ${response.length} chars to chat ${targetChatId}`)
}
