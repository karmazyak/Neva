/**
 * Rule-based fraud/scam detection. 0 LLM calls.
 * Checks incoming messages for scam patterns and returns alert signals.
 *
 * NOTE: We use (?<!\p{L}) / (?!\p{L}) with the `u` flag instead of \b,
 * because \b does not work with Cyrillic characters in JS.
 */

// Unicode-aware word boundary helpers
const B = '(?<!\\p{L})'  // "not preceded by a letter"
const E = '(?!\\p{L})'   // "not followed by a letter"

// ── Pattern categories ──────────────────────────────────────────────────────

const FINANCIAL_PATTERNS = [
  new RegExp(`${B}(деньги|деньг[аи]|перевод|перевести|переведи|счёт|счет|карт[аеуы]|оплат[аиу]|кредит|займ|долг)${E}`, 'iu'),
  new RegExp(`${B}(money|transfer|payment|card|credit|loan|bank)${E}`, 'iu'),
  /(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})/, // card numbers
  new RegExp(`${B}(IBAN|BIC|SWIFT)${E}`, 'iu'),
]

const PRESSURE_PATTERNS = [
  new RegExp(`${B}(срочно|немедленно|сейчас же|прямо сейчас|только сегодня|последний шанс)${E}`, 'iu'),
  new RegExp(`${B}(urgent|immediately|right now|last chance|act now)${E}`, 'iu'),
  new RegExp(`${B}(быстрее|скорее|не медли|торопись|не откладывай)${E}`, 'iu'),
  /!!+/, // multiple exclamation marks
]

const MANIPULATION_PATTERNS = [
  new RegExp(`${B}(ваш (внук|сын|дочь|муж|жена|родственник))${E}`, 'iu'),
  new RegExp(`${B}(беда|авария|задержан[аы]?|арестован|больниц[ауе]|полици[яию]|следовател)${E}`, 'iu'),
  new RegExp(`${B}(помогите|спасите|выручите)${E}`, 'iu'),
  new RegExp(`${B}(не говори|никому не рассказывай|секрет|тайна)${E}`, 'iu'),
  new RegExp(`${B}(congratulations|won|prize|lottery|наследств|поздравляем|выиграли|приз|лотере)${E}`, 'iu'),
]

const IMPERSONATION_PATTERNS = [
  new RegExp(`${B}(служба безопасности|банк[аеу]? (звонит|просит)|сотрудник банка)${E}`, 'iu'),
  new RegExp(`${B}(налоговая|пенсионный фонд|соцзащита|министерство)${E}`, 'iu'),
  new RegExp(`${B}(security service|bank officer|government|official)${E}`, 'iu'),
  new RegExp(`${B}(подтвердите (личность|данные|паспорт))${E}`, 'iu'),
]

// ── Detection ───────────────────────────────────────────────────────────────

export interface FraudSignal {
  category: 'financial' | 'pressure' | 'manipulation' | 'impersonation'
  matched: string
}

export interface FraudResult {
  isSuspicious: boolean
  severity: 'low' | 'medium' | 'high'
  signals: FraudSignal[]
  categoriesHit: number
}

export function detectFraud(messageText: string): FraudResult {
  const signals: FraudSignal[] = []

  const categories = [
    { patterns: FINANCIAL_PATTERNS, category: 'financial' as const },
    { patterns: PRESSURE_PATTERNS, category: 'pressure' as const },
    { patterns: MANIPULATION_PATTERNS, category: 'manipulation' as const },
    { patterns: IMPERSONATION_PATTERNS, category: 'impersonation' as const },
  ]

  const hitCategories = new Set<string>()

  for (const { patterns, category } of categories) {
    for (const pattern of patterns) {
      const match = messageText.match(pattern)
      if (match) {
        signals.push({ category, matched: match[0] })
        hitCategories.add(category)
      }
    }
  }

  const categoriesHit = hitCategories.size

  let severity: 'low' | 'medium' | 'high' = 'low'
  if (categoriesHit >= 3) severity = 'high'
  else if (categoriesHit >= 2) severity = 'medium'

  return {
    isSuspicious: categoriesHit >= 2, // at least 2 different categories
    severity,
    signals,
    categoriesHit,
  }
}

/**
 * Check if sender is a known contact (has chat history).
 * Unknown + fraud signals = higher risk.
 */
export function isUnknownContact(userId: string, senderId: string): boolean {
  try {
    const { db, schema } = require('../db')
    const { eq, and } = require('drizzle-orm')

    const sharedChats = db.select({ id: schema.chatMembers.chatId })
      .from(schema.chatMembers)
      .where(eq(schema.chatMembers.userId, userId))
      .all()
      .map((r: any) => r.id)

    if (sharedChats.length === 0) return true

    const senderInAny = db.select({ id: schema.chatMembers.id })
      .from(schema.chatMembers)
      .where(and(
        eq(schema.chatMembers.userId, senderId),
      ))
      .all()

    return senderInAny.length === 0
  } catch {
    return false
  }
}
