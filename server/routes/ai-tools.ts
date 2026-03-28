import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { chatCompletion } from '../ai/openrouter'
import { db, schema } from '../db'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { decrypt } from '../security/encryption'
import { extractPersonaProfile, simulateWithPersona, getCachedPersona, personaToPrompt, updatePersonaMood, type PersonaProfile } from '../ai/persona-profiler'
import { getModelConfig } from '../ai/model-router'
import { PROMPTS } from '../ai/prompts'
import { getContactIntel, getOrCreateContactIntel, updatePersona as ciUpdatePersona, recordMood as ciRecordMood, getLatestMood, getMoodTrend } from '../ai/contact-intelligence'
import { getMemoryPromptBlock, extractAndPersistFacts, getActiveMemories } from '../ai/memory-manager'
import { getGraphPromptBlock, getRelevantGraphContext, extractAndMergeGraph } from '../ai/knowledge-graph'
import { getBaseline, calculateBaseline, updateBaseline } from '../ai/contact-intelligence'

const aiTools = new Hono()
aiTools.use('*', authMiddleware)

// ============================
// Relationship type detection & caching
// ============================
type RelationshipType = 'family' | 'friend' | 'work' | 'client' | 'acquaintance' | 'other'

async function getRelationshipType(userId: string, chatId: string): Promise<RelationshipType | null> {
  // Check if already cached in DB
  const member = db.select({ relationshipType: schema.chatMembers.relationshipType })
    .from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId)))
    .get()

  if (member?.relationshipType) return member.relationshipType as RelationshipType

  return null // not yet detected
}

async function detectAndCacheRelationship(userId: string, chatId: string, chatText: string): Promise<RelationshipType> {
  // Already cached?
  const cached = await getRelationshipType(userId, chatId)
  if (cached) return cached

  // Auto-detect from conversation
  try {
    const classConfig = getModelConfig('classification')
    const result = await chatCompletion({
      model: classConfig.model,
      messages: [
        {
          role: 'system',
          content: `Classify the relationship between the conversation participants. Return ONLY one word from: family, friend, work, client, acquaintance, other.

Rules:
- family: relatives, parents, siblings, spouse, children
- friend: close personal friends, old friends
- work: colleagues, team members, boss, subordinates
- client: business clients, customers, partners
- acquaintance: casual contacts, neighbors, not close
- other: bots, services, unclear`
        },
        { role: 'user', content: chatText.slice(0, 1500) },
      ],
      temperature: classConfig.temperature,
      maxTokens: classConfig.maxTokens,
    })

    const type = result.trim().toLowerCase() as RelationshipType
    const valid: RelationshipType[] = ['family', 'friend', 'work', 'client', 'acquaintance', 'other']
    const finalType = valid.includes(type) ? type : 'other'

    // Cache in DB
    db.update(schema.chatMembers)
      .set({ relationshipType: finalType })
      .where(and(eq(schema.chatMembers.chatId, chatId), eq(schema.chatMembers.userId, userId)))
      .run()

    return finalType
  } catch {
    return 'other'
  }
}

