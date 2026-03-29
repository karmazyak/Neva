import { useState, useEffect } from 'react'
import {
  X, Bot, Users, Eye, Shield, MessageSquare,
  CheckCircle, XCircle, Clock, Zap, ChevronRight,
  Settings, Bell, Check, UserPlus, Undo2,
} from 'lucide-react'
import { useAgentDialogStore, type AgentDialog, type DialogType } from '../../stores/agentDialogStore'
import AgentDialogDetail from './AgentDialogDetail'
import AgentAutonomySettings from './AgentAutonomySettings'

interface Props {
  open: boolean
  onClose: () => void
}

export default function AgentDialogPanel({ open, onClose }: Props) {
  const {
    dialogs, pendingCount, loadDialogs,
    selectedDialogId, setSelectedDialog,
    respondToDialog,
  } = useAgentDialogStore()

  const [tab, setTab] = useState<'dialogs' | 'settings'>('dialogs')
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')

  useEffect(() => {
    if (open) loadDialogs()
  }, [open])

  if (!open) return null

  // If a dialog is selected, show detail view
  if (selectedDialogId) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
        <div
          className="w-full max-w-md bg-bg-secondary h-full flex flex-col animate-slide-in-right"
          onClick={e => e.stopPropagation()}
        >
          <AgentDialogDetail
            dialogId={selectedDialogId}
            onBack={() => setSelectedDialog(null)}
            onClose={onClose}
          />
        </div>
      </div>
    )
  }

  const filtered = dialogs.filter(d => {
    if (filter === 'pending') return d.status === 'pending'
    if (filter === 'completed') return d.status !== 'pending'
    return true
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-secondary h-full flex flex-col animate-slide-in-right"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">Уведомления</h2>
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab(tab === 'settings' ? 'dialogs' : 'settings')}
              className={`p-1.5 rounded-lg transition ${
                tab === 'settings' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {tab === 'settings' ? (
          <AgentAutonomySettings />
        ) : (
          <>
            {/* Filter tabs */}
            <div className="flex gap-1 p-3 border-b border-border">
              {(['all', 'pending', 'completed'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition ${
                    filter === f
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  {f === 'all' ? 'Все' : f === 'pending' ? 'Новые' : 'История'}
                  {f === 'pending' && pendingCount > 0 && (
                    <span className="ml-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Dialog list */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
                  <Bell className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">Нет уведомлений</p>
                  <p className="text-xs mt-1 opacity-60">
                    Здесь появятся запросы от друзей и результаты
                  </p>
                </div>
              ) : (
                filtered.map(dialog => (
                  <HumanDialogCard
                    key={dialog.id}
                    dialog={dialog}
                    onClick={() => setSelectedDialog(dialog.id)}
                    onRespond={respondToDialog}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Human-Friendly Dialog Card ──────────────────────────────────────────────────

function HumanDialogCard({
  dialog,
  onClick,
  onRespond,
}: {
  dialog: AgentDialog
  onClick: () => void
  onRespond: (id: string, approved: boolean, message?: string) => Promise<void>
}) {
  const isParent = dialog.initiatorUserId === dialog.targetUserId
  const timeAgo = getTimeAgo(dialog.createdAt)
  const contextData = dialog.contextData as Record<string, any>

  // Build human-friendly description
  const description = buildHumanDescription(dialog, isParent, contextData)

  // Determine card style based on status
  const isAutoAction = dialog.status === 'auto_approved'
  const isPending = dialog.status === 'pending'
  const isResolved = ['approved', 'denied', 'expired', 'cancelled'].includes(dialog.status)

  return (
    <div
      className={`border-b border-border transition-colors ${
        isPending ? 'bg-amber-500/5' : isAutoAction ? 'bg-green-500/5' : ''
      }`}
    >
      <button
        onClick={onClick}
        className="w-full flex items-start gap-3 p-4 hover:bg-bg-hover text-left"
      >
        {/* Icon */}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          isAutoAction
            ? 'bg-green-500/15'
            : isPending
            ? 'bg-amber-500/15'
            : 'bg-bg-hover'
        }`}>
          {isAutoAction ? (
            <Bot className="w-5 h-5 text-green-400" />
          ) : dialog.type === 'whos_free' ? (
            <Users className="w-5 h-5 text-green-400" />
          ) : dialog.type === 'match_proposal' ? (
            <UserPlus className="w-5 h-5 text-blue-400" />
          ) : dialog.type === 'get_interests' ? (
            <Eye className="w-5 h-5 text-blue-400" />
          ) : (
            <Shield className="w-5 h-5 text-purple-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary leading-snug">
            {description}
          </p>

          {/* Context message */}
          {dialog.lastMessage && (
            <p className="text-xs text-text-secondary mt-1 truncate italic">
              "{dialog.lastMessage}"
            </p>
          )}

          {/* Auto-action info */}
          {isAutoAction && !isParent && (
            <div className="flex items-center gap-1 mt-1.5 text-[11px] text-green-400/70">
              <Zap size={10} />
              Обработано автоматически
            </div>
          )}

          {/* Time */}
          <span className="text-[10px] text-text-secondary mt-1 block">{timeAgo}</span>
        </div>

        <ChevronRight className="w-4 h-4 text-text-secondary flex-shrink-0 mt-1" />
      </button>

      {/* Quick actions for pending items */}
      {isPending && !isParent && (
        <div className="flex gap-2 px-4 pb-3 pl-[68px]">
          {dialog.type === 'whos_free' ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onRespond(dialog.id, true, 'Свободен') }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 text-xs font-medium transition-colors"
              >
                <Check size={12} />
                Свободен
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRespond(dialog.id, false, 'Занят') }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 text-xs font-medium transition-colors"
              >
                <XCircle size={12} />
                Занят
              </button>
              <button
                onClick={onClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-text-secondary hover:text-text-primary text-xs transition-colors"
              >
                <MessageSquare size={12} />
                Написать
              </button>
            </>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onRespond(dialog.id, true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 text-xs font-medium transition-colors"
              >
                <CheckCircle size={12} />
                Принять
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRespond(dialog.id, false) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-text-secondary hover:text-text-primary text-xs transition-colors"
              >
                Отклонить
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Build human-friendly description ────────────────────────────────────────────

function buildHumanDescription(
  dialog: AgentDialog,
  isParent: boolean,
  contextData: Record<string, any>,
): string {
  const { type, status, initiatorName, targetName } = dialog

  // Auto-approved actions: show what the agent did
  if (status === 'auto_approved' && !isParent) {
    if (type === 'whos_free') {
      return `Ваш агент ответил ${initiatorName}, что вы свободны`
    }
    if (type === 'get_interests') {
      return `Ваш агент поделился интересами с ${initiatorName}`
    }
    return `Ваш агент обработал запрос от ${initiatorName}`
  }

  // Parent "whos_free" dialogs: show aggregate info
  if (isParent && type === 'whos_free') {
    const friendsAsked = contextData?.friendsAsked || 0
    const context = contextData?.context
    if (context) {
      return `Опрос "${context}" -- ${friendsAsked} друзей`
    }
    return `Вы спросили ${friendsAsked} друзей, кто свободен`
  }

  // Pending requests: human-friendly phrasing
  if (status === 'pending') {
    if (type === 'whos_free') {
      const context = contextData?.context
      return context
        ? `${initiatorName} спрашивает, свободны ли вы: "${context}"`
        : `${initiatorName} спрашивает, свободны ли вы`
    }
    if (type === 'match_proposal') {
      return `${initiatorName} хочет познакомить вас с кем-то`
    }
    if (type === 'get_interests') {
      return `${initiatorName} хочет узнать ваши интересы`
    }
    return `${initiatorName} отправил запрос`
  }

  // Resolved dialogs
  if (status === 'approved') {
    if (type === 'whos_free') return `Вы ответили ${initiatorName}: свободны`
    if (type === 'match_proposal') return `Знакомство с ${initiatorName} одобрено`
    return `Запрос от ${initiatorName} принят`
  }
  if (status === 'denied') {
    if (type === 'whos_free') return `Вы ответили ${initiatorName}: заняты`
    return `Запрос от ${initiatorName} отклонён`
  }
  if (status === 'expired') {
    return `Запрос от ${initiatorName} истёк`
  }

  // Fallback
  return `${initiatorName} -- ${targetName}`
}

// ── Time helper ──────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'сейчас'
  if (minutes < 60) return `${minutes}м назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}ч назад`
  const days = Math.floor(hours / 24)
  return `${days}д назад`
}
