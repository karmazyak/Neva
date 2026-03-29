import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAgentDialogStore } from '../stores/agentDialogStore'
import { useAgentHubStore } from '../stores/agentHubStore'
import { showToast } from '../components/ui/Toast'
import { useNotifications } from './useNotifications'

export function useWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const setTyping = useChatStore((s) => s.setTyping)
  const loadChats = useChatStore((s) => s.loadChats)
  const loadMessages = useChatStore((s) => s.loadMessages)
  const handleSyncBatch = useChatStore((s) => s.handleSyncBatch)
  const deltaSync = useChatStore((s) => s.deltaSync)
  const getActiveChat = () => useChatStore.getState().activeChat
  const getGhostEnabled = () => useChatStore.getState().ghostLayerEnabled
  const { notify } = useNotifications()

  // Batch ACK: collect message IDs and send ACK periodically
  const pendingAcksRef = useRef<string[]>([])
  const ackTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const flushAcks = useCallback(() => {
    if (pendingAcksRef.current.length === 0) return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'ack',
        messageIds: pendingAcksRef.current,
      }))
    }
    pendingAcksRef.current = []
  }, [])

  const queueAck = useCallback((messageId: string) => {
    pendingAcksRef.current.push(messageId)
    // Batch ACKs every 500ms
    if (!ackTimerRef.current) {
      ackTimerRef.current = setTimeout(() => {
        flushAcks()
        ackTimerRef.current = undefined
      }, 500)
    }
  }, [flushAcks])

  useEffect(() => {
    if (!token) return

    let reconnectAttempts = 0

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
        return
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws`
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        reconnectAttempts = 0
        ws.send(JSON.stringify({ type: 'auth', token }))
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          switch (data.type) {
            case 'auth_ok':
              console.log('WebSocket authenticated')
              // Delta sync on reconnect instead of full reload
              deltaSync().catch(() => {
                // Fallback: reload active chat
                const activeChat = getActiveChat()
                if (activeChat) {
                  const ghostEnabled = getGhostEnabled()[activeChat] || false
                  loadMessages(activeChat, ghostEnabled)
                }
              })
              break

            case 'auth_error':
              console.error('WebSocket auth failed:', data.message)
              ws.close()
              break

            case 'new_message':
              addMessage(data.message)
              // ACK the message
              if (data.message.id) {
                queueAck(data.message.id)
              }
              notify({
                chatId: data.message.chatId,
                senderName: data.message.senderName,
                content: data.message.content,
                senderId: data.message.senderId,
                type: data.message.type,
                visibility: data.message.visibility,
              })
              break

            case 'sync':
              // Server sends pending messages on reconnect
              if (Array.isArray(data.messages) && data.messages.length > 0) {
                handleSyncBatch(data.messages)
                // ACK all synced messages
                const syncIds = data.messages.map((m: any) => m.id).filter(Boolean)
                if (syncIds.length > 0) {
                  pendingAcksRef.current.push(...syncIds)
                  flushAcks()
                }
              }
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

            case 'proactive_action':
              // Dispatch custom event for ProactiveCard component
              window.dispatchEvent(new CustomEvent('proactive_action', { detail: data }))
              break

            case 'consent_request':
              // Dispatch for ProactiveCard consent flow
              window.dispatchEvent(new CustomEvent('consent_request', { detail: data }))
              break

            case 'fraud_alert':
              // Dispatch for ProactiveCard fraud warning
              window.dispatchEvent(new CustomEvent('fraud_alert', { detail: data }))
              break

            case 'agent_dialog_request':
              useAgentDialogStore.getState().handleDialogRequest(data)
              useAgentHubStore.getState().handleDialogRequest(data)
              window.dispatchEvent(new CustomEvent('agent_dialog_request', { detail: data }))
              showToast('info', `🤖 ${data.dialog?.initiatorName || 'Агент'}: ${data.dialog?.message?.slice(0, 60) || 'новый запрос'}`)
              break

            case 'agent_dialog_update':
              useAgentDialogStore.getState().handleDialogUpdate(data)
              window.dispatchEvent(new CustomEvent('agent_dialog_update', { detail: data }))
              break

            case 'agent_dialog_auto':
              useAgentDialogStore.getState().handleDialogAuto(data)
              useAgentHubStore.getState().handleDialogAuto(data)
              showToast('info', `🤖 ${data.message || 'Ваш агент обработал запрос автоматически'}`)
              break

            case 'agent_activity':
              useAgentHubStore.getState().handleActivity(data)
              break

            case 'agent_activity_undone':
              useAgentHubStore.getState().handleActivityUndone(data)
              break

            case 'gather_progress':
              useAgentHubStore.getState().handleGatherProgress(data)
              break

            case 'gather_plan_ready':
              useAgentHubStore.getState().handleGatherPlanReady(data)
              break

            case 'gather_complete':
              useAgentHubStore.getState().handleGatherComplete(data)
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
        if (event.code === 4001) {
          console.error('WebSocket: authentication rejected')
          return
        }
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
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current)
      }
      flushAcks()
      wsRef.current?.close()
    }
  }, [token, addMessage, updateMessage, setTyping, loadChats, notify, deltaSync, handleSyncBatch, queueAck, flushAcks])

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
