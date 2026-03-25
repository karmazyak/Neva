import { db, schema } from '../db'
import { eq } from 'drizzle-orm'

// Ensure user has a credits record (create on first use)
function ensureCredits(userId: string) {
  const existing = db.select().from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId)).get()

  if (!existing) {
    db.insert(schema.userCredits).values({
      userId,
      balance: 1000,  // 1000 free credits on start
      totalUsed: 0,
    }).run()
  }
}

export function getBalance(userId: string): number {
  ensureCredits(userId)
  const credits = db.select().from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId)).get()
  return credits?.balance ?? 1000
}

export function trackUsage(params: {
  userId: string
  agentId?: string
  skillId: string
  skillName: string
  cost: number
  chatId?: string
}): { balance: number; cost: number } {
  ensureCredits(params.userId)

  // Get current balance
  const credits = db.select().from(schema.userCredits)
    .where(eq(schema.userCredits.userId, params.userId)).get()

  const currentBalance = credits?.balance ?? 1000
  const newBalance = currentBalance - params.cost
  const totalUsed = (credits?.totalUsed ?? 0) + params.cost

  // Update balance (don't block even if negative — free for now)
  db.update(schema.userCredits)
    .set({
      balance: newBalance,
      totalUsed,
      updatedAt: new Date(),
    })
    .where(eq(schema.userCredits.userId, params.userId))
    .run()

  // Log the transaction
  db.insert(schema.creditLog).values({
    id: crypto.randomUUID(),
    userId: params.userId,
    agentId: params.agentId || null,
    skillId: params.skillId,
    skillName: params.skillName,
    cost: params.cost,
    balanceAfter: newBalance,
    chatId: params.chatId || null,
  }).run()

  return { balance: newBalance, cost: params.cost }
}

export function getUsageHistory(userId: string, limit = 20) {
  return db.select().from(schema.creditLog)
    .where(eq(schema.creditLog.userId, userId))
    .orderBy(schema.creditLog.createdAt)
    .limit(limit)
    .all()
}
