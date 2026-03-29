import { db, schema } from '../db'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { sendToUser } from '../ws'
import { addDialogMessage } from './agent-dialog'

// ── Log Agent Activity ──────────────────────────────────────────────────────

export function logAgentActivity(userId: string, data: {
  type: string
  title: string
  body?: string
  relatedDialogId?: string
  relatedChatId?: string
  relatedUserId?: string
  metadata?: Record<string, any>
  undoable?: boolean
  undoWindowMs?: number
}) {
  const id = crypto.randomUUID()
  const now = new Date()
  const undoDeadline = data.undoable
    ? new Date(now.getTime() + (data.undoWindowMs || 300000)) // 5 min default
    : null

  const activity = {
    id,
    userId,
    type: data.type,
    title: data.title,
    body: data.body || null,
    relatedDialogId: data.relatedDialogId || null,
    relatedChatId: data.relatedChatId || null,
    relatedUserId: data.relatedUserId || null,
    metadata: data.metadata || null,
    undoable: data.undoable || false,
    undoDeadline,
    createdAt: now,
  }

  db.insert(schema.agentActivities).values(activity).run()

  // Real-time push
  sendToUser(userId, {
    type: 'agent_activity',
    activity: {
      ...activity,
      undoDeadline: undoDeadline?.toISOString() || null,
      createdAt: now.toISOString(),
    },
  })

  return activity
}

// ── Get Activities ──────────────────────────────────────────────────────────

export function getActivities(userId: string, opts?: {
  limit?: number
  offset?: number
  type?: string
}) {
  const limit = opts?.limit || 20
  const offset = opts?.offset || 0

  const rows = db.select()
    .from(schema.agentActivities)
    .where(eq(schema.agentActivities.userId, userId))
    .orderBy(desc(schema.agentActivities.createdAt))
    .limit(limit)
    .offset(offset)
    .all()

  // Filter by type in JS if needed (drizzle dynamic where is messy)
  const filtered = opts?.type
    ? rows.filter(r => r.type === opts.type)
    : rows

  return filtered
}

// ── Undo ────────────────────────────────────────────────────────────────────

export function handleUndo(activityId: string, userId: string): {
  success: boolean
  error?: string
} {
  const activity = db.select()
    .from(schema.agentActivities)
    .where(and(
      eq(schema.agentActivities.id, activityId),
      eq(schema.agentActivities.userId, userId),
    ))
    .get()

  if (!activity) return { success: false, error: 'Not found' }
  if (!activity.undoable) return { success: false, error: 'Not undoable' }
  if (activity.undoneAt) return { success: false, error: 'Already undone' }
  if (activity.undoDeadline && activity.undoDeadline < new Date()) {
    return { success: false, error: 'Undo window expired' }
  }

  // Revert the dialog status to pending
  if (activity.relatedDialogId) {
    db.update(schema.agentDialogs)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(schema.agentDialogs.id, activity.relatedDialogId))
      .run()

    const dialog = db.select()
      .from(schema.agentDialogs)
      .where(eq(schema.agentDialogs.id, activity.relatedDialogId))
      .get()

    if (dialog) {
      const counterpartyId = dialog.initiatorUserId === userId
        ? dialog.targetUserId
        : dialog.initiatorUserId

      addDialogMessage(activity.relatedDialogId, 'target',
        'Автоматический ответ отменён. Ожидается ручное решение.')

      sendToUser(counterpartyId, {
        type: 'agent_dialog_update',
        dialogId: activity.relatedDialogId,
        status: 'pending',
        message: 'Автоответ отозван',
      })

      // Also notify target that their dialog is now pending
      sendToUser(userId, {
        type: 'agent_dialog_update',
        dialogId: activity.relatedDialogId,
        status: 'pending',
      })
    }
  }

  // Mark as undone
  db.update(schema.agentActivities)
    .set({ undoneAt: new Date() })
    .where(eq(schema.agentActivities.id, activityId))
    .run()

  // Log undo activity
  logAgentActivity(userId, {
    type: 'undo',
    title: `Отменено: ${activity.title}`,
    relatedDialogId: activity.relatedDialogId || undefined,
  })

  sendToUser(userId, {
    type: 'agent_activity_undone',
    activityId,
  })

  return { success: true }
}
