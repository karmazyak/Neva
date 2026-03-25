import { create } from 'zustand'
import { api } from '../lib/api'
import { useAuthStore } from './authStore'

interface Message {
  id: string
  chatId: string
  senderId: string
  senderName: string
  senderAvatar: string | null
  content: string
  type: string
  replyToId?: string
  status: string
  visibility?: string
  metadata?: Record<string, any>
  editedAt?: string
  forwardedFrom?: { chatId: string; chatName: string; senderName: string }
  createdAt: string
  reactions?: { emoji: string; count: number; userIds: string[]; reacted: boolean }[]
  pinned?: boolean
  saved?: boolean
  _optimistic?: boolean  // Optimistic update flag (client-only)
}

interface Chat {
  id: string
  type: string
  name: string
  avatar: string | null
  members: any[]
  lastMessage: Message | null
  unreadCount: number
}

interface ChatState {
  chats: Chat[]
  activeChat: string | null
  messages: Record<string, Message[]>
  typingUsers: Record<string, { userId: string; username: string; timeout: ReturnType<typeof setTimeout> }>
  ghostLayerEnabled: Record<string, boolean>
  lastSyncTimestamp: number  // Unix timestamp of last successful sync
  loadChats: () => Promise<void>
  setActiveChat: (chatId: string | null) => void
  loadMessages: (chatId: string, includeGhost?: boolean) => Promise<void>
  addMessage: (message: Message) => void
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void
  setTyping: (chatId: string, userId: string, username: string) => void
  clearTyping: (chatId: string) => void
  createChat: (memberIds: string[], type?: string, name?: string) => Promise<string>
  toggleGhostLayer: (chatId: string) => void
  addReactionToMessage: (chatId: string, messageId: string, emoji: string, reactUserId: string) => void
  removeReactionFromMessage: (chatId: string, messageId: string, emoji: string, reactUserId: string) => void
  removeMessage: (chatId: string, messageId: string) => void
  // Optimistic send
  sendMessageOptimistic: (chatId: string, content: string, type?: string, replyToId?: string, metadata?: Record<string, any>) => Promise<void>
  // Replace optimistic message with real one
  replaceOptimisticMessage: (chatId: string, tempId: string, realMessage: Message) => void
  markMessageFailed: (chatId: string, tempId: string) => void
  // Delta sync
  deltaSync: () => Promise<void>
  // Handle sync batch from WS
  handleSyncBatch: (messages: Message[]) => void
}

