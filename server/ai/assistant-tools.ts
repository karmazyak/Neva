import { db, schema } from '../db'
import { eq, and, like, desc, sql } from 'drizzle-orm'
import { broadcastToChat } from '../ws'
import type { ToolDefinition } from './openrouter'
import { sanitizeForAi } from './security'
import { analyzeStyle } from './style/analyzer'
import { generateStyledReply } from './style/generator'
import { getCachedProfile, saveProfileToCache } from './style/cache'
import { getPresetById, getPresetAsFullProfile } from './style/presets'
import { decrypt, encrypt } from '../security/encryption'
import { logDataAccess } from '../security/audit'

// ── Tool definitions for OpenAI function calling format ──

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_chats',
      description: 'Get list of user\'s chats with names, types, and last message. Use when user asks about their chats, wants to find a specific chat, or you need to find the right chat to send a message to.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chat_history',
      description: 'Get recent messages from a specific chat. Use to read conversation context before drafting a reply, or when user asks what was discussed.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Chat ID to get history from' },
          limit: { type: 'number', description: 'Number of messages to fetch (default 20, max 50)' },
        },
        required: ['chatId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_messages',
      description: 'Search through user\'s messages by keyword or phrase. Use when user asks to find specific information, agreements, links, or past discussions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — keyword or phrase to find in messages' },
          chatId: { type: 'string', description: 'Optional: limit search to a specific chat' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contacts',
      description: 'Get user\'s contacts with online status. Use when user asks who is online, or needs to find a person.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_message',
      description: 'Prepare a message draft for a chat. This does NOT send the message — it returns a preview for user confirmation. Always use this before sending.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Chat ID to send the message to' },
          content: { type: 'string', description: 'Message text to send' },
        },
        required: ['chatId', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chat_stats',
      description: 'Get messaging statistics: total messages, active chats, top contacts. Use when user asks about stats or activity.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Period in days (default 7)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information, images, memes, articles, links. Returns search results with titles, snippets, and URLs. Use when user asks to find something online.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_channels',
      description: 'Search for messages in messenger channels only. Use to find news, announcements, or content in channels that can be forwarded to friends. Returns messageId for forwarding.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results (default 5, max 20)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forward_message',
      description: 'Forward a specific message to another chat. Use the messageId from search_channels or get_chat_history results.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'ID of the message to forward' },
          targetChatId: { type: 'string', description: 'Chat ID to forward the message to' },
        },
        required: ['messageId', 'targetChatId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_writing_style',
      description: 'Analyze a person\'s writing style from their messages. IMPORTANT: When user says "в моём стиле" or "write like me" — use THEIR userId as targetUserId (provided in system prompt). When user says "write like Gabe" — use Gabe\'s userId. If chatId is omitted, analyzes across ALL chats (recommended).',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Optional: specific chat to analyze. If omitted, analyzes across all chats (better quality).' },
          targetUserId: { type: 'string', description: 'User ID whose style to analyze. IMPORTANT: For "my style" use the current user\'s own userId from the system prompt.' },
        },
        required: ['targetUserId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_styled_reply',
      description: 'Generate a reply matching a writing style. IMPORTANT: When user says "напиши в моём стиле" — use the current user\'s own userId as targetUserId (from system prompt), NOT the recipient\'s. When user says "write like Gabe" — use Gabe\'s userId. If no targetUserId and no presetId — defaults to user\'s own style.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Chat ID to generate reply for (uses chat history as context)' },
          targetUserId: { type: 'string', description: 'User ID whose style to mimic. For "my style" — use the current user\'s own userId from system prompt.' },
          presetId: { type: 'string', description: 'Preset style ID instead of targetUserId. Options: casual_friendly, business_concise, ironic_witty, warm_empathetic, laconic_reserved' },
          intent: { type: 'string', description: 'What the reply should convey (e.g., "agree to meet tomorrow", "decline politely")' },
        },
        required: ['chatId'],
      },
    },
  },
]

