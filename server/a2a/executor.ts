import type { SendMessageParams, A2AMessage, TextPart } from './types'
import type { ExecutionEventBus } from './event-bus'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { findMatchingOffers } from '../ai/matching'
import { requestConsent, checkAccess, getRelationshipLevel } from '../ai/consent'
import { generateEmbedding } from '../ai/embeddings'

// ── Helpers ─────────────────────────────────────────────────────────────────

function getTextFromParts(parts: A2AMessage['parts']): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map(p => p.text)
    .join('\n')
}

function agentMessage(text: string): A2AMessage {
  return { role: 'agent', parts: [{ type: 'text', text }] }
}

// ── Executor ────────────────────────────────────────────────────────────────

export class NevaAgentExecutor {
  /**
   * Execute a skill based on incoming A2A message.
   */
  async execute(params: SendMessageParams, bus: ExecutionEventBus): Promise<void> {
    const skillId = params.metadata?.skillId
    const userText = getTextFromParts(params.message.parts)

    bus.publish({ type: 'status', state: 'working' })

    try {
      switch (skillId) {
        case 'check-availability':
          await this.checkAvailability(userText, params, bus)
          break
        case 'match-need':
          await this.matchNeed(userText, params, bus)
          break
        case 'get-interests':
          await this.getInterests(userText, params, bus)
          break
        default:
          // No specific skill — try to understand from text
          await this.handleFreeform(userText, params, bus)
          break
      }

      bus.publish({ type: 'status', state: 'completed', message: agentMessage('Done') })
    } catch (err) {
      bus.publish({
        type: 'status',
        state: 'failed',
        message: agentMessage(`Error: ${err instanceof Error ? err.message : String(err)}`),
      })
    }

    bus.finish()
  }

  async cancelTask(taskId: string): Promise<void> {
    // Cancel any pending consent requests for this task
    // In the future: track task→consentRequest mapping
  }

  // ── Skills ──────────────────────────────────────────────────────────────

  /**
   * check-availability: Ask a target user if they're free.
   * Requires: targetUserId in message metadata or text.
   * 0 LLM calls — consent flow only.
   */
  private async checkAvailability(
    text: string,
    params: SendMessageParams,
    bus: ExecutionEventBus,
  ): Promise<void> {
    const targetUserId = (params.metadata as any)?.targetUserId as string | undefined
    if (!targetUserId) {
      bus.publish({ type: 'status', state: 'failed', message: agentMessage('targetUserId is required in metadata') })
      return
    }

    const callerAppId = (params.metadata as any)?.callerUserId as string | undefined
    if (!callerAppId) {
      bus.publish({ type: 'status', state: 'failed', message: agentMessage('callerUserId is required') })
      return
    }

    // Check access rules
    const access = checkAccess('availability', callerAppId, targetUserId)
    if (!access.allowed) {
      bus.publish({
        type: 'artifact',
        artifact: {
          name: 'availability-result',
          parts: [{ type: 'text', text: JSON.stringify({ allowed: false, reason: 'insufficient_relationship' }) }],
        },
      })
      return
    }

    // Send consent request
    bus.publish({ type: 'status', state: 'working', message: agentMessage('Asking user...') })

    const result = await requestConsent(
      callerAppId,
      targetUserId,
      'availability',
      text || 'Checking availability',
      300000, // 5 min timeout for availability checks
    )

    bus.publish({
      type: 'artifact',
      artifact: {
        name: 'availability-result',
        parts: [{
          type: 'text',
          text: JSON.stringify({
            available: result.approved,
            message: result.message,
            expired: result.expired || false,
          }),
        }],
      },
    })
  }

  /**
   * match-need: Find matching offers for a described need.
   * 1 LLM call (embedding).
   */
  private async matchNeed(
    text: string,
    params: SendMessageParams,
    bus: ExecutionEventBus,
  ): Promise<void> {
    if (!text) {
      bus.publish({ type: 'status', state: 'failed', message: agentMessage('Need description is required') })
      return
    }

    bus.publish({ type: 'status', state: 'working', message: agentMessage('Searching for matches...') })

    const callerUserId = (params.metadata as any)?.callerUserId as string
    const visibility = ((params.metadata as any)?.visibility || 'friends') as 'friends' | 'friends_of_friends' | 'network'

    // Generate embedding for the need
    const embedding = await generateEmbedding(text)

    const candidates = await findMatchingOffers(
      'a2a-search', // virtual needId
      callerUserId || 'anonymous',
      text,
      embedding,
      'professional', // default category
      visibility,
    )

    bus.publish({
      type: 'artifact',
      artifact: {
        name: 'match-results',
        description: `Found ${candidates.length} matching offers`,
        parts: [{
          type: 'text',
          text: JSON.stringify(candidates.slice(0, 10)),
        }],
      },
    })
  }

  /**
   * get-interests: Get a user's current interests/topics.
   * 0 LLM calls — pure DB read.
   */
  private async getInterests(
    text: string,
    params: SendMessageParams,
    bus: ExecutionEventBus,
  ): Promise<void> {
    const targetUserId = (params.metadata as any)?.targetUserId as string
    const callerUserId = (params.metadata as any)?.callerUserId as string

    if (!targetUserId || !callerUserId) {
      bus.publish({ type: 'status', state: 'failed', message: agentMessage('targetUserId and callerUserId required') })
      return
    }

    // Check access
    const access = checkAccess('interests', callerUserId, targetUserId)
    if (!access.allowed) {
      bus.publish({
        type: 'artifact',
        artifact: { name: 'interests', parts: [{ type: 'text', text: JSON.stringify({ allowed: false }) }] },
      })
      return
    }

    // Get persona data — interests come from activeTopics
    const intels = db.select({ persona: schema.contactIntelligence.persona })
      .from(schema.contactIntelligence)
      .where(eq(schema.contactIntelligence.contactId, targetUserId))
      .all()

    const allTopics = new Set<string>()
    for (const intel of intels) {
      const persona = intel.persona as Record<string, any> | null
      const topics = persona?.currentState?.activeTopics || []
      for (const t of topics) allTopics.add(t)
    }

    bus.publish({
      type: 'artifact',
      artifact: {
        name: 'interests',
        parts: [{ type: 'text', text: JSON.stringify({ interests: [...allTopics] }) }],
      },
    })
  }

  /**
   * Freeform: no specific skill — return a helpful message.
   */
  private async handleFreeform(
    text: string,
    params: SendMessageParams,
    bus: ExecutionEventBus,
  ): Promise<void> {
    bus.publish({
      type: 'status',
      state: 'completed',
      message: agentMessage(
        `Available skills: check-availability, match-need, get-interests. ` +
        `Please specify a skillId in metadata.`
      ),
    })
  }
}
