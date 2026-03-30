import { db, schema } from '../db'
import { eq } from 'drizzle-orm'
import type { PrivacyVault } from '../db/schema'

// ── Default vault settings ─────────────────────────────────────────────────

const DEFAULT_VAULT: Omit<PrivacyVault, 'id' | 'userId' | 'updatedAt'> = {
  shareInterests: true,
  shareExpertise: true,
  shareAvailability: true,
  shareMood: false,
  shareFacts: false,
  publicBio: null,
  publicInterests: [],
  publicExpertise: [],
  blockedUserIds: [],
}

// ── In-memory LRU cache ────────────────────────────────────────────────────

const vaultCache = new Map<string, { vault: PrivacyVault; ts: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min

function getCached(userId: string): PrivacyVault | null {
  const entry = vaultCache.get(userId)
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.vault
  if (entry) vaultCache.delete(userId)
  return null
}

function setCache(userId: string, vault: PrivacyVault) {
  vaultCache.set(userId, { vault, ts: Date.now() })
  // Evict if cache too large
  if (vaultCache.size > 200) {
    const oldest = vaultCache.keys().next().value
    if (oldest) vaultCache.delete(oldest)
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the user's privacy vault settings.
 * Creates default vault if none exists.
 */
export function getVault(userId: string): PrivacyVault {
  const cached = getCached(userId)
  if (cached) return cached

  let vault = db.select()
    .from(schema.privacyVault)
    .where(eq(schema.privacyVault.userId, userId))
    .get()

  if (!vault) {
    // Create default vault
    const id = crypto.randomUUID()
    db.insert(schema.privacyVault).values({
      id,
      userId,
      ...DEFAULT_VAULT,
    }).run()

    vault = db.select()
      .from(schema.privacyVault)
      .where(eq(schema.privacyVault.userId, userId))
      .get()!
  }

  setCache(userId, vault)
  return vault
}

/**
 * Update vault settings. Only provided fields are updated.
 */
export function updateVault(userId: string, updates: Partial<{
  shareInterests: boolean
  shareExpertise: boolean
  shareAvailability: boolean
  shareMood: boolean
  shareFacts: boolean
  publicBio: string | null
  publicInterests: string[]
  publicExpertise: string[]
  blockedUserIds: string[]
}>): PrivacyVault {
  // Ensure vault exists
  getVault(userId)

  db.update(schema.privacyVault)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(schema.privacyVault.userId, userId))
    .run()

  // Invalidate cache
  vaultCache.delete(userId)

  return getVault(userId)
}

/**
 * Check if a specific data type is disclosable for the target user.
 * This is the PRIMARY GATE for all A2A data sharing.
 */
export function isDisclosable(
  targetUserId: string,
  dataType: 'interests' | 'expertise' | 'availability' | 'mood' | 'facts',
): boolean {
  const vault = getVault(targetUserId)

  switch (dataType) {
    case 'interests': return vault.shareInterests ?? true
    case 'expertise': return vault.shareExpertise ?? true
    case 'availability': return vault.shareAvailability ?? true
    case 'mood': return vault.shareMood ?? false
    case 'facts': return vault.shareFacts ?? false
    default: return false
  }
}

/**
 * Check if a user is blocked by the target.
 * Blocked users get silent "unavailable" — never an error.
 */
export function isBlockedBy(targetUserId: string, callerUserId: string): boolean {
  const vault = getVault(targetUserId)
  const blocked = vault.blockedUserIds as string[] | null
  return blocked?.includes(callerUserId) ?? false
}

/**
 * Get the user's public profile (what they explicitly want to share).
 * Falls back to auto-detected interests if public lists are empty.
 */
export function getPublicProfile(userId: string): {
  bio: string | null
  interests: string[]
  expertise: string[]
} {
  const vault = getVault(userId)
  return {
    bio: vault.publicBio,
    interests: (vault.publicInterests as string[] | null) || [],
    expertise: (vault.publicExpertise as string[] | null) || [],
  }
}