// Autopilot-only tools (replace draft_message with send_message + wait_for_reply)
const AUTOPILOT_EXTRA_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a message immediately to a chat without user confirmation. Only available in autopilot mode. Use this instead of draft_message.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Chat ID to send the message to' },
          content: { type: 'string', description: 'Message text to send' },
        },
        required: ['chatId', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for_reply',
      description: 'Wait for a new reply in the specified chat. Use after sending a message to wait for the other person to respond. Returns new messages once they arrive or timeout.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Chat ID to watch for new messages' },
          timeoutSeconds: { type: 'number', description: 'Max wait time in seconds (default 60, max 120)' },
        },
        required: ['chatId'],
      },
    },
  },
]

// Build autopilot tool set: all tools minus draft_message, plus send_message + wait_for_reply
export const AUTOPILOT_TOOLS: ToolDefinition[] = [
  ...ASSISTANT_TOOLS.filter(t => t.function.name !== 'draft_message'),
  ...AUTOPILOT_EXTRA_TOOLS,
]

// ── Tool execution ──

export interface ToolContext {
  userId: string
  dataMasking?: boolean
  autopilot?: boolean
  ip?: string
}

export interface AutopilotEvent {
  type: 'message_sent' | 'waiting_reply' | 'reply_received' | 'task_complete' | 'task_failed'
  chatName?: string
  content?: string
  timestamp: string
}

export interface PendingAction {
  id: string
  type: 'send_message'
  chatId: string
  chatName: string
  content: string
}

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  ctx: ToolContext
): Promise<{ result: string; pendingAction?: PendingAction; autopilotEvent?: AutopilotEvent }> {
  const mask = ctx.dataMasking ?? true
  switch (toolName) {
    case 'get_my_chats':
      return { result: await getMyChats(ctx.userId, mask, ctx.ip) }
    case 'get_chat_history':
      return { result: await getChatHistory(ctx.userId, args.chatId, args.limit, mask, ctx.ip) }
    case 'search_messages':
      return { result: await searchMessages(ctx.userId, args.query, args.chatId, args.limit, mask, ctx.ip) }
    case 'get_contacts':
      return { result: await getContacts(ctx.userId, ctx.ip) }
    case 'draft_message':
      return await draftMessage(ctx.userId, args.chatId, args.content)
    case 'get_chat_stats':
      return { result: await getChatStats(ctx.userId, args.days) }
    case 'web_search':
      return { result: await webSearch(args.query, args.count) }
    case 'search_channels':
      return { result: await searchChannels(ctx.userId, args.query, args.count, mask) }
    case 'forward_message':
      return await forwardMessageTool(ctx.userId, args.messageId, args.targetChatId)
    case 'analyze_writing_style':
      return { result: await analyzeWritingStyleTool(ctx.userId, args.chatId, args.targetUserId) }
    case 'generate_styled_reply':
      return { result: await generateStyledReplyTool(ctx.userId, args.chatId, args.targetUserId, args.presetId, args.intent) }
    case 'send_message':
      if (!ctx.autopilot) return { result: 'send_message доступен только в режиме автопилота. Используй draft_message.' }
      return await sendMessageDirect(ctx.userId, args.chatId, args.content)
    case 'wait_for_reply':
      if (!ctx.autopilot) return { result: 'wait_for_reply доступен только в режиме автопилота.' }
      return await waitForReply(ctx.userId, args.chatId, args.timeoutSeconds, mask)
    default:
      return { result: `Unknown tool: ${toolName}` }
  }
}

// ── Tool implementations ──

