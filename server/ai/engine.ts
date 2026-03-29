import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'
import { chatCompletion, type ChatMessage } from './openrouter'
import { broadcastToChat, sendToUser } from '../ws'
import { findSkillByCommand, findSkillById, getAgentSkills, SKILLS } from './skills/registry'
import { trackUsage } from '../middleware/billing'
import { encrypt, decrypt } from '../security/encryption'

// Resolve a /command to a skill, checking custom aliases first
export function resolveCommand(
  userId: string,
  command: string
): { skill: typeof SKILLS[string]; agentId?: string; originalCommand: string } | null {
  const normalizedCmd = command.startsWith('/') ? command : `/${command}`

  // 1. Check custom aliases first
  const alias = db.select({
    alias: schema.agentCommandAliases,
    agent: schema.agents,
  })
    .from(schema.agentCommandAliases)
    .innerJoin(schema.agents, eq(schema.agentCommandAliases.agentId, schema.agents.id))
    .where(and(
      eq(schema.agentCommandAliases.userId, userId),
      eq(schema.agentCommandAliases.customCommand, normalizedCmd)
    ))
    .get()

  if (alias) {
    const skill = findSkillById(alias.alias.skillId)
    if (skill) {
      return { skill, agentId: alias.alias.agentId, originalCommand: normalizedCmd }
    }
  }

  // 2. Fall back to default command lookup, but only if user has an agent with this skill
  const skill = findSkillByCommand(normalizedCmd)
  if (!skill) return null

  // Find an agent owned by user that has this skill
  const userAgents = db.select().from(schema.agents)
    .where(eq(schema.agents.ownerId, userId))
    .all()

  for (const agent of userAgents) {
    const tools = (agent.tools as string[]) || []
    const agentSkills = getAgentSkills(tools)
    if (agentSkills.some(s => s.id === skill.id)) {
      return { skill, agentId: agent.id, originalCommand: normalizedCmd }
    }
  }

  // text_reply is always available if user has any agent
  if (skill.id === 'text_reply' && userAgents.length > 0) {
    return { skill, agentId: userAgents[0].id, originalCommand: normalizedCmd }
  }

  return null
}

// Get all available /commands for a user (from their installed agents)
export function getUserAvailableSkills(userId: string) {
  const userAgents = db.select().from(schema.agents)
    .where(eq(schema.agents.ownerId, userId))
    .all()

  // Get custom aliases
  const aliases = db.select().from(schema.agentCommandAliases)
    .where(eq(schema.agentCommandAliases.userId, userId))
    .all()

  const aliasMap = new Map<string, { customCommand: string; agentId: string }>()
  for (const a of aliases) {
    aliasMap.set(`${a.agentId}:${a.skillId}`, { customCommand: a.customCommand, agentId: a.agentId })
  }

  const skills: Array<{
    id: string
    command: string
    customCommand?: string
    name: string
    description: string
    icon: string
    cost: number
    agentId: string
    agentName: string
    agentAvatar: string | null
  }> = []

  const seen = new Set<string>() // avoid duplicate skills from multiple agents

  for (const agent of userAgents) {
    const tools = (agent.tools as string[]) || []
    const agentSkills = getAgentSkills(tools)

    for (const skill of agentSkills) {
      // text_reply is available via /reply command (don't skip it)

      const key = `${agent.id}:${skill.id}`
      const aliasInfo = aliasMap.get(key)
      const skillKey = aliasInfo?.customCommand || skill.command

      if (seen.has(skillKey)) continue
      seen.add(skillKey)

      skills.push({
        id: skill.id,
        command: skill.command,
        customCommand: aliasInfo?.customCommand,
        name: skill.name,
        description: skill.description,
        icon: skill.icon,
        cost: skill.cost,
        agentId: agent.id,
        agentName: agent.name,
        agentAvatar: agent.avatar,
      })
    }
  }

  return skills
}

