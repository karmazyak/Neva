import type { TaskEvent } from './types'

/**
 * Queue-based event bus for async agent execution.
 * Publisher (executor) pushes events, consumer (SSE/blocking) reads via async generator.
 */
export class ExecutionEventBus {
  private queue: TaskEvent[] = []
  private resolve: ((value: TaskEvent) => void) | null = null
  private done = false

  publish(event: TaskEvent): void {
    if (this.resolve) {
      const r = this.resolve
      this.resolve = null
      r(event)
    } else {
      this.queue.push(event)
    }
  }

  finish(): void {
    this.done = true
    this.publish({ type: 'done' })
  }

  async *events(): AsyncGenerator<TaskEvent> {
    while (true) {
      if (this.queue.length > 0) {
        const event = this.queue.shift()!
        if (event.type === 'done') return
        yield event
      } else if (this.done) {
        return
      } else {
        const event = await new Promise<TaskEvent>((r) => {
          this.resolve = r
        })
        if (event.type === 'done') return
        yield event
      }
    }
  }
}