async function getMyChats(userId: string, mask: boolean = true, ip?: string): Promise<string> {
  logDataAccess({ userId, accessorType: 'ai', action: 'get_my_chats', resourceType: 'all_chats', ip })
  const memberships = db.select({
    chatId: schema.chatMembers.chatId,
    chat: schema.chats,
  })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(eq(schema.chatMembers.userId, userId))
    .all()

  if (memberships.length === 0) return 'У вас пока нет чатов.'

  const results = await Promise.all(memberships.map(async ({ chatId, chat }) => {
    // Get last message
    const lastMsg = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      createdAt: schema.messages.createdAt,
    })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal')
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1)
      .get()

    // For private chats, get the other person's name
    let chatName = chat.name || 'Unnamed'
    if (chat.type === 'private') {
      const otherMember = db.select({ displayName: schema.users.displayName })
        .from(schema.chatMembers)
        .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
        .where(and(
          eq(schema.chatMembers.chatId, chatId),
          sql`${schema.chatMembers.userId} != ${userId}`
        ))
        .get()
      if (otherMember) chatName = otherMember.displayName
    }

    const rawContent = lastMsg ? await decrypt(lastMsg.content) : ''
    const msgContent = rawContent ? sanitizeForAi(rawContent, mask) : ''
    const lastMsgText = lastMsg
      ? `${lastMsg.senderName}: ${msgContent.slice(0, 80)}${msgContent.length > 80 ? '...' : ''}`
      : 'Нет сообщений'

    return `- [${chat.type}] "${chatName}" (id: ${chatId}) — ${lastMsgText}`
  }))

  return `Ваши чаты (${results.length}):\n${results.join('\n')}`
}

async function getChatHistory(userId: string, chatId: string, limit?: number, mask: boolean = true, ip?: string): Promise<string> {
  // Verify user is member of this chat
  const membership = db.select()
    .from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    ))
    .get()

  if (!membership) return 'У вас нет доступа к этому чату.'

  // Audit: AI agent is reading chat history
  logDataAccess({ userId, accessorType: 'ai', action: 'get_chat_history', resourceType: 'chat_history', resourceId: chatId, ip })

  const maxLimit = Math.min(limit || 20, 50)
  const messages = db.select({
    content: schema.messages.content,
    senderName: schema.users.displayName,
    createdAt: schema.messages.createdAt,
    type: schema.messages.type,
  })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(
      eq(schema.messages.chatId, chatId),
      eq(schema.messages.visibility, 'normal')
    ))
    .orderBy(desc(schema.messages.createdAt))
    .limit(maxLimit)
    .all()
    .reverse()

  if (messages.length === 0) return 'В этом чате пока нет сообщений.'

  const lines = await Promise.all(messages.map(async (msg) => {
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU') : ''
    const plainContent = await decrypt(msg.content)
    return `[${time}] ${msg.senderName}: ${sanitizeForAi(plainContent, mask)}`
  }))

  return `Последние ${messages.length} сообщений:\n${lines.join('\n')}`
}

async function searchMessages(
  userId: string,
  query: string,
  chatId?: string,
  limit?: number,
  mask: boolean = true,
  ip?: string
): Promise<string> {
  const maxLimit = Math.min(limit || 20, 50)

  // Get user's chat IDs for access control
  const userChats = db.select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.userId, userId))
    .all()
    .map(c => c.chatId)

  if (userChats.length === 0) return 'У вас нет чатов для поиска.'

  // Audit: AI agent is searching messages
  logDataAccess({ userId, accessorType: 'ai', action: 'search_messages', resourceType: 'message_search', resourceId: chatId || 'all', ip })

  // Fetch candidates from DB (no content filter — ciphertext can't be searched with LIKE)
  let candidates
  if (chatId && userChats.includes(chatId)) {
    candidates = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      chatId: schema.messages.chatId,
      createdAt: schema.messages.createdAt,
    })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal'),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .all()
  } else {
    candidates = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      chatId: schema.messages.chatId,
      createdAt: schema.messages.createdAt,
    })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(
        eq(schema.messages.visibility, 'normal'),
        sql`${schema.messages.chatId} IN (${sql.join(userChats.map(id => sql`${id}`), sql`, `)})`
      ))
      .orderBy(desc(schema.messages.createdAt))
      .all()
  }

  // Decrypt all candidates then filter in-memory
  const queryLower = query.toLowerCase()
  const decrypted = await Promise.all(candidates.map(async (msg) => ({
    ...msg,
    content: await decrypt(msg.content),
  })))
  const results = decrypted
    .filter(msg => msg.content.toLowerCase().includes(queryLower))
    .slice(0, maxLimit)

  if (results.length === 0) return `Ничего не найдено по запросу "${query}".`

  const lines = results.map((msg) => {
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU') : ''
    const content = sanitizeForAi(msg.content, mask)
    return `[${time}] ${msg.senderName} (chat: ${msg.chatId}): ${content.slice(0, 200)}`
  })

  return `Найдено ${results.length} сообщений по запросу "${query}":\n${lines.join('\n')}`
}

