import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { chatCompletion } from '../ai/openrouter'
import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'
import { decrypt } from '../security/encryption'

const aiTools = new Hono()
aiTools.use('*', authMiddleware)

// ============================
// Text Transformation endpoint
// Rewrite text before sending: formal, casual, shorter, translate, etc.
// ============================
const transformSchema = z.object({
  text: z.string().min(1).max(5000),
  mode: z.enum(['formal', 'casual', 'shorter', 'longer', 'friendly', 'professional', 'translate_en', 'translate_ru', 'fix_grammar']),
  context: z.string().optional(), // optional chat context for better results
})

const TRANSFORM_PROMPTS: Record<string, string> = {
  formal: 'Rewrite the following text in a more formal, professional tone. CRITICAL: Keep the SAME LANGUAGE as the input — if the input is in Russian, output must be in Russian; if in English, output in English. Keep the same meaning. Output ONLY the rewritten text, nothing else.',
  casual: 'Rewrite the following text in a casual, friendly tone. CRITICAL: Keep the SAME LANGUAGE as the input — if the input is in Russian, output must be in Russian; if in English, output in English. Keep the same meaning. Output ONLY the rewritten text, nothing else.',
  shorter: 'Make the following text significantly shorter while keeping the core meaning. CRITICAL: Keep the SAME LANGUAGE as the input — do NOT translate. Output ONLY the shortened text, nothing else.',
  longer: 'Expand the following text with more detail while keeping the same tone. CRITICAL: Keep the SAME LANGUAGE as the input — do NOT translate. Output ONLY the expanded text, nothing else.',
  friendly: 'Rewrite the following text to sound warm and friendly. CRITICAL: Keep the SAME LANGUAGE as the input — do NOT translate. Keep the same meaning. Output ONLY the rewritten text, nothing else.',
  professional: 'Rewrite the following text to sound professional and business-appropriate. CRITICAL: Keep the SAME LANGUAGE as the input — if the input is in Russian, output must be in Russian; if in English, output in English. Keep the same meaning. Output ONLY the rewritten text, nothing else.',
  translate_en: 'Translate the following text to English. Output ONLY the translation, nothing else.',
  translate_ru: 'Translate the following text to Russian. Output ONLY the translation, nothing else.',
  fix_grammar: 'Fix any grammar, spelling, or punctuation errors in the following text. CRITICAL: Keep the SAME LANGUAGE as the input — do NOT translate. Keep the tone and style. Output ONLY the corrected text, nothing else.',
}

aiTools.post('/transform', async (c) => {
  const body = await c.req.json()
  const parsed = transformSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { text, mode, context } = parsed.data
  const systemPrompt = TRANSFORM_PROMPTS[mode]

  try {
    const result = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt + (context ? `\n\nChat context for reference: ${context}` : '') },
        { role: 'user', content: text },
      ],
      temperature: 0.5,
      maxTokens: 1024,
    })

    return c.json({ result: result.trim() })
  } catch (error: any) {
    return c.json({ error: error.message || 'Transform failed' }, 500)
  }
})

// ============================
// Message Analysis endpoint
// Summarize, translate, explain a specific message
// ============================
const analyzeSchema = z.object({
  text: z.string().min(1).max(10000),
  action: z.enum(['summarize', 'translate_en', 'translate_ru', 'explain', 'reply_suggestions']),
  chatContext: z.string().optional(),
})

const ANALYZE_PROMPTS: Record<string, string> = {
  summarize: 'Summarize the following message concisely in 1-2 sentences. Respond in the same language as the input. Output ONLY the summary.',
  translate_en: 'Translate the following to English. Output ONLY the translation.',
  translate_ru: 'Translate the following to Russian. Output ONLY the translation.',
  explain: 'Explain what this message means in simple terms. If it contains technical jargon, define it. Respond in the same language. Be brief.',
  reply_suggestions: 'Based on this message and chat context, suggest 3 short reply options. Format as a JSON array of strings. Example: ["Sure, sounds good!", "Let me think about it", "Can we discuss tomorrow?"]. Reply in the same language as the message.',
}

aiTools.post('/analyze', async (c) => {
  const body = await c.req.json()
  const parsed = analyzeSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { text, action, chatContext } = parsed.data
  const systemPrompt = ANALYZE_PROMPTS[action]

  try {
    const result = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt + (chatContext ? `\n\nRecent chat context:\n${chatContext}` : '') },
        { role: 'user', content: text },
      ],
      temperature: action === 'reply_suggestions' ? 0.8 : 0.3,
      maxTokens: action === 'reply_suggestions' ? 512 : 256,
    })

    // For reply suggestions, try to parse as JSON array
    if (action === 'reply_suggestions') {
      try {
        const suggestions = JSON.parse(result)
        if (Array.isArray(suggestions)) {
          return c.json({ result: suggestions })
        }
      } catch {
        // If parsing fails, split by newlines
        const lines = result.split('\n').filter(l => l.trim()).map(l => l.replace(/^[\d\.\-\*]+\s*/, '').replace(/^["']|["']$/g, '').trim()).filter(Boolean)
        return c.json({ result: lines.slice(0, 3) })
      }
    }

    return c.json({ result: result.trim() })
  } catch (error: any) {
    return c.json({ error: error.message || 'Analysis failed' }, 500)
  }
})

// ============================
// Chat Briefing endpoint
// Get smart summary of unread messages instead of just count
// ============================
const briefingSchema = z.object({
  chatId: z.string(),
  messageCount: z.number().optional(),
})

