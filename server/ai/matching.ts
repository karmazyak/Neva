import { db, schema } from '../db'
import { eq, and, ne, inArray, sql } from 'drizzle-orm'
import { cosineSimilarity, generateEmbedding } from './embeddings'
import type { MatchCandidate, Visibility } from '../a2a/types'
import { isBlockedBy } from '../a2a/privacy-vault'

const SIMILARITY_THRESHOLD = 0.35

// ── Social Graph ────────────────────────────────────────────────────────────

export function getDirectContacts(userId: string): string[] {
  const rows = db.select({ userId: schema.chatMembers.userId })
    .from(schema.chatMembers)
    .where(
      inArray(
        schema.chatMembers.chatId,
        db.select({ chatId: schema.chatMembers.chatId })
          .from(schema.chatMembers)
          .where(eq(schema.chatMembers.userId, userId))
      )
    )
    .all()

  const contacts = new Set<string>()
  for (const row of rows) {
    if (row.userId !== userId) contacts.add(row.userId)
  }
  return [...contacts]
}

export function getFriendsOfFriends(userId: string): Array<{ userId: string; via: string }> {
  const direct = new Set(getDirectContacts(userId))
  direct.add(userId)

  const fof: Map<string, string> = new Map() // userId → via (first mutual contact)

  for (const contactId of direct) {
    if (contactId === userId) continue
    const theirContacts = getDirectContacts(contactId)
    for (const fofId of theirContacts) {
      if (!direct.has(fofId) && !fof.has(fofId)) {
        fof.set(fofId, contactId)
      }
    }
  }

  return [...fof.entries()].map(([userId, via]) => ({ userId, via }))
}

export function getSocialDistance(fromUserId: string, toUserId: string): { distance: number; via?: string } {
  if (fromUserId === toUserId) return { distance: 0 }

  const direct = getDirectContacts(fromUserId)
  if (direct.includes(toUserId)) return { distance: 1 }

  const fof = getFriendsOfFriends(fromUserId)
  const found = fof.find(f => f.userId === toUserId)
  if (found) return { distance: 2, via: found.via }

  return { distance: 3 }
}

