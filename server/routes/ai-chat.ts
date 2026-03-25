import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, desc } from 'drizzle-orm'
import { getCachedProfile } from '../ai/style/cache'
import { authMiddleware } from '../middleware/auth'
import { chatCompletionWithTools, type ChatMessage } from '../ai/openrouter'
import { ASSISTANT_TOOLS, AUTOPILOT_TOOLS, executeTool, sendConfirmedMessage, type PendingAction, type AutopilotEvent } from '../ai/assistant-tools'
import {
  checkAiRateLimit,
  logAiAction,
  getPrivacySettings,
  isChatAccessAllowed,
  sanitizeForAi,
  storePendingAction,
  consumePendingAction,
  clearPendingActions,
} from '../ai/security'

const aiChat = new Hono()
aiChat.use('*', authMiddleware)

// In-memory conversation store (per user)
const conversations = new Map<string, ChatMessage[]>()

const SYSTEM_PROMPT = `Ты — умный AI-ассистент в мессенджере MLSendger. Ты можешь:

1. **Коммуникация**: Писать и отправлять сообщения от имени пользователя в любой чат.
2. **Переговоры**: Вести переписку с целью (продать, договориться, убедить).
3. **Поиск**: Искать по истории сообщений, находить договорённости и информацию.
4. **Аналитика**: Показывать статистику общения.
5. **Контакты**: Находить людей и чаты.

ПРАВИЛА:
- Отвечай на том же языке, на котором пишет пользователь.
- КРИТИЧЕСКИ ВАЖНО: Когда пользователь просит написать/отправить сообщение кому-то — ты ОБЯЗАН вызвать draft_message. НИКОГДА не пиши текст сообщения просто в ответе. Только через draft_message пользователь сможет подтвердить и отправить сообщение.
- Если нужно найти чат — сначала вызови get_my_chats. Даже если ты помнишь chatId из предыдущего разговора — всё равно используй get_my_chats для надёжности.
- Если нужен контекст переписки — вызови get_chat_history перед составлением ответа.
- Пиши сообщения естественно, как живой человек, не как бот.
- Будь кратким и конкретным в своих ответах пользователю.
- Когда составляешь сообщение для отправки — учитывай стиль и тон предыдущей переписки.
- ВСЕГДА используй tools для действий. Не имитируй результат tool вызова текстом.
- Когда пользователь спрашивает "что я обещал", "какие договорённости", "что я должен" — используй get_my_chats, затем get_chat_history для каждого активного чата, и проанализируй сообщения на предмет обещаний, задач, договорённостей, дедлайнов. Не ограничивайся только search_messages.
- Когда пользователь даёт задание вроде "договорись", "узнай", "предложи" — составь правильное сообщение через draft_message с учётом контекста переписки и цели пользователя.
- Некоторые чаты могут быть недоступны из-за настроек приватности пользователя. Если tool вернул ошибку доступа — сообщи пользователю что этот чат исключён из AI-доступа.`

const MAX_TOOL_ITERATIONS = 5
const AUTOPILOT_MAX_ITERATIONS = 15

// Guard: only one autopilot session per user
const activeAutopilotSessions = new Set<string>()

const chatSchema = z.object({
  message: z.string().min(1).max(10000),
  agentId: z.string().optional(),
  model: z.string().optional(),
  clearHistory: z.boolean().optional(),
  autopilot: z.boolean().optional(),
})

const AUTOPILOT_PROMPT_ADDITION = `

РЕЖИМ АВТОПИЛОТА ВКЛЮЧЁН. Особые правила:
- Используй send_message вместо draft_message для немедленной отправки сообщений (БЕЗ подтверждения пользователя).
- После отправки сообщения используй wait_for_reply чтобы дождаться ответа собеседника.
- Когда получишь ответ — проанализируй его и продолжай диалог для достижения цели.
- Продолжай вести диалог до выполнения задачи или пока не станет ясно что цель недостижима.
- В конце верни финальный отчёт пользователю о результате.
- Пиши естественно, как живой человек. Не раскрывай что ты AI.`

