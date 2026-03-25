import { LRUCache } from 'lru-cache'

// ── Chat List Cache ──────────────────────────────────────────────────────────
// Caches the full loadChats() response per user. Invalidated on new messages,
// status changes, or membership changes.
export const chatListCache = new LRUCache<string, any[]>({
  max: 10_000,
  ttl: 30_000,  // 30s TTL
})

// ── Recent Messages Cache ────────────────────────────────────────────────────
// Caches the last N messages per chat. Invalidated on new message in that chat.
export const recentMessagesCache = new LRUCache<string, any[]>({
  max: 5_000,
  ttl: 60_000,  // 1 min TTL
})

// ── Online Status Cache ──────────────────────────────────────────────────────
// Avoids DB hits for isUserOnline checks (these are done in-memory via WS map,
// but this caches the DB-backed status for API routes)
export const onlineStatusCache = new LRUCache<string, boolean>({
  max: 50_000,
  ttl: 10_000,  // 10s TTL
})

// ── Invalidation Helpers ─────────────────────────────────────────────────────

/**
 * Call when a new message is sent to a chat. Invalidates:
 * - recentMessagesCache for that chat
 * - chatListCache for all members of that chat
 */
export function invalidateOnNewMessage(chatId: string, memberUserIds: string[]) {
  recentMessagesCache.delete(chatId)
  for (const userId of memberUserIds) {
    chatListCache.delete(userId)
  }
}

/**
 * Call when a user goes online/offline, or any chat metadata changes
 */
export function invalidateChatListForUser(userId: string) {
  chatListCache.delete(userId)
}

/**
 * Call when any member joins/leaves a chat
 */
export function invalidateChatMembers(chatId: string, allMemberIds: string[]) {
  recentMessagesCache.delete(chatId)
  for (const userId of allMemberIds) {
    chatListCache.delete(userId)
  }
}