async function getContacts(userId: string, ip?: string): Promise<string> {
  logDataAccess({ userId, accessorType: 'ai', action: 'get_contacts', resourceType: 'contacts', ip })
  // Get all users the user has chats with
  const userChats = db.select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.userId, userId))
    .all()
    .map(c => c.chatId)

  if (userChats.length === 0) return 'У вас пока нет контактов.'

  const contactIds = new Set<string>()
  for (const chatId of userChats) {
    const members = db.select({ userId: schema.chatMembers.userId })
      .from(schema.chatMembers)
      .where(eq(schema.chatMembers.chatId, chatId))
      .all()
    for (const m of members) {
      if (m.userId !== userId) contactIds.add(m.userId)
    }
  }

  if (contactIds.size === 0) return 'У вас пока нет контактов.'

  const contacts = Array.from(contactIds).map(id => {
    const user = db.select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .get()
    if (!user) return null
    const status = user.online ? '🟢 online' : '⚫ offline'
    return `- ${user.displayName} (@${user.username}) — ${status}`
  }).filter(Boolean)

  return `Ваши контакты (${contacts.length}):\n${contacts.join('\n')}`
}

async function draftMessage(
  userId: string,
  chatId: string,
  content: string
): Promise<{ result: string; pendingAction?: PendingAction }> {
  // Verify access
  const membership = db.select()
    .from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    ))
    .get()

  if (!membership) return { result: 'У вас нет доступа к этому чату.' }

  // Get chat name
  const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
  let chatName = chat?.name || 'Unnamed'
  if (chat?.type === 'private') {
    const otherMember = db.select({ displayName: schema.users.displayName })
      .from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(and(
        eq(schema.chatMembers.chatId, chatId),
        sql`${schema.chatMembers.userId} != ${userId}`
      ))
      .get()
    if (otherMember) chatName = otherMember.displayName
  }

  const actionId = crypto.randomUUID()
  return {
    result: `Черновик подготовлен для чата "${chatName}": "${content}". Ожидаю подтверждения от пользователя.`,
    pendingAction: {
      id: actionId,
      type: 'send_message',
      chatId,
      chatName,
      content,
    },
  }
}

// Actually send a confirmed message
export async function sendConfirmedMessage(userId: string, chatId: string, content: string): Promise<boolean> {
  const membership = db.select()
    .from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    ))
    .get()

  if (!membership) return false

  const messageId = crypto.randomUUID()
  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  const encryptedContent = await encrypt(content)

  db.insert(schema.messages).values({
    id: messageId,
    chatId,
    senderId: userId,
    content: encryptedContent,
    type: 'text',
    status: 'sent',
    visibility: 'normal',
  }).run()

  broadcastToChat(chatId, {
    type: 'new_message',
    message: {
      id: messageId,
      chatId,
      senderId: userId,
      senderName: sender?.displayName || 'Unknown',
      senderAvatar: sender?.avatar || null,
      content, // plaintext for WebSocket broadcast
      type: 'text',
      status: 'sent',
      createdAt: new Date(),
    },
  })

  return true
}

