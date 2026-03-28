/**
 * Contact Intelligence — unified persistent store for persona, style, mood, and memory
 * Replaces fragmented in-memory caches (personaCache, moodCheckCache) with DB-backed storage
 *
 * Phase 1: Core CRUD + LRU cache + incremental analysis
 * Phase 3: Per-contact user style (myStyleForThem)
 * Phase 4: Mood tracking (detectAndRecordMood, getMoodTrend)
 */

import { db, schema } from '../db'
import { eq, and, sql } from 'drizzle-orm'
import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'
import type { PersonaProfile } from './persona-profiler'
import type { StyleProfile } from './style/analyzer'
import type { ContactIntelligenceRow } from '../db/schema'

// ── Types ──

export interface MoodEntry {
  mood: string
  note: string | null
  confidence: number
  timestamp: number
}

export interface MoodTrend {
  current: string
  trend: 'improving' | 'stable' | 'declining' | 'volatile'
  significantChange: boolean
}

// ── LRU Cache ──

const LRU_MAX = 100
const LRU_TTL = 30 * 60 * 1000 // 30 min
const lruCache = new Map<string, { row: ContactIntelligenceRow; at: number }>()

function lruKey(userId: string, chatId: string) { return `${userId}:${chatId}` }

function lruGet(userId: string, chatId: string): ContactIntelligenceRow | null {
  const k = lruKey(userId, chatId)
  const entry = lruCache.get(k)
  if (!entry) return null
  if (Date.now() - entry.at > LRU_TTL) {
    lruCache.delete(k)
    return null
  }
  return entry.row
}

function lruSet(userId: string, chatId: string, row: ContactIntelligenceRow) {
  const k = lruKey(userId, chatId)
  // Evict oldest if at capacity
  if (lruCache.size >= LRU_MAX && !lruCache.has(k)) {
    const oldest = lruCache.keys().next().value
    if (oldest) lruCache.delete(oldest)
  }
  lruCache.set(k, { row, at: Date.now() })
}

function lruInvalidate(userId: string, chatId: string) {
  lruCache.delete(lruKey(userId, chatId))
}

// ── Core CRUD ──

/** Read contact intelligence from DB (with LRU cache) */
export function getContactIntel(userId: string, chatId: string): ContactIntelligenceRow | null {
  const cached = lruGet(userId, chatId)
  if (cached) return cached

  const row = db.select()
    .from(schema.contactIntelligence)
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .get()

  if (row) lruSet(userId, chatId, row)
  return row || null
}

/** Get or create contact intelligence row */
export function getOrCreateContactIntel(
  userId: string,
  contactId: string,
  chatId: string,
): ContactIntelligenceRow {
  const existing = getContactIntel(userId, chatId)
  if (existing) return existing

  const id = crypto.randomUUID()
  db.insert(schema.contactIntelligence).values({
    id,
    userId,
    contactId,
    chatId,
    persona: null,
    theirStyle: null,
    myStyleForThem: null,
    moodHistory: [],
    relationshipType: null,
    lastAnalyzedAt: null,
    messageCountAtAnalysis: 0,
    version: 1,
  } as any).run()

  const row = db.select()
    .from(schema.contactIntelligence)
    .where(eq(schema.contactIntelligence.id, id))
    .get()!

  lruSet(userId, chatId, row)
  return row
}