// Helper: get relationship context string for prompts
function relationshipContext(type: RelationshipType | null): string {
  if (!type) return ''
  const descriptions: Record<RelationshipType, string> = {
    family: 'This is a FAMILY chat (relatives). Tone should be warm and personal. Unanswered messages from family are high priority.',
    friend: 'This is a FRIENDS chat. Tone is casual and informal. Rough humor is normal and not a warning sign.',
    work: 'This is a WORK chat (colleagues). Tone should be professional but friendly. Deadlines and tasks are high priority.',
    client: 'This is a CLIENT/BUSINESS chat. Tone must be professional and polite. Response time and follow-ups are critical.',
    acquaintance: 'This is a casual ACQUAINTANCE chat. Tone is polite but neutral.',
    other: '',
  }
  return descriptions[type] ? `\n\nRELATIONSHIP CONTEXT: ${descriptions[type]}` : ''
}

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
    const genConfig = getModelConfig('generation')
    const result = await chatCompletion({
      model: genConfig.model,
      messages: [
        { role: 'system', content: systemPrompt + (context ? `\n\nChat context for reference: ${context}` : '') },
        { role: 'user', content: text },
      ],
      temperature: 0.5,
      maxTokens: genConfig.maxTokens,
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
  chatId: z.string().optional(),
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

  const { text, action, chatContext, chatId: analyzeChatId } = parsed.data
  const userId = c.get('userId')
  let systemPrompt = ANALYZE_PROMPTS[action]

  // For reply suggestions — check relationship type for empathetic mode
  if (action === 'reply_suggestions' && analyzeChatId && userId) {
    const relType = await getRelationshipType(userId, analyzeChatId)
    if (relType === 'family' || relType === 'friend') {
      // Get optional persona context (free if cached)
      const persona = getCachedPersona(analyzeChatId, userId)
      const moodHint = persona?.currentState?.recentMood ? `\nTheir recent mood: ${persona.currentState.recentMood}.` : ''
      const sharedHint = persona?.dynamics?.sharedContext?.length ? `\nShared context: ${persona.dynamics.sharedContext.join(', ')}.` : ''

      systemPrompt = `You are helping someone reply to a close ${relType}. Generate 3 reply options.

Rules:
- Warm, personal, genuine — NOT corporate
- Reference specific details from conversation
- Match their energy — excited → excited, sad → supportive
- Vary depth: one supportive, one light/funny, one thoughtful
- Same language as conversation
- Format as JSON array of strings${moodHint}${sharedHint}`
    }
  }

  try {
    const analysisConfig = getModelConfig('analysis')
    const result = await chatCompletion({
      model: analysisConfig.model,
      messages: [
        { role: 'system', content: systemPrompt + (chatContext ? `\n\nRecent chat context:\n${chatContext}` : '') },
        { role: 'user', content: text },
      ],
      temperature: action === 'reply_suggestions' ? 0.8 : analysisConfig.temperature,
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

    const briefConfig = getModelConfig('analysis')
    const result = await chatCompletion({
      model: briefConfig.model,
      messages: [
        {
          role: 'system',
          content: `You are a messaging assistant. Create an ultra-brief summary (max 2 sentences) of this chat conversation. Focus on: key decisions, questions that need answers, action items. Respond in the same language as the messages. Be concise like a notification preview.`,
        },
        { role: 'user', content: conversationText },
      ],
      temperature: briefConfig.temperature,
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
  forceRefresh: z.boolean().optional(),
})

// In-memory cache for context analysis: chatId -> { analysis, messageCount, timestamp }
const CONTEXT_CACHE_THRESHOLD = 5 // re-generate after 5+ new messages
const contextCache = new Map<string, { analysis: any; messageCount: number; timestamp: number }>()

aiTools.post('/context', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = contextSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { chatId, query, forceRefresh } = parsed.data

  try {
    // Count current messages to check cache validity
    const msgCountResult = db
      .select({ count: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.chatId, chatId))
      .all()
    const currentMsgCount = msgCountResult.length

    // Check cache for analysis requests (not Q&A queries)
    if (!query && !forceRefresh) {
      const cached = contextCache.get(chatId)
      if (cached) {
        const cacheAge = Date.now() - cached.timestamp
        // Return cached if less than 5 min old OR fewer than 5 new messages
        if (cacheAge < 5 * 60 * 1000 || (currentMsgCount - cached.messageCount) < CONTEXT_CACHE_THRESHOLD) {
          return c.json({ result: cached.analysis, type: 'analysis', cached: true })
        }
      }
    }

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

    // Detect relationship type for better context
    const relType = await detectAndCacheRelationship(userId, chatId, conversationText)
    const relCtx = relationshipContext(relType)

    // Check for active goal for this chat
    const goalKey = `${userId}:${chatId}`
    const activeGoal = activeGoals.get(goalKey)
    const goalCtx = activeGoal
      ? `\nThe user has an ACTIVE GOAL: "${activeGoal.goal}" with strategy: "${activeGoal.strategy}". Evaluate next action and risk in context of this goal.`
      : ''

    // Try to get persona insights for better risk assessment
    const persona = getCachedPersona(chatId, userId)
    const personaCtx = persona
      ? `\nPerson's sensitive topics: ${persona.dynamics.sensitiveTopics.join(', ') || 'none'}. Pending expectations: ${persona.currentState.pendingExpectations.join(', ') || 'none'}.`
      : ''

    const systemPrompt = query
      ? `You are an intelligent chat assistant. Answer the user's question about this chat conversation. Be concise and helpful. Respond in the same language as the question.${relCtx}`
      : `You are an intelligent chat assistant. Analyze this conversation and provide:
1. **Topics**: Key topics being discussed (max 3, as short tags)
2. **Decisions**: Any decisions made or pending
3. **Action items**: Tasks or follow-ups mentioned
4. **Mood**: Overall tone of the conversation (one word)
5. **Next action**: What should the user do next? One specific step. Include a short draft message if possible.
6. **Risk**: Communication risk? (person avoiding topic, tone escalation, missed commitments, growing silence). null if none.
7. **Celebration**: Any positive moment worth acknowledging? null if none.
${goalCtx}${personaCtx}

Format as JSON: {"topics":["..."],"decisions":["..."],"actions":["..."],"mood":"...","nextAction":{"text":"...","draftMessage":"...","priority":"high|medium|low"}|null,"risk":"string"|null,"celebration":"string"|null}
If a category is empty, use an empty array. Be concise.`

    const userContent = query
      ? `Chat context:\n${conversationText}\n\nQuestion: ${query}`
      : conversationText

    const ctxConfig = getModelConfig('analysis')
    const result = await chatCompletion({
      model: ctxConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: ctxConfig.temperature,
      maxTokens: query ? 512 : ctxConfig.maxTokens,
    })

    if (query) {
      return c.json({ result: result.trim(), type: 'answer' })
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(result)
      // Cache the analysis
      contextCache.set(chatId, { analysis: parsed, messageCount: currentMsgCount, timestamp: Date.now() })
      return c.json({ result: parsed, type: 'analysis', cached: false })
    } catch {
      const fallback = { topics: [], decisions: [], actions: [], mood: 'neutral' }
      contextCache.set(chatId, { analysis: fallback, messageCount: currentMsgCount, timestamp: Date.now() })
      return c.json({ result: fallback, type: 'analysis', cached: false })
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

  const meetConfig = getModelConfig('analysis')
  const response = await chatCompletion({
    model: meetConfig.model,
    messages: [
      { role: 'system', content: 'You are a meeting summary assistant. Create a structured summary with: Key Decisions, Action Items, Topics Discussed, and Key Points. Be concise. Write in the same language as the messages.' },
      { role: 'user', content: `Summarize this conversation (${msgs.length} messages):\n\n${chatText}` },
    ],
    temperature: meetConfig.temperature,
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
    const contactConfig = getModelConfig('analysis')
    const response = await chatCompletion({
      model: contactConfig.model,
      messages: [
        { role: 'system', content: 'You are a CRM assistant. Given recent messages from a chat, provide a 1-2 sentence context summary: what was last discussed, any pending items or follow-ups. Be very concise. Write in the same language as the messages.' },
        { role: 'user', content: chatText },
      ],
      temperature: contactConfig.temperature,
      maxTokens: 200,
    })
    return c.json({ context: response, lastInteraction: lastMsg?.createdAt })
  } catch {
    return c.json({ context: null, lastInteraction: lastMsg?.createdAt })
  }
})

// ============================
// Proactive Nudges — morning briefing across all chats
// ============================
/**
 * Phase 6: Unified nudges endpoint — reads from proactiveActions DB.
 * The proactive-engine is now the sole generator of nudges.
 * Optional ?forceRefresh=true triggers an immediate scan for this user.
 */
aiTools.post('/nudges', async (c) => {
  const userId = c.get('userId')

  try {
    const { forceRefresh } = await c.req.json().catch(() => ({ forceRefresh: false }))

    // Optional: trigger immediate scan for this user
    if (forceRefresh) {
      try {
        const { runProactiveScanForUser } = await import('../ai/proactive-engine')
        await runProactiveScanForUser(userId)
      } catch {}
    }

    // Read pending proactive actions from DB
    const actions = db.select()
      .from(schema.proactiveActions)
      .where(and(
        eq(schema.proactiveActions.userId, userId),
        eq(schema.proactiveActions.status, 'pending'),
      ))
      .orderBy(desc(schema.proactiveActions.createdAt))
      .limit(10)
      .all()

    // Resolve chat names
    const nudges = await Promise.all(actions.map(async (a) => {
      let chatName = 'Chat'
      if (a.chatId) {
        const chat = db.select({ name: schema.chats.name })
          .from(schema.chats)
          .where(eq(schema.chats.id, a.chatId))
          .get()
        chatName = chat?.name || 'Chat'
      }

      // Map trigger to priority
      const priorityMap: Record<string, string> = {
        mood: 'high',
        burst: 'high',
        unanswered: 'medium',
        goal_stall: 'medium',
        silence: 'low',
      }

      return {
        id: a.id,
        chatId: a.chatId,
        chatName,
        type: a.trigger,
        text: a.body || a.title,
        title: a.title,
        priority: (a as any).priority || priorityMap[a.trigger] || 'medium',
        draftMessage: a.draftMessage,
      }
    }))

    const summary = nudges.length > 0
      ? `${nudges.length} дел требуют внимания.`
      : null

    return c.json({ nudges, summary })
  } catch (error: any) {
    return c.json({ error: error.message || 'Nudges failed' }, 500)
  }
})

// ============================
// Person Context — relationship intelligence for a specific contact
// ============================
aiTools.post('/person-context', async (c) => {
  const userId = c.get('userId')
  const { chatId } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  try {
    // Get chat info
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    // Get the other person's info (for private chats)
    const members = db.select({
      userId: schema.chatMembers.userId,
      displayName: schema.users.displayName,
      username: schema.users.username,
    }).from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(eq(schema.chatMembers.chatId, chatId))
      .all()

    const otherPerson = members.find(m => m.userId !== userId) || members[0]

    // Get message history (larger window for relationship analysis)
    // Filter out ghost (AI-only) messages — only analyze real human messages
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
      createdAt: schema.messages.createdAt,
      type: schema.messages.type,
      visibility: schema.messages.visibility,
      metadata: schema.messages.metadata,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.visibility, 'normal')))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50)
      .all()
      .reverse()

    if (msgs.length === 0) return c.json({ person: null })

    const decrypted = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const textMsgs = decrypted.filter(m => m.type === 'text' && m.content)

    // Separate human messages from AI-assisted ones (metadata.agentName present)
    const humanMsgs = textMsgs.filter(m => {
      const meta = m.metadata as Record<string, any> | null
      return !meta?.agentName
    })
    const aiAssistedMsgs = textMsgs.filter(m => {
      const meta = m.metadata as Record<string, any> | null
      return !!meta?.agentName
    })

    // Build chat text, marking AI-assisted messages
    const chatText = textMsgs.map(m => {
      const meta = m.metadata as Record<string, any> | null
      const aiTag = meta?.agentName ? ' [AI-assisted]' : ''
      return `[${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}] ${m.senderName}${aiTag}: ${m.content}`
    }).join('\n')

    // Detect relationship type
    const relType = await detectAndCacheRelationship(userId, chatId, chatText)

    // Get persona hints if cached (for deduplication)
    const persona = getCachedPersona(chatId, userId)
    const personaHint = persona
      ? `\nAlready known context (don't duplicate): ${persona.dynamics.sharedContext.join(', ')}. Pending expectations: ${persona.currentState.pendingExpectations.join(', ')}.`
      : ''

    const isPersonal = relType === 'family' || relType === 'friend' || relType === 'acquaintance'
    const personalMemoryPrompt = isPersonal
      ? `
7. **Personal memory**: Extract specific personal details mentioned in conversation — upcoming events, life situations, people/pets names, plans, health issues. Things a caring friend would remember. Max 5 items, most recent first. Each with time reference and category (plans/life/dates/health/work).`
      : ''
    const personalMemoryJson = isPersonal
      ? `,"personalMemory":[{"text":"example","when":"mentioned X days ago","category":"plans|life|dates|health|work"}]`
      : `,"personalMemory":[]`

    const personConfig = getModelConfig('persona_extraction')
    const result = await chatCompletion({
      model: personConfig.model,
      messages: [
        {
          role: 'system',
          content: `You are a relationship intelligence assistant. Analyze messages and provide a person profile.
${relationshipContext(relType)}
IMPORTANT: Some messages are marked with [AI-assisted] — these were written or rewritten by AI, not by the person directly. When analyzing communication style, tone, and mood:
- Focus primarily on messages WITHOUT the [AI-assisted] tag — those reflect the person's real voice
- Note if someone uses AI assistance frequently (this is a style signal too)
- Don't let AI-assisted message tone influence your assessment of the person's natural communication style
${personaHint}

Return JSON: {
  "relationshipType": "${relType}",
  "communicationStyle": "1 sentence about their REAL communication tone (excluding AI-assisted)",
  "avgResponseTime": "estimate like '~2h' or 'minutes' or 'same day'",
  "activeHours": "e.g. '10-18' or 'evening'",
  "sharedTopics": ["topic1", "topic2", "topic3"],
  "unresolvedItems": ["unresolved question or task"],
  "moodTrend": "improving|stable|declining|neutral",
  "moodNote": "1 sentence about recent mood",
  "totalMessages": ${humanMsgs.length},
  "aiAssistedMessages": ${aiAssistedMsgs.length},
  "usesAiFrequently": ${aiAssistedMsgs.length > humanMsgs.length * 0.3}${personalMemoryJson}
}${personalMemoryPrompt}

Be concise and factual. Respond in the same language as the messages.`
        },
        { role: 'user', content: chatText },
      ],
      temperature: personConfig.temperature,
      maxTokens: isPersonal ? 768 : 512,
    })

    try {
      const parsed = JSON.parse(result)

      // Phase 2: Persist extracted personalMemory facts to contactMemory DB
      if (parsed.personalMemory && Array.isArray(parsed.personalMemory) && otherPerson) {
        try {
          const contactId = otherPerson.userId
          const memoryFacts = parsed.personalMemory
            .filter((m: any) => m.text)
            .map((m: any) => ({
              fact: m.text,
              category: (['plans', 'life', 'dates', 'health', 'work'].includes(m.category)
                ? (m.category === 'plans' ? 'plan' : m.category === 'life' ? 'life_event' : m.category === 'dates' ? 'date' : m.category)
                : 'life_event') as any,
              confidence: 0.85,
            }))

          if (memoryFacts.length > 0 && contactId) {
            extractAndPersistFacts(userId, contactId, chatId, otherPerson.displayName || 'Contact', [])
              .catch(() => {}) // non-blocking
            // Also directly persist the LLM-extracted facts
            const { persistFacts } = await import('../ai/memory-manager')
            persistFacts(userId, contactId, chatId, memoryFacts)
          }
        } catch {}
      }

      // Merge persisted memories with freshly extracted ones
      const persistedMemories = getActiveMemories(userId, chatId)

      return c.json({
        person: {
          name: otherPerson?.displayName || chat.name,
          username: otherPerson?.username,
          relationshipType: relType,
          ...parsed,
          // Augment with persisted memories not in the fresh extraction
          persistedMemories: persistedMemories.map(m => ({ text: m.fact, category: m.category })),
        }
      })
    } catch {
      return c.json({ person: null })
    }
  } catch (error: any) {
    return c.json({ error: error.message || 'Person context failed' }, 500)
  }
})

// ============================
// Tone Advisor — check if message tone fits the chat context
// ============================
aiTools.post('/tone-check', async (c) => {
  const userId = c.get('userId')
  const { chatId, text } = await c.req.json()
  if (!chatId || !text) return c.json({ error: 'chatId and text required' }, 400)

  try {
    // Get recent messages for tone context
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(15)
      .all()
      .reverse()

    const decrypted = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const context = decrypted.filter(m => m.content && !m.content.startsWith('/uploads/')).map(m => `${m.senderName}: ${m.content}`).join('\n')

    // Get relationship context for tone calibration
    const relType = await getRelationshipType(userId, chatId)
    const relCtx = relationshipContext(relType)

    // Check for active goal (goal-aware tone checking)
    const goalKey = `${userId}:${chatId}`
    const goal = activeGoals.get(goalKey)
    const goalCtx = goal
      ? `\nACTIVE GOAL: The user is trying to "${goal.goal}" using strategy: "${goal.strategy}". Check if the draft message SUPPORTS or CONTRADICTS this goal. If it contradicts (gives up, changes topic, weakens position, accepts bad terms), warn.`
      : ''

    // Check persona for sensitive topics
    const persona = getCachedPersona(chatId, userId)
    const sensitiveCtx = persona?.dynamics.sensitiveTopics?.length
      ? `\nSENSITIVE TOPICS for this person: ${persona.dynamics.sensitiveTopics.join(', ')}. Be extra careful if the draft touches these.`
      : ''

    // Phase 2: Inject persistent memory context
    const memoryCtx = getMemoryPromptBlock(userId, chatId)

    // Phase 4: Inject current mood from contact-intelligence
    const currentMood = getLatestMood(userId, chatId)
    const moodCtx = currentMood
      ? `\nCONTACT'S CURRENT MOOD: ${currentMood.mood}${currentMood.note ? ` (${currentMood.note})` : ''}. Adapt tone suggestions accordingly.`
      : ''

    const toneConfig = getModelConfig('evaluation')
    const result = await chatCompletion({
      model: toneConfig.model,
      messages: [
        {
          role: 'system',
          content: `You are a tone advisor for a messaging app. Given recent chat context and a draft message, determine if the draft tone might cause issues.
${relCtx}${goalCtx}${sensitiveCtx}${memoryCtx}${moodCtx}
Return JSON: { "needsWarning": boolean, "warning": "short warning text if needed", "suggestion": "softened version if needed", "goalConflict": boolean }

Rules:
- Only warn if tone is significantly harsh, aggressive, passive-aggressive, or could damage the relationship
- CALIBRATE based on relationship type: rough humor with friends is OK, but even mild directness with clients may need softening
- Don't warn for normal direct/brief messages
- Don't warn if the chat tone is already casual/rough
- Keep warning under 15 words
- goalConflict: true ONLY if there's an active goal and the draft contradicts it
- Respond in the same language as the messages`
        },
        { role: 'user', content: `Chat context:\n${context}\n\nDraft message: ${text}` },
      ],
      temperature: toneConfig.temperature,
      maxTokens: 200,
    })

    try {
      const parsed = JSON.parse(result)
      return c.json(parsed)
    } catch {
      return c.json({ needsWarning: false })
    }
  } catch (error: any) {
    return c.json({ needsWarning: false })
  }
})

// ============================
// Conversation Simulation — "what if" mode (v2: two-stage persona + branching + confidence)
// ============================
aiTools.post('/simulate', async (c) => {
  const userId = c.get('userId')
  const { chatId, userMessage, history, branching } = await c.req.json()
  if (!chatId || !userMessage) return c.json({ error: 'chatId and userMessage required' }, 400)

  try {
    // Get chat context and other person's style
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50)
      .all()
      .reverse()

    const decrypted = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))

    // Find the other person's name and their messages
    const otherPerson = decrypted.find(m => m.senderId !== userId)?.senderName || 'Contact'
    const chatContext = decrypted
      .filter(m => m.content && !m.content.startsWith('/uploads/'))
      .map(m => `${m.senderName}: ${m.content}`).join('\n')

    // Collect only the contact's messages for persona extraction
    const contactMessages = decrypted
      .filter(m => m.senderId !== userId && m.content && !m.content.startsWith('/uploads/'))
      .map(m => m.content)

    // Build simulation history
    const simHistory = history
      ? history.map((h: any) => `${h.role === 'user' ? 'You' : otherPerson}: ${h.content}`).join('\n')
      : ''

    // Get relationship context
    const relType = await getRelationshipType(userId, chatId)

    // Stage 1: Extract or retrieve cached persona profile
    let persona: PersonaProfile | null = getCachedPersona(chatId, userId)

    if (!persona && contactMessages.length >= 2) {
      persona = await extractPersonaProfile(
        otherPerson,
        contactMessages,
        chatContext,
        relType,
      )
      // Persist to contact-intelligence DB
      if (persona) {
        try {
          const contactId = decrypted.find(m => m.senderId !== userId)?.senderId
          if (contactId) {
            getOrCreateContactIntel(userId, contactId, chatId)
            ciUpdatePersona(userId, chatId, persona)
          }
        } catch {}
      }
    }

    // Stage 2: Simulate with persona (or fallback to enhanced legacy)
    if (persona) {
      const result = await simulateWithPersona(
        persona,
        chatContext,
        simHistory,
        userMessage,
        { branching: branching ?? false },
      )

      return c.json({
        response: result.response,
        personName: otherPerson,
        confidence: result.confidence,
        branches: result.branches,
        innerMonologue: result.innerMonologue,
        hasPersona: true,
      })
    }

    // Fallback: legacy simulation for chats with few messages
    const config = getModelConfig('simulation')
    const result = await chatCompletion({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `You are simulating how "${otherPerson}" would respond in a chat conversation.
Based on their writing style, tone, and typical responses from the chat history, generate a realistic reply.
${relationshipContext(relType)}

You MUST respond with JSON: { "mainResponse": "the response", "confidence": 0-100, "innerMonologue": "what they'd think" }

Rules:
- Match their writing style exactly (length, emoji usage, formality, language)
- Stay in character — respond as they would, not as an AI
- Keep it realistic and natural
- Account for the relationship type`
        },
        {
          role: 'user',
          content: `Real chat history:\n${chatContext}\n\n${simHistory ? `Simulation so far:\n${simHistory}\n\n` : ''}New message from user: ${userMessage}\n\nHow would ${otherPerson} reply?`
        },
      ],
      temperature: config.temperature,
      maxTokens: 500,
    })

    try {
      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned)
      return c.json({
        response: parsed.mainResponse || result.trim(),
        personName: otherPerson,
        confidence: parsed.confidence ?? 60,
        innerMonologue: parsed.innerMonologue,
        hasPersona: false,
      })
    } catch {
      return c.json({
        response: result.trim(),
        personName: otherPerson,
        confidence: 50,
        hasPersona: false,
      })
    }
  } catch (error: any) {
    return c.json({ error: error.message || 'Simulation failed' }, 500)
  }
})