async function getChatStats(userId: string, days?: number): Promise<string> {
  const period = days || 7
  const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000)

  // Get user's chats
  const userChats = db.select({ chatId: schema.chatMembers.chatId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.userId, userId))
    .all()
    .map(c => c.chatId)

  if (userChats.length === 0) return 'Нет данных для статистики.'

  // Count messages sent by user
  const sentCount = db.select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.senderId, userId),
      sql`${schema.messages.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .get()

  // Count messages received
  const receivedCount = db.select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(and(
      sql`${schema.messages.senderId} != ${userId}`,
      sql`${schema.messages.chatId} IN (${sql.join(userChats.map(id => sql`${id}`), sql`, `)})`,
      sql`${schema.messages.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .get()

  // Top contacts by message count
  const topContacts = db.select({
    senderName: schema.users.displayName,
    count: sql<number>`count(*)`,
  })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(
      sql`${schema.messages.senderId} != ${userId}`,
      sql`${schema.messages.chatId} IN (${sql.join(userChats.map(id => sql`${id}`), sql`, `)})`,
      sql`${schema.messages.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .groupBy(schema.messages.senderId)
    .orderBy(desc(sql`count(*)`))
    .limit(5)
    .all()

  const topList = topContacts.map((c, i) => `  ${i + 1}. ${c.senderName} — ${c.count} сообщений`).join('\n')

  return `Статистика за ${period} дней:
- Отправлено сообщений: ${sentCount?.count || 0}
- Получено сообщений: ${receivedCount?.count || 0}
- Активных чатов: ${userChats.length}
${topContacts.length > 0 ? `\nТоп контактов по активности:\n${topList}` : ''}`
}

// ── Web Search ──

async function webSearch(query: string, count?: number): Promise<string> {
  const maxResults = Math.min(count || 5, 10)

  // Use DuckDuckGo Instant Answer API (no key needed)
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    )
    const data = await response.json()

    const results: string[] = []

    // Abstract (main answer)
    if (data.Abstract) {
      results.push(`${data.Heading || 'Result'}: ${data.Abstract}\n   ${data.AbstractURL || ''}`)
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text && topic.FirstURL) {
          results.push(`${topic.Text.slice(0, 200)}\n   ${topic.FirstURL}`)
        }
      }
    }

    // If DuckDuckGo returned nothing useful, do a basic web scrape approach
    if (results.length === 0) {
      // Fallback: use DuckDuckGo HTML search
      const htmlResponse = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MLSendger/1.0)' } }
      )
      const html = await htmlResponse.text()

      // Parse simple results from HTML
      const linkMatches = html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)
      const snippetMatches = html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)
      const links = [...linkMatches].slice(0, maxResults)
      const snippets = [...snippetMatches].slice(0, maxResults)

      for (let i = 0; i < links.length; i++) {
        const title = links[i][2].replace(/<[^>]*>/g, '').trim()
        const url = links[i][1]
        const snippet = snippets[i]?.[1]?.replace(/<[^>]*>/g, '').trim() || ''
        results.push(`${i + 1}. ${title}\n   ${url}\n   ${snippet}`)
      }
    }

    if (results.length === 0) {
      return `Поиск по запросу "${query}" не дал результатов. Попробуй другие ключевые слова.`
    }

    return `Результаты поиска "${query}":\n\n${results.slice(0, maxResults).map((r, i) => `${i + 1}. ${r}`).join('\n\n')}`
  } catch (err: any) {
    return `Ошибка поиска: ${err.message}. Попробуй позже.`
  }
}

// ── Autopilot: Direct message send ──

async function sendMessageDirect(
  userId: string,
  chatId: string,
  content: string
): Promise<{ result: string; autopilotEvent?: AutopilotEvent }> {
  // Get chat name
  const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
  let chatName = chat?.name || 'Unknown'
  if (chat?.type === 'private') {
    const otherMember = db.select({ displayName: schema.users.displayName })
      .from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(and(
        eq(schema.chatMembers.chatId, chatId),
        sql`${schema.chatMembers.userId} != ${userId}`
      ))
      .get()
    if (otherMember) chatName = otherMember.displayName
  }

  const success = await sendConfirmedMessage(userId, chatId, content)
  if (!success) {
    return {
      result: `Не удалось отправить сообщение в "${chatName}". Нет доступа к чату.`,
      autopilotEvent: {
        type: 'task_failed',
        chatName,
        content: 'Нет доступа к чату',
        timestamp: new Date().toISOString(),
      },
    }
  }

  return {
    result: `Сообщение отправлено в "${chatName}": "${content}"`,
    autopilotEvent: {
      type: 'message_sent',
      chatName,
      content,
      timestamp: new Date().toISOString(),
    },
  }
}

// ── Autopilot: Wait for reply ──

async function waitForReply(
  userId: string,
  chatId: string,
  timeoutSeconds?: number,
  mask: boolean = true
): Promise<{ result: string; autopilotEvent?: AutopilotEvent }> {
  const timeout = Math.min(timeoutSeconds || 60, 120) * 1000
  const startTime = Date.now()
  const markerTime = Math.floor(Date.now() / 1000)

  // Get chat name
  const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
  let chatName = chat?.name || 'Unknown'
  if (chat?.type === 'private') {
    const otherMember = db.select({ displayName: schema.users.displayName })
      .from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(and(
        eq(schema.chatMembers.chatId, chatId),
        sql`${schema.chatMembers.userId} != ${userId}`
      ))
      .get()
    if (otherMember) chatName = otherMember.displayName
  }

  while (Date.now() - startTime < timeout) {
    await new Promise(r => setTimeout(r, 2000)) // poll every 2s

    const newMessages = db.select({
      content: schema.messages.content,
      senderName: schema.users.displayName,
      createdAt: schema.messages.createdAt,
    })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal'),
        sql`${schema.messages.senderId} != ${userId}`,
        sql`${schema.messages.createdAt} > ${markerTime}`
      ))
      .orderBy(schema.messages.createdAt)
      .all()

    if (newMessages.length > 0) {
      const decryptedReplies = await Promise.all(newMessages.map(async m => ({
        ...m,
        content: await decrypt(m.content),
      })))
      const replyText = decryptedReplies
        .map(m => `${m.senderName}: ${sanitizeForAi(m.content, mask)}`)
        .join('\n')
      const lastContent = decryptedReplies[decryptedReplies.length - 1].content

      return {
        result: `Получены новые сообщения в "${chatName}":\n${replyText}`,
        autopilotEvent: {
          type: 'reply_received',
          chatName,
          content: lastContent.slice(0, 100),
          timestamp: new Date().toISOString(),
        },
      }
    }
  }

  return {
    result: `Время ожидания ответа в "${chatName}" истекло (${Math.round(timeout / 1000)}с). Можешь продолжить другие задачи или подождать ещё.`,
    autopilotEvent: {
      type: 'task_failed',
      chatName,
      content: 'Timeout — нет ответа',
      timestamp: new Date().toISOString(),
    },
  }
}

// ── Search Channels ──

async function searchChannels(userId: string, query: string, count?: number, mask: boolean = true): Promise<string> {
  const maxResults = Math.min(count || 5, 20)

  // Get channel IDs user has access to
  const userChannels = db.select({
    chatId: schema.chatMembers.chatId,
    chatName: schema.chats.name,
  })
    .from(schema.chatMembers)
    .innerJoin(schema.chats, eq(schema.chatMembers.chatId, schema.chats.id))
    .where(and(
      eq(schema.chatMembers.userId, userId),
      eq(schema.chats.type, 'channel')
    ))
    .all()

  if (userChannels.length === 0) return 'У вас нет доступных каналов.'

  const channelIds = userChannels.map(c => c.chatId)
  // Fetch all channel messages then decrypt + filter in-memory (LIKE can't search ciphertext)
  const candidates = db.select({
    id: schema.messages.id,
    content: schema.messages.content,
    senderName: schema.users.displayName,
    chatId: schema.messages.chatId,
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(and(
      eq(schema.messages.visibility, 'normal'),
      sql`${schema.messages.chatId} IN (${sql.join(channelIds.map(id => sql`${id}`), sql`, `)})`
    ))
    .orderBy(desc(schema.messages.createdAt))
    .all()

  const queryLower = query.toLowerCase()
  const decrypted = await Promise.all(candidates.map(async msg => ({
    ...msg,
    content: await decrypt(msg.content),
  })))
  const results = decrypted
    .filter(msg => msg.content.toLowerCase().includes(queryLower))
    .slice(0, maxResults)

  if (results.length === 0) return `В каналах ничего не найдено по запросу "${query}".`

  const channelNameMap = Object.fromEntries(userChannels.map(c => [c.chatId, c.chatName]))

  const lines = results.map((msg) => {
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU') : ''
    const content = sanitizeForAi(msg.content, mask)
    const channelName = channelNameMap[msg.chatId] || 'Unknown'
    return `- [${time}] #${channelName} | ${msg.senderName}: ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}\n  messageId: ${msg.id}`
  })

  return `Найдено ${results.length} сообщений в каналах по запросу "${query}":\n\n${lines.join('\n\n')}`
}

