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
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChat: null,
  messages: {},
  typingUsers: {},
  ghostLayerEnabled: {},

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
      // Avoid duplicates
      if (chatMessages.find((m) => m.id === message.id)) return state

      // If ghost message and ghost layer is not enabled, don't add to visible list
      // But still keep it (it was delivered via WS)
      const ghostEnabled = state.ghostLayerEnabled[message.chatId] || false
      if (message.visibility === 'ghost' && !ghostEnabled) {
        // Store it but don't show — it will appear when ghost layer is toggled
        return state
      }

      const newMessages = {
        ...state.messages,
        [message.chatId]: [...chatMessages, message],
      }

      // Update last message in chat list (don't update with ghost messages)
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

      // Sort chats by last message time
      chats.sort((a, b) => {
        const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0
        const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0
        return bTime - aTime
      })

      return { messages: newMessages, chats }
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
    // Reload messages with/without ghost
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
}))
