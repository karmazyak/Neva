/**
 * Knowledge Graph — entity-relation memory stored as JSON in SQLite.
 * Extracts entities and relationships from conversations via LLM,
 * stores as a graph structure for richer context than flat facts.
 *
 * No Neo4j, no training — just smart prompts + JSON in SQLite.
 */

import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'

// ── Types ──

export interface GraphEntity {
  id: string
  name: string
  type: 'person' | 'place' | 'thing' | 'event' | 'interest' | 'date' | 'work'
  attributes: Record<string, string>
}

export interface GraphRelation {
  from: string  // entity id
  to: string    // entity id
  type: string  // e.g. "любит", "работает_в", "планирует", "день_рождения"
  confidence: number
  firstMentioned: number  // timestamp
  lastMentioned: number   // timestamp
}

export interface KnowledgeGraph {
  entities: GraphEntity[]
  relations: GraphRelation[]
}

// ── CRUD ──

/** Get knowledge graph for a contact */
export function getGraph(userId: string, chatId: string): KnowledgeGraph {
  const row = db.select()
    .from(schema.contactKnowledgeGraph)
    .where(and(
      eq(schema.contactKnowledgeGraph.userId, userId),
      eq(schema.contactKnowledgeGraph.chatId, chatId),
    ))
    .get()

  if (!row) return { entities: [], relations: [] }
  return {
    entities: (row.entities as GraphEntity[]) || [],
    relations: (row.relations as GraphRelation[]) || [],
  }
}

/** Save or update knowledge graph */
export function saveGraph(userId: string, contactId: string, chatId: string, graph: KnowledgeGraph) {
  const existing = db.select({ id: schema.contactKnowledgeGraph.id })
    .from(schema.contactKnowledgeGraph)
    .where(and(
      eq(schema.contactKnowledgeGraph.userId, userId),
      eq(schema.contactKnowledgeGraph.chatId, chatId),
    ))
    .get()

  if (existing) {
    db.update(schema.contactKnowledgeGraph)
      .set({
        entities: graph.entities as any,
        relations: graph.relations as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.contactKnowledgeGraph.id, existing.id))
      .run()
  } else {
    db.insert(schema.contactKnowledgeGraph).values({
      id: crypto.randomUUID(),
      userId,
      contactId,
      chatId,
      entities: graph.entities as any,
      relations: graph.relations as any,
    }).run()
  }
}

// ── Extraction via LLM ──

/**
 * Extract entities and relations from new messages, merge with existing graph.
 * Uses one LLM call (analysis model).
 */
export async function extractAndMergeGraph(
  userId: string,
  contactId: string,
  chatId: string,
  contactName: string,
  newMessages: string[],
): Promise<KnowledgeGraph> {
  const existing = getGraph(userId, chatId)

  if (newMessages.length === 0) return existing

  const existingContext = existing.entities.length > 0
    ? `\nExisting entities: ${existing.entities.map(e => `${e.name} (${e.type})`).join(', ')}`
    : ''

  const config = getModelConfig('analysis')

  try {
    const result = await chatCompletion({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `Extract entities and relationships from a conversation about "${contactName}".
${existingContext}

You MUST respond with ONLY a valid JSON object. No markdown, no code blocks, no explanations. Just raw JSON.

Schema: {"entities":[{"id":"short_id","name":"Name","type":"person|place|thing|event|interest|date|work","attributes":{}}],"relations":[{"from":"entity_id","to":"entity_id","type":"verb","confidence":0.8}]}

Rules:
- Main person: id="contact", name="${contactName}"
- EXTRACT only MEANINGFUL entities: close people (friends, family by name), favorite places, real hobbies/passions, important events, dates (birthdays)
- DO NOT extract: technical terms, code/frameworks, routine activities, one-time mentions, food items, weather
- Relation types: любит, хочет, планирует, работает_в, дружит_с, увлекается, ходит_в, коллекционирует, etc.
- Keep attribute values SHORT (1-3 words)
- Max 10 entities, 15 relations. Quality over quantity — only things a friend should remember
- Use simple ASCII ids like "e1","e2","e3"
- Response language: same as messages`,
        },
        {
          role: 'user',
          content: newMessages.slice(-30).join('\n'),
        },
      ],
      temperature: 0.2,
      maxTokens: 2048,
    })

    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    const newEntities: GraphEntity[] = (parsed.entities || []).map((e: any) => ({
      id: e.id || crypto.randomUUID().slice(0, 8),
      name: e.name || '',
      type: e.type || 'thing',
      attributes: e.attributes || {},
    })).filter((e: GraphEntity) => e.name)

    const now = Date.now()
    const newRelations: GraphRelation[] = (parsed.relations || []).map((r: any) => ({
      from: r.from || '',
      to: r.to || '',
      type: r.type || '',
      confidence: r.confidence ?? 0.8,
      firstMentioned: now,
      lastMentioned: now,
    })).filter((r: GraphRelation) => r.from && r.to && r.type)

    // Merge with existing graph
    const merged = mergeGraph(existing, newEntities, newRelations)
    saveGraph(userId, contactId, chatId, merged)
    return merged
  } catch (e) {
    console.error('[KnowledgeGraph] Extraction failed:', e)
    return existing
  }
}