// ============================
// Persona Profile endpoint — extract or retrieve cached persona
// ============================
aiTools.post('/persona', async (c) => {
  const userId = c.get('userId')
  const { chatId } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  try {
    // Check cache first
    const cached = getCachedPersona(chatId, userId)
    if (cached) return c.json({ persona: cached, cached: true })

    // Extract fresh persona
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50)
      .all()
      .reverse()

    const decrypted = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const otherPerson = decrypted.find(m => m.senderId !== userId)?.senderName || 'Contact'
    const contactMessages = decrypted
      .filter(m => m.senderId !== userId && m.content && !m.content.startsWith('/uploads/'))
      .map(m => m.content)
    const chatContext = decrypted
      .filter(m => m.content && !m.content.startsWith('/uploads/'))
      .map(m => `${m.senderName}: ${m.content}`).join('\n')

    if (contactMessages.length < 2) {
      return c.json({ error: 'Not enough messages for persona extraction (need 2+)', minMessages: 2 }, 400)
    }

    const relType = await getRelationshipType(userId, chatId)
    const persona = await extractPersonaProfile(otherPerson, contactMessages, chatContext, relType)

    // Persist to contact-intelligence DB
    try {
      const contactId = decrypted.find(m => m.senderId !== userId)?.senderId
      if (contactId) {
        getOrCreateContactIntel(userId, contactId, chatId)
        ciUpdatePersona(userId, chatId, persona)
      }
    } catch {}

    return c.json({ persona, cached: false })
  } catch (error: any) {
    return c.json({ error: error.message || 'Persona extraction failed' }, 500)
  }
})

