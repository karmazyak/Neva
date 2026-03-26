import { db, schema } from '../../db'
import { eq, and, desc } from 'drizzle-orm'
import { chatCompletion } from '../openrouter'
import { decrypt } from '../../security/encryption'

export interface StyleProfile {
  sourceUserId: string
  sourceName: string
  messageCount: number
  confidence: 'low' | 'medium' | 'high'

  language: string
  avgMessageLength: number
  sentencesPerMessage: number

  tone: string
  formality: 'very_casual' | 'casual' | 'neutral' | 'formal' | 'very_formal'
  emotionality: 'reserved' | 'moderate' | 'expressive'
  humor: 'none' | 'rare' | 'frequent' | 'constant'

  usesEmoji: boolean
  emojiFrequency: string
  usesSlang: boolean
  commonPhrases: string[]
  punctuationStyle: string
  capitalization: string
  typoFrequency: string

  fewShotExamples: Array<{
    context?: string
    response: string
  }>

  styleInstruction: string
}

const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu

function computeMetrics(messages: string[]) {
  const lengths = messages.map(m => m.length)
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length

  const emojiCounts = messages.map(m => (m.match(EMOJI_REGEX) || []).length)
  const totalEmojis = emojiCounts.reduce((a, b) => a + b, 0)
  const emojiRatio = totalEmojis / messages.length

  const lowerCount = messages.filter(m => m === m.toLowerCase()).length
  const upperCount = messages.filter(m => /[A-ZА-ЯЁ]{3,}/.test(m)).length
  const capsRatio = upperCount / messages.length
  const lowerRatio = lowerCount / messages.length

  let capitalization = 'стандарт'
  if (lowerRatio > 0.8) capitalization = 'строчные'
  else if (capsRatio > 0.2) capitalization = 'КАПС'

  let emojiFrequency = 'никогда'
  if (emojiRatio > 1) emojiFrequency = 'часто'
  else if (emojiRatio > 0.3) emojiFrequency = 'иногда'
  else if (emojiRatio > 0) emojiFrequency = 'редко'

  const sentencesPerMessage = messages.reduce((acc, m) => {
    const sentences = m.split(/[.!?]+/).filter(s => s.trim().length > 0)
    return acc + sentences.length
  }, 0) / messages.length

  return {
    avgLength: Math.round(avgLength),
    emojiFrequency,
    usesEmoji: totalEmojis > 0,
    capitalization,
    sentencesPerMessage: Math.round(sentencesPerMessage * 10) / 10,
  }
}

function selectCharacteristicMessages(
  messages: Array<{ content: string; context?: string }>,
  count: number
): Array<{ content: string; context?: string }> {
  if (messages.length <= count) return messages

  // Pick messages with varied lengths to capture range
  const sorted = [...messages].sort((a, b) => a.content.length - b.content.length)
  const step = Math.max(1, Math.floor(sorted.length / count))
  const selected: typeof messages = []

  for (let i = 0; i < sorted.length && selected.length < count; i += step) {
    selected.push(sorted[i])
  }

  return selected
}

const STYLE_ANALYSIS_PROMPT = `Ты — лингвистический аналитик. Проанализируй стиль общения человека по его сообщениям из мессенджера.

СООБЩЕНИЯ ЭТОГО ЧЕЛОВЕКА:
{messages}

Верни СТРОГО JSON (без markdown, без комментариев):
{
  "tone": "общий тон в 1-3 слова (например: ироничный и тёплый)",
  "formality": "very_casual | casual | neutral | formal | very_formal",
  "emotionality": "reserved | moderate | expressive",
  "humor": "none | rare | frequent | constant",
  "usesSlang": true/false,
  "commonPhrases": ["до 10 характерных оборотов/слов, которые этот человек повторяет"],
  "punctuationStyle": "описание использования знаков препинания (например: минимальная, без точек в конце)",
  "typoFrequency": "нет | редко | часто",
  "language": "ru | en | mixed",
  "fewShotExamples": [
    {"context": "предыдущее сообщение собеседника (если есть в данных)", "response": "характерный ответ этого человека"},
    ... (5 самых типичных примеров)
  ],
  "styleInstruction": "Инструкция для AI, как писать в стиле этого человека. 3-5 предложений. Описывай конкретные паттерны: длину сообщений, регистр, пунктуацию, любимые слова, тон, манеру реагировать."
}`