// Execute a slash command skill (hidden from chat partner)
export async function executeSkill(
  chatId: string,
  userId: string,
  command: string,
  prompt: string,
  outputMode?: 'ghost' | 'normal'
): Promise<{ ok: boolean; messageId?: string; skill?: string; cost?: number }> {
  // Resolve command (handles aliases and agent ownership)
  const resolved = resolveCommand(userId, command)
  if (!resolved) {
    throw new Error(`Unknown command: ${command}. Install agents from Agent Store to get /commands.`)
  }

  const { skill } = resolved

  // Find agent assigned to this chat or use the skill's owning agent
  const config = db.select({
    config: schema.agentConfigs,
    agent: schema.agents,
  })
    .from(schema.agentConfigs)
    .innerJoin(schema.agents, eq(schema.agentConfigs.agentId, schema.agents.id))
    .where(and(
      eq(schema.agentConfigs.chatId, chatId),
      eq(schema.agentConfigs.userId, userId),
      eq(schema.agentConfigs.enabled, true)
    ))
    .get()

  // Use assigned agent's model if available, otherwise find the agent that owns the skill
  let agentModel = 'openai/gpt-4o-mini'
  let agentId = resolved.agentId
  let agentSystemPrompt = ''
  let agentSkillSettings: Record<string, Record<string, any>> = {}

  if (config) {
    agentModel = config.agent.model
    agentId = config.agent.id
    agentSystemPrompt = config.agent.systemPrompt
    agentSkillSettings = (config.agent as any).skillSettings || {}
  } else if (resolved.agentId) {
    const agent = db.select().from(schema.agents)
      .where(eq(schema.agents.id, resolved.agentId)).get()
    if (agent) {
      agentModel = agent.model
      agentSystemPrompt = agent.systemPrompt
      agentSkillSettings = (agent.skillSettings as any) || {}
    }
  }

  // BUG FIX: Load chat history for the skill (especially important for /reply)
  const chatHistoryRaw = db.select({
    senderId: schema.messages.senderId,
    content: schema.messages.content,
  })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.chatId, chatId),
      eq(schema.messages.visibility, 'normal')
    ))
    .orderBy(desc(schema.messages.createdAt))
    .limit(20)
    .all()
    .reverse()
  const chatHistory = await Promise.all(chatHistoryRaw.map(async msg => ({
    role: (msg.senderId === userId ? 'assistant' : 'user') as 'user' | 'assistant',
    content: await decrypt(msg.content),
  })))

  // Build messages array with system prompt if available
  const skillChatHistory = agentSystemPrompt
    ? [{ role: 'system' as const, content: agentSystemPrompt }, ...chatHistory]
    : chatHistory

  // Execute the skill
  const result = await skill.execute({
    chatId,
    userId,
    prompt,
    agentModel,
    chatHistory: skillChatHistory as any,
    skillSettings: agentSkillSettings[skill.id] || {},
    outputMode: outputMode || 'ghost',
  })

  // Determine visibility — pipeline outputMode overrides skill's default
  const visibility = outputMode || result.visibility || 'ghost'

  // Save result as a message
  const messageId = crypto.randomUUID()
  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  db.insert(schema.messages).values({
    id: messageId,
    chatId,
    senderId: userId,
    content: await encrypt(result.content),
    type: result.type,
    status: 'sent',
    visibility,
    metadata: result.metadata || null,
  }).run()

  const fullMessage = {
    id: messageId,
    chatId,
    senderId: userId,
    senderName: sender?.displayName || 'Unknown',
    senderAvatar: sender?.avatar || null,
    content: result.content, // plaintext for WebSocket
    type: result.type,
    status: 'sent',
    visibility,
    metadata: result.metadata || null,
    createdAt: new Date(),
  }

  if (visibility === 'ghost') {
    // Ghost messages: send ONLY to the owner, never broadcast to chat
    sendToUser(userId, {
      type: 'new_message',
      message: fullMessage,
    })
  } else {
    // Normal messages: broadcast to all chat members
    broadcastToChat(chatId, {
      type: 'new_message',
      message: fullMessage,
    })
  }

  // Track credit usage
  const billing = trackUsage({
    userId,
    agentId,
    skillId: skill.id,
    skillName: skill.name,
    cost: skill.cost,
    chatId,
  })

  return {
    ok: true,
    messageId,
    skill: skill.name,
    cost: billing.cost,
  }
}

