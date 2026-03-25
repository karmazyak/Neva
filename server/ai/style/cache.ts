import { db, schema } from '../../db'
import { eq, and, sql } from 'drizzle-orm'
import type { StyleProfile } from './analyzer'

export function getCachedProfile(
  userId: string,
  analyzedBy: string,
  chatId?: string,
  context?: string
): { profile: StyleProfile; messageCount: number } | null {
  const conditions = [
    eq(schema.styleProfiles.userId, userId),
    eq(schema.styleProfiles.analyzedBy, analyzedBy),
  ]
  if (chatId) {
    conditions.push(eq(schema.styleProfiles.chatId, chatId))
  }
  if (context) {
    conditions.push(eq(schema.styleProfiles.context as any, context))
  }

  const row = db.select()
    .from(schema.styleProfiles)
    .where(and(...conditions))
    .get()

  if (!row || !row.profile) return null

  return {
    profile: row.profile as StyleProfile,
    messageCount: row.messageCount || 0,
  }
}

// Get own global style profile (convenience)
export function getOwnProfile(userId: string): { profile: StyleProfile; messageCount: number } | null {
  return getCachedProfile(userId, userId, undefined, 'global')
}

// Get full profile row for display (includes updatedAt)
export function getOwnProfileForDisplay(userId: string): {
  profile: StyleProfile
  messageCount: number
  updatedAt: any
  context: string
} | null {
  const row = db.select()
    .from(schema.styleProfiles)
    .where(and(
      eq(schema.styleProfiles.userId, userId),
      eq(schema.styleProfiles.analyzedBy, userId),
      eq(schema.styleProfiles.context as any, 'global'),
    ))
    .get()

  if (!row || !row.profile) return null

  return {
    profile: row.profile as StyleProfile,
    messageCount: row.messageCount || 0,
    updatedAt: row.updatedAt,
    context: (row as any).context || 'global',
  }
}

export function saveProfileToCache(
  userId: string,
  analyzedBy: string,
  profile: StyleProfile,
  chatId?: string,
  context: string = 'global'
): void {
  // Count current messages for the user
  const countResult = db.select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.senderId, userId),
      eq(schema.messages.type, 'text'),
    ))
    .get()
  const currentCount = countResult?.count || 0

  const conditions = [
    eq(schema.styleProfiles.userId, userId),
    eq(schema.styleProfiles.analyzedBy, analyzedBy),
    eq(schema.styleProfiles.context as any, context),
  ]

  const existing = db.select({ id: schema.styleProfiles.id })
    .from(schema.styleProfiles)
    .where(and(...conditions))
    .get()

  if (existing) {
    db.update(schema.styleProfiles)
      .set({
        profile: profile as any,
        messageCount: profile.messageCount,
        messageCountAtAnalysis: currentCount,
        updatedAt: new Date(),
      })
      .where(eq(schema.styleProfiles.id, existing.id))
      .run()
  } else {
    db.insert(schema.styleProfiles).values({
      id: crypto.randomUUID(),
      userId,
      analyzedBy,
      chatId: chatId || null,
      context,
      profile: profile as any,
      messageCount: profile.messageCount,
      messageCountAtAnalysis: currentCount,
    } as any).run()
  }
}

// Check if first-time analysis should be triggered (30+ messages, no profile yet)
export function shouldTriggerFirstAnalysis(userId: string): boolean {
  const existing = db.select({ id: schema.styleProfiles.id })
    .from(schema.styleProfiles)
    .where(and(
      eq(schema.styleProfiles.userId, userId),
      eq(schema.styleProfiles.analyzedBy, userId),
    ))
    .get()

  if (existing) return false

  const countResult = db.select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.senderId, userId),
      eq(schema.messages.type, 'text'),
    ))
    .get()

  return (countResult?.count || 0) >= 30
}

// Check if re-analysis is needed (30+ days old AND 200+ new messages)
export function shouldTriggerReanalysis(userId: string): boolean {
  const row = db.select()
    .from(schema.styleProfiles)
    .where(and(
      eq(schema.styleProfiles.userId, userId),
      eq(schema.styleProfiles.analyzedBy, userId),
      eq(schema.styleProfiles.context as any, 'global'),
    ))
    .get()

  if (!row) return false

  const updatedAt = row.updatedAt ? new Date(row.updatedAt as any) : null
  if (!updatedAt) return false

  const daysSince = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince < 30) return false

  const countResult = db.select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.senderId, userId),
      eq(schema.messages.type, 'text'),
    ))
    .get()

  const currentCount = countResult?.count || 0
  const atAnalysis = (row as any).messageCountAtAnalysis || 0
  return currentCount - atAnalysis > 200
}

export function shouldRefreshProfile(
  cached: { messageCount: number },
  currentMessageCount: number
): boolean {
  return currentMessageCount - cached.messageCount > 50
}

export function listProfiles(analyzedBy: string): Array<{
  id: string
  userId: string
  chatId: string | null
  sourceName: string
  messageCount: number
  confidence: string
  updatedAt: Date | null
}> {
  const rows = db.select()
    .from(schema.styleProfiles)
    .where(eq(schema.styleProfiles.analyzedBy, analyzedBy))
    .all()

  return rows.map(row => {
    const profile = row.profile as StyleProfile | null
    return {
      id: row.id,
      userId: row.userId,
      chatId: row.chatId,
      sourceName: profile?.sourceName || 'Unknown',
      messageCount: row.messageCount || 0,
      confidence: profile?.confidence || 'low',
      updatedAt: row.updatedAt,
    }
  })
}

export function deleteProfile(profileId: string, analyzedBy: string): boolean {
  const result = db.delete(schema.styleProfiles)
    .where(and(
      eq(schema.styleProfiles.id, profileId),
      eq(schema.styleProfiles.analyzedBy, analyzedBy),
    ))
    .run()

  return result.changes > 0
}

export function deleteOwnProfile(userId: string): boolean {
  const result = db.delete(schema.styleProfiles)
    .where(and(
      eq(schema.styleProfiles.userId, userId),
      eq(schema.styleProfiles.analyzedBy, userId),
    ))
    .run()

  return result.changes > 0
}
