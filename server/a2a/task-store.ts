import { db, schema } from '../db'
import { eq, sql } from 'drizzle-orm'
import type { Task } from './types'

export interface TaskStore {
  get(taskId: string): Task | null
  set(task: Task): void
  delete(taskId: string): void
}

export class SqliteTaskStore implements TaskStore {
  get(taskId: string): Task | null {
    const row = db.select()
      .from(schema.a2aTasks)
      .where(eq(schema.a2aTasks.id, taskId))
      .get()

    if (!row) return null
    return row.data as Task
  }

  set(task: Task): void {
    const existing = db.select({ id: schema.a2aTasks.id })
      .from(schema.a2aTasks)
      .where(eq(schema.a2aTasks.id, task.id))
      .get()

    if (existing) {
      db.update(schema.a2aTasks)
        .set({
          state: task.status.state,
          data: task as any,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(schema.a2aTasks.id, task.id))
        .run()
    } else {
      db.insert(schema.a2aTasks)
        .values({
          id: task.id,
          contextId: task.contextId || null,
          state: task.status.state,
          data: task as any,
        })
        .run()
    }
  }

  delete(taskId: string): void {
    db.delete(schema.a2aTasks)
      .where(eq(schema.a2aTasks.id, taskId))
      .run()
  }
}
