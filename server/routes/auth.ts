import { Hono } from 'hono'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db, schema } from '../db'
import { eq } from 'drizzle-orm'
import { signToken } from '../middleware/auth'
import { checkLoginAttempts, recordLoginAttempt } from '../middleware/security'

const auth = new Hono()

// Strong password validation
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  displayName: z.string().min(1).max(50),
  email: z.string().email(),
  password: passwordSchema,
})

const loginSchema = z.object({
  login: z.string().max(100),
  password: z.string().max(128),
})

auth.post('/register', async (c) => {
  const body = await c.req.json()
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { username, displayName, email, password } = parsed.data

  const existing = db.select().from(schema.users)
    .where(eq(schema.users.username, username)).get()
  if (existing) {
    return c.json({ error: 'Username already taken' }, 409)
  }

  const existingEmail = db.select().from(schema.users)
    .where(eq(schema.users.email, email)).get()
  if (existingEmail) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  // bcrypt with 14 rounds (stronger than default 12)
  const passwordHash = await bcrypt.hash(password, 14)
  const id = crypto.randomUUID()

  db.insert(schema.users).values({
    id,
    username,
    displayName,
    email,
    passwordHash,
  }).run()

  const token = signToken({ userId: id, username })

  return c.json({
    token,
    user: { id, username, displayName, email, avatar: null, bio: null, onboardingCompleted: false },
  })
})

auth.post('/login', async (c) => {
  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { login, password } = parsed.data
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
  const attemptKey = `${ip}:${login}`

  // Check brute force lockout
  const { allowed, retryAfterSec } = checkLoginAttempts(attemptKey)
  if (!allowed) {
    return c.json({
      error: `Too many login attempts. Try again in ${retryAfterSec} seconds.`
    }, 429)
  }

  const user = db.select().from(schema.users)
    .where(
      login.includes('@')
        ? eq(schema.users.email, login)
        : eq(schema.users.username, login)
    ).get()

  if (!user) {
    recordLoginAttempt(attemptKey, false)
    // Same error message for both invalid user and password (prevents enumeration)
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    recordLoginAttempt(attemptKey, false)
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Successful login — clear attempts
  recordLoginAttempt(attemptKey, true)

  const token = signToken({ userId: user.id, username: user.username })

  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      onboardingCompleted: !!user.onboardingCompleted,
    },
  })
})

auth.get('/me', async (c) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const { verifyToken } = await import('../middleware/auth')
    const payload = verifyToken(header.slice(7))

    const user = db.select().from(schema.users)
      .where(eq(schema.users.id, payload.userId)).get()

    if (!user) return c.json({ error: 'User not found' }, 404)

    return c.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      statusText: user.statusText || null,
      statusEmoji: user.statusEmoji || null,
      onboardingCompleted: !!user.onboardingCompleted,
    })
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

// Update user status
auth.put('/status', async (c) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const { verifyToken } = await import('../middleware/auth')
    const payload = verifyToken(header.slice(7))
    const { statusText, statusEmoji } = await c.req.json()

    const { sql } = await import('drizzle-orm')
    db.run(sql`UPDATE users SET status_text = ${statusText || null}, status_emoji = ${statusEmoji || null} WHERE id = ${payload.userId}`)

    // Broadcast to user's chats
    const { broadcastToChat } = await import('../ws')
    const userChats = db.select({ chatId: schema.chatMembers.chatId })
      .from(schema.chatMembers).where(eq(schema.chatMembers.userId, payload.userId)).all()
    for (const { chatId } of userChats) {
      broadcastToChat(chatId, { type: 'user_status_updated', userId: payload.userId, statusText, statusEmoji })
    }
    return c.json({ ok: true })
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

// Complete onboarding
auth.post('/onboarding-complete', async (c) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const { verifyToken } = await import('../middleware/auth')
    const payload = verifyToken(header.slice(7))
    const { sql } = await import('drizzle-orm')
    db.run(sql`UPDATE users SET onboarding_completed = 1 WHERE id = ${payload.userId}`)
    return c.json({ ok: true })
  } catch (err) {
    console.error('Onboarding error:', err)
    return c.json({ error: 'Invalid token' }, 401)
  }
})

export default auth