// ============================
// Active Goals — persistent in DB (replaces in-memory Map)
// ============================

/**
 * Get active goal for a user+chat pair from the database.
 * Returns null if no active goal exists.
 */
export function getActiveGoal(userId: string, chatId: string): { goal: string; strategy: string; chatId: string } | null {
  const row = db.select()
    .from(schema.userGoals)
    .where(and(
      eq(schema.userGoals.userId, userId),
      eq(schema.userGoals.chatId, chatId),
      inArray(schema.userGoals.status, ['active', 'in_progress']),
    ))
    .orderBy(desc(schema.userGoals.updatedAt))
    .limit(1)
    .get()

  if (!row) return null
  return { goal: row.goal, strategy: row.strategy || '', chatId: row.chatId || chatId }
}

/**
 * Get ALL active goals for a user (for briefing/context).
 */
export function getAllActiveGoals(userId: string): Array<{ id: string; goal: string; strategy: string; chatId: string | null; progress: number; mode: string }> {
  return db.select()
    .from(schema.userGoals)
    .where(and(
      eq(schema.userGoals.userId, userId),
      inArray(schema.userGoals.status, ['active', 'in_progress']),
    ))
    .orderBy(desc(schema.userGoals.updatedAt))
    .all()
    .map(r => ({
      id: r.id,
      goal: r.goal,
      strategy: r.strategy || '',
      chatId: r.chatId,
      progress: r.progress || 0,
      mode: r.mode,
    }))
}

