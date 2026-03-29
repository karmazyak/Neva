/**
 * Memory Manager — persistent long-term memory about contacts
 * Extracts and stores facts (events, preferences, names, dates) incrementally.
 * Facts accumulate over time instead of being re-extracted from scratch.
 */

import { db, schema } from '../db'
import { eq, and, sql } from 'drizzle-orm'
import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'

export interface MemoryFact {
  fact: string
  category: 'life_event' | 'plan' | 'person' | 'date' | 'health' | 'preference' | 'work'
  confidence: number
  source?: string
}

// Expiration rules per category (in days, null = never)
const EXPIRATION_DAYS: Record<string, number | null> = {
  plan: 30,
  health: 60,
  preference: 90,
  work: 90,
  life_event: null,
  person: null,
  date: null,
}

/** Get all active, non-expired memories for a contact */
export function getActiveMemories(userId: string, chatId: string): Array<{
  id: string
  fact: string
  category: string
  confidence: number
  extractedAt: Date | null
}> {
  const now = Math.floor(Date.now() / 1000)
  const rows = db.select()
    .from(schema.contactMemory)
    .where(and(
      eq(schema.contactMemory.userId, userId),
      eq(schema.contactMemory.chatId, chatId),
      eq(schema.contactMemory.isActive, true),
    ))
    .all()

  // Filter out expired
  return rows
    .filter(r => !r.expiresAt || new Date(r.expiresAt).getTime() / 1000 > now)
    .slice(0, 20)
    .map(r => ({
      id: r.id,
      fact: r.fact,
      category: r.category,
      confidence: r.confidence || 0.8,
      extractedAt: r.extractedAt,
    }))
}

/** Format active memories as a prompt injection block */
export function getMemoryPromptBlock(userId: string, chatId: string): string {
  const memories = getActiveMemories(userId, chatId)
  if (memories.length === 0) return ''

  const grouped: Record<string, string[]> = {}
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = []
    grouped[m.category].push(m.fact)
  }

  let block = '\n=== KNOWN FACTS ABOUT THIS CONTACT ===\n'
  for (const [cat, facts] of Object.entries(grouped)) {
    block += `${cat}: ${facts.join('; ')}\n`
  }
  block += '=== END FACTS ===\n'
  return block
}

/** Extract NEW facts from recent messages given existing known facts */
export async function extractNewFacts(
  userId: string,
  chatId: string,
  contactName: string,
  newMessages: string[],
): Promise<MemoryFact[]> {
  if (newMessages.length === 0) return []

  const existing = getActiveMemories(userId, chatId)
  const existingFacts = existing.map(m => m.fact)

  const config = getModelConfig('analysis')
  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `Extract SIGNIFICANT personal facts about "${contactName}" from new messages.
Return ONLY facts NOT already in the known list.

EXTRACT (important, long-lasting):
- Life events: moves, new job, relationship changes, big milestones
- Plans: trips, celebrations, major upcoming events (NOT routine meetings)
- People: names of close friends, family members, pets
- Dates: birthdays, anniversaries (with specific dates if mentioned)
- Health: ongoing conditions, significant health events
- Preferences: hobbies, favorite places, food preferences, interests they're passionate about
- Work: job title, company, career changes (NOT daily tasks or technical details)

DO NOT EXTRACT (noise):
- Technical work details (debugging, code, tools, frameworks)
- Routine daily activities (what they ate, routine errands)
- One-time trivial mentions
- Things everyone does (commuting, sleeping, eating)

Return JSON array: [{"fact":"short meaningful fact","category":"life_event|plan|person|date|health|preference|work","confidence":0.0-1.0}]
Return [] if no significant facts found. Max 10 words per fact. Quality over quantity.`,
      },
      {
        role: 'user',
        content: `Known facts about ${contactName}:
${existingFacts.length > 0 ? existingFacts.map(f => `- ${f}`).join('\n') : '(none yet)'}

New messages:
${newMessages.join('\n')}

Extract ONLY NEW facts not already known:`,
      },
    ],
    temperature: 0.2,
    maxTokens: 512,
  })

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f: any) => f.fact && f.category).map((f: any) => ({
      fact: f.fact.slice(0, 200),
      category: f.category,
      confidence: Math.min(1, Math.max(0, f.confidence ?? 0.8)),
    }))
  } catch {
    return []
  }
}

/** Persist extracted facts to DB (with dedup by similar fact text) */
export function persistFacts(
  userId: string,
  contactId: string,
  chatId: string,
  facts: MemoryFact[],
): number {
  if (facts.length === 0) return 0

  const existing = getActiveMemories(userId, chatId)
  const existingLower = existing.map(m => m.fact.toLowerCase())

  let inserted = 0
  for (const fact of facts) {
    // Fuzzy dedup: skip if similar fact already exists
    const lower = fact.fact.toLowerCase()
    // 1) Substring match
    if (existingLower.some(e => e.includes(lower) || lower.includes(e))) continue
    // 2) Word overlap: if >70% of words match, consider duplicate
    const newWords = new Set(lower.split(/\s+/).filter(w => w.length > 2))
    if (newWords.size > 0 && existingLower.some(e => {
      const existWords = new Set(e.split(/\s+/).filter(w => w.length > 2))
      if (existWords.size === 0) return false
      let overlap = 0
      for (const w of newWords) if (existWords.has(w)) overlap++
      const ratio = overlap / Math.min(newWords.size, existWords.size)
      return ratio >= 0.7
    })) continue

    const expirationDays = EXPIRATION_DAYS[fact.category]
    const expiresAt = expirationDays
      ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
      : null

    db.insert(schema.contactMemory).values({
      id: crypto.randomUUID(),
      userId,
      contactId,
      chatId,
      fact: fact.fact,
      category: fact.category as any,
      source: fact.source || null,
      confidence: fact.confidence,
      expiresAt,
      isActive: true,
    } as any).run()
    inserted++
  }

  return inserted
}

/** Deactivate stale facts based on expiration rules */
export function deactivateStale(userId: string, chatId: string): number {
  const now = new Date()
  const rows = db.select()
    .from(schema.contactMemory)
    .where(and(
      eq(schema.contactMemory.userId, userId),
      eq(schema.contactMemory.chatId, chatId),
      eq(schema.contactMemory.isActive, true),
    ))
    .all()

  let deactivated = 0
  for (const row of rows) {
    if (row.expiresAt && new Date(row.expiresAt) < now) {
      db.update(schema.contactMemory)
        .set({ isActive: false } as any)
        .where(eq(schema.contactMemory.id, row.id))
        .run()
      deactivated++
    }
  }
  return deactivated
}

/**
 * Full extraction pipeline: extract facts from messages and persist them
 * Returns the number of new facts added
 */
export async function extractAndPersistFacts(
  userId: string,
  contactId: string,
  chatId: string,
  contactName: string,
  newMessages: string[],
): Promise<number> {
  // Deactivate stale facts first
  deactivateStale(userId, chatId)

  // Extract new facts
  const facts = await extractNewFacts(userId, chatId, contactName, newMessages)

  // Persist
  return persistFacts(userId, contactId, chatId, facts)
}