// Direct AI chat with function calling + security
aiChat.post('/chat', async (c) => {
  const userId = c.get('userId')
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'

  // Rate limiting
  const rateCheck = checkAiRateLimit(userId)
  if (!rateCheck.allowed) {
    logAiAction({ userId, action: 'rate_limited', status: 'denied', ip: clientIp })
    return c.json({
      error: `Лимит запросов исчерпан. Попробуйте через ${Math.ceil(rateCheck.resetIn / 60)} мин.`,
    }, 429)
  }

  // Privacy check — is AI enabled for this user?
  const privacy = getPrivacySettings(userId)
  if (!privacy.aiEnabled) {
    return c.json({ error: 'AI ассистент отключён в настройках приватности.' }, 403)
  }

  const body = await c.req.json()
  const parsed = chatSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { message, agentId, model, clearHistory, autopilot } = parsed.data

  // Autopilot guard: only one session per user
  if (autopilot) {
    if (activeAutopilotSessions.has(userId)) {
      return c.json({ error: 'У вас уже есть активная сессия автопилота. Дождитесь её завершения.' }, 429)
    }
    activeAutopilotSessions.add(userId)
  }

  if (clearHistory) {
    conversations.delete(userId)
    clearPendingActions(userId)
  }

  // Get or create conversation
  if (!conversations.has(userId)) {
    conversations.set(userId, [])
  }
  const history = conversations.get(userId)!

  // Determine system prompt and model
  let systemPrompt = SYSTEM_PROMPT
  let aiModel = model || 'openai/gpt-4o-mini'
  let temperature = 0.7
  let maxTokens = 2048

  // Inject user's own writing style into system prompt if cached
  const userStyleCached = getCachedProfile(userId, userId, undefined, 'global')
  if (userStyleCached) {
    const sp = userStyleCached.profile
    systemPrompt += `\n\nСТИЛЬ ПОЛЬЗОВАТЕЛЯ (используй при составлении сообщений от его имени):\n${sp.styleInstruction}\nХарактерные фразы: ${(sp.commonPhrases || []).join(', ')}`
  } else {
    systemPrompt += `\n\nУ пользователя пока нет профиля стиля. Когда он просит "напиши в моём стиле" — вызови analyze_writing_style с targetUserId="${userId}" (это ID текущего пользователя). Для написания В СТИЛЕ ДРУГОГО человека — передай targetUserId этого человека.`
  }
  systemPrompt += `\n\nТекущий userId пользователя: "${userId}". Когда пользователь говорит "в моём стиле" или "как я пишу" — используй targetUserId="${userId}" (его собственный ID). Когда он просит "напиши Gabe" без уточнения стиля — тоже пиши в стиле пользователя (targetUserId="${userId}"), а НЕ в стиле получателя.`

  if (autopilot) {
    systemPrompt += AUTOPILOT_PROMPT_ADDITION
  }

  if (agentId) {
    const agent = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get()
    if (agent) {
      systemPrompt = SYSTEM_PROMPT + (autopilot ? AUTOPILOT_PROMPT_ADDITION : '') + '\n\nДополнительные инструкции агента:\n' + agent.systemPrompt
      aiModel = agent.model
      temperature = agent.temperature ?? 0.7
      maxTokens = agent.maxTokens ?? 2048
    }
  }

  // Add user message
  history.push({ role: 'user', content: message })

  // Log the chat request
  logAiAction({ userId, action: 'ai_chat', details: { messageLength: message.length, model: aiModel }, ip: clientIp })

  // Build messages for LLM
  const recentHistory = history.slice(-30)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
  ]

  try {
    let finalContent = ''
    const toolsUsed: string[] = []
    const collectedActions: PendingAction[] = []
    const autopilotEvents: AutopilotEvent[] = []
    let currentMessages = [...messages]
    const maxIterations = autopilot ? AUTOPILOT_MAX_ITERATIONS : MAX_TOOL_ITERATIONS
    const toolSet = autopilot ? AUTOPILOT_TOOLS : ASSISTANT_TOOLS

    // Tool calling loop
    for (let i = 0; i < maxIterations; i++) {
      const result = await chatCompletionWithTools({
        model: aiModel,
        messages: currentMessages,
        temperature,
        maxTokens,
        tools: toolSet,
      })

      // If LLM returned text (no more tool calls), we're done
      if (!result.tool_calls || result.tool_calls.length === 0) {
        finalContent = result.content || ''
        break
      }

      // Process tool calls
      currentMessages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.tool_calls,
      })

      for (const toolCall of result.tool_calls) {
        const toolName = toolCall.function.name
        toolsUsed.push(toolName)

        let args: Record<string, any> = {}
        try {
          args = JSON.parse(toolCall.function.arguments || '{}')
        } catch {
          args = {}
        }

        // Privacy check: if tool accesses a specific chat, verify access
        const chatIdArg = args.chatId
        if (chatIdArg && !isChatAccessAllowed(userId, chatIdArg)) {
          logAiAction({
            userId, action: toolName, details: args,
            chatIdAccessed: chatIdArg, status: 'denied', ip: clientIp,
          })

          currentMessages.push({
            role: 'tool',
            content: 'Доступ запрещён: этот чат исключён из AI-доступа в настройках приватности.',
            tool_call_id: toolCall.id,
          })
          continue
        }

        // Execute tool with data masking
        const toolResult = await executeTool(toolName, args, {
          userId,
          dataMasking: privacy.dataMasking ?? true,
          autopilot: autopilot || false,
          ip: clientIp,
        })

        // Audit log
        logAiAction({
          userId, action: toolName, details: args,
          chatIdAccessed: chatIdArg || null, status: 'success', ip: clientIp,
        })

        if (toolResult.pendingAction) {
          collectedActions.push(toolResult.pendingAction)
          storePendingAction(userId, toolResult.pendingAction)
        }

        if (toolResult.autopilotEvent) {
          autopilotEvents.push(toolResult.autopilotEvent)
        }

        // Add tool result to messages
        currentMessages.push({
          role: 'tool',
          content: toolResult.result,
          tool_call_id: toolCall.id,
        })
      }

      // If this is the last iteration, get a final text response
      if (i === maxIterations - 1) {
        const finalResult = await chatCompletionWithTools({
          model: aiModel,
          messages: currentMessages,
          temperature,
          maxTokens,
        })
        finalContent = finalResult.content || ''
      }
    }

    // Save assistant response to history
    history.push({ role: 'assistant', content: finalContent })

    // Trim history
    if (history.length > 60) {
      conversations.set(userId, history.slice(-40))
    }

    if (autopilot) activeAutopilotSessions.delete(userId)

    return c.json({
      response: finalContent,
      model: aiModel,
      toolsUsed,
      pendingActions: collectedActions.length > 0 ? collectedActions : undefined,
      autopilotEvents: autopilotEvents.length > 0 ? autopilotEvents : undefined,
      historyLength: history.length,
      rateLimitRemaining: rateCheck.remaining,
    })
  } catch (error: any) {
    if (autopilot) activeAutopilotSessions.delete(userId)
    logAiAction({ userId, action: 'ai_chat_error', details: { error: error.message }, status: 'error', ip: clientIp })
    return c.json({ error: error.message || 'AI request failed' }, 500)
  }
})

