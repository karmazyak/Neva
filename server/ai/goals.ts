/**
 * Goals module — extracted from ai-tools.ts for use by skills and other AI modules
 * without circular dependency on the routes layer.
 */

import { db, schema } from '../db'
import { eq, and, desc, inArray } from 'drizzle-orm'

/** Get active goal for a specific chat */
export function getActiveGoal(userId: string, chatId: string): { goal: string; strategy: string; chatId: string } | null {
  const row = db.select()
    .from(schema.userGoals)
    .where(and(
      eq(schema.userGoals.userId, userId),
      eq(schema.userGoals.chatId, chatId),
      inArray(schema.userGoals.status, ['active', 'in_progress']),
    ))
    .orderBy(desc(schema.userGoals.updatedAt))
    .limit(1)
    .get()

  if (!row) return null
  return { goal: row.goal, strategy: row.strategy || '', chatId: row.chatId || chatId }
}

/** Get ALL active goals for a user */
export function getAllActiveGoals(userId: string): Array<{ id: string; goal: string; strategy: string; chatId: string | null; progress: number; mode: string }> {
  return db.select()
    .from(schema.userGoals)
    .where(and(
      eq(schema.userGoals.userId, userId),
      inArray(schema.userGoals.status, ['active', 'in_progress']),
    ))
    .orderBy(desc(schema.userGoals.updatedAt))
    .all()
    .map(r => ({
      id: r.id,
      goal: r.goal,
      strategy: r.strategy || '',
      chatId: r.chatId,
      progress: r.progress || 0,
      mode: r.mode,
    }))
}