/**
 * Update goal progress from AI agent.
 */
export function updateGoalProgress(goalId: string, userId: string, progress: number, note?: string) {
  const existing = db.select().from(schema.userGoals)
    .where(and(eq(schema.userGoals.id, goalId), eq(schema.userGoals.userId, userId)))
    .get()
  if (!existing) return

  const updates: Record<string, any> = {
    progress: Math.min(100, Math.max(0, progress)),
    updatedAt: sql`(unixepoch())`,
  }
  if (progress >= 100) {
    updates.status = 'completed'
    updates.completedAt = sql`(unixepoch())`
  } else if (progress > 0 && existing.status === 'active') {
    updates.status = 'in_progress'
  }

  if (note) {
    const notes = (existing.progressNotes || []) as Array<{ date: string; note: string }>
    notes.push({ date: new Date().toISOString(), note })
    updates.progressNotes = JSON.stringify(notes)
  }

  db.update(schema.userGoals).set(updates)
    .where(eq(schema.userGoals.id, goalId))
    .run()
}

// Legacy compatibility: keep the old export name for any other imports
export const activeGoals = {
  get(key: string) {
    const [userId, chatId] = key.split(':')
    return getActiveGoal(userId, chatId)
  },
  set(key: string, val: { goal: string; strategy: string; chatId: string; createdAt: number }) {
    const [userId] = key.split(':')
    // Upsert: if active goal exists for this chat, update it; otherwise create
    const existing = db.select().from(schema.userGoals)
      .where(and(
        eq(schema.userGoals.userId, userId),
        eq(schema.userGoals.chatId, val.chatId),
        inArray(schema.userGoals.status, ['active', 'in_progress']),
      )).get()

    if (existing) {
      db.update(schema.userGoals).set({
        goal: val.goal,
        strategy: val.strategy,
        status: 'in_progress',
        updatedAt: sql`(unixepoch())`,
      }).where(eq(schema.userGoals.id, existing.id)).run()
    } else {
      db.insert(schema.userGoals).values({
        id: crypto.randomUUID(),
        userId,
        chatId: val.chatId,
        goal: val.goal,
        strategy: val.strategy,
        status: 'in_progress',
        mode: 'strategic',
      }).run()
    }
  },
}

// ============================
// Helper: get past lessons from mission_history
// ============================
export function getPastLessons(userId: string, chatId?: string): string {
  try {
    const pastMissions = db.select({
      goal: schema.missionHistory.goal,
      result: schema.missionHistory.result,
      lessonsLearned: schema.missionHistory.lessonsLearned,
      createdAt: schema.missionHistory.createdAt,
    }).from(schema.missionHistory)
      .where(eq(schema.missionHistory.userId, userId))
      .orderBy(desc(schema.missionHistory.createdAt))
      .limit(5)
      .all()

    // If chatId, prioritize lessons from that chat
    const filtered = chatId
      ? pastMissions.filter(m => m.lessonsLearned)
      : pastMissions.filter(m => m.lessonsLearned)

    if (filtered.length === 0) return ''

    return filtered
      .map(m => {
        const daysAgo = Math.round((Date.now() - (m.createdAt ? new Date(m.createdAt).getTime() : Date.now())) / (1000 * 60 * 60 * 24))
        return `- [${m.result}] "${m.goal}" (${daysAgo}d ago): ${m.lessonsLearned}`
      })
      .join('\n')
  } catch {
    return ''
  }
}

// ============================
// Mission Strategy Cache (D3: 10min TTL)
// ============================
const missionStrategyCache = new Map<string, { data: any; timestamp: number }>()
const STRATEGY_CACHE_TTL = 10 * 60 * 1000