// ── Forward Message Tool ──

async function forwardMessageTool(
  userId: string,
  messageId: string,
  targetChatId: string
): Promise<{ result: string; autopilotEvent?: AutopilotEvent }> {
  // Get original message
  const original = db.select({
    msg: schema.messages,
    senderName: schema.users.displayName,
  })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
    .where(eq(schema.messages.id, messageId))
    .get()

  if (!original) return { result: 'Сообщение не найдено.' }

  // Check access to source
  const sourceMember = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, original.msg.chatId), eq(schema.chatMembers.userId, userId))).get()
  if (!sourceMember) return { result: 'Нет доступа к исходному чату.' }

  // Check access to target
  const targetMember = db.select().from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.chatId, targetChatId), eq(schema.chatMembers.userId, userId))).get()
  if (!targetMember) return { result: 'Нет доступа к целевому чату.' }

  // Get chat names
  const sourceChat = db.select().from(schema.chats).where(eq(schema.chats.id, original.msg.chatId)).get()
  const targetChat = db.select().from(schema.chats).where(eq(schema.chats.id, targetChatId)).get()
  let sourceChatName = sourceChat?.name || 'Unknown'
  let targetChatName = targetChat?.name || 'Unknown'

  if (targetChat?.type === 'private') {
    const other = db.select({ displayName: schema.users.displayName })
      .from(schema.chatMembers)
      .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
      .where(and(eq(schema.chatMembers.chatId, targetChatId), sql`${schema.chatMembers.userId} != ${userId}`)).get()
    if (other) targetChatName = other.displayName
  }

  // Create forwarded message
  const newMsgId = crypto.randomUUID()
  const sender = db.select({ displayName: schema.users.displayName, avatar: schema.users.avatar })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  const forwardedFrom = {
    chatId: original.msg.chatId,
    chatName: sourceChatName,
    senderName: original.senderName,
  }

  // Decrypt source, re-encrypt for the new record
  const srcPlain = await decrypt(original.msg.content)
  const srcEncrypted = await encrypt(srcPlain)

  db.insert(schema.messages).values({
    id: newMsgId,
    chatId: targetChatId,
    senderId: userId,
    content: srcEncrypted,
    type: original.msg.type || 'text',
    status: 'sent',
    visibility: 'normal',
    forwardedFrom,
  }).run()

  broadcastToChat(targetChatId, {
    type: 'new_message',
    message: {
      id: newMsgId,
      chatId: targetChatId,
      senderId: userId,
      senderName: sender?.displayName || 'Unknown',
      senderAvatar: sender?.avatar || null,
      content: srcPlain, // plaintext for WebSocket broadcast
      type: original.msg.type || 'text',
      status: 'sent',
      forwardedFrom,
      createdAt: new Date(),
    },
  })

  return {
    result: `Сообщение переслано из "#${sourceChatName}" в "${targetChatName}".`,
    autopilotEvent: {
      type: 'message_sent',
      chatName: targetChatName,
      content: `Forwarded: ${original.msg.content.slice(0, 60)}...`,
      timestamp: new Date().toISOString(),
    },
  }
}

