import type { StyleProfile } from './analyzer'
import { chatCompletion, type ChatMessage } from '../openrouter'

// Phrases that immediately reveal an AI bot
const BOT_BLACKLIST = [
  'на самом деле', 'кстати', 'о, круто', 'интересно', 'знаешь что',
  'это здорово', 'звучит классно', 'расскажи подробнее', 'как интересно',
  'я понимаю', 'безусловно', 'разумеется', 'в целом', 'в принципе',
  'actually', 'by the way', 'that\'s interesting', 'tell me more',
  'I understand', 'absolutely', 'certainly', 'indeed',
]

function buildStyleSystemPrompt(profile: StyleProfile, chatContext?: string): string {
  const fewShotBlock = profile.fewShotExamples.length > 0
    ? profile.fewShotExamples.map((ex, i) => {
        if (ex.context) return `собеседник: ${ex.context}\nты: ${ex.response}`
        return `ты: ${ex.response}`
      }).join('\n\n')
    : ''

  const blacklistBlock = BOT_BLACKLIST.slice(0, 15).map(p => `«${p}»`).join(', ')

  return `Ты — ${profile.sourceName}. Пиши сообщения ТОЧНО в стиле этого человека.

СТИЛЬ:
${profile.styleInstruction}

ХАРАКТЕРНЫЕ ФРАЗЫ И СЛОВА: ${profile.commonPhrases.join(', ')}

${fewShotBlock ? `ПРИМЕРЫ ТВОИХ СООБЩЕНИЙ (повторять дословно нельзя, но пиши в таком же духе):
${fewShotBlock}` : ''}

ПРАВИЛА:
– средняя длина сообщения: ~${profile.avgMessageLength} символов
– эмодзи: ${profile.emojiFrequency}
– регистр: ${profile.capitalization}
– пунктуация: ${profile.punctuationStyle}
– опечатки: ${profile.typoFrequency}
– одно сообщение = одна мысль, ${profile.sentencesPerMessage < 2 ? '1 предложение' : '1-2 предложения'}

ЗАПРЕЩЕНО (выдаёт бота):
– слова и обороты: ${blacklistBlock}
– ответы заметно длиннее ${Math.round(profile.avgMessageLength * 1.5)} символов
– резкая смена стиля
– объяснять свои чувства и мотивы
– начинать сообщение со своего имени`
}

export interface GenerateOptions {
  profile: StyleProfile
  chatHistory: ChatMessage[]
  intent?: string
  model?: string
  temperature?: number
  variants?: number
}

export async function generateStyledReply(options: GenerateOptions): Promise<string> {
  const {
    profile,
    chatHistory,
    intent,
    model = 'openai/gpt-4o-mini',
    temperature = 0.8,
  } = options

  const systemPrompt = buildStyleSystemPrompt(profile)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.filter(m => m.role !== 'system'),
  ]

  if (intent) {
    messages.push({
      role: 'user',
      content: `ВАЖНО — ответь ИМЕННО на эту тему: ${intent}

Не копируй содержание примеров. Пиши НОВОЕ сообщение на указанную тему, но в стиле ${profile.sourceName}.`,
    })
  }

  const response = await chatCompletion({
    model,
    messages,
    temperature,
    maxTokens: 300,
  })

  return cleanResponse(response, profile)
}

export async function generateStyledVariants(options: GenerateOptions): Promise<string[]> {
  const {
    profile,
    chatHistory,
    intent,
    model = 'openai/gpt-4o-mini',
    temperature = 0.85,
    variants = 3,
  } = options

  const systemPrompt = buildStyleSystemPrompt(profile)

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${systemPrompt}

ЗАДАЧА: Сгенерируй ${variants} разных варианта ответа. Каждый вариант — немного другой подход (но все в одном стиле). Раздели варианты строкой ---.
${intent ? `\nКРИТИЧЕСКИ ВАЖНО — каждый вариант должен быть ИМЕННО про: ${intent}\nНе копируй содержание примеров стиля. Пиши НОВЫЕ сообщения на указанную тему.` : ''}`,
    },
    ...chatHistory.filter(m => m.role !== 'system'),
  ]

  const response = await chatCompletion({
    model,
    messages,
    temperature,
    maxTokens: 1024,
  })

  const parsed = response
    .split(/---+/)
    .map(v => cleanResponse(v.trim(), profile))
    .filter(v => v.length > 0)

  return parsed.length > 0 ? parsed : [cleanResponse(response, profile)]
}

function cleanResponse(text: string, profile: StyleProfile): string {
  let cleaned = text.trim()

  // Remove name prefix if model adds it
  const namePrefix = `${profile.sourceName}:`
  if (cleaned.startsWith(namePrefix)) {
    cleaned = cleaned.slice(namePrefix.length).trim()
  }

  // Remove quotes that LLM sometimes wraps responses in
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith('«') && cleaned.endsWith('»'))) {
    cleaned = cleaned.slice(1, -1)
  }

  // Enforce capitalization style
  if (profile.capitalization === 'строчные' && cleaned.length > 0) {
    cleaned = cleaned[0].toLowerCase() + cleaned.slice(1)
  }

  // Trim to reasonable length
  const maxLen = Math.round(profile.avgMessageLength * 2.5)
  if (cleaned.length > maxLen && maxLen > 50) {
    // Find last sentence boundary before maxLen
    const boundary = cleaned.lastIndexOf('.', maxLen)
    const boundary2 = cleaned.lastIndexOf('!', maxLen)
    const boundary3 = cleaned.lastIndexOf('?', maxLen)
    const cutAt = Math.max(boundary, boundary2, boundary3)
    if (cutAt > maxLen * 0.3) {
      cleaned = cleaned.slice(0, cutAt + 1)
    } else {
      cleaned = cleaned.slice(0, maxLen)
    }
  }

  return cleaned
}
