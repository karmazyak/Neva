import type { Skill } from './registry'
import { chatCompletion } from '../openrouter'
import { db, schema } from '../../db'
import { eq, desc } from 'drizzle-orm'
import { decrypt } from '../../security/encryption'

export const summarizeSkill: Skill = {
  id: 'summarize',
  command: '/summarize',
  name: 'Summarize',
  description: 'Summarize recent chat messages',
  icon: '📋',
  cost: 2,
  isAutoTrigger: false,
  inputType: 'text',
  inputDescription: 'Chat history',
  outputDescription: 'Structured summary with key topics',
  configSchema: {
    needsSystemPrompt: true,
    needsModel: true,
    needsTemperature: false,
    fields: [
      {
        key: 'maxMessages',
        label: 'Messages to analyze',
        type: 'number',
        defaultValue: 50,
        min: 10,
        max: 200,
      },
    ],
  },

  async execute(ctx) {
    // Get last 50 messages from chat for summarization
    const messages = db
      .select({
        content: schema.messages.content,
        senderName: schema.users.displayName,
      })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, ctx.chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50)
      .all()
      .reverse()

    if (messages.length === 0) {
      return {
        content: '📋 No messages to summarize.',
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Summarizer' },
      }
    }

    const decryptedMessages = await Promise.all(messages.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const chatText = decryptedMessages.map(m => `${m.senderName}: ${m.content}`).join('\n')

    const response = await chatCompletion({
      model: ctx.agentModel || 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Summarize this chat conversation concisely. Highlight key topics, decisions, and action items.
Use bullet points. Keep it under 200 words. Write in the same language as the conversation.`,
        },
        { role: 'user', content: chatText },
      ],
      temperature: 0.3,
      maxTokens: 500,
    })

    return {
      content: `📋 **Summary (${messages.length} messages)**\n\n${response}`,
      type: 'text',
      visibility: 'ghost' as const,
      metadata: { agentName: 'Summarizer' },
    }
  },
}