/** Update persona JSON */
export function updatePersona(userId: string, chatId: string, persona: PersonaProfile) {
  const { extractedAt, messageCountUsed, ...personaData } = persona as any
  db.update(schema.contactIntelligence)
    .set({
      persona: personaData as any,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

/** Update contact's writing style */
export function updateTheirStyle(userId: string, chatId: string, style: StyleProfile) {
  db.update(schema.contactIntelligence)
    .set({
      theirStyle: style as any,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

/** Update user's writing style for this specific contact */
export function updateMyStyleForThem(userId: string, chatId: string, style: StyleProfile) {
  db.update(schema.contactIntelligence)
    .set({
      myStyleForThem: style as any,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

/** Update relationship type */
export function updateRelationshipType(userId: string, chatId: string, type: string) {
  db.update(schema.contactIntelligence)
    .set({
      relationshipType: type as any,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

/** Append mood entry to history (trim to max 30) */
export function recordMood(userId: string, chatId: string, mood: string, note: string | null, confidence: number) {
  const row = getContactIntel(userId, chatId)
  if (!row) return

  const history: MoodEntry[] = Array.isArray(row.moodHistory) ? [...row.moodHistory] : []
  history.unshift({ mood, note, confidence, timestamp: Date.now() })
  if (history.length > 30) history.length = 30

  db.update(schema.contactIntelligence)
    .set({
      moodHistory: history as any,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

/** Get latest mood from history */
export function getLatestMood(userId: string, chatId: string): MoodEntry | null {
  const row = getContactIntel(userId, chatId)
  if (!row || !Array.isArray(row.moodHistory) || row.moodHistory.length === 0) return null
  return row.moodHistory[0]
}

/** Get mood trend over last 7 days */
export function getMoodTrend(userId: string, chatId: string): MoodTrend | null {
  const row = getContactIntel(userId, chatId)
  if (!row || !Array.isArray(row.moodHistory) || row.moodHistory.length === 0) return null

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recent = row.moodHistory.filter(m => m.timestamp > sevenDaysAgo)
  if (recent.length === 0) return null

  const current = recent[0].mood

  // Classify moods as positive/neutral/negative
  const positiveWords = ['happy', 'good', 'great', 'excited', 'cheerful', 'positive', 'радостный', 'хороший', 'веселый', 'счастливый']
  const negativeWords = ['sad', 'angry', 'stressed', 'anxious', 'upset', 'frustrated', 'irritated', 'грустный', 'злой', 'раздраженный', 'расстроенный', 'стресс']

  function classify(mood: string): number {
    const m = mood.toLowerCase()
    if (positiveWords.some(w => m.includes(w))) return 1
    if (negativeWords.some(w => m.includes(w))) return -1
    return 0
  }

  const scores = recent.map(m => classify(m.mood))

  if (scores.length < 2) {
    return { current, trend: 'stable', significantChange: false }
  }

  // Check trend: compare first half vs second half
  const mid = Math.floor(scores.length / 2)
  const older = scores.slice(mid)
  const newer = scores.slice(0, mid)
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length
  const avgNewer = newer.reduce((a, b) => a + b, 0) / newer.length
  const diff = avgNewer - avgOlder

  // Check for significant change (positive <-> negative in last 3 entries)
  const last3 = scores.slice(0, 3)
  const significantChange = last3.length >= 2 && last3.some(s => s > 0) && last3.some(s => s < 0)

  // Check volatility
  const variance = scores.reduce((sum, s, i) => i > 0 ? sum + Math.abs(s - scores[i - 1]) : sum, 0) / (scores.length - 1)

  let trend: MoodTrend['trend']
  if (variance > 0.8) trend = 'volatile'
  else if (diff > 0.3) trend = 'improving'
  else if (diff < -0.3) trend = 'declining'
  else trend = 'stable'

  return { current, trend, significantChange }
}

// ── Communication Baselines ──

export interface CommunicationBaseline {
  avgMessageLength: number
  avgEmojiPerMessage: number
  avgResponseTimeMs: number
  capsFrequency: number
  avgMessagesPerDay: number
  ellipsisFrequency: number
  positiveEmojiRate: number
  negativeKeywordRate: number
  sampleSize: number
  stdMessageLength: number
  lastUpdatedAt: number
}

const POSITIVE_EMOJI_RE = /[\u{1F600}-\u{1F606}\u{1F609}-\u{1F60D}\u{1F618}\u{1F617}\u{1F619}\u{1F61A}\u{1F970}\u{1F60F}\u{1F642}\u{1F643}\u{2764}\u{1F49A}-\u{1F49F}\u{1F389}\u{1F38A}\u{1F973}\u{2705}\u{1F44D}\u{1F44F}\u{1F525}]/gu
const NEGATIVE_KEYWORD_RE = /\b(ужас|плохо|грустно|устал|бесит|злюсь|ненавижу|хреново|отстой|достало|надоело|невозможно|кошмар|horrible|terrible|awful|hate|angry|sad|tired|exhausted|frustrated|depressed|worst)\b/gi

/** Calculate statistical communication baseline from message texts */
export function calculateBaseline(messages: string[]): CommunicationBaseline | null {
  if (messages.length < 5) return null

  const lengths = messages.map(m => m.length)
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const stdLen = Math.sqrt(lengths.reduce((s, l) => s + (l - avgLen) ** 2, 0) / lengths.length)

  let totalEmoji = 0
  let totalCaps = 0
  let totalEllipsis = 0
  let totalPositiveEmoji = 0
  let totalNegKeywords = 0

  for (const msg of messages) {
    const emojiMatches = msg.match(/[\u{1F000}-\u{1FFFF}]/gu) || []
    totalEmoji += emojiMatches.length
    totalPositiveEmoji += (msg.match(POSITIVE_EMOJI_RE) || []).length
    totalNegKeywords += (msg.match(NEGATIVE_KEYWORD_RE) || []).length
    if (msg.length > 3 && msg === msg.toUpperCase() && /[A-ZА-ЯЁ]/.test(msg)) totalCaps++
    if ((msg.match(/\.{3,}/g) || []).length > 0) totalEllipsis++
  }

  return {
    avgMessageLength: Math.round(avgLen),
    avgEmojiPerMessage: +(totalEmoji / messages.length).toFixed(2),
    avgResponseTimeMs: 0, // TODO: needs timestamps, skip for now
    capsFrequency: +(totalCaps / messages.length).toFixed(3),
    avgMessagesPerDay: 0, // TODO: needs timestamps
    ellipsisFrequency: +(totalEllipsis / messages.length).toFixed(3),
    positiveEmojiRate: +(totalPositiveEmoji / messages.length).toFixed(3),
    negativeKeywordRate: +(totalNegKeywords / messages.length).toFixed(3),
    sampleSize: messages.length,
    stdMessageLength: Math.round(stdLen),
    lastUpdatedAt: Date.now(),
  }
}

/** Get cached baseline for a contact */
export function getBaseline(userId: string, chatId: string): CommunicationBaseline | null {
  const row = getContactIntel(userId, chatId)
  return (row as any)?.communicationBaseline || null
}

/** Update baseline in DB */
export function updateBaseline(userId: string, chatId: string, baseline: CommunicationBaseline) {
  db.update(schema.contactIntelligence)
    .set({
      communicationBaseline: baseline as any,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

// ── Analysis Freshness ──

/** Check if reanalysis is needed (>50 new messages or >7 days old) */
export function shouldReanalyze(row: ContactIntelligenceRow, currentMsgCount: number): boolean {
  if (!row.lastAnalyzedAt) return true
  const msgDelta = currentMsgCount - (row.messageCountAtAnalysis || 0)
  if (msgDelta > 50) return true
  const daysSince = (Date.now() - new Date(row.lastAnalyzedAt).getTime()) / (1000 * 60 * 60 * 24)
  return daysSince > 7
}

/** Mark analysis as completed with current message count */
export function markAnalyzed(userId: string, chatId: string, messageCount: number) {
  db.update(schema.contactIntelligence)
    .set({
      lastAnalyzedAt: new Date(),
      messageCountAtAnalysis: messageCount,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .run()
  lruInvalidate(userId, chatId)
}

// ── Incremental Analysis ──

/**
 * Run a single combined LLM call that updates persona + theirStyle + current mood.
 * Only processes messages after the last analysis point.
 */
export async function runIncrementalAnalysis(
  userId: string,
  contactId: string,
  chatId: string,
  contactName: string,
  contactMessages: string[],
  fullChatHistory: string,
  relationshipType: string | null,
): Promise<void> {
  const row = getOrCreateContactIntel(userId, contactId, chatId)
  const existingPersona = row.persona as any
  const existingStyle = row.theirStyle as any

  const config = getModelConfig('persona_extraction')

  // Take last 50 contact messages for analysis
  const recentMessages = contactMessages.slice(-50).join('\n')

  const existingContext = existingPersona
    ? `\nExisting persona (update if needed based on new messages):\n${JSON.stringify(existingPersona, null, 1)}`
    : ''

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are analyzing a contact's communication style and personality. You MUST respond with valid JSON only.

Analyze the person's messages and produce a combined profile covering:
1. Persona (behavioral traits, mood, dynamics)
2. Writing style (linguistic patterns for replication)

JSON schema:
{
  "persona": {
    "linguistic": {
      "avgMessageLength": "short|medium|long",
      "emojiUsage": "none|rare|moderate|heavy",
      "punctuationStyle": "description",
      "language": "ru|en|etc",
      "formality": 0.0-1.0,
      "signaturePatterns": ["phrases"],
      "greeting": "typical greeting",
      "farewell": "typical farewell"
    },
    "behavioral": {
      "agreeableness": 0.0-1.0,
      "directness": 0.0-1.0,
      "emotionalReactivity": 0.0-1.0,
      "humor": "none|dry|playful|sarcastic",
      "decisionSpeed": "quick|deliberate|avoidant",
      "conflictStyle": "confrontational|diplomatic|avoidant|passive-aggressive"
    },
    "currentState": {
      "recentMood": "one word",
      "activeTopics": ["topics"],
      "pendingExpectations": ["expectations"],
      "lastInteractionTone": "brief description"
    },
    "dynamics": {
      "powerDynamic": "equal|dominant|submissive|varies",
      "sharedContext": ["shared themes"],
      "sensitiveTopics": ["sensitive topics"]
    }
  },
  "style": {
    "tone": "1-3 words describing their tone",
    "formality": "very_casual|casual|neutral|formal|very_formal",
    "emotionality": "reserved|moderate|expressive",
    "humor": "none|rare|frequent|constant",
    "usesEmoji": true/false,
    "emojiFrequency": "часто|иногда|редко|никогда",
    "usesSlang": true/false,
    "commonPhrases": ["5-10 characteristic phrases"],
    "punctuationStyle": "description",
    "capitalization": "строчные|стандарт|КАПС",
    "typoFrequency": "нет|редко|часто",
    "styleInstruction": "3-5 sentence instruction for AI to write in this person's style"
  },
  "currentMood": {
    "mood": "one word",
    "note": "brief explanation or null",
    "confidence": 0-100
  }
}

Rules:
- Base ALL assessments on actual message evidence
- signaturePatterns and commonPhrases: actual phrases they use, verbatim
- If you have an existing persona, only update what changed in new messages
- currentMood should reflect the LATEST messages`,
      },
      {
        role: 'user',
        content: `Person: "${contactName}"
Relationship: ${relationshipType || 'unknown'}
${existingContext}

Their recent messages:
${recentMessages}

Full conversation context (last 3000 chars):
${fullChatHistory.slice(-3000)}`,
      },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Update persona
    if (parsed.persona) {
      const persona: PersonaProfile = {
        name: contactName,
        linguistic: {
          avgMessageLength: parsed.persona.linguistic?.avgMessageLength || existingPersona?.linguistic?.avgMessageLength || 'medium',
          emojiUsage: parsed.persona.linguistic?.emojiUsage || 'rare',
          punctuationStyle: parsed.persona.linguistic?.punctuationStyle || 'standard',
          language: parsed.persona.linguistic?.language || 'ru',
          formality: parsed.persona.linguistic?.formality ?? 0.5,
          signaturePatterns: parsed.persona.linguistic?.signaturePatterns || [],
          greeting: parsed.persona.linguistic?.greeting || '',
          farewell: parsed.persona.linguistic?.farewell || '',
        },
        behavioral: {
          agreeableness: parsed.persona.behavioral?.agreeableness ?? 0.5,
          directness: parsed.persona.behavioral?.directness ?? 0.5,
          emotionalReactivity: parsed.persona.behavioral?.emotionalReactivity ?? 0.5,
          humor: parsed.persona.behavioral?.humor || 'none',
          decisionSpeed: parsed.persona.behavioral?.decisionSpeed || 'deliberate',
          conflictStyle: parsed.persona.behavioral?.conflictStyle || 'diplomatic',
        },
        currentState: {
          recentMood: parsed.persona.currentState?.recentMood || 'neutral',
          activeTopics: parsed.persona.currentState?.activeTopics || [],
          pendingExpectations: parsed.persona.currentState?.pendingExpectations || [],
          lastInteractionTone: parsed.persona.currentState?.lastInteractionTone || 'neutral',
        },
        dynamics: {
          relationshipType: relationshipType || 'other',
          powerDynamic: parsed.persona.dynamics?.powerDynamic || 'equal',
          sharedContext: parsed.persona.dynamics?.sharedContext || [],
          sensitiveTopics: parsed.persona.dynamics?.sensitiveTopics || [],
        },
        extractedAt: Date.now(),
        messageCountUsed: contactMessages.length,
      }
      updatePersona(userId, chatId, persona)
    }

    // Update their style
    if (parsed.style) {
      const style: Partial<StyleProfile> = {
        sourceUserId: contactId,
        sourceName: contactName,
        messageCount: contactMessages.length,
        confidence: contactMessages.length >= 100 ? 'high' : contactMessages.length >= 20 ? 'medium' : 'low',
        language: parsed.persona?.linguistic?.language || 'ru',
        avgMessageLength: 0, // will be computed if needed
        sentencesPerMessage: 0,
        tone: parsed.style.tone || '',
        formality: parsed.style.formality || 'neutral',
        emotionality: parsed.style.emotionality || 'moderate',
        humor: parsed.style.humor || 'none',
        usesEmoji: parsed.style.usesEmoji ?? false,
        emojiFrequency: parsed.style.emojiFrequency || 'редко',
        usesSlang: parsed.style.usesSlang ?? false,
        commonPhrases: parsed.style.commonPhrases || [],
        punctuationStyle: parsed.style.punctuationStyle || '',
        capitalization: parsed.style.capitalization || 'стандарт',
        typoFrequency: parsed.style.typoFrequency || 'нет',
        fewShotExamples: [],
        styleInstruction: parsed.style.styleInstruction || '',
      }
      updateTheirStyle(userId, chatId, style as StyleProfile)
    }

    // Record mood
    if (parsed.currentMood) {
      recordMood(userId, chatId, parsed.currentMood.mood, parsed.currentMood.note || null, parsed.currentMood.confidence || 70)
    }

    // Update relationship type if detected
    if (relationshipType) {
      updateRelationshipType(userId, chatId, relationshipType)
    }

    // Mark as analyzed
    markAnalyzed(userId, chatId, contactMessages.length)
  } catch (e) {
    console.error('[ContactIntelligence] Failed to parse incremental analysis:', e)
  }
}

/**
 * Get contact intelligence, building it if needed.
 * Checks freshness and triggers incremental analysis if stale.
 */
export async function getOrBuildContactIntel(
  userId: string,
  contactId: string,
  chatId: string,
  contactName: string,
  contactMessages: string[],
  fullChatHistory: string,
  relationshipType: string | null,
): Promise<ContactIntelligenceRow> {
  const row = getOrCreateContactIntel(userId, contactId, chatId)

  // Check if we need to analyze
  if (shouldReanalyze(row, contactMessages.length) && contactMessages.length >= 2) {
    await runIncrementalAnalysis(userId, contactId, chatId, contactName, contactMessages, fullChatHistory, relationshipType)
    return getContactIntel(userId, chatId)!
  }

  return row
}

/**
 * Get persona from contact intelligence (backward compat with persona-profiler consumers)
 */
export function getPersonaFromIntel(userId: string, chatId: string): PersonaProfile | null {
  const row = getContactIntel(userId, chatId)
  if (!row || !row.persona) return null

  const p = row.persona as any
  return {
    name: p.name || '',
    linguistic: p.linguistic || { avgMessageLength: 'medium', emojiUsage: 'rare', punctuationStyle: 'standard', language: 'ru', formality: 0.5, signaturePatterns: [], greeting: '', farewell: '' },
    behavioral: p.behavioral || { agreeableness: 0.5, directness: 0.5, emotionalReactivity: 0.5, humor: 'none', decisionSpeed: 'deliberate', conflictStyle: 'diplomatic' },
    currentState: p.currentState || { recentMood: 'neutral', activeTopics: [], pendingExpectations: [], lastInteractionTone: 'neutral' },
    dynamics: p.dynamics || { relationshipType: 'other', powerDynamic: 'equal', sharedContext: [], sensitiveTopics: [] },
    extractedAt: row.lastAnalyzedAt ? new Date(row.lastAnalyzedAt).getTime() : Date.now(),
    messageCountUsed: row.messageCountAtAnalysis || 0,
  }
}

// ── Phase 3: Per-Contact User Style ──

/**
 * Analyze how the USER writes in a specific chat (not the contact's style).
 * Reuses the style analyzer but filters only the user's own messages in this chat.
 * Minimum 20 messages required, otherwise returns null (fallback to global).
 */
export async function analyzeMyStyleForContact(
  userId: string,
  chatId: string,
): Promise<StyleProfile | null> {
  try {
    const { analyzeStyle } = await import('./style/analyzer')
    // analyzeStyle takes userId and optional chatId to filter messages
    const profile = await analyzeStyle(userId, chatId)
    if (profile) {
      updateMyStyleForThem(userId, chatId, profile)
    }
    return profile
  } catch (e) {
    console.error('[ContactIntelligence] Failed to analyze per-contact style:', e)
    return null
  }
}
