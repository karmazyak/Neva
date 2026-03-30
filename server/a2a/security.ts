/**
 * A2A Security Layer
 *
 * 1. Input sanitization — strips prompt injection patterns from A2A text
 * 2. Silent rate limiting — per-user request caps (returns "unavailable", not 429)
 * 3. Anomaly detection — flags excessive queries to same target
 */

// ── Prompt Injection Sanitizer ─────────────────────────────────────────────

const INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/gi,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)/gi,
  /forget\s+(all\s+)?(previous|prior|above|earlier)/gi,
  /override\s+(system|instructions|rules|prompt)/gi,
  /new\s+instructions?\s*:/gi,
  /system\s*prompt\s*:/gi,
  // Role-play jailbreak attempts
  /you\s+are\s+now\s+/gi,
  /pretend\s+(you|to\s+be)/gi,
  /act\s+as\s+/gi,
  /role\s*play\s+as/gi,
  // Data exfiltration attempts
  /(?:reveal|show|give|tell|output|print|display|leak)\s+(?:your|the|all|my)?\s*(?:system|secret|private|hidden|internal)\s*(?:prompt|key|token|password|seed|phrase)/gi,
  /(?:24|12)\s*(?:words?|seed)\s*(?:phrase)?/gi,
  /(?:bitcoin|btc|eth|crypto)\s*(?:wallet|key|seed|phrase)/gi,
  /api[_\s]*key/gi,
  /(?:private|secret)[_\s]*key/gi,
  // Delimiter injection (trying to break out of context)
  /```\s*(?:system|assistant|user)/gi,
  /<\|(?:im_start|im_end|system|assistant)\|>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<\s*SYS\s*>>/gi,
  // Encoded/obfuscated injection
  /(?:base64|hex|rot13)\s*(?:decode|encode)/gi,
]

/**
 * Sanitize A2A input text: strip injection patterns and limit length.
 * Returns cleaned text — never throws. The "Avito approach":
 * we observe and neuter, but don't tell the attacker.
 */
export function sanitizeA2AInput(text: string): string {
  if (!text || typeof text !== 'string') return ''

  let cleaned = text

  // 1. Strip null bytes and control characters (except newlines/tabs)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // 2. Remove injection patterns (replace with empty string, silently)
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // 3. Limit length (long inputs are suspicious)
  const MAX_A2A_TEXT_LENGTH = 1000
  if (cleaned.length > MAX_A2A_TEXT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_A2A_TEXT_LENGTH)
  }

  // 4. Collapse excessive whitespace
  cleaned = cleaned.replace(/\s{3,}/g, '  ').trim()

  return cleaned
}

/**
 * Check if text contains injection patterns (for logging/monitoring).
 * Returns true if suspicious — but NEVER tells the caller what triggered it.
 */
export function hasInjectionSignals(text: string): boolean {
  if (!text) return false
  return INJECTION_PATTERNS.some(p => p.test(text))
}

// ── Silent Rate Limiter ────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  windowStart: number
}

// Per-user rate limiting (not per-IP — we care about which user is making requests)
const userRateLimits = new Map<string, RateLimitEntry>()

// Per-user-per-target anomaly tracking
const targetRequestTracker = new Map<string, { count: number; firstAt: number }>()

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_REQUESTS_PER_HOUR = 30 // normal usage is ~5-10
const ANOMALY_THRESHOLD = 3 // 3+ requests to same target in 1 hour = suspicious

// Cleanup interval
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of userRateLimits) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      userRateLimits.delete(key)
    }
  }
  for (const [key, entry] of targetRequestTracker) {
    if (now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
      targetRequestTracker.delete(key)
    }
  }
}, 5 * 60 * 1000) // cleanup every 5 min

/**
 * Silent rate limiter: returns false if over limit.
 * The caller should return a generic "unavailable" response.
 * Never returns 429 or explains why.
 */
export function checkA2ARateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = userRateLimits.get(userId)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    userRateLimits.set(userId, { count: 1, windowStart: now })
    return true
  }

  entry.count++
  return entry.count <= MAX_REQUESTS_PER_HOUR
}

/**
 * Track requests to specific target for anomaly detection.
 * Returns true if anomalous (3+ requests to same target in 1 hour).
 */
export function trackTargetRequest(userId: string, targetUserId: string): boolean {
  const key = `${userId}:${targetUserId}`
  const now = Date.now()
  const entry = targetRequestTracker.get(key)

  if (!entry || now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    targetRequestTracker.set(key, { count: 1, firstAt: now })
    return false
  }

  entry.count++
  return entry.count >= ANOMALY_THRESHOLD
}

// ── Audit Logger ───────────────────────────────────────────────────────────

interface A2ASecurityEvent {
  type: 'injection_attempt' | 'rate_limited' | 'anomaly_detected' | 'blocked_user'
  userId: string
  targetUserId?: string
  details?: string
}

const securityLog: A2ASecurityEvent[] = []
const MAX_LOG_SIZE = 1000

/**
 * Log a security event. In production this would go to a monitoring system.
 * For now, in-memory ring buffer.
 */
export function logSecurityEvent(event: A2ASecurityEvent) {
  securityLog.push({ ...event })
  if (securityLog.length > MAX_LOG_SIZE) {
    securityLog.shift()
  }
  // In dev, also log to console
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[A2A-Security] ${event.type}:`, event.userId, event.details || '')
  }
}

/**
 * Get recent security events (for admin dashboard).
 */
export function getSecurityEvents(limit = 50): A2ASecurityEvent[] {
  return securityLog.slice(-limit)
}