export async function analyzeStyle(
  targetUserId: string,
  chatId?: string,
  model: string = 'anthropic/claude-sonnet-4'
): Promise<StyleProfile> {
  // 1. Get user info
  const user = db.select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .get()

  if (!user) throw new Error(`User not found: ${targetUserId}`)

  // 2. Load messages
  const conditions = [
    eq(schema.messages.senderId, targetUserId),
    eq(schema.messages.type, 'text'),
    eq(schema.messages.visibility, 'normal'),
  ]
  if (chatId) conditions.push(eq(schema.messages.chatId, chatId))

  const rawMessages = db.select({
    content: schema.messages.content,
    chatId: schema.messages.chatId,
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .where(and(...conditions))
    .orderBy(desc(schema.messages.createdAt))
    .limit(200)
    .all()
    .reverse()

  if (rawMessages.length === 0) {
    throw new Error(`No messages found for user ${user.displayName}`)
  }

  // Decrypt all messages
  const decryptedMessages = await Promise.all(rawMessages.map(async m => ({
    ...m,
    content: await decrypt(m.content),
  })))

  const messageTexts = decryptedMessages.map(m => m.content)

  // 3. Compute metrics
  const metrics = computeMetrics(messageTexts)

  // 4. Get context (previous messages for few-shot) — use adjacent messages, no N+1
  const messagesWithContext: Array<{ content: string; context?: string }> = decryptedMessages.map((msg, i) => ({
    content: msg.content,
    context: i > 0 ? decryptedMessages[i - 1].content : undefined,
  }))

  // 5. Select characteristic messages for LLM analysis
  const selected = selectCharacteristicMessages(messagesWithContext, 80)
  const messagesForPrompt = selected
    .map((m, i) => {
      if (m.context) return `[${i + 1}] собеседник: ${m.context}\n    ${user.displayName}: ${m.content}`
      return `[${i + 1}] ${user.displayName}: ${m.content}`
    })
    .join('\n')

  // 6. LLM analysis
  const prompt = STYLE_ANALYSIS_PROMPT.replace('{messages}', messagesForPrompt)

  const response = await chatCompletion({
    model,
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    maxTokens: 2048,
  })

  // 7. Parse LLM response
  let llmAnalysis: any
  try {
    // Strip markdown code blocks if present
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    llmAnalysis = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`Failed to parse style analysis: ${response.slice(0, 200)}`)
  }

  // 8. Determine confidence
  const messageCount = rawMessages.length
  let confidence: 'low' | 'medium' | 'high' = 'low'
  if (messageCount >= 100) confidence = 'high'
  else if (messageCount >= 20) confidence = 'medium'

  // 9. Assemble StyleProfile
  const profile: StyleProfile = {
    sourceUserId: targetUserId,
    sourceName: user.displayName,
    messageCount,
    confidence,

    language: llmAnalysis.language || 'ru',
    avgMessageLength: metrics.avgLength,
    sentencesPerMessage: metrics.sentencesPerMessage,

    tone: llmAnalysis.tone || 'нейтральный',
    formality: llmAnalysis.formality || 'casual',
    emotionality: llmAnalysis.emotionality || 'moderate',
    humor: llmAnalysis.humor || 'rare',

    usesEmoji: metrics.usesEmoji,
    emojiFrequency: metrics.emojiFrequency,
    usesSlang: llmAnalysis.usesSlang ?? false,
    commonPhrases: (llmAnalysis.commonPhrases || []).slice(0, 10),
    punctuationStyle: llmAnalysis.punctuationStyle || 'стандартная',
    capitalization: metrics.capitalization,
    typoFrequency: llmAnalysis.typoFrequency || 'нет',

    fewShotExamples: (llmAnalysis.fewShotExamples || []).slice(0, 5),
    styleInstruction: llmAnalysis.styleInstruction || '',
  }

  return profile
}