export function getMutualContact(userA: string, userB: string): { id: string; name: string } | null {
  const contactsA = new Set(getDirectContacts(userA))
  const contactsB = new Set(getDirectContacts(userB))

  for (const id of contactsA) {
    if (contactsB.has(id)) {
      const user = db.select({ displayName: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .get()
      return user ? { id, name: user.displayName } : null
    }
  }
  return null
}

// ── Trust Score ─────────────────────────────────────────────────────────────

export function calculateTrustScore(userId: string, fromUserId: string): number {
  // Component 1: Match history (50%)
  const matchRatings = db.select({ rating: schema.matches.providerRating })
    .from(schema.matches)
    .where(and(
      eq(schema.matches.providerId, userId),
      eq(schema.matches.status, 'completed'),
    ))
    .all()
    .filter(r => r.rating != null)

  const matchAvg = matchRatings.length > 0
    ? matchRatings.reduce((sum, r) => sum + r.rating!, 0) / matchRatings.length
    : 2.5 // neutral baseline for new users

  // Component 2: Activity (30%)
  const msgCount = db.select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(eq(schema.messages.senderId, userId))
    .get()
  const activity = Math.min(5, (msgCount?.count || 0) / 100) // 500+ msgs = 5

  // Component 3: Social distance (20%)
  const { distance } = getSocialDistance(fromUserId, userId)
  const distanceScore = distance === 1 ? 5 : distance === 2 ? 3 : 1

  return matchAvg * 0.5 + activity * 0.3 + distanceScore * 0.2
}

// ── Matching Engine ─────────────────────────────────────────────────────────

export async function findMatchingOffers(
  needId: string,
  needUserId: string,
  needDescription: string,
  needEmbedding: number[] | null,
  needCategory: string,
  visibility: Visibility,
): Promise<MatchCandidate[]> {
  // Generate embedding if missing
  const queryEmbedding = needEmbedding || await generateEmbedding(needDescription)

  // Determine which users are in scope
  let allowedUserIds: Set<string>
  if (visibility === 'network') {
    // All users — no filter
    allowedUserIds = new Set(['*'])
  } else {
    const direct = getDirectContacts(needUserId)
    allowedUserIds = new Set(direct)

    if (visibility === 'friends_of_friends') {
      const fof = getFriendsOfFriends(needUserId)
      for (const f of fof) {
        allowedUserIds.add(f.userId)
      }
    }
  }

  // Load all active offers with embeddings
  const allOffers = db.select()
    .from(schema.offers)
    .where(and(
      ne(schema.offers.userId, needUserId),
      eq(schema.offers.availability, 'available'),
    ))
    .all()

  const candidates: MatchCandidate[] = []

  for (const offer of allOffers) {
    // Filter by social graph
    if (!allowedUserIds.has('*') && !allowedUserIds.has(offer.userId)) continue

    // Filter by category compatibility
    if (needCategory === 'professional' && offer.category !== 'professional') continue
    if (needCategory === 'social' && offer.category === 'professional') continue

    // Compute semantic similarity
    if (!offer.embedding) continue
    const similarity = cosineSimilarity(queryEmbedding, offer.embedding as number[])
    if (similarity < SIMILARITY_THRESHOLD) continue

    // Compute trust + distance
    const trustScore = calculateTrustScore(offer.userId, needUserId)
    const { distance, via } = getSocialDistance(needUserId, offer.userId)

    let mutualContactName: string | undefined
    if (via) {
      const user = db.select({ displayName: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.id, via))
        .get()
      mutualContactName = user?.displayName
    }

    const finalScore = similarity * 0.4 + (trustScore / 5) * 0.3 + (1 / distance) * 0.3

    candidates.push({
      userId: offer.userId,
      offerId: offer.id,
      offerDescription: offer.description,
      similarity,
      trustScore,
      socialDistance: distance,
      mutualContactId: via,
      mutualContactName,
      finalScore,
    })
  }

  return candidates.sort((a, b) => b.finalScore - a.finalScore)
}

// ── Mutual Matching (bidirectional) ────────────────────────────────────────

export interface MutualMatchCandidate extends MatchCandidate {
  /** The need from requester side */
  needDescription: string
  needCategory: string
}

/**
 * Find bidirectional matches: the requester's need matches the provider's offer
 * AND the provider has their own active need that could match the requester's offers.
 * This creates truly mutual connections.
 *
 * Falls back to one-way matches if no mutual ones exist (with a flag).
 */
export async function findMutualMatches(
  needId: string,
  needUserId: string,
  needDescription: string,
  needEmbedding: number[] | null,
  needCategory: string,
  visibility: Visibility,
): Promise<{ mutual: MutualMatchCandidate[]; oneWay: MatchCandidate[] }> {
  // Step 1: Find one-way matches (requester's need → provider's offers)
  const oneWayCandidates = await findMatchingOffers(
    needId, needUserId, needDescription, needEmbedding, needCategory, visibility,
  )

  // Step 2: For each candidate, check if they have active needs that match our offers
  const mutual: MutualMatchCandidate[] = []
  const oneWay: MatchCandidate[] = []

  // Load requester's offers
  const requesterOffers = db.select()
    .from(schema.offers)
    .where(and(
      eq(schema.offers.userId, needUserId),
      eq(schema.offers.availability, 'available'),
    ))
    .all()

  for (const candidate of oneWayCandidates) {
    // Skip blocked users
    if (isBlockedBy(candidate.userId, needUserId) || isBlockedBy(needUserId, candidate.userId)) {
      continue
    }

    // Check if provider has active needs
    const providerNeeds = db.select()
      .from(schema.needs)
      .where(and(
        eq(schema.needs.userId, candidate.userId),
        eq(schema.needs.status, 'active'),
      ))
      .all()

    let isMutual = false

    for (const providerNeed of providerNeeds) {
      if (!providerNeed.embedding) continue

      // Check if any of requester's offers match provider's needs
      for (const offer of requesterOffers) {
        if (!offer.embedding) continue
        const sim = cosineSimilarity(
          providerNeed.embedding as number[],
          offer.embedding as number[],
        )
        if (sim >= SIMILARITY_THRESHOLD) {
          isMutual = true
          break
        }
      }
      if (isMutual) break
    }

    if (isMutual) {
      mutual.push({
        ...candidate,
        needDescription,
        needCategory,
      })
    } else {
      oneWay.push(candidate)
    }
  }

  return { mutual, oneWay }
}
