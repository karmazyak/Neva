import { Hono } from 'hono'
import { db, schema } from '../db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const marketplace = new Hono()
marketplace.use('*', authMiddleware)

// Browse marketplace agents
marketplace.get('/', async (c) => {
  const category = c.req.query('category')
  const search = c.req.query('q')
  const sort = c.req.query('sort') || 'popular' // popular, newest, rating

  let query = db.select({
    id: schema.agents.id,
    name: schema.agents.name,
    description: schema.agents.description,
    avatar: schema.agents.avatar,
    model: schema.agents.model,
    tools: schema.agents.tools,
    modes: schema.agents.modes,
    category: schema.agents.category,
    rating: schema.agents.rating,
    downloads: schema.agents.downloads,
    price: schema.agents.price,
    featured: schema.agents.featured,
    ownerName: schema.users.displayName,
    createdAt: schema.agents.createdAt,
  })
    .from(schema.agents)
    .innerJoin(schema.users, eq(schema.agents.ownerId, schema.users.id))
    .where(eq(schema.agents.isPublic, true))

  const agents = query.all()

  let filtered = agents
  if (category) {
    filtered = filtered.filter(a => a.category === category)
  }
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q)
    )
  }

  filtered.sort((a, b) => {
    if (sort === 'newest') return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    if (sort === 'rating') return (b.rating || 0) - (a.rating || 0)
    return (b.downloads || 0) - (a.downloads || 0)
  })

  return c.json(filtered)
})

// Get agent details
marketplace.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId')

  const agent = db.select({
    id: schema.agents.id,
    name: schema.agents.name,
    description: schema.agents.description,
    avatar: schema.agents.avatar,
    systemPrompt: schema.agents.systemPrompt,
    model: schema.agents.model,
    tools: schema.agents.tools,
    category: schema.agents.category,
    rating: schema.agents.rating,
    downloads: schema.agents.downloads,
    price: schema.agents.price,
    ownerName: schema.users.displayName,
    createdAt: schema.agents.createdAt,
  })
    .from(schema.agents)
    .innerJoin(schema.users, eq(schema.agents.ownerId, schema.users.id))
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.isPublic, true)))
    .get()

  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  return c.json(agent)
})

// Install agent (clone to user's agents)
marketplace.post('/:agentId/install', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const original = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.isPublic, true)))
    .get()

  if (!original) return c.json({ error: 'Agent not found' }, 404)

  // Check if user already installed this agent (by name + same tools)
  const existing = db.select().from(schema.agents)
    .where(and(
      eq(schema.agents.ownerId, userId),
      eq(schema.agents.name, original.name)
    ))
    .all()
    .find(a => JSON.stringify(a.tools) === JSON.stringify(original.tools))

  if (existing) {
    return c.json({ error: 'You already have this agent installed', existingId: existing.id }, 409)
  }

  const newId = crypto.randomUUID()
  db.insert(schema.agents).values({
    id: newId,
    ownerId: userId,
    name: original.name,
    description: original.description,
    avatar: original.avatar,
    systemPrompt: original.systemPrompt,
    model: original.model,
    tools: original.tools,
    modes: original.modes,
    temperature: original.temperature,
    maxTokens: original.maxTokens,
    isPublic: false,
    category: original.category,
  }).run()

  // Increment download count
  db.update(schema.agents)
    .set({ downloads: (original.downloads || 0) + 1 })
    .where(eq(schema.agents.id, agentId))
    .run()

  // Return installed agent with skill info
  const installed = db.select().from(schema.agents)
    .where(eq(schema.agents.id, newId)).get()

  return c.json({ id: newId, installed: true, agent: installed })
})

// Add review for an agent
marketplace.post('/:agentId/review', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')
  const { rating, reviewText } = await c.req.json()
  if (!rating || rating < 1 || rating > 5) return c.json({ error: 'Rating 1-5 required' }, 400)

  // Upsert: delete old, insert new
  db.delete(schema.agentReviews).where(
    and(eq(schema.agentReviews.agentId, agentId), eq(schema.agentReviews.userId, userId))
  ).run()

  db.insert(schema.agentReviews).values({
    id: crypto.randomUUID(), agentId, userId, rating, reviewText: reviewText || null,
  }).run()

  // Update agent average rating
  const reviews = db.select({ rating: schema.agentReviews.rating }).from(schema.agentReviews)
    .where(eq(schema.agentReviews.agentId, agentId)).all()
  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
  db.update(schema.agents).set({ rating: Math.round(avgRating * 10) / 10 }).where(eq(schema.agents.id, agentId)).run()

  return c.json({ ok: true })
})

// Get reviews for an agent
marketplace.get('/:agentId/reviews', async (c) => {
  const agentId = c.req.param('agentId')
  const reviews = db.select({
    id: schema.agentReviews.id,
    userId: schema.agentReviews.userId,
    userName: schema.users.displayName,
    rating: schema.agentReviews.rating,
    reviewText: schema.agentReviews.reviewText,
    createdAt: schema.agentReviews.createdAt,
  }).from(schema.agentReviews)
    .innerJoin(schema.users, eq(schema.agentReviews.userId, schema.users.id))
    .where(eq(schema.agentReviews.agentId, agentId))
    .orderBy(desc(schema.agentReviews.createdAt))
    .all()
  return c.json(reviews)
})

export default marketplace
