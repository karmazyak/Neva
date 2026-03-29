import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { sendToUser } from '../ws'
import type { RelationshipLevel, AccessRule, ConsentType } from '../a2a/types'
import {
  handleConsentDialog,
  handleWhosFreeChildResponse,
  handleMatchProposalResponse,
  handleGatherChildResponse,
} from '../a2a/agent-skills-internal'
import { respondToDialog } from '../a2a/agent-dialog'

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

// ── Consent via Agent Dialogs (non-blocking) ─────────────────────────────────

export interface ConsentResult {
  approved: boolean
  message?: string
  expired?: boolean
  dialogId?: string
}

/**
 * Request consent through the agent dialog system.
 * Returns a dialogId immediately — no more blocking Promises.
 * The result arrives via WebSocket agent_dialog_update.
 */
export function requestConsentAsync(
  fromUserId: string,
  toUserId: string,
  type: ConsentType,
  context: string,
  timeoutMs: number = 86400000,
): { dialogId: string; autoResolved: boolean; approved?: boolean } {
  return handleConsentDialog(fromUserId, toUserId, type, context, timeoutMs)
}

/**
 * Legacy blocking version — kept for backward compat with external A2A executor.
 * Uses dialog system under the hood but polls for result.
 */
export async function requestConsent(
  fromUserId: string,
  toUserId: string,
  type: ConsentType,
  context: string,
  timeoutMs: number = 86400000,
): Promise<ConsentResult> {
  const result = handleConsentDialog(fromUserId, toUserId, type, context, timeoutMs)

  if (result.autoResolved) {
    return {
      approved: result.approved!,
      dialogId: result.dialogId,
    }
  }

  // Poll DB for response (with timeout)
  const startTime = Date.now()
  const pollInterval = 2000 // 2s

  return new Promise<ConsentResult>((resolve) => {
    const check = () => {
      const dialog = db.select({ status: schema.agentDialogs.status, result: schema.agentDialogs.result })
        .from(schema.agentDialogs)
        .where(eq(schema.agentDialogs.id, result.dialogId))
        .get()

      if (!dialog || dialog.status === 'pending') {
        if (Date.now() - startTime > timeoutMs) {
          resolve({ approved: false, expired: true, dialogId: result.dialogId })
          return
        }
        setTimeout(check, pollInterval)
        return
      }

      const approved = dialog.status === 'approved' || dialog.status === 'auto_approved'
      resolve({
        approved,
        dialogId: result.dialogId,
        message: (dialog.result as any)?.message,
      })
    }
    setTimeout(check, pollInterval)
  })
}

/**
 * Handle consent/dialog response — routes to appropriate handler based on dialog type.
 */
export function handleConsentResponse(
  requestId: string,
  approved: boolean,
  message?: string,
): void {
  // First, check if this is a dialog ID (new system)
  const dialog = db.select({ id: schema.agentDialogs.id, type: schema.agentDialogs.type })
    .from(schema.agentDialogs)
    .where(eq(schema.agentDialogs.id, requestId))
    .get()

  if (dialog) {
    // Route to appropriate handler based on dialog type
    if (dialog.type === 'whos_free') {
      // Check if this belongs to a gather parent
      const fullDialog = db.select()
        .from(schema.agentDialogs)
        .where(eq(schema.agentDialogs.id, requestId))
        .get()
      const isGatherChild = fullDialog?.contextData && (fullDialog.contextData as any).isGatherChild

      if (isGatherChild) {
        handleGatherChildResponse(requestId, approved, message)
      } else {
        handleWhosFreeChildResponse(requestId, approved, message)
      }
    } else if (dialog.type === 'match_proposal') {
      handleMatchProposalResponse(requestId, approved, message)
    } else {
      respondToDialog(requestId, approved, message)
    }
    return
  }

  // Legacy: update consent_requests table directly
  db.update(schema.consentRequests)
    .set({
      status: approved ? 'approved' : 'denied',
      responseMessage: message || null,
    })
    .where(eq(schema.consentRequests.id, requestId))
    .run()

  // If there's a linked dialog, respond to that too
  const consentReq = db.select({ dialogId: schema.consentRequests.dialogId, fromUserId: schema.consentRequests.fromUserId, toUserId: schema.consentRequests.toUserId })
    .from(schema.consentRequests)
    .where(eq(schema.consentRequests.id, requestId))
    .get()

  if (consentReq?.dialogId) {
    respondToDialog(consentReq.dialogId, approved, message)
  }

  // Notify the requester
  if (consentReq) {
    sendToUser(consentReq.fromUserId, {
      type: 'consent_response',
      requestId,
      approved,
      message,
      fromUserId: consentReq.toUserId,
    })
  }
}

/**
 * Get pending consent requests for a user (includes both legacy and dialog-based).
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