// Confirm a pending action with TTL check
const confirmSchema = z.object({
  actionId: z.string(),
})

aiChat.post('/confirm-action', async (c) => {
  const userId = c.get('userId')
  const clientIp = c.req.header('x-forwarded-for') || 'unknown'
  const body = await c.req.json()
  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  // Use secure pending actions with TTL
  const action = consumePendingAction(userId, parsed.data.actionId)
  if (!action) {
    logAiAction({ userId, action: 'confirm_action', details: { actionId: parsed.data.actionId }, status: 'denied', ip: clientIp })
    return c.json({ error: 'Действие не найдено или истекло (5 мин).' }, 404)
  }

  if (action.type === 'send_message') {
    const success = await sendConfirmedMessage(userId, action.chatId, action.content)
    if (!success) {
      logAiAction({ userId, action: 'send_message', details: { chatId: action.chatId }, status: 'error', ip: clientIp })
      return c.json({ error: 'Failed to send message' }, 500)
    }

    logAiAction({ userId, action: 'send_message', details: { chatId: action.chatId, chatName: action.chatName }, ip: clientIp })

    // Add confirmation to chat history
    const history = conversations.get(userId)
    if (history) {
      history.push({
        role: 'user',
        content: `[Сообщение отправлено в чат "${action.chatName}": "${action.content}"]`,
      })
    }

    return c.json({
      ok: true,
      message: `Сообщение отправлено в "${action.chatName}"`,
    })
  }

  return c.json({ error: 'Unknown action type' }, 400)
})

// Clear conversation history
aiChat.delete('/chat/history', async (c) => {
  const userId = c.get('userId')
  conversations.delete(userId)
  clearPendingActions(userId)
  return c.json({ ok: true })
})

// ── Privacy settings endpoints ──

aiChat.get('/privacy', async (c) => {
  const userId = c.get('userId')
  const settings = getPrivacySettings(userId)
  return c.json(settings)
})

const privacySchema = z.object({
  aiEnabled: z.boolean().optional(),
  excludedChats: z.array(z.string()).optional(),
  dataMasking: z.boolean().optional(),
  auditLogEnabled: z.boolean().optional(),
})

aiChat.put('/privacy', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = privacySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const updates: Record<string, any> = {}
  if (parsed.data.aiEnabled !== undefined) updates.aiEnabled = parsed.data.aiEnabled
  if (parsed.data.excludedChats !== undefined) updates.excludedChats = parsed.data.excludedChats
  if (parsed.data.dataMasking !== undefined) updates.dataMasking = parsed.data.dataMasking
  if (parsed.data.auditLogEnabled !== undefined) updates.auditLogEnabled = parsed.data.auditLogEnabled

  // Ensure settings row exists
  getPrivacySettings(userId)

  db.update(schema.aiPrivacySettings)
    .set(updates)
    .where(eq(schema.aiPrivacySettings.userId, userId))
    .run()

  logAiAction({ userId, action: 'privacy_settings_updated', details: updates })

  return c.json({ ok: true })
})

// Audit log — view recent AI actions
aiChat.get('/audit-log', async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)

  const logs = db.select()
    .from(schema.aiAuditLog)
    .where(eq(schema.aiAuditLog.userId, userId))
    .orderBy(desc(schema.aiAuditLog.createdAt))
    .limit(limit)
    .all()

  return c.json(logs)
})

export default aiChat
