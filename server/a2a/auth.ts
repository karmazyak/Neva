import type { Context, Next } from 'hono'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'

/**
 * A2A auth middleware — verifies Bearer token against a2a_apps table.
 * API keys are stored as SHA-256 hashes.
 */
export async function a2aAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401)
  }

  const apiKey = authHeader.slice(7)
  if (!apiKey || apiKey.length < 8) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  // Hash the key and compare
  const hash = await hashApiKey(apiKey)
  const app = db.select()
    .from(schema.a2aApps)
    .where(and(
      eq(schema.a2aApps.apiKeyHash, hash),
      eq(schema.a2aApps.active, true),
    ))
    .get()

  if (!app) {
    return c.json({ error: 'Invalid or inactive API key' }, 401)
  }

  c.set('a2aAppId' as any, app.id)
  c.set('a2aAppName' as any, app.name)
  await next()
}

/**
 * Hash an API key using SHA-256.
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Register a new A2A app and return the raw API key (shown once).
 */
export async function registerA2AApp(name: string, permissions: string[] = []): Promise<{ appId: string; apiKey: string }> {
  const apiKey = `neva_a2a_${crypto.randomUUID().replace(/-/g, '')}`
  const hash = await hashApiKey(apiKey)
  const id = crypto.randomUUID()

  db.insert(schema.a2aApps).values({
    id,
    name,
    apiKeyHash: hash,
    permissions,
    active: true,
  }).run()

  return { appId: id, apiKey }
}