// ── Style Analysis Tool ──

async function analyzeWritingStyleTool(userId: string, chatId: string | undefined, targetUserId: string): Promise<string> {
  try {
    // Check cache — for self-analysis, use global context
    const isSelf = targetUserId === userId
    const cached = isSelf
      ? getCachedProfile(targetUserId, userId, undefined, 'global')
      : getCachedProfile(targetUserId, userId, chatId)
    if (cached) {
      const p = cached.profile
      return `Стиль ${p.sourceName} (из кеша, ${p.messageCount} сообщений, ${p.confidence}):
- Тон: ${p.tone}
- Формальность: ${p.formality}
- Эмоциональность: ${p.emotionality}
- Юмор: ${p.humor}
- Характерные фразы: ${p.commonPhrases.join(', ')}
- Инструкция: ${p.styleInstruction}

Профиль готов к использованию в generate_styled_reply.`
    }

    const profile = await analyzeStyle(targetUserId, chatId || undefined)
    if (isSelf) {
      saveProfileToCache(targetUserId, userId, profile, undefined, 'global')
    } else {
      saveProfileToCache(targetUserId, userId, profile, chatId)
    }

    return `Стиль ${profile.sourceName} проанализирован (${profile.messageCount} сообщений, ${profile.confidence}):
- Тон: ${profile.tone}
- Формальность: ${profile.formality}
- Эмоциональность: ${profile.emotionality}
- Юмор: ${profile.humor}
- Характерные фразы: ${profile.commonPhrases.join(', ')}
- Инструкция: ${profile.styleInstruction}

Профиль сохранён. Используй generate_styled_reply для генерации ответов в этом стиле.`
  } catch (err: any) {
    return `Ошибка анализа стиля: ${err.message}`
  }
}

