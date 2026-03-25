// Trigger processor — evaluates and executes automatic actions on chat events

import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'
import { sendToUser } from '../ws'
import { executeSkill } from './engine'
import { transcribeAudio, isSTTAvailable } from './stt'
import { findSkillById } from './skills/registry'
import { decrypt, encrypt } from '../security/encryption'

interface TriggerMessage {
  id: string
  chatId: string
  senderId: string
  content: string
  type: string // 'text' | 'image' | 'file'
}

export async function processTriggers(
  chatId: string,
  senderId: string,
  message: TriggerMessage
) {
  // Get all chat members except the sender
  const members = db.select({ userId: schema.chatMembers.userId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.chatId, chatId))
    .all()
    .filter(m => m.userId !== senderId)

  for (const member of members) {
    // Get enabled triggers for this member
    const triggers = db.select()
      .from(schema.triggers)
      .where(and(
        eq(schema.triggers.userId, member.userId),
        eq(schema.triggers.enabled, true)
      ))
      .all()

    for (const trigger of triggers) {
      // Check if trigger applies to this chat
      if (trigger.chatId && trigger.chatId !== chatId) continue

      // Check event match
      if (!matchesEvent(trigger, message, senderId)) continue

      // Execute action
      try {
        await executeTriggerAction(trigger, chatId, member.userId, message)
      } catch (error) {
        console.error(`Trigger ${trigger.id} execution error:`, error)
      }
    }
  }
}

function matchesEvent(
  trigger: typeof schema.triggers.$inferSelect,
  message: TriggerMessage,
  senderId: string
): boolean {
  const condition = trigger.condition as { fromUserId?: string; keyword?: string; chatId?: string } | null

  switch (trigger.event) {
    case 'on_audio':
      // File type that looks like audio
      return message.type === 'file' && (
        message.content.includes('.ogg') ||
        message.content.includes('.mp3') ||
        message.content.includes('.wav') ||
        message.content.includes('.m4a') ||
        message.content.includes('.webm') ||
        message.content.includes('audio')
      )

    case 'on_image':
      return message.type === 'image'

    case 'on_message':
      return message.type === 'text'

    case 'on_message_from':
      return condition?.fromUserId === senderId

    case 'on_keyword':
      if (!condition?.keyword) return false
      return message.content.toLowerCase().includes(condition.keyword.toLowerCase())

    default:
      return false
  }
}

// Prepare data based on pipeline method
async function prepareMethodData(
  method: string | null,
  chatId: string,
  message: TriggerMessage,
  condition: any
): Promise<string> {
  const methodId = method || 'pass_content'

  switch (methodId) {
    case 'last_n_messages': {
      const count = condition?.count || 20
      const msgs = db.select({
        content: schema.messages.content,
        senderName: schema.users.displayName,
      })
        .from(schema.messages)
        .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
        .where(and(
          eq(schema.messages.chatId, chatId),
          eq(schema.messages.visibility, 'normal')
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(count)
        .all()
        .reverse()

      const decryptedMsgs = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
      return decryptedMsgs.map(m => `${m.senderName}: ${m.content}`).join('\n')
    }

    case 'collect_from_channels': {
      const sourceChats: string[] = condition?.sourceChats || []
      if (sourceChats.length === 0) return message.content

      let allMessages: string[] = []
      for (const sChatId of sourceChats) {
        const chat = db.select({ name: schema.chats.name }).from(schema.chats)
          .where(eq(schema.chats.id, sChatId)).get()
        const msgs = db.select({ content: schema.messages.content })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.chatId, sChatId),
            eq(schema.messages.visibility, 'normal')
          ))
          .orderBy(desc(schema.messages.createdAt))
          .limit(condition?.maxMessages || 50)
          .all()
          .reverse()
        const decrypted = await Promise.all(msgs.map(async m => await decrypt(m.content)))
        allMessages.push(...decrypted.map(c => `[${chat?.name || 'Channel'}] ${c}`))
      }
      return allMessages.join('\n')
    }

    case 'last_audio': {
      const audioMsg = db.select({ content: schema.messages.content })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.chatId, chatId),
          eq(schema.messages.type, 'file')
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(1)
        .get()
      return audioMsg ? await decrypt(audioMsg.content) : message.content
    }

    case 'last_image': {
      const imgMsg = db.select({ content: schema.messages.content })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.chatId, chatId),
          eq(schema.messages.type, 'image')
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(1)
        .get()
      return imgMsg ? await decrypt(imgMsg.content) : message.content
    }

    case 'pass_content':
    default:
      return message.content
  }
}

