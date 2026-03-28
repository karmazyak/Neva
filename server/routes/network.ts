import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and, or, desc, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { generateEmbedding } from '../ai/embeddings'
import { findMatchingOffers, calculateTrustScore, getSocialDistance, getDirectContacts } from '../ai/matching'
import { requestConsent, getPendingConsents, handleConsentResponse, getRelationshipLevel } from '../ai/consent'
import { chatCompletion } from '../ai/openrouter'
import { getModelConfig } from '../ai/model-router'
import { sendToUser } from '../ws'
import type { Visibility } from '../a2a/types'

const app = new Hono()
app.use('*', authMiddleware)

// ── Expiration helpers ──────────────────────────────────────────────────────

function getExpiresAt(urgency: string): Date {
  const now = Date.now()
  switch (urgency) {
    case 'now': return new Date(now + 3 * 86400000)       // 3 days
    case 'this_week': return new Date(now + 7 * 86400000)  // 7 days
    default: return new Date(now + 30 * 86400000)          // 30 days
  }
}

// ── Needs CRUD ──────────────────────────────────────────────────────────────

const needSchema = z.object({
  description: z.string().min(2).max(500),
  category: z.enum(['professional', 'social', 'care']),
  urgency: z.enum(['now', 'this_week', 'whenever']).default('whenever'),
  visibility: z.enum(['friends', 'friends_of_friends', 'network']).default('friends'),
  chatId: z.string().optional(),
})

app.post('/needs', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = needSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)

  const { description, category, urgency, visibility, chatId } = parsed.data

  // Generate embedding
  let embedding: number[] | null = null
  try {
    embedding = await generateEmbedding(description)
  } catch (e) {
    console.error('[NETWORK] Embedding generation failed:', e)
  }

  const id = crypto.randomUUID()
  db.insert(schema.needs).values({
    id,
    userId,
    chatId: chatId || null,
    description,
    embedding,
    category,
    urgency,
    source: 'explicit',
    visibility,
    status: 'active',
    expiresAt: getExpiresAt(urgency),
  }).run()

  return c.json({ need: { id, description, category, urgency, visibility, status: 'active' } }, 201)
})

app.get('/needs', (c) => {
  const userId = c.get('userId') as string
  const needs = db.select({
    id: schema.needs.id,
    description: schema.needs.description,
    category: schema.needs.category,
    urgency: schema.needs.urgency,
    visibility: schema.needs.visibility,
    status: schema.needs.status,
    source: schema.needs.source,
    createdAt: schema.needs.createdAt,
    expiresAt: schema.needs.expiresAt,
  })
    .from(schema.needs)
    .where(eq(schema.needs.userId, userId))
    .orderBy(desc(schema.needs.createdAt))
    .all()

  return c.json({ needs })
})

app.delete('/needs/:id', (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  db.update(schema.needs)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.needs.id, id), eq(schema.needs.userId, userId)))
    .run()
  return c.json({ ok: true })
})

// ── Offers CRUD ─────────────────────────────────────────────────────────────

const offerSchema = z.object({
  description: z.string().min(2).max(500),
  category: z.enum(['professional', 'social', 'hobby']),
})

app.post('/offers', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = offerSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)

  const { description, category } = parsed.data

  let embedding: number[] | null = null
  try {
    embedding = await generateEmbedding(description)
  } catch (e) {
    console.error('[NETWORK] Embedding generation failed:', e)
  }

  const id = crypto.randomUUID()
  db.insert(schema.offers).values({
    id,
    userId,
    description,
    embedding,
    category,
    source: 'explicit',
    availability: 'available',
  }).run()

  return c.json({ offer: { id, description, category, availability: 'available' } }, 201)
})

app.get('/offers', (c) => {
  const currentUserId = c.get('userId') as string
  const queryUserId = c.req.query('userId') || currentUserId
  const offers = db.select({
    id: schema.offers.id,
    description: schema.offers.description,
    category: schema.offers.category,
    availability: schema.offers.availability,
    source: schema.offers.source,
    createdAt: schema.offers.createdAt,
  })
    .from(schema.offers)
    .where(eq(schema.offers.userId, queryUserId))
    .orderBy(desc(schema.offers.createdAt))
    .all()

  return c.json({ offers })
})

app.delete('/offers/:id', (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  db.delete(schema.offers)
    .where(and(eq(schema.offers.id, id), eq(schema.offers.userId, userId)))
    .run()
  return c.json({ ok: true })
})

// ── Matching ────────────────────────────────────────────────────────────────

