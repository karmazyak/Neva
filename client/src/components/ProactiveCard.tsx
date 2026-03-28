import { useState, useEffect } from 'react'
import {
  X, Send, MessageSquare, Heart, Target, AlertTriangle, Sparkles,
  Search, Shield, Users, CheckCircle,
} from 'lucide-react'
import { api } from '../lib/api'
import { useChatStore } from '../stores/chatStore'
import { useNetworkStore } from '../stores/networkStore'

interface ProactiveAction {
  id: string
  chatId: string
  chatName?: string
  title: string
  body: string
  draftMessage?: string
  type: string
  trigger: string
  // Extended fields for new triggers
  metadata?: Record<string, any>
}

/**
 * ProactiveCard — shows AI-generated proactive suggestions.
 * Supports: silence, unanswered, burst, goal_stall, mood,
 *           detected_need, fraud_suspicion, consent_request
 */
export default function ProactiveCard() {
  const [actions, setActions] = useState<ProactiveAction[]>([])
  const { setActiveChat } = useChatStore()

  useEffect(() => { loadActions() }, [])

  // Listen for WebSocket proactive_action events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const action = e.detail?.action
      if (action) {
        setActions(prev => {
          if (prev.some(a => a.id === action.id)) return prev
          return [action, ...prev]
        })
      }
    }
    window.addEventListener('proactive_action' as any, handler)
    return () => window.removeEventListener('proactive_action' as any, handler)
  }, [])

  // Listen for consent_request events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const req = e.detail
      if (req) {
        const action: ProactiveAction = {
          id: `consent-${req.requestId}`,
          chatId: '',
          title: `${req.fromName || 'Кто-то'} спрашивает`,
          body: req.context || 'Запрос на доступ к данным',
          type: 'consent',
          trigger: 'consent_request',
          metadata: { requestId: req.requestId },
        }
        setActions(prev => {
          if (prev.some(a => a.id === action.id)) return prev
          return [action, ...prev]
        })
      }
    }
    window.addEventListener('consent_request' as any, handler)
    return () => window.removeEventListener('consent_request' as any, handler)
  }, [])

  // Listen for fraud_alert events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const alert = e.detail
      if (alert) {
        const action: ProactiveAction = {
          id: `fraud-${Date.now()}`,
          chatId: alert.chatId || '',
          chatName: alert.chatName,
          title: 'Подозрительное сообщение',
          body: `Обнаружены признаки мошенничества: ${(alert.signals || []).map((s: any) => s.category).join(', ')}`,
          type: 'fraud',
          trigger: 'fraud_suspicion',
        }
        setActions(prev => [action, ...prev])
      }
    }
    window.addEventListener('fraud_alert' as any, handler)
    return () => window.removeEventListener('fraud_alert' as any, handler)
  }, [])

  const loadActions = async () => {
    try {
      const data = await api.getProactiveActions()
      setActions(data.actions || [])
    } catch {}
  }

  const handleAct = async (action: ProactiveAction) => {
    if (action.trigger === 'detected_need') {
      // Open network sheet to create a need
      useNetworkStore.getState().setSheetOpen(true)
      setActions(prev => prev.filter(a => a.id !== action.id))
      try { await api.actOnProactiveAction(action.id, 'acted') } catch {}
      return
    }

    if (action.trigger === 'consent_request' && action.metadata?.requestId) {
      try { await api.respondConsent(action.metadata.requestId, true) } catch {}
      setActions(prev => prev.filter(a => a.id !== action.id))
      return
    }

    if (action.chatId) {
      setActiveChat(action.chatId)
    }
    try { await api.actOnProactiveAction(action.id, 'acted') } catch {}
    setActions(prev => prev.filter(a => a.id !== action.id))
  }

  const handleDismiss = async (action: ProactiveAction) => {
    if (action.trigger === 'consent_request' && action.metadata?.requestId) {
      try { await api.respondConsent(action.metadata.requestId, false) } catch {}
      setActions(prev => prev.filter(a => a.id !== action.id))
      return
    }

    try { await api.actOnProactiveAction(action.id, 'dismissed') } catch {}
    setActions(prev => prev.filter(a => a.id !== action.id))
  }

  if (actions.length === 0) return null

  const triggerIcon = (trigger: string) => {
    switch (trigger) {
      case 'silence': return <Heart size={16} className="text-pink-400" />
      case 'unanswered': return <MessageSquare size={16} className="text-amber-400" />
      case 'goal_stall': return <Target size={16} className="text-purple-400" />
      case 'burst': return <AlertTriangle size={16} className="text-red-400" />
      case 'mood': return <Heart size={16} className="text-pink-400" />
      case 'detected_need': return <Search size={16} className="text-cyan-400" />
      case 'fraud_suspicion': return <Shield size={16} className="text-red-400" />
      case 'consent_request': return <Users size={16} className="text-blue-400" />
      default: return <Sparkles size={16} className="text-accent" />
    }
  }

  const triggerColor = (trigger: string) => {
    switch (trigger) {
      case 'silence': return 'border-pink-500/20 bg-pink-500/5'
      case 'unanswered': return 'border-amber-500/20 bg-amber-500/5'
      case 'goal_stall': return 'border-purple-500/20 bg-purple-500/5'
      case 'burst': return 'border-red-500/20 bg-red-500/5'
      case 'detected_need': return 'border-cyan-500/20 bg-cyan-500/5'
      case 'fraud_suspicion': return 'border-red-500/20 bg-red-500/5'
      case 'consent_request': return 'border-blue-500/20 bg-blue-500/5'
      default: return 'border-accent/20 bg-accent/5'
    }
  }

  const actionLabel = (action: ProactiveAction) => {
    switch (action.trigger) {
      case 'detected_need': return 'Да, поищи'
      case 'fraud_suspicion': return 'Заблокировать'
      case 'consent_request': return 'Разрешить'
      default: return action.draftMessage ? 'Открыть чат' : 'Перейти'
    }
  }

  const dismissLabel = (trigger: string) => {
    switch (trigger) {
      case 'fraud_suspicion': return 'Это знакомый'
      case 'consent_request': return 'Отклонить'
      default: return 'Не сейчас'
    }
  }

  return (
    <div className="fixed bottom-16 md:bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {actions.slice(0, 3).map((action) => (
        <div
          key={action.id}
          className={`pointer-events-auto border rounded-xl p-3.5 shadow-lg backdrop-blur-sm fade-in ${triggerColor(action.trigger)}`}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex-shrink-0">
              {triggerIcon(action.trigger)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-text-primary truncate">{action.title}</h4>
                <button
                  onClick={() => handleDismiss(action)}
                  className="p-0.5 rounded-full hover:bg-white/10 text-text-secondary flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{action.body}</p>

              {action.draftMessage && (
                <div className="mt-2 bg-bg-primary/50 rounded-lg px-2.5 py-1.5 text-xs text-text-primary italic">
                  "{action.draftMessage}"
                </div>
              )}

              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={() => handleAct(action)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    action.trigger === 'fraud_suspicion'
                      ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
                      : action.trigger === 'consent_request'
                      ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400'
                      : 'bg-accent/20 hover:bg-accent/30 text-accent'
                  }`}
                >
                  {action.trigger === 'consent_request' ? <CheckCircle size={12} /> : <Send size={12} />}
                  {actionLabel(action)}
                </button>
                <button
                  onClick={() => handleDismiss(action)}
                  className="px-3 py-1.5 text-text-secondary hover:text-text-primary text-xs transition-colors"
                >
                  {dismissLabel(action.trigger)}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