/** Merge new entities/relations into existing graph with dedup */
function mergeGraph(
  existing: KnowledgeGraph,
  newEntities: GraphEntity[],
  newRelations: GraphRelation[],
): KnowledgeGraph {
  const entityMap = new Map<string, GraphEntity>()

  // Add existing entities
  for (const e of existing.entities) {
    entityMap.set(e.id, e)
  }

  // Merge new entities — match by name+type or add new
  for (const ne of newEntities) {
    const existingMatch = [...entityMap.values()].find(
      e => e.name.toLowerCase() === ne.name.toLowerCase() && e.type === ne.type
    )
    if (existingMatch) {
      // Update attributes
      existingMatch.attributes = { ...existingMatch.attributes, ...ne.attributes }
      // Remap new entity's id to existing one for relation matching
      for (const r of newRelations) {
        if (r.from === ne.id) r.from = existingMatch.id
        if (r.to === ne.id) r.to = existingMatch.id
      }
    } else {
      entityMap.set(ne.id, ne)
    }
  }

  // Merge relations — dedup by from+to+type
  const relationMap = new Map<string, GraphRelation>()
  for (const r of existing.relations) {
    relationMap.set(`${r.from}:${r.to}:${r.type}`, r)
  }
  for (const r of newRelations) {
    const key = `${r.from}:${r.to}:${r.type}`
    const ex = relationMap.get(key)
    if (ex) {
      ex.lastMentioned = r.lastMentioned
      ex.confidence = Math.max(ex.confidence, r.confidence)
    } else {
      relationMap.set(key, r)
    }
  }

  // Trim to limits
  const entities = [...entityMap.values()].slice(0, 20)
  const entityIds = new Set(entities.map(e => e.id))
  const relations = [...relationMap.values()]
    .filter(r => entityIds.has(r.from) && entityIds.has(r.to))
    .slice(0, 30)

  return { entities, relations }
}

// ── Prompt Block ──

/**
 * Format knowledge graph as a prompt block for LLM context injection.
 * Returns relationship-style format: "Person → [verb] → Object"
 */
export function getGraphPromptBlock(userId: string, chatId: string): string {
  const graph = getGraph(userId, chatId)
  if (graph.entities.length === 0) return ''

  const entityNames = new Map(graph.entities.map(e => [e.id, e.name]))

  const lines: string[] = []
  for (const r of graph.relations) {
    const fromName = entityNames.get(r.from)
    const toName = entityNames.get(r.to)
    if (fromName && toName) {
      lines.push(`${fromName} → [${r.type}] → ${toName}`)
    }
  }

  // Add entity attributes
  for (const e of graph.entities) {
    const attrs = Object.entries(e.attributes)
    if (attrs.length > 0) {
      lines.push(`${e.name} (${e.type}): ${attrs.map(([k, v]) => `${k}=${v}`).join(', ')}`)
    }
  }

  if (lines.length === 0) return ''

  return `\n=== KNOWLEDGE GRAPH ===\n${lines.join('\n')}\n=== END GRAPH ===\n`
}

/**
 * Get graph-based recommendations for a specific context.
 * Returns entities connected to the contact that are relevant.
 */
export function getRelevantGraphContext(userId: string, chatId: string, context?: string): {
  interests: string[]
  plans: string[]
  people: string[]
  dates: string[]
} {
  const graph = getGraph(userId, chatId)
  const result = { interests: [] as string[], plans: [] as string[], people: [] as string[], dates: [] as string[] }

  const entityNames = new Map(graph.entities.map(e => [e.id, e]))

  for (const r of graph.relations) {
    const to = entityNames.get(r.to)
    if (!to) continue

    const relType = r.type.toLowerCase()
    if (['любит', 'нравится', 'интересуется', 'увлекается', 'хочет'].some(v => relType.includes(v))) {
      result.interests.push(to.name)
    }
    if (['планирует', 'собирается', 'хочет_посетить'].some(v => relType.includes(v))) {
      result.plans.push(to.name)
    }
    if (to.type === 'person' && r.from !== r.to) {
      result.people.push(to.name)
    }
    if (to.type === 'date' || relType.includes('день_рождения') || relType.includes('годовщина')) {
      result.dates.push(`${to.name}: ${Object.values(to.attributes).join(', ')}`)
    }
  }

  return result
}
