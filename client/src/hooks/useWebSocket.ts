import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { showToast } from '../components/ui/Toast'

export function useWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const setTyping = useChatStore((s) => s.setTyping)
  const loadChats = useChatStore((s) => s.loadChats)
  const loadMessages = useChatStore((s) => s.loadMessages)
  const getActiveChat = () => useChatStore.getState().activeChat
  const getGhostEnabled = () => useChatStore.getState().ghostLayerEnabled

  useEffect(() => {
    if (!token) return

    let reconnectAttempts = 0

    function connect() {
      // Don't reconnect if there's already an open connection
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
        return
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws`
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        reconnectAttempts = 0
        ws.send(JSON.stringify({ type: 'auth', token }))

        const activeChat = getActiveChat()
        if (activeChat) {
          const ghostEnabled = getGhostEnabled()[activeChat] || false
          loadMessages(activeChat, ghostEnabled)
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          switch (data.type) {
            case 'auth_ok':
              console.log('WebSocket authenticated')
              break
            case 'auth_error':
              console.error('WebSocket auth failed:', data.message)
              ws.close()
              break
            case 'new_message':
              addMessage(data.message)
              break
            case 'message_edited':
              updateMessage(data.chatId, data.messageId, {
                content: data.content,
                editedAt: data.editedAt,
              })
              break
            case 'typing':
              setTyping(data.chatId || '', data.userId, data.username)
              break
            case 'user_status':
            case 'user_status_updated':
              loadChats()
              break
            case 'messages_read':
              break
            case 'reaction_added':
              useChatStore.getState().addReactionToMessage(data.chatId, data.messageId, data.emoji, data.userId)
              break
            case 'reaction_removed':
              useChatStore.getState().removeReactionFromMessage(data.chatId, data.messageId, data.emoji, data.userId)
              break
            case 'mention':
              if (Notification.permission === 'granted') {
                new Notification(`${data.mentionedBy} mentioned you`, { body: data.content })
              }
              break
            case 'message_pinned':
            case 'message_unpinned':
            case 'chat_settings_updated':
              loadChats()
              break
            case 'message_deleted':
              useChatStore.getState().removeMessage(data.chatId, data.messageId)
              break
            case 'style_analyzed':
              if (data.isFirst) {
                showToast('success', '✨ Your writing style has been analyzed! Check it out in Profile.')
              }
              break
            case 'error':
              console.warn('WebSocket error:', data.message)
              break
          }
        } catch {
          // Ignore
        }
      }

      ws.onclose = (event) => {
        wsRef.current = null
        // Don't reconnect on auth failure
        if (event.code === 4001) {
          console.error('WebSocket: authentication rejected')
          return
        }
        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
        reconnectAttempts++
        console.log(`WebSocket disconnected, reconnecting in ${Math.round(delay / 1000)}s...`)
        reconnectTimeoutRef.current = setTimeout(connect, delay)
      }

      wsRef.current = ws
    }

    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [token, addMessage, updateMessage, setTyping, loadChats])

  const sendTyping = useCallback((chatId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', chatId }))
    }
  }, [])

  const sendRead = useCallback((chatId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'read', chatId }))
    }
  }, [])

  return { sendTyping, sendRead }
}
