import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { sendToUser } from '../ws'
import type { RelationshipLevel, AccessRule, ConsentType } from '../a2a/types'

// ── Access Rules ────────────────────────────────────────────────────────────

const ACCESS_RULES: AccessRule[] = [
  { dataType: 'interests',      minRelationship: 'acquaintance', requiresConsent: false },
  { dataType: 'expertise',      minRelationship: 'acquaintance', requiresConsent: true },
  { dataType: 'availability',   minRelationship: 'friend',       requiresConsent: true },
  { dataType: 'mood_abstract',  minRelationship: 'friend',       requiresConsent: false },
  { dataType: 'facts',          minRelationship: 'close',        requiresConsent: false },
  { dataType: 'wishes',         minRelationship: 'close',        requiresConsent: false },
]

const RELATIONSHIP_HIERARCHY: Record<RelationshipLevel, number> = {
  acquaintance: 0,
  friend: 1,
  close: 2,
}

export function getRelationshipLevel(userId: string, contactId: string): RelationshipLevel {
  // Check contact_intelligence for existing relationship type
  const intel = db.select({ relationshipType: schema.contactIntelligence.relationshipType })
    .from(schema.contactIntelligence)
    .where(and(
      eq(schema.contactIntelligence.userId, userId),
      eq(schema.contactIntelligence.contactId, contactId),
    ))
    .get()

  if (!intel?.relationshipType) return 'acquaintance'

  switch (intel.relationshipType) {
    case 'family': return 'close'
    case 'friend': return 'friend'
    case 'work':
    case 'client': return 'friend'
    default: return 'acquaintance'
  }
}

export function checkAccess(
  dataType: string,
  fromUserId: string,
  targetUserId: string,
): { allowed: boolean; requiresConsent: boolean } {
  const rule = ACCESS_RULES.find(r => r.dataType === dataType)
  if (!rule) return { allowed: false, requiresConsent: false }

  const level = getRelationshipLevel(fromUserId, targetUserId)
  const hasLevel = RELATIONSHIP_HIERARCHY[level] >= RELATIONSHIP_HIERARCHY[rule.minRelationship]

  if (!hasLevel) return { allowed: false, requiresConsent: false }

  return { allowed: true, requiresConsent: rule.requiresConsent }
}

// ── Consent Request/Response ────────────────────────────────────────────────

// Pending consent resolvers — keyed by request ID
const pendingConsents = new Map<string, {
  resolve: (result: ConsentResult) => void
  timeout: ReturnType<typeof setTimeout>
}>()

export interface ConsentResult {
  approved: boolean
  message?: string
  expired?: boolean
}

export async function requestConsent(
  fromUserId: string,
  toUserId: string,
  type: ConsentType,
  context: string,
  timeoutMs: number = 86400000, // 24h default
): Promise<ConsentResult> {
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + timeoutMs)

  // Persist to DB
  db.insert(schema.consentRequests).values({
    id,
    fromUserId,
    toUserId,
    type,
    context,
    status: 'pending',
    expiresAt,
  }).run()

  // Get requester name for display
  const fromUser = db.select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, fromUserId))
    .get()

  // Push to target user via WebSocket
  sendToUser(toUserId, {
    type: 'consent_request',
    request: {
      id,
      fromUserId,
      fromUserName: fromUser?.displayName || 'Кто-то',
      consentType: type,
      context,
      expiresAt: expiresAt.toISOString(),
    },
  })

  // Wait for response or timeout
  return new Promise<ConsentResult>((resolve) => {
    const timeout = setTimeout(() => {
      pendingConsents.delete(id)
      // Mark expired in DB
      db.update(schema.consentRequests)
        .set({ status: 'expired' })
        .where(eq(schema.consentRequests.id, id))
        .run()
      resolve({ approved: false, expired: true })
    }, Math.min(timeoutMs, 86400000))

    pendingConsents.set(id, { resolve, timeout })
  })
}

/**
 * Called from WebSocket handler when user responds to a consent request.
 */
export function handleConsentResponse(
  requestId: string,
  approved: boolean,
  message?: string,
): void {
  // Update DB
  db.update(schema.consentRequests)
    .set({
      status: approved ? 'approved' : 'denied',
      responseMessage: message || null,
    })
    .where(eq(schema.consentRequests.id, requestId))
    .run()

  // Resolve pending promise
  const pending = pendingConsents.get(requestId)
  if (pending) {
    clearTimeout(pending.timeout)
    pendingConsents.delete(requestId)
    pending.resolve({ approved, message })
  }

  // Notify the requester
  const request = db.select()
    .from(schema.consentRequests)
    .where(eq(schema.consentRequests.id, requestId))
    .get()

  if (request) {
    sendToUser(request.fromUserId, {
      type: 'consent_response',
      requestId,
      approved,
      message,
      fromUserId: request.toUserId,
    })
  }
}

/**
 * Get pending consent requests for a user.
 */
export function getPendingConsents(userId: string) {
  return db.select()
    .from(schema.consentRequests)
    .where(and(
      eq(schema.consentRequests.toUserId, userId),
      eq(schema.consentRequests.status, 'pending'),
    ))
    .all()
}
