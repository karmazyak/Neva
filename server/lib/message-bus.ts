/**
 * MessageBus — abstraction layer over pub/sub.
 *
 * Phase 1: LocalMessageBus (in-process EventEmitter)
 * Phase 2: swap to RedisMessageBus without touching any callers.
 */

type Handler = (data: unknown) => void

export interface MessageBus {
  publish(channel: string, data: unknown): void
  subscribe(channel: string, handler: Handler): void
  unsubscribe(channel: string, handler?: Handler): void
  /** Subscribe to a pattern like "chat:*" */
  psubscribe?(pattern: string, handler: (channel: string, data: unknown) => void): void
}

/**
 * In-process implementation. Zero overhead, no network.
 * Suitable for single-node deployments.
 */
export class LocalMessageBus implements MessageBus {
  private handlers = new Map<string, Set<Handler>>()

  publish(channel: string, data: unknown): void {
    const set = this.handlers.get(channel)
    if (!set) return
    for (const handler of set) {
      try {
        handler(data)
      } catch (err) {
        console.error(`[MessageBus] handler error on channel ${channel}:`, err)
      }
    }
  }

  subscribe(channel: string, handler: Handler): void {
    let set = this.handlers.get(channel)
    if (!set) {
      set = new Set()
      this.handlers.set(channel, set)
    }
    set.add(handler)
  }

  unsubscribe(channel: string, handler?: Handler): void {
    if (!handler) {
      this.handlers.delete(channel)
      return
    }
    const set = this.handlers.get(channel)
    if (set) {
      set.delete(handler)
      if (set.size === 0) this.handlers.delete(channel)
    }
  }
}

// Singleton — swap this line when migrating to Redis
export const bus: MessageBus = new LocalMessageBus()