// ============================
// Strategic Mission Plan — generate strategies before mission launch
// ============================
aiTools.post('/mission-plan', async (c) => {
  const userId = c.get('userId')
  const { chatId, goal } = await c.req.json()
  if (!chatId || !goal) return c.json({ error: 'chatId and goal required' }, 400)

  try {
    // D3: Check cache
    const cacheKey = `${userId}:${chatId}:${goal}`
    const cached = missionStrategyCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < STRATEGY_CACHE_TTL) {
      return c.json(cached.data)
    }

    // 1. Get relationship type
    const relType = await getRelationshipType(userId, chatId)

    // 2. Get last 30 messages
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(30)
      .all()
      .reverse()

    const decrypted = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const chatHistory = decrypted
      .filter(m => m.content && !m.content.startsWith('/uploads/'))
      .map(m => `${m.senderName}: ${m.content}`)
      .join('\n')

    const otherPerson = decrypted.find(m => m.senderId !== userId)?.senderName || 'Contact'
    const contactMessages = decrypted
      .filter(m => m.senderId !== userId && m.content && !m.content.startsWith('/uploads/'))
      .map(m => m.content)

    // 3. Get persona profile
    let persona: PersonaProfile | null = getCachedPersona(chatId, userId)
    if (!persona && contactMessages.length >= 2) {
      persona = await extractPersonaProfile(otherPerson, contactMessages, chatHistory, relType)
    }
    const personaPrompt = persona ? personaToPrompt(persona) : ''

    // 4. Past lessons
    const pastLessons = getPastLessons(userId, chatId)

    // 5. Generate 3 strategies — one AI call
    const planConfig = getModelConfig('planning')
    const strategiesRaw = await chatCompletion({
      model: planConfig.model,
      messages: [
        { role: 'system', content: PROMPTS.missionStrategies.generate(otherPerson, personaPrompt, relType || 'unknown', pastLessons) },
        { role: 'user', content: `Goal: ${goal}\n\nRecent chat history:\n${chatHistory.slice(-2000)}` },
      ],
      temperature: planConfig.temperature,
      maxTokens: planConfig.maxTokens,
    })

    let strategies: any[]
    try {
      const cleaned = strategiesRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned)
      strategies = parsed.strategies || []
    } catch {
      strategies = [{ id: 's1', name: 'Direct approach', description: 'Send a direct message', draftMessage: goal, recommended: true }]
    }

    // 6. Simulate response for each strategy
    for (const strat of strategies) {
      if (persona) {
        const simResult = await simulateWithPersona(persona, chatHistory, '', strat.draftMessage, { branching: false })
        strat.simulatedResponse = simResult.response
        strat.confidence = simResult.confidence
      } else {
        strat.simulatedResponse = '(недостаточно данных для симуляции)'
        strat.confidence = 40
      }
    }

    // 7. Evaluate strategies
    const evalConfig = getModelConfig('evaluation')
    try {
      const evalPrompt = strategies.map((s: any) =>
        `[${s.id}] Draft: "${s.draftMessage}" → Simulated response: "${s.simulatedResponse}" (confidence: ${s.confidence}%)`
      ).join('\n')

      const evalRaw = await chatCompletion({
        model: evalConfig.model,
        messages: [
          { role: 'system', content: PROMPTS.missionStrategies.evaluate(evalPrompt) },
          { role: 'user', content: `Goal: ${goal}` },
        ],
        temperature: evalConfig.temperature,
        maxTokens: evalConfig.maxTokens,
      })

      const evalCleaned = evalRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const evalParsed = JSON.parse(evalCleaned)
      for (const ev of (evalParsed.evaluations || [])) {
        const strat = strategies.find((s: any) => s.id === ev.id)
        if (strat) strat.successRate = ev.successRate
      }
    } catch {
      // Fallback: assign based on recommendation
      for (const s of strategies) {
        if (!s.successRate) s.successRate = s.recommended ? 'high' : 'medium'
      }
    }

    // Build past experience strings
    const pastMissions = db.select({
      goal: schema.missionHistory.goal,
      result: schema.missionHistory.result,
      createdAt: schema.missionHistory.createdAt,
    }).from(schema.missionHistory)
      .where(and(eq(schema.missionHistory.userId, userId), eq(schema.missionHistory.chatId, chatId)))
      .orderBy(desc(schema.missionHistory.createdAt))
      .limit(3)
      .all()

    for (const strat of strategies) {
      const similar = pastMissions.find(m => m.goal?.toLowerCase().includes(goal.toLowerCase().split(' ')[0]))
      if (similar) {
        const daysAgo = Math.round((Date.now() - (similar.createdAt ? new Date(similar.createdAt).getTime() : Date.now())) / (1000 * 60 * 60 * 24))
        strat.pastExperience = `Похожая миссия ${daysAgo}д назад: ${similar.result}`
      } else {
        strat.pastExperience = null
      }
    }

    const response = {
      context: {
        personName: otherPerson,
        relationshipType: relType || 'unknown',
        mood: persona?.currentState?.recentMood || 'unknown',
        communicationStyle: persona
          ? `${persona.linguistic.avgMessageLength} messages, ${persona.linguistic.emojiUsage} emoji, ${persona.behavioral.humor} humor`
          : 'unknown',
        persona: persona ? {
          directness: persona.behavioral.directness,
          agreeableness: persona.behavioral.agreeableness,
          conflictStyle: persona.behavioral.conflictStyle,
        } : null,
      },
      strategies: strategies.map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        draftMessage: s.draftMessage,
        simulatedResponse: s.simulatedResponse,
        successRate: s.successRate || 'medium',
        confidence: s.confidence || 50,
        recommended: !!s.recommended,
        pastExperience: s.pastExperience || null,
      })),
      lessonsFromPast: pastLessons || null,
    }

    // D3: Cache result
    missionStrategyCache.set(cacheKey, { data: response, timestamp: Date.now() })

    return c.json(response)
  } catch (error: any) {
    return c.json({ error: error.message || 'Mission plan failed' }, 500)
  }
})

// ============================
// Set active goal (for tone advisor integration)
// ============================
aiTools.post('/set-goal', async (c) => {
  const userId = c.get('userId')
  const { chatId, goal, strategy } = await c.req.json()
  if (!chatId || !goal) return c.json({ error: 'chatId and goal required' }, 400)

  activeGoals.set(`${userId}:${chatId}`, { goal, strategy: strategy || '', chatId, createdAt: Date.now() })
  return c.json({ ok: true })
})

// ============================
// Mood Check — lightweight mood detection for family/friend
// ============================
const moodCheckCache = new Map<string, { mood: string; note: string | null; confidence: number; messageCount: number; timestamp: number }>()
const MOOD_CHECK_MSG_THRESHOLD = 3

