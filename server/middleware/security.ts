import { Context, Next } from 'hono'

// ========== RATE LIMITER ==========
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) rateLimitStore.delete(key)
  }
}, 5 * 60 * 1000)

interface RateLimitOptions {
  windowMs: number  // Time window in milliseconds
  max: number       // Max requests per window
  keyPrefix?: string
}

export function rateLimiter(options: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
    const key = `${options.keyPrefix || 'global'}:${ip}`
    const now = Date.now()

    let entry = rateLimitStore.get(key)
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + options.windowMs }
      rateLimitStore.set(key, entry)
    }

    entry.count++

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(options.max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > options.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'Too many requests. Please try again later.' }, 429)
    }

    await next()
  }
}

// ========== SECURITY HEADERS ==========
export async function securityHeaders(c: Context, next: Next) {
  await next()

  // Prevent MIME sniffing
  c.header('X-Content-Type-Options', 'nosniff')
  // Prevent clickjacking
  c.header('X-Frame-Options', 'DENY')
  // XSS protection (legacy browsers)
  c.header('X-XSS-Protection', '1; mode=block')
  // Referrer policy - don't leak URLs
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Permissions policy - restrict browser features
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Content Security Policy
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '))
  // HSTS (when behind HTTPS proxy)
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

// ========== MESSAGE SANITIZER ==========
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
}

export function sanitizeInput(input: string): string {
  return input.replace(/[&<>"'/]/g, (char) => HTML_ENTITIES[char] || char)
}

// Strip potential script/html from message content for storage
export function sanitizeMessage(content: string): string {
  // Remove any HTML tags
  let sanitized = content.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  sanitized = sanitized.replace(/<\/?[^>]+(>|$)/g, '')
  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:/gi, '')
  // Remove data: URIs that could contain scripts
  sanitized = sanitized.replace(/data:text\/html/gi, '')
  return sanitized.trim()
}

// ========== LOGIN BRUTE FORCE PROTECTION ==========
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>()

export function checkLoginAttempts(identifier: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const entry = loginAttempts.get(identifier)

  if (!entry) return { allowed: true }

  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) }
  }

  // Reset if lock expired
  if (entry.count >= 5) {
    loginAttempts.delete(identifier)
    return { allowed: true }
  }

  return { allowed: true }
}

export function recordLoginAttempt(identifier: string, success: boolean) {
  if (success) {
    loginAttempts.delete(identifier)
    return
  }

  const entry = loginAttempts.get(identifier) || { count: 0, lockedUntil: 0 }
  entry.count++

  // Progressive lockout: 30s after 3 fails, 5min after 5 fails, 30min after 10 fails
  if (entry.count >= 10) {
    entry.lockedUntil = Date.now() + 30 * 60 * 1000  // 30 minutes
  } else if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 5 * 60 * 1000   // 5 minutes
  } else if (entry.count >= 3) {
    entry.lockedUntil = Date.now() + 30 * 1000        // 30 seconds
  }

  loginAttempts.set(identifier, entry)
}

// Clean up login attempts every 30 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of loginAttempts) {
    if (entry.lockedUntil < now && entry.count < 3) {
      loginAttempts.delete(key)
    }
  }
}, 30 * 60 * 1000)