// ── Styled Reply Tool ──

async function generateStyledReplyTool(
  userId: string,
  chatId: string,
  targetUserId?: string,
  presetId?: string,
  intent?: string
): Promise<string> {
  try {
    let profile
    if (presetId) {
      const preset = getPresetById(presetId)
      if (!preset) return `Пресет "${presetId}" не найден. Доступные: casual_friendly, business_concise, ironic_witty, warm_empathetic, laconic_reserved`
      profile = getPresetAsFullProfile(preset, userId)
    } else {
      // If no targetUserId specified, default to user's own style
      const effectiveTarget = targetUserId || userId
      const isSelf = effectiveTarget === userId
      const cached = isSelf
        ? getCachedProfile(effectiveTarget, userId, undefined, 'global')
        : getCachedProfile(effectiveTarget, userId, chatId)
      if (cached) {
        profile = cached.profile
      } else {
        profile = await analyzeStyle(effectiveTarget, isSelf ? undefined : chatId)
        if (isSelf) {
          saveProfileToCache(effectiveTarget, userId, profile, undefined, 'global')
        } else {
          saveProfileToCache(effectiveTarget, userId, profile, chatId)
        }
      }
    }

    // Load chat history
    const chatHistory = db.select({
      senderId: schema.messages.senderId,
      content: schema.messages.content,
    })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal'),
        eq(schema.messages.type, 'text'),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20)
      .all()
      .reverse()
      .map(msg => ({
        role: (msg.senderId === userId ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.content,
      }))

    const reply = await generateStyledReply({
      profile,
      chatHistory,
      intent,
    })

    return `Ответ в стиле ${profile.sourceName}: "${reply}"`
  } catch (err: any) {
    return `Ошибка генерации: ${err.message}`
  }
}