aiTools.post('/briefing', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = briefingSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { chatId, messageCount } = parsed.data

  try {
    // Fetch recent messages from this chat
    const messages = db
      .select({
        content: schema.messages.content,
        senderName: schema.users.displayName,
        type: schema.messages.type,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(messageCount || 20)
      .all()
      .reverse()

    if (messages.length === 0) {
      return c.json({ briefing: null })
    }

    // Build conversation text for summarization (decrypt first)
    const decryptedBriefing = await Promise.all(messages.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const conversationText = decryptedBriefing
      .filter(m => m.type === 'text')
      .map(m => `${m.senderName}: ${m.content}`)
      .join('\n')

    if (!conversationText.trim()) {
      return c.json({ briefing: null })
    }

    const result = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a messaging assistant. Create an ultra-brief summary (max 2 sentences) of this chat conversation. Focus on: key decisions, questions that need answers, action items. Respond in the same language as the messages. Be concise like a notification preview.`,
        },
        { role: 'user', content: conversationText },
      ],
      temperature: 0.3,
      maxTokens: 150,
    })

    return c.json({ briefing: result.trim() })
  } catch (error: any) {
    return c.json({ error: error.message || 'Briefing failed' }, 500)
  }
})

// ============================
// Context Panel - analyze current chat context
// ============================
const contextSchema = z.object({
  chatId: z.string(),
  query: z.string().optional(), // optional user question about the chat
})

aiTools.post('/context', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = contextSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { chatId, query } = parsed.data

  try {
    // Fetch recent messages
    const messages = db
      .select({
        content: schema.messages.content,
        senderName: schema.users.displayName,
        type: schema.messages.type,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(30)
      .all()
      .reverse()

    const decryptedContext = await Promise.all(messages.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const conversationText = decryptedContext
      .filter(m => m.type === 'text')
      .map(m => `${m.senderName}: ${m.content}`)
      .join('\n')

    if (!conversationText.trim() && !query) {
      return c.json({ result: null })
    }

    const systemPrompt = query
      ? `You are an intelligent chat assistant. Answer the user's question about this chat conversation. Be concise and helpful. Respond in the same language as the question.`
      : `You are an intelligent chat assistant. Analyze this conversation and provide:
1. **Topics**: Key topics being discussed (max 3, as short tags)
2. **Decisions**: Any decisions made or pending
3. **Action items**: Tasks or follow-ups mentioned
4. **Mood**: Overall tone of the conversation (one word)

Format as JSON: {"topics":["..."],"decisions":["..."],"actions":["..."],"mood":"..."}
If a category is empty, use an empty array. Be concise.`

    const userContent = query
      ? `Chat context:\n${conversationText}\n\nQuestion: ${query}`
      : conversationText

    const result = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      maxTokens: query ? 512 : 256,
    })

    if (query) {
      return c.json({ result: result.trim(), type: 'answer' })
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(result)
      return c.json({ result: parsed, type: 'analysis' })
    } catch {
      return c.json({ result: { topics: [], decisions: [], actions: [], mood: 'neutral' }, type: 'analysis' })
    }
  } catch (error: any) {
    return c.json({ error: error.message || 'Context analysis failed' }, 500)
  }
})

// Meeting summary — summarize a chat conversation
aiTools.post('/meeting-summary', async (c) => {
  const userId = c.get('userId')
  const { chatId, messageLimit } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  const limit = messageLimit || 100
  const msgs = db.select({
    content: schema.messages.content,
    senderName: schema.users.displayName,
    createdAt: schema.messages.createdAt,
  }).from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.visibility, 'normal')))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit).all().reverse()

  if (msgs.length === 0) return c.json({ summary: null })

  const decryptedMeeting = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
  const chatText = decryptedMeeting.map(m => {
    const t = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    return `${t} ${m.senderName}: ${m.content}`
  }).join('\n')

  const response = await chatCompletion({
    model: 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a meeting summary assistant. Create a structured summary with: Key Decisions, Action Items, Topics Discussed, and Key Points. Be concise. Write in the same language as the messages.' },
      { role: 'user', content: `Summarize this conversation (${msgs.length} messages):\n\n${chatText}` },
    ],
    temperature: 0.3,
    maxTokens: 2048,
  })

  return c.json({ summary: response })
})

// Contact context — AI insight about last interaction
aiTools.post('/contact-context', async (c) => {
  const userId = c.get('userId')
  const { chatId } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  const member = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!member) return c.json({ error: 'Not a member' }, 403)

  const msgs = db.select({
    content: schema.messages.content,
    senderName: schema.users.displayName,
    createdAt: schema.messages.createdAt,
  }).from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.visibility, 'normal')))
    .orderBy(desc(schema.messages.createdAt))
    .limit(20).all().reverse()

  if (msgs.length === 0) return c.json({ context: null })

  const decryptedContact = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
  const lastMsg = decryptedContact[decryptedContact.length - 1]
  const chatText = decryptedContact.map(m => `${m.senderName}: ${m.content}`).join('\n')

  try {
    const response = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a CRM assistant. Given recent messages from a chat, provide a 1-2 sentence context summary: what was last discussed, any pending items or follow-ups. Be very concise. Write in the same language as the messages.' },
        { role: 'user', content: chatText },
      ],
      temperature: 0.3,
      maxTokens: 200,
    })
    return c.json({ context: response, lastInteraction: lastMsg?.createdAt })
  } catch {
    return c.json({ context: null, lastInteraction: lastMsg?.createdAt })
  }
})

export default aiTools