let tempIdCounter = 0

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChat: null,
  messages: {},
  typingUsers: {},
  ghostLayerEnabled: {},
  lastSyncTimestamp: parseInt(localStorage.getItem('lastSyncTs') || '0'),

  loadChats: async () => {
    const chats = await api.getChats()
    set({ chats })
  },

  setActiveChat: (chatId) => {
    set({ activeChat: chatId })
    if (chatId) {
      const ghostEnabled = get().ghostLayerEnabled[chatId] || false
      get().loadMessages(chatId, ghostEnabled)
    }
  },

  loadMessages: async (chatId, includeGhost = false) => {
    const messages = await api.getChatMessages(chatId, 50, includeGhost)
    set((state) => ({
      messages: { ...state.messages, [chatId]: messages },
    }))
  },

  addMessage: (message) => {
    set((state) => {
      const chatMessages = state.messages[message.chatId] || []

      // If this is a real message replacing an optimistic one, skip duplicate check
      // Optimistic messages have temp_ prefix IDs
      const existingIndex = chatMessages.findIndex((m) => m.id === message.id)
      if (existingIndex >= 0) return state

      // Check if this is a server echo of our optimistic message
      // Match by content + senderId + chatId within last 10s
      if (message.senderId === useAuthStore.getState().user?.id) {
        const optimistic = chatMessages.find(
          m => m._optimistic && m.content === message.content && m.chatId === message.chatId
        )
        if (optimistic) {
          // Replace optimistic with real
          return {
            messages: {
              ...state.messages,
              [message.chatId]: chatMessages.map(m =>
                m.id === optimistic.id ? { ...message, _optimistic: undefined } : m
              ),
            },
          }
        }
      }

      // Ghost filter
      const ghostEnabled = state.ghostLayerEnabled[message.chatId] || false
      if (message.visibility === 'ghost' && !ghostEnabled) {
        return state
      }

      const newMessages = {
        ...state.messages,
        [message.chatId]: [...chatMessages, message],
      }

      const chats = state.chats.map((chat) => {
        if (chat.id === message.chatId && message.visibility !== 'ghost') {
          return {
            ...chat,
            lastMessage: message,
            unreadCount: message.chatId === state.activeChat ? 0 : chat.unreadCount + 1,
          }
        }
        return chat
      })

      chats.sort((a, b) => {
        const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0
        const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0
        return bTime - aTime
      })

      return { messages: newMessages, chats }
    })
  },

  // ── Optimistic Send ──────────────────────────────────────────────────────
  sendMessageOptimistic: async (chatId, content, type = 'text', replyToId?, metadata?) => {
    const user = useAuthStore.getState().user
    if (!user) return

    const tempId = `temp_${Date.now()}_${++tempIdCounter}`

    // 1. Immediately add to UI
    const optimisticMessage: Message = {
      id: tempId,
      chatId,
      senderId: user.id,
      senderName: user.displayName || user.username,
      senderAvatar: user.avatar || null,
      content,
      type,
      replyToId,
      status: 'sending',
      visibility: 'normal',
      metadata,
      createdAt: new Date().toISOString(),
      _optimistic: true,
    }

    get().addMessage(optimisticMessage)

    try {
      // 2. Send to server
      const realMessage = await api.sendMessage({
        chatId,
        content,
        type,
        metadata,
        ...(replyToId ? { replyToId } : {}),
      })

      // 3. Replace optimistic with real
      get().replaceOptimisticMessage(chatId, tempId, realMessage)
    } catch (err) {
      // 4. Mark as failed
      get().markMessageFailed(chatId, tempId)
      throw err
    }
  },

  replaceOptimisticMessage: (chatId, tempId, realMessage) => {
    set((state) => {
      const chatMessages = state.messages[chatId]
      if (!chatMessages) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.map(m =>
            m.id === tempId ? { ...realMessage, _optimistic: undefined } : m
          ),
        },
      }
    })
  },

  markMessageFailed: (chatId, tempId) => {
    set((state) => {
      const chatMessages = state.messages[chatId]
      if (!chatMessages) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.map(m =>
            m.id === tempId ? { ...m, status: 'failed', _optimistic: true } : m
          ),
        },
      }
    })
  },

  updateMessage: (chatId, messageId, updates) => {
    set((state) => {
      const chatMessages = state.messages[chatId]
      if (!chatMessages) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m
          ),
        },
      }
    })
  },

  setTyping: (chatId, userId, username) => {
    set((state) => {
      const key = `${chatId}-${userId}`
      const existing = state.typingUsers[key]
      if (existing) clearTimeout(existing.timeout)

      const timeout = setTimeout(() => {
        set((s) => {
          const { [key]: _, ...rest } = s.typingUsers
          return { typingUsers: rest }
        })
      }, 3000)

      return {
        typingUsers: {
          ...state.typingUsers,
          [key]: { userId, username, timeout },
        },
      }
    })
  },

  clearTyping: (chatId) => {
    set((state) => {
      const newTyping = { ...state.typingUsers }
      for (const key of Object.keys(newTyping)) {
        if (key.startsWith(chatId)) {
          clearTimeout(newTyping[key].timeout)
          delete newTyping[key]
        }
      }
      return { typingUsers: newTyping }
    })
  },

  createChat: async (memberIds, type = 'private', name, description?) => {
    const result = await api.createChat({ memberIds, type, name, description })
    await get().loadChats()
    return result.id
  },

  toggleGhostLayer: (chatId) => {
    set((state) => {
      const newEnabled = !state.ghostLayerEnabled[chatId]
      return {
        ghostLayerEnabled: { ...state.ghostLayerEnabled, [chatId]: newEnabled },
      }
    })
    const enabled = get().ghostLayerEnabled[chatId] || false
    get().loadMessages(chatId, enabled)
  },

  addReactionToMessage: (chatId, messageId, emoji, reactUserId) => {
    const currentUserId = useAuthStore.getState().user?.id
    set((state) => {
      const chatMsgs = state.messages[chatId]
      if (!chatMsgs) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMsgs.map(m => {
            if (m.id !== messageId) return m
            const reactions = [...(m.reactions || []).map(r => ({ ...r, userIds: [...r.userIds] }))]
            const existing = reactions.find(r => r.emoji === emoji)
            if (existing) {
              if (!existing.userIds.includes(reactUserId)) {
                existing.count++
                existing.userIds.push(reactUserId)
              }
            } else {
              reactions.push({ emoji, count: 1, userIds: [reactUserId], reacted: false })
            }
            return { ...m, reactions: reactions.map(r => ({ ...r, reacted: currentUserId ? r.userIds.includes(currentUserId) : false })) }
          }),
        },
      }
    })
  },

  removeReactionFromMessage: (chatId, messageId, emoji, reactUserId) => {
    const currentUserId = useAuthStore.getState().user?.id
    set((state) => {
      const chatMsgs = state.messages[chatId]
      if (!chatMsgs) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMsgs.map(m => {
            if (m.id !== messageId) return m
            let reactions = [...(m.reactions || []).map(r => ({ ...r, userIds: [...r.userIds] }))]
            const existing = reactions.find(r => r.emoji === emoji)
            if (existing) {
              existing.count--
              existing.userIds = existing.userIds.filter((id: string) => id !== reactUserId)
              if (existing.count <= 0) reactions = reactions.filter(r => r.emoji !== emoji)
            }
            return { ...m, reactions: reactions.map(r => ({ ...r, reacted: currentUserId ? r.userIds.includes(currentUserId) : false })) }
          }),
        },
      }
    })
  },

  removeMessage: (chatId, messageId) => {
    set((state) => {
      const chatMsgs = state.messages[chatId]
      if (!chatMsgs) return state
      return { messages: { ...state.messages, [chatId]: chatMsgs.filter(m => m.id !== messageId) } }
    })
  },

  // ── Delta Sync ─────────────────────────────────────────────────────────────
  deltaSync: async () => {
    const { lastSyncTimestamp } = get()
    if (!lastSyncTimestamp) return // First load, use full loadChats

    try {
      const result = await api.syncMessages(lastSyncTimestamp)
      const { messages: syncData, timestamp } = result

      // Apply new messages
      if (syncData.new && syncData.new.length > 0) {
        for (const msg of syncData.new) {
          get().addMessage(msg)
        }
      }

      // Apply edited messages
      if (syncData.edited && syncData.edited.length > 0) {
        for (const msg of syncData.edited) {
          get().updateMessage(msg.chatId, msg.id, {
            content: msg.content,
            editedAt: msg.editedAt,
          })
        }
      }

      // Update timestamp
      set({ lastSyncTimestamp: timestamp })
      localStorage.setItem('lastSyncTs', String(timestamp))
    } catch (err) {
      console.error('[Sync] Delta sync failed, falling back to full load:', err)
      await get().loadChats()
    }
  },

  // Handle bulk sync from WS (on reconnect, server sends pending messages)
  handleSyncBatch: (messages) => {
    for (const msg of messages) {
      get().addMessage(msg)
    }
    // Update sync timestamp
    const now = Math.floor(Date.now() / 1000)
    set({ lastSyncTimestamp: now })
    localStorage.setItem('lastSyncTs', String(now))
  },
}))