async function executeTriggerAction(
  trigger: typeof schema.triggers.$inferSelect,
  chatId: string,
  userId: string,
  message: TriggerMessage
) {
  const action = trigger.action as { type: string; skillCommand?: string; skillId?: string; agentId?: string; params?: any }
  const outputMode = trigger.outputMode || 'ghost'
  const condition = trigger.condition as any

  // Prepare data using the pipeline method
  const preparedData = await prepareMethodData(trigger.method, chatId, message, condition)

  switch (action.type) {
    case 'stt': {
      const available = await isSTTAvailable()
      if (!available) return

      try {
        const text = await transcribeAudio(message.content)
        const messageId = crypto.randomUUID()
        const transcriptContent = `🎤 **Транскрипция:**\n\n${text}`

        db.insert(schema.messages).values({
          id: messageId,
          chatId,
          senderId: userId,
          content: await encrypt(transcriptContent),
          type: 'text',
          status: 'sent',
          visibility: outputMode === 'silent' ? 'ghost' : outputMode,
          metadata: { agentName: 'Scribe', triggerId: trigger.id },
        }).run()

        if (outputMode !== 'silent') {
          const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
            .from(schema.users).where(eq(schema.users.id, userId)).get()

          const fullMessage = {
            id: messageId,
            chatId,
            senderId: userId,
            senderName: sender?.displayName || 'Unknown',
            senderAvatar: sender?.avatar || null,
            content: transcriptContent, // plaintext for WebSocket
            type: 'text',
            status: 'sent',
            visibility: outputMode,
            metadata: { agentName: 'Scribe', triggerId: trigger.id },
            createdAt: new Date(),
          }

          if (outputMode === 'ghost') {
            sendToUser(userId, { type: 'new_message', message: fullMessage })
          } else {
            const { broadcastToChat } = await import('../ws')
            broadcastToChat(chatId, { type: 'new_message', message: fullMessage })
          }
        }
      } catch (error) {
        console.error('STT trigger error:', error)
      }
      break
    }

    case 'skill': {
      const command = action.skillCommand
        || (action.skillId ? findSkillById(action.skillId)?.command : null)
      if (!command) return
      try {
        const mode = outputMode === 'ghost' ? 'ghost' : 'normal'
        await executeSkill(chatId, userId, command, preparedData, mode as 'ghost' | 'normal')
      } catch (error) {
        console.error('Skill trigger error:', error)
      }
      break
    }

    case 'agent_reply': {
      try {
        const mode = outputMode === 'ghost' ? 'ghost' : 'normal'
        await executeSkill(chatId, userId, '/reply', preparedData, mode as 'ghost' | 'normal')
      } catch (error) {
        console.error('Agent reply trigger error:', error)
      }
      break
    }
  }
}

// Process a scheduled pipeline trigger (called from scheduler)
export async function processTriggerSchedule(
  trigger: typeof schema.triggers.$inferSelect
) {
  const condition = trigger.condition as any
  const action = trigger.action as any
  const sourceChats: string[] = condition?.sourceChats || []

  // Prepare data using the method
  const dummyMessage: TriggerMessage = {
    id: '', chatId: '', senderId: trigger.userId, content: '', type: 'text',
  }

  const preparedData = await prepareMethodData(trigger.method, '', dummyMessage, condition)
  if (!preparedData.trim()) {
    console.log(`Scheduled pipeline ${trigger.id}: no data to process, skipping.`)
    return
  }

  // Determine target chat (first source chat or any user chat)
  const targetChatId = sourceChats[0] || ''
  if (!targetChatId) {
    console.log(`Scheduled pipeline ${trigger.id}: no target chat.`)
    return
  }

  const command = action.skillCommand
    || (action.skillId ? findSkillById(action.skillId)?.command : null)
  if (!command) return

  try {
    await executeSkill(targetChatId, trigger.userId, command, preparedData)
  } catch (error) {
    console.error(`Scheduled pipeline skill error:`, error)
  }
}