// Auto-reply: triggered when someone else sends a message to a chat with an agent
export async function processAgentResponse(
  chatId: string,
  senderId: string,
  messageContent: string
) {
  const configs = db.select({
    config: schema.agentConfigs,
    agent: schema.agents,
  })
    .from(schema.agentConfigs)
    .innerJoin(schema.agents, eq(schema.agentConfigs.agentId, schema.agents.id))
    .where(and(
      eq(schema.agentConfigs.chatId, chatId),
      eq(schema.agentConfigs.enabled, true)
    ))
    .all()

  for (const { config, agent } of configs) {
    if (config.userId === senderId) continue

    // Check if agent supports auto mode
    const modes = (agent.modes as string[]) || ['command']
    const supportsAuto = modes.includes('auto')

    const shouldTrigger = checkTrigger(config.triggerMode, messageContent, agent.name)
    if (!shouldTrigger) continue

    // For auto trigger mode, agent must support 'auto' mode
    if (config.triggerMode === 'auto' && !supportsAuto) continue

    const historyRaw = db.select({
      senderId: schema.messages.senderId,
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
      .limit(20)
      .all()
      .reverse()
    const history = await Promise.all(historyRaw.map(async msg => ({
      ...msg,
      content: await decrypt(msg.content),
    })))

    const ownerUser = db.select()
      .from(schema.users)
      .where(eq(schema.users.id, config.userId))
      .get()

    if (!ownerUser) continue

    // Phase 3: Prefer per-contact style, fallback to global
    let styleBlock = ''
    try {
      const { getContactIntel } = await import('./contact-intelligence')
      const intel = getContactIntel(config.userId, chatId)
      if (intel?.myStyleForThem) {
        const p = intel.myStyleForThem as any
        styleBlock = `\n\nСТИЛЬ ВЛАДЕЛЬЦА ДЛЯ ЭТОГО КОНТАКТА (пиши именно так):\n${p.styleInstruction || ''}\nХарактерные фразы: ${(p.commonPhrases || []).join(', ')}\nДлина сообщений: ~${p.avgMessageLength || 50} символов\nЭмодзи: ${p.emojiFrequency || 'иногда'}\nРегистр: ${p.capitalization || 'стандарт'}`
      }
      if (!styleBlock) {
        const { getOwnProfile } = await import('./style/cache')
        const cachedStyle = getOwnProfile(config.userId)
        if (cachedStyle) {
          const p = cachedStyle.profile
          styleBlock = `\n\nСТИЛЬ ВЛАДЕЛЬЦА (пиши именно так):\n${p.styleInstruction}\nХарактерные фразы: ${(p.commonPhrases || []).join(', ')}\nДлина сообщений: ~${p.avgMessageLength} символов\nЭмодзи: ${p.emojiFrequency}\nРегистр: ${p.capitalization}`
        }
      }
    } catch {}

    // Phase 5: Inject active goal into auto-reply
    let goalBlock = ''
    try {
      const { getActiveGoal } = await import('./goals')
      const goal = getActiveGoal(config.userId, chatId)
      if (goal) {
        goalBlock = `\n\nАКТИВНАЯ ЦЕЛЬ: "${goal.goal}". Стратегия: "${goal.strategy}". Отвечай так, чтобы продвигать эту цель.`
      }
    } catch {}

    // Check if reply is actually needed (skip "ok", "👍", thanks, etc.)
    const lastMsg = messageContent.trim().toLowerCase()
    const noReplyPatterns = /^(ок|ok|ладно|хорошо|понял|спасибо|спс|пасиб|ага|угу|да|👍|👌|🤝|✅|❤️|💪|🔥|😊|😄|😂|🙏|👏|👋|лайк|круто|класс|супер|отлично|ясно|принято|получил|увидел|записал)$/i
    if (noReplyPatterns.test(lastMsg) || lastMsg.length <= 2) {
      continue // No need to reply to acknowledgements
    }

    // For ambiguous messages, ask LLM if reply is needed
    if (lastMsg.length < 30) {
      try {
        const { getModelConfig } = await import('./model-router')
        const classConfig = getModelConfig('classification')
        const needsReply = await chatCompletion({
          model: classConfig.model,
          messages: [
            { role: 'system', content: 'Определи, требует ли последнее сообщение в чате ответа. Если это подтверждение, одобрение, завершение разговора, стикер, реакция — ответ НЕ нужен. Если вопрос, просьба, новая тема — ответ нужен. Верни ТОЛЬКО одно слово: YES или NO.' },
            { role: 'user', content: `Последние сообщения:\n${history.slice(-3).map(m => `${m.senderName}: ${m.content}`).join('\n')}` },
          ],
          temperature: 0.1,
          maxTokens: 5,
        })
        if (needsReply.trim().toUpperCase().startsWith('NO')) {
          continue
        }
      } catch {}
    }

    // Use text_reply skill for auto-responses
    // For auto mode, use a generic conversational prompt instead of the agent's
    // skill-specific system prompt (which may contain instructions like "generate 3 variants")
    const autoSystemPrompt = `You are a helpful chat assistant that responds naturally in conversations. Write a single, natural reply to the last message. Keep it concise (1-3 sentences). Match the conversation language and tone.`
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(autoSystemPrompt, ownerUser.displayName) + styleBlock + goalBlock },
      ...history.map((msg) => ({
        role: (msg.senderId === config.userId ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.senderId === config.userId ? msg.content : `${msg.senderName}: ${msg.content}`,
      })),
    ]

    const typingDelay = calculateTypingDelay(messageContent.length)
    broadcastToChat(chatId, {
      type: 'typing',
      userId: config.userId,
      username: ownerUser.displayName,
    })
    await new Promise((r) => setTimeout(r, typingDelay))

    try {
      const response = await chatCompletion({
        model: agent.model,
        messages,
        temperature: agent.temperature ?? 0.7,
        maxTokens: agent.maxTokens ?? 2048,
      })

      if (!response.trim()) return

      let cleanedResponse = response.trim()
      const namePrefix = `${ownerUser.displayName}:`
      if (cleanedResponse.startsWith(namePrefix)) {
        cleanedResponse = cleanedResponse.slice(namePrefix.length).trim()
      }
      cleanedResponse = cleanedResponse.replace(/^[A-Za-zА-Яа-яЁё]+:\s*/u, (match) => {
        const prefix = match.replace(/:\s*$/, '').trim()
        if (prefix.toLowerCase() === ownerUser.displayName.toLowerCase() ||
            prefix.toLowerCase() === ownerUser.displayName.split(' ')[0]?.toLowerCase()) {
          return ''
        }
        return match
      })

      const messageId = crypto.randomUUID()
      db.insert(schema.messages).values({
        id: messageId,
        chatId,
        senderId: config.userId,
        content: await encrypt(cleanedResponse),
        type: 'text',
        status: 'sent',
      }).run()

      broadcastToChat(chatId, {
        type: 'new_message',
        message: {
          id: messageId,
          chatId,
          senderId: config.userId,
          senderName: ownerUser.displayName,
          senderAvatar: ownerUser.avatar,
          content: cleanedResponse, // plaintext for WebSocket
          type: 'text',
          status: 'sent',
          createdAt: new Date(),
        },
      })

      // Track usage
      trackUsage({
        userId: config.userId,
        agentId: agent.id,
        skillId: 'text_reply',
        skillName: 'Text Reply',
        cost: 1,
        chatId,
      })
    } catch (error) {
      console.error('Agent response error:', error)
    }
  }
}

function getTimeContext(): string {
  const now = new Date()
  const hour = now.getHours()
  const minutes = now.getMinutes()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const day = dayNames[now.getDay()]
  let timeOfDay = 'daytime'
  let greeting = ''
  if (hour >= 0 && hour < 6) { timeOfDay = 'late night / early morning'; greeting = 'People usually don\'t greet at this hour, they just continue chatting or say something casual' }
  else if (hour >= 6 && hour < 12) { timeOfDay = 'morning'; greeting = 'A morning greeting if appropriate would be доброе утро / good morning style' }
  else if (hour >= 12 && hour < 17) { timeOfDay = 'afternoon'; greeting = 'An afternoon greeting if appropriate would be добрый день / hey style' }
  else if (hour >= 17 && hour < 22) { timeOfDay = 'evening'; greeting = 'An evening greeting if appropriate would be добрый вечер / привет style' }
  else { timeOfDay = 'late evening'; greeting = 'Late night — keep it relaxed, no formal greetings needed' }
  return `\nCURRENT TIME CONTEXT:\n- It is ${day}, ${hour}:${minutes.toString().padStart(2, '0')} (${timeOfDay})\n- ${greeting}\n- IMPORTANT: Do NOT greet if the conversation is already ongoing — only greet if this is the first exchange. Never repeat greetings that were already said. Read the chat history to understand context.`
}

function buildSystemPrompt(agentPrompt: string, ownerName: string): string {
  return `${agentPrompt}

IMPORTANT CONTEXT:
- You are responding as ${ownerName} in a private messaging conversation.
- Your responses should sound natural, like a real person chatting.
- Do NOT reveal that you are an AI or agent.
- Keep responses concise and conversational.
- Match the tone and style of the conversation.
- NEVER start your message with your name or "${ownerName}:". Just write the message directly.
- Do NOT just say "привет" or a generic greeting — respond meaningfully to what the other person said.${getTimeContext()}`
}

function checkTrigger(mode: string, content: string, agentName: string): boolean {
  switch (mode) {
    case 'auto': return true
    case 'mention': return content.toLowerCase().includes(`@${agentName.toLowerCase()}`)
    case 'command': return content.startsWith('/')
    default: return true
  }
}

function calculateTypingDelay(messageLength: number): number {
  const baseDelay = 1000
  const charsPerSecond = 40 + Math.random() * 40
  const typingTime = (messageLength / charsPerSecond) * 1000
  const randomJitter = Math.random() * 2000
  return Math.min(baseDelay + typingTime + randomJitter, 8000)
}
