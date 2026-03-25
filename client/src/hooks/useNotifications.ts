import { useEffect, useRef, useCallback } from 'react'
import { useNotificationStore } from '../stores/notificationStore'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'

// Generate a short notification beep using Web Audio API
let audioCtx: AudioContext | null = null

function playNotificationSound(volume: number) {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const oscillator = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioCtx.destination)

    // Pleasant two-tone notification (like Telegram)
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime) // A5
    oscillator.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.08) // ~C#6

    gainNode.gain.setValueAtTime(volume * 0.3, audioCtx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25)

    oscillator.start(audioCtx.currentTime)
    oscillator.stop(audioCtx.currentTime + 0.25)
  } catch {
    // Audio API not available
  }
}

// Track page visibility
let isPageVisible = true

function setupVisibilityTracking() {
  const handler = () => { isPageVisible = !document.hidden }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}

export function useNotifications() {
  const { soundEnabled, notificationsEnabled, isMuted, volume } = useNotificationStore()
  const originalTitle = useRef(document.title)
  const titleIntervalRef = useRef<ReturnType<typeof setInterval>>()

  // Setup visibility tracking
  useEffect(() => {
    const cleanup = setupVisibilityTracking()
    originalTitle.current = document.title.replace(/^\(\d+\)\s*/, '')
    return cleanup
  }, [])

  // Update document title with unread count
  useEffect(() => {
    const updateTitle = () => {
      const chats = useChatStore.getState().chats
      const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
      const base = originalTitle.current || 'Neva'

      if (totalUnread > 0) {
        document.title = `(${totalUnread}) ${base}`
        // Also flash favicon could be added here
      } else {
        document.title = base
      }
    }

    // Subscribe to chat store changes
    const unsub = useChatStore.subscribe(updateTitle)
    updateTitle()

    return () => {
      unsub()
      document.title = originalTitle.current || 'Neva'
    }
  }, [])

  // Flash title when page is hidden and there are unreads
  useEffect(() => {
    const checkFlash = () => {
      if (titleIntervalRef.current) {
        clearInterval(titleIntervalRef.current)
        titleIntervalRef.current = undefined
      }

      if (!document.hidden) {
        // Restore normal title with count
        const chats = useChatStore.getState().chats
        const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
        const base = originalTitle.current || 'Neva'
        document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base
        return
      }
    }

    document.addEventListener('visibilitychange', checkFlash)
    return () => {
      document.removeEventListener('visibilitychange', checkFlash)
      if (titleIntervalRef.current) clearInterval(titleIntervalRef.current)
    }
  }, [])

  const notify = useCallback((message: {
    chatId: string
    senderName: string
    content: string
    senderId: string
    type?: string
    visibility?: string
  }) => {
    const currentUser = useAuthStore.getState().user
    // Don't notify for own messages
    if (message.senderId === currentUser?.id) return
    // Don't notify for ghost messages
    if (message.visibility === 'ghost') return
    // Don't notify for muted chats
    if (isMuted(message.chatId)) return
    // Don't notify if this is the active chat AND page is visible
    const activeChat = useChatStore.getState().activeChat
    if (activeChat === message.chatId && isPageVisible) return

    // Play sound
    if (soundEnabled) {
      playNotificationSound(volume)
    }

    // Show browser notification when tab is hidden
    if (notificationsEnabled && !isPageVisible && Notification.permission === 'granted') {
      const chat = useChatStore.getState().chats.find(c => c.id === message.chatId)
      const title = chat?.type === 'private' ? message.senderName : `${message.senderName} · ${chat?.name || 'Chat'}`

      let body = message.content
      if (message.type === 'image') body = '📷 Фото'
      else if (message.type === 'video') body = '🎥 Видео'
      else if (message.type === 'file') body = '📎 Файл'
      else if (message.type === 'media_group') body = '📷 Альбом'
      else if (body.startsWith('/uploads/')) body = '📎 Файл'

      // Truncate long messages
      if (body.length > 100) body = body.slice(0, 100) + '…'

      try {
        const notification = new Notification(title, {
          body,
          icon: chat?.avatar || '/vite.svg',
          tag: `chat-${message.chatId}`, // Group by chat
          silent: true, // We handle sound ourselves
        })

        notification.onclick = () => {
          window.focus()
          useChatStore.getState().setActiveChat(message.chatId)
          notification.close()
        }

        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000)
      } catch {
        // Notification API error
      }
    }
  }, [soundEnabled, notificationsEnabled, isMuted, volume])

  return { notify, isPageVisible: () => isPageVisible }
}
