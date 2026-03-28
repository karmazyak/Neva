import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'

// ── Rule-based pre-filter (saves ~80% LLM calls) ───────────────────────────
// NOTE: \b doesn't work with Cyrillic in JS, so we use Unicode property escapes

const B = '(?<!\\p{L})'  // not preceded by a letter
const E = '(?!\\p{L})'   // not followed by a letter

const NEED_PATTERNS = [
  new RegExp(`${B}(ищу|нужен|нужна|нужно|нужны)${E}`, 'iu'),
  new RegExp(`${B}(не могу найти|где найти|кто знает)${E}`, 'iu'),
  new RegExp(`${B}(посоветуйте|подскажите|порекомендуйте)${E}`, 'iu'),
  new RegExp(`${B}(looking for|need|searching for)${E}`, 'iu'),
  new RegExp(`${B}(кто может|кто умеет|есть кто)${E}`, 'iu'),
  new RegExp(`${B}(хочу найти|хочу нанять)${E}`, 'iu'),
]

const OFFER_PATTERNS = [
  new RegExp(`${B}(могу помочь|готов помочь)${E}`, 'iu'),
  new RegExp(`${B}(умею|я делаю|я занимаюсь)${E}`, 'iu'),
  new RegExp(`${B}(свободен|свободна|есть время)${E}`, 'iu'),
  new RegExp(`${B}(предлагаю|могу сделать)${E}`, 'iu'),
  new RegExp(`${B}(i can|i do|available for)${E}`, 'iu'),
]

export interface IntentSignal {
  hasSignal: boolean
  hintType: 'need' | 'offer' | null
  matchedPatterns: string[]
}

export function preFilterIntent(text: string): IntentSignal {
  const matchedPatterns: string[] = []
  let hintType: 'need' | 'offer' | null = null

  for (const pattern of NEED_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      matchedPatterns.push(match[0])
      hintType = 'need'
    }
  }

  if (!hintType) {
    for (const pattern of OFFER_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        matchedPatterns.push(match[0])
        hintType = 'offer'
      }
    }
  }

  return {
    hasSignal: matchedPatterns.length > 0,
    hintType,
    matchedPatterns,
  }
}

// ── LLM Extraction (called only when pre-filter fires) ─────────────────────

export interface ExtractedIntent {
  type: 'need' | 'offer' | null
  description: string | null
  category: 'professional' | 'social' | 'care' | 'hobby' | null
  urgency: 'now' | 'this_week' | 'whenever' | null
}

export async function extractIntent(messageText: string, chatContext?: string): Promise<ExtractedIntent> {
  const config = getModelConfig('classification')

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `Extract intent from a chat message. Return ONLY valid JSON:
{
  "type": "need" | "offer" | null,
  "description": "short description of what they need/offer" | null,
  "category": "professional" | "social" | "care" | "hobby" | null,
  "urgency": "now" | "this_week" | "whenever" | null
}

Rules:
- "need" = person is looking for something (specialist, service, companion, help)
- "offer" = person is offering their skills/time/help
- null = no clear intent detected
- "professional" = work-related (designer, developer, accountant, etc.)
- "social" = social activities (bar, cinema, walk, party)
- "care" = caring for someone (gift, support, check on)
- "hobby" = hobby/interest-related offerings
- Only extract when intent is CLEAR, not ambiguous`
      },
      {
        role: 'user',
        content: chatContext
          ? `Chat context:\n${chatContext}\n\nMessage to analyze:\n${messageText}`
          : `Message to analyze:\n${messageText}`
      }
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  try {
    const cleaned = result.replace(/```json\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return { type: null, description: null, category: null, urgency: null }
  }
}

/**
 * Full pipeline: pre-filter → optional LLM extraction.
 * Returns null if no intent detected.
 */
export async function detectIntent(
  messageText: string,
  chatContext?: string,
): Promise<ExtractedIntent | null> {
  const signal = preFilterIntent(messageText)
  if (!signal.hasSignal) return null

  const extracted = await extractIntent(messageText, chatContext)
  if (!extracted.type) return null

  return extracted
}