aiTools.post('/mood-check', async (c) => {
  const userId = c.get('userId')
  const { chatId } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  try {
    // Only for family/friend
    const relType = await getRelationshipType(userId, chatId)
    if (relType && relType !== 'family' && relType !== 'friend') {
      return c.json({ mood: 'normal', note: null, confidence: 0 })
    }

    // Check contact-intelligence DB first (persistent, free!)
    const latestMood = getLatestMood(userId, chatId)
    if (latestMood) {
      // Check if still fresh (fewer than 3 new messages since last check)
      const msgCount = db.select({ count: schema.messages.id })
        .from(schema.messages).where(eq(schema.messages.chatId, chatId)).all().length
      const cached = moodCheckCache.get(chatId)
      if (cached && (msgCount - cached.messageCount) < MOOD_CHECK_MSG_THRESHOLD) {
        return c.json({ mood: latestMood.mood, note: latestMood.note, confidence: latestMood.confidence })
      }
    }

    // Fallback: check persona cache
    const persona = getCachedPersona(chatId, userId)
    if (persona && !latestMood) {
      const mood = persona.currentState.recentMood?.toLowerCase()
      const moodMap: Record<string, string> = {
        'sad': 'seems_off', 'upset': 'seems_off', 'anxious': 'seems_off', 'worried': 'seems_off',
        'stressed': 'stressed', 'overwhelmed': 'stressed', 'frustrated': 'stressed', 'angry': 'stressed',
        'happy': 'happy', 'excited': 'happy', 'joyful': 'happy', 'cheerful': 'happy',
      }
      const mappedMood = moodMap[mood] || 'normal'
      return c.json({ mood: mappedMood, note: persona.currentState.lastInteractionTone, confidence: 70 })
    }

    // Check in-memory cache
    const msgCount = db.select({ count: schema.messages.id })
      .from(schema.messages).where(eq(schema.messages.chatId, chatId)).all().length
    const cached = moodCheckCache.get(chatId)
    if (cached && (msgCount - cached.messageCount) < MOOD_CHECK_MSG_THRESHOLD) {
      return c.json({ mood: cached.mood, note: cached.note, confidence: cached.confidence })
    }

    // Light AI call
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(10)
      .all()
      .reverse()

    const decryptedMood = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const otherMsgs = decryptedMood
      .filter(m => m.senderId !== userId && m.content && !m.content.startsWith('/uploads/'))
      .map(m => m.content)
      .join('\n')

    if (!otherMsgs.trim()) {
      return c.json({ mood: 'normal', note: null, confidence: 0 })
    }

    const moodConfig = getModelConfig('classification')
    const moodResult = await chatCompletion({
      model: moodConfig.model,
      messages: [
        { role: 'system', content: 'Analyze the person\'s recent messages and detect their mood. Return JSON: {"mood":"normal|seems_off|happy|stressed","note":"1 sentence explanation or null","confidence":0-100}. Only flag seems_off or stressed if clearly visible. Be conservative.' },
        { role: 'user', content: otherMsgs },
      ],
      temperature: moodConfig.temperature,
      maxTokens: 100,
    })

    try {
      const parsed = JSON.parse(moodResult.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
      moodCheckCache.set(chatId, { ...parsed, messageCount: msgCount, timestamp: Date.now() })

      // Persist mood to contact-intelligence DB (always, not just concerning)
      try {
        ciRecordMood(userId, chatId, parsed.mood, parsed.note || null, parsed.confidence || 70)
      } catch {}

      // D2: Update persona cache if mood is concerning
      if ((parsed.mood === 'seems_off' || parsed.mood === 'stressed') && parsed.confidence > 60) {
        updatePersonaMood(chatId, userId, parsed.mood === 'stressed' ? 'stressed' : 'seems_off')
      }

      return c.json(parsed)
    } catch {
      return c.json({ mood: 'normal', note: null, confidence: 0 })
    }
  } catch {
    return c.json({ mood: 'normal', note: null, confidence: 0 })
  }
})

// ============================
// Relationship Insights — psychologist-style analysis (cached 10min)
// ============================
const insightsCache = new Map<string, { data: any; at: number }>()
const INSIGHTS_TTL = 10 * 60 * 1000 // 10 min

aiTools.post('/relationship-insights', async (c) => {
  const userId = c.get('userId')
  const { chatId, forceRefresh } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  // Check cache
  const cacheKey = `${userId}:${chatId}`
  const cached = insightsCache.get(cacheKey)
  if (cached && !forceRefresh && Date.now() - cached.at < INSIGHTS_TTL) {
    return c.json(cached.data)
  }

  try {
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    // Get other person's info
    const members = db.select({
      userId: schema.chatMembers.userId,
      displayName: schema.users.displayName,
    }).from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(eq(schema.chatMembers.chatId, chatId))
      .all()
    const otherPerson = members.find(m => m.userId !== userId) || members[0]
    const personName = otherPerson?.displayName || chat.name || 'Contact'

    // Get mood data
    const moodTrend = getMoodTrend(userId, chatId)
    const latestMood = getLatestMood(userId, chatId)

    // Get memories
    const memories = getActiveMemories(userId, chatId)
    const memoryText = memories.map(m => `[${m.category}] ${m.fact}`).join('\n')

    // v2: Get knowledge graph context
    const graphContext = getRelevantGraphContext(userId, chatId)
    const graphBlock = getGraphPromptBlock(userId, chatId)

    // Get recent messages for context
    const msgs = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      senderId: schema.messages.senderId,
      createdAt: schema.messages.createdAt,
      visibility: schema.messages.visibility,
    }).from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.visibility, 'normal')))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20)
      .all()
      .reverse()

    const decrypted = await Promise.all(msgs.map(async m => ({ ...m, content: await decrypt(m.content) })))
    const chatText = decrypted
      .filter(m => m.content && !m.content.startsWith('/uploads/'))
      .map(m => `${m.senderName}: ${m.content}`)
      .join('\n')

    const relType = await getRelationshipType(userId, chatId)

    const genConfig = getModelConfig('generation')
    const result = await chatCompletion({
      model: genConfig.model,
      messages: [
        {
          role: 'system',
          content: `You are a relationship psychologist analyzing communication patterns. Given a conversation, mood data, and personal facts, provide:
1. A brief interpretation of what's happening emotionally (1-2 sentences)
2. 2-4 actionable recommendations for how the user can be a better friend/partner/family member right now

Context:
- Person: ${personName} (${relType || 'unknown'} relationship)
- Current mood: ${latestMood?.mood || 'unknown'} (trend: ${moodTrend?.trend || 'unknown'})
- Known facts about them:
${memoryText || 'No facts stored yet'}
${graphBlock || ''}
${graphContext.interests.length > 0 ? `- Their interests: ${graphContext.interests.join(', ')}` : ''}
${graphContext.plans.length > 0 ? `- Their plans: ${graphContext.plans.join(', ')}` : ''}
${graphContext.dates.length > 0 ? `- Important dates: ${graphContext.dates.join(', ')}` : ''}

Return JSON:
{
  "situation": "Brief emotional interpretation",
  "recommendations": [
    { "text": "What to do", "draftMessage": "Optional draft message to send", "type": "support|activity|gift|contact" }
  ]
}

Respond in the same language as the messages. Be warm but practical.`
        },
        { role: 'user', content: chatText || 'No recent messages' },
      ],
      temperature: 0.6,
      maxTokens: 512,
    })

    try {
      const parsed = JSON.parse(result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
      insightsCache.set(cacheKey, { data: parsed, at: Date.now() })
      return c.json(parsed)
    } catch {
      return c.json({ situation: null, recommendations: [] })
    }
  } catch (error: any) {
    return c.json({ error: error.message || 'Relationship insights failed' }, 500)
  }
})