app.post('/match/:needId', async (c) => {
  const userId = c.get('userId') as string
  const needId = c.req.param('needId')

  const need = db.select()
    .from(schema.needs)
    .where(and(eq(schema.needs.id, needId), eq(schema.needs.userId, userId)))
    .get()

  if (!need) return c.json({ error: 'Need not found' }, 404)
  if (need.status !== 'active') return c.json({ error: 'Need is not active' }, 400)

  const candidates = await findMatchingOffers(
    need.id,
    need.userId,
    need.description,
    need.embedding as number[] | null,
    need.category,
    need.visibility as Visibility,
  )

  if (candidates.length === 0) {
    return c.json({ matches: [], message: 'No matching offers found' })
  }

  // Get display names for candidates
  const enriched = candidates.slice(0, 10).map(candidate => {
    const user = db.select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, candidate.userId))
      .get()

    return {
      ...candidate,
      displayName: candidate.socialDistance <= 1
        ? user?.displayName || 'Unknown'
        : `Знакомый ${candidate.mutualContactName || 'вашего контакта'}`,
    }
  })

  return c.json({ matches: enriched })
})

// ── Propose match (sends consent to provider) ──────────────────────────────

app.post('/match/:needId/propose/:offerId', async (c) => {
  const userId = c.get('userId') as string
  const needId = c.req.param('needId')
  const offerId = c.req.param('offerId')

  const need = db.select().from(schema.needs)
    .where(and(eq(schema.needs.id, needId), eq(schema.needs.userId, userId))).get()
  if (!need) return c.json({ error: 'Need not found' }, 404)

  const offer = db.select().from(schema.offers).where(eq(schema.offers.id, offerId)).get()
  if (!offer) return c.json({ error: 'Offer not found' }, 404)

  // Create match record
  const matchId = crypto.randomUUID()
  const { distance, via } = getSocialDistance(userId, offer.userId)

  db.insert(schema.matches).values({
    id: matchId,
    needId,
    offerId,
    requesterId: userId,
    providerId: offer.userId,
    similarityScore: 0,
    socialDistance: distance,
    mutualContactId: via || null,
    status: 'proposed',
  }).run()

  // Send consent request to provider
  const requester = db.select({ displayName: schema.users.displayName })
    .from(schema.users).where(eq(schema.users.id, userId)).get()

  const context = via
    ? `Знакомый ${requester?.displayName || 'кого-то'} ищет: ${need.description}. Предложить тебя?`
    : `${requester?.displayName || 'Пользователь'} ищет: ${need.description}. Предложить тебя?`

  // Fire and forget — consent response updates match status
  requestConsent(userId, offer.userId, 'match_offer', context, 86400000).then(result => {
    db.update(schema.matches)
      .set({ status: result.approved ? 'accepted' : 'declined' })
      .where(eq(schema.matches.id, matchId))
      .run()

    // Notify requester
    sendToUser(userId, {
      type: 'match_update',
      matchId,
      status: result.approved ? 'accepted' : 'declined',
      providerMessage: result.message,
    })
  })

  return c.json({ matchId, status: 'proposed' })
})

// ── Matches list ────────────────────────────────────────────────────────────

app.get('/matches', (c) => {
  const userId = c.get('userId') as string
  const matches = db.select()
    .from(schema.matches)
    .where(or(
      eq(schema.matches.requesterId, userId),
      eq(schema.matches.providerId, userId),
    ))
    .orderBy(desc(schema.matches.createdAt))
    .all()

  return c.json({ matches })
})

// ── Match feedback ──────────────────────────────────────────────────────────

const feedbackSchema = z.object({
  matchId: z.string(),
  rating: z.number().min(1).max(5),
})

app.post('/match-feedback', (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json' as never) || {}
  const parsed = feedbackSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const match = db.select().from(schema.matches)
    .where(eq(schema.matches.id, parsed.data.matchId)).get()
  if (!match) return c.json({ error: 'Match not found' }, 404)

  if (match.requesterId === userId) {
    db.update(schema.matches)
      .set({ requesterRating: parsed.data.rating, status: 'completed', completedAt: new Date() })
      .where(eq(schema.matches.id, parsed.data.matchId)).run()
  } else if (match.providerId === userId) {
    db.update(schema.matches)
      .set({ providerRating: parsed.data.rating, status: 'completed', completedAt: new Date() })
      .where(eq(schema.matches.id, parsed.data.matchId)).run()
  } else {
    return c.json({ error: 'Not a participant' }, 403)
  }

  return c.json({ ok: true })
})

// ── Consent endpoints ───────────────────────────────────────────────────────

app.get('/consent', (c) => {
  const userId = c.get('userId') as string
  const pending = getPendingConsents(userId)
  return c.json({ requests: pending })
})

app.post('/consent/:id', async (c) => {
  const userId = c.get('userId') as string
  const requestId = c.req.param('id')
  const body = await c.req.json<{ approved: boolean; message?: string }>()

  // Verify this request is for this user
  const request = db.select().from(schema.consentRequests)
    .where(and(
      eq(schema.consentRequests.id, requestId),
      eq(schema.consentRequests.toUserId, userId),
    )).get()

  if (!request) return c.json({ error: 'Request not found' }, 404)
  if (request.status !== 'pending') return c.json({ error: 'Already responded' }, 400)

  handleConsentResponse(requestId, body.approved, body.message)
  return c.json({ ok: true })
})

// ── Trust score ─────────────────────────────────────────────────────────────

app.get('/trust/:userId', (c) => {
  const myUserId = c.get('userId') as string
  const targetUserId = c.req.param('userId')

  const trustScore = calculateTrustScore(targetUserId, myUserId)
  const { distance } = getSocialDistance(myUserId, targetUserId)

  return c.json({
    userId: targetUserId,
    trustScore: Math.round(trustScore * 10) / 10,
    stars: Math.round(trustScore),
    socialDistance: distance,
  })
})

// ── Who's free? (mass consent request) ──────────────────────────────────────

const whosFreeSchema = z.object({
  context: z.string().min(2).max(300),
  timeoutMinutes: z.number().min(5).max(1440).default(120),
})

app.post('/whos-free', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = whosFreeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { context, timeoutMinutes } = parsed.data
  const timeoutMs = timeoutMinutes * 60000

  // Get friends (not acquaintances)
  const contacts = getDirectContacts(userId)
  const friends = contacts.filter(contactId => {
    const level = getRelationshipLevel(userId, contactId)
    return level === 'friend' || level === 'close'
  })

  if (friends.length === 0) {
    return c.json({ message: 'No friends found to ask', responses: [] })
  }

  // Send consent requests to all friends in parallel
  const promises = friends.map(friendId =>
    requestConsent(userId, friendId, 'availability', context, timeoutMs)
      .then(result => {
        const user = db.select({ displayName: schema.users.displayName })
          .from(schema.users).where(eq(schema.users.id, friendId)).get()
        return {
          userId: friendId,
          displayName: user?.displayName || 'Unknown',
          available: result.approved,
          message: result.message,
          expired: result.expired || false,
        }
      })
  )

  // Return immediately with pending status, results come via WebSocket
  // But also race with a short initial timeout for quick responses
  const quickResults = await Promise.race([
    Promise.all(promises),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 10000)), // 10s initial wait
  ])

  if (quickResults) {
    return c.json({ responses: quickResults, complete: true })
  }

  // If not all responded in 10s, return what we have and let WS handle the rest
  return c.json({
    message: `Asking ${friends.length} friends. Results will arrive via notifications.`,
    friendsAsked: friends.length,
    complete: false,
  })
})

// ── Gift ideas ──────────────────────────────────────────────────────────────

const giftSchema = z.object({
  contactId: z.string(),
  chatId: z.string(),
  occasion: z.string().optional(),
})

app.post('/gift-ideas', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const parsed = giftSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { contactId, chatId, occasion } = parsed.data

  // Get facts about the contact from our own memory
  const memories = db.select({ fact: schema.contactMemory.fact, category: schema.contactMemory.category })
    .from(schema.contactMemory)
    .where(and(
      eq(schema.contactMemory.userId, userId),
      eq(schema.contactMemory.contactId, contactId),
      eq(schema.contactMemory.isActive, true),
    ))
    .all()

  // Get persona topics
  const intel = db.select({ persona: schema.contactIntelligence.persona })
    .from(schema.contactIntelligence)
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.chatId, chatId),
    ))
    .get()

  const persona = intel?.persona as Record<string, any> | null
  const activeTopics = persona?.currentState?.activeTopics || []

  const factsList = memories.map(m => `- [${m.category}] ${m.fact}`).join('\n')
  const topicsList = activeTopics.join(', ')

  const config = getModelConfig('generation')
  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `Ты помощник по подбору подарков. Предложи 3-5 конкретных идей подарков на основе известных фактов о человеке. Будь конкретным (названия, цены примерно). Отвечай на русском.`
      },
      {
        role: 'user',
        content: `Известные факты:\n${factsList || 'Нет данных'}\n\nТекущие интересы: ${topicsList || 'неизвестны'}\n\n${occasion ? `Повод: ${occasion}` : 'Подарок без повода'}\n\nПредложи идеи подарков.`
      }
    ],
    temperature: 0.7,
    maxTokens: 500,
  })

  return c.json({ ideas: result, factsUsed: memories.length, topics: activeTopics })
})

export default app