// ============================
// Contact Desires — interests, wishes, important dates
// ============================
aiTools.post('/contact-desires', async (c) => {
  const userId = c.get('userId')
  const { chatId } = await c.req.json()
  if (!chatId) return c.json({ error: 'chatId required' }, 400)

  try {
    const memories = getActiveMemories(userId, chatId)

    // Only show real desires/interests — NOT work tasks or technical details
    const desires = memories
      .filter(m => ['preference', 'plan'].includes(m.category))
      .filter(m => {
        // Filter out technical/work noise
        const lower = m.fact.toLowerCase()
        const isNoise = /\b(debug|useform|react|memory leak|event listener|api|deploy|баг|код|фикс|коммит|merge|pr|pull request)\b/i.test(lower)
        return !isNoise
      })
      .map(m => ({
        text: m.fact,
        category: m.category,
        confidence: m.confidence,
      }))

    // Life events — only significant ones
    const lifeEvents = memories
      .filter(m => m.category === 'life_event')
      .filter(m => m.confidence >= 0.7)
      .slice(0, 3) // max 3 life events
      .map(m => ({ text: m.fact, category: m.category, confidence: m.confidence }))

    const dates = memories
      .filter(m => m.category === 'date')
      .map(m => ({
        label: m.fact,
        category: m.category,
      }))

    // People they mentioned
    const people = memories
      .filter(m => m.category === 'person')
      .map(m => ({ text: m.fact, category: m.category, confidence: m.confidence }))

    return c.json({
      desires: [...desires, ...lifeEvents, ...people].slice(0, 8), // max 8 items
      dates,
    })
  } catch (error: any) {
    return c.json({ error: error.message || 'Contact desires failed' }, 500)
  }
})

// ============================
// Contact Summary — combined data for Relationships page
// ============================
aiTools.get('/contact-summary/:chatId', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

  try {
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    // Get other person
    const members = db.select({
      userId: schema.chatMembers.userId,
      displayName: schema.users.displayName,
      username: schema.users.username,
    }).from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(eq(schema.chatMembers.chatId, chatId))
      .all()
    const otherPerson = members.find(m => m.userId !== userId) || members[0]

    // Mood
    const moodTrend = getMoodTrend(userId, chatId)
    const latestMood = getLatestMood(userId, chatId)

    // Memories
    const memories = getActiveMemories(userId, chatId)

    // Goals for this chat
    const goals = db.select().from(schema.userGoals)
      .where(and(
        eq(schema.userGoals.userId, userId),
        eq(schema.userGoals.chatId, chatId),
        inArray(schema.userGoals.status, ['active', 'in_progress']),
      ))
      .orderBy(desc(schema.userGoals.updatedAt))
      .all()

    // Agent config
    const agentConfig = db.select().from(schema.agentConfigs)
      .where(and(
        eq(schema.agentConfigs.userId, userId),
        eq(schema.agentConfigs.chatId, chatId),
        eq(schema.agentConfigs.enabled, true),
      ))
      .get()

    // Relationship type
    const relType = await getRelationshipType(userId, chatId)

    // Contact intelligence for style info
    const intel = getContactIntel(userId, chatId)

    // Recent proactive actions
    const proactiveActions = db.select().from(schema.proactiveActions)
      .where(and(
        eq(schema.proactiveActions.userId, userId),
        eq(schema.proactiveActions.chatId, chatId),
      ))
      .orderBy(desc(schema.proactiveActions.createdAt))
      .limit(5)
      .all()

    return c.json({
      contact: {
        name: otherPerson?.displayName || chat.name,
        username: otherPerson?.username,
        userId: otherPerson?.userId || null,
        chatId,
        relationshipType: relType,
        mood: latestMood ? { mood: latestMood.mood, note: latestMood.note, confidence: latestMood.confidence } : null,
        moodTrend: moodTrend ? { trend: moodTrend.trend, current: moodTrend.current, significantChange: moodTrend.significantChange } : null,
        memories: memories.map(m => ({ fact: m.fact, category: m.category })),
        goals,
        agentConfig: agentConfig ? { agentId: agentConfig.agentId, triggerMode: agentConfig.triggerMode } : null,
        style: intel?.theirStyle || null,
        myStylePreference: intel?.myStyleForThem || null,
        proactiveActions,
      }
    })
  } catch (error: any) {
    return c.json({ error: error.message || 'Contact summary failed' }, 500)
  }
})

// ============================
// Contacts Overview — all contacts for dashboard grid
// ============================
aiTools.get('/contacts-overview', async (c) => {
  const userId = c.get('userId')

  try {
    // Get all private chats for user
    const userChats = db.select({
      chatId: schema.chatMembers.chatId,
    }).from(schema.chatMembers)
      .where(eq(schema.chatMembers.userId, userId))
      .all()

    const chatIds = userChats.map(uc => uc.chatId)
    if (chatIds.length === 0) return c.json({ contacts: [] })

    // Get chats that are private
    const privateChats = db.select().from(schema.chats)
      .where(and(
        inArray(schema.chats.id, chatIds),
        eq(schema.chats.type, 'private'),
      ))
      .all()

    const contacts = await Promise.all(privateChats.map(async (chat) => {
      // Get other person
      const members = db.select({
        userId: schema.chatMembers.userId,
        displayName: schema.users.displayName,
        relationshipType: schema.chatMembers.relationshipType,
      }).from(schema.chatMembers)
        .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
        .where(eq(schema.chatMembers.chatId, chat.id))
        .all()
      const otherPerson = members.find(m => m.userId !== userId)
      if (!otherPerson) return null // skip self-chats and bot chats

      // Mood
      const latestMood = getLatestMood(userId, chat.id)

      // Active goals count
      const goalCount = db.select({ count: sql<number>`count(*)` }).from(schema.userGoals)
        .where(and(
          eq(schema.userGoals.userId, userId),
          eq(schema.userGoals.chatId, chat.id),
          inArray(schema.userGoals.status, ['active', 'in_progress']),
        ))
        .get()

      // Agent config
      const hasAgent = db.select({ id: schema.agentConfigs.id }).from(schema.agentConfigs)
        .where(and(
          eq(schema.agentConfigs.userId, userId),
          eq(schema.agentConfigs.chatId, chat.id),
          eq(schema.agentConfigs.enabled, true),
        ))
        .get()

      // Top desire from memory
      const topMemory = getActiveMemories(userId, chat.id)
        .filter(m => ['preference', 'plan'].includes(m.category))
        .slice(0, 1)

      return {
        chatId: chat.id,
        name: otherPerson.displayName,
        relationshipType: otherPerson.relationshipType || null,
        mood: latestMood ? { mood: latestMood.mood, note: latestMood.note } : null,
        activeGoals: goalCount?.count || 0,
        hasAgent: !!hasAgent,
        topDesire: topMemory[0]?.fact || null,
      }
    }))

    return c.json({ contacts: contacts.filter(Boolean) })
  } catch (error: any) {
    return c.json({ error: error.message || 'Contacts overview failed' }, 500)
  }
})

export { getRelationshipType, detectAndCacheRelationship, relationshipContext }
export default aiTools
