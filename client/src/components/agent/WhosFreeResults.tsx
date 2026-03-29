import { useState, useEffect } from 'react'
import {
  X, Users, CheckCircle, XCircle, Clock, Bot,
  Sparkles, MessageSquare, UserPlus, User,
} from 'lucide-react'
import { useAgentDialogStore, type WhosFreePartialResult } from '../../stores/agentDialogStore'
import { useChatStore } from '../../stores/chatStore'
import { useNavigate } from 'react-router-dom'

interface Props {
  dialogId: string
  intentText: string
  friendsAsked: number
  onClose: () => void
}

export default function WhosFreeResults({ dialogId, intentText, friendsAsked, onClose }: Props) {
  const navigate = useNavigate()
  const { setActiveChat } = useChatStore()
  const { whosFreeResults } = useAgentDialogStore()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showSummary, setShowSummary] = useState(false)

  const results = whosFreeResults.get(dialogId) || []
  const respondedCount = results.length
  const availableResults = results.filter(r => r.available)
  const unavailableResults = results.filter(r => !r.available)
  const waitingCount = Math.max(0, friendsAsked - respondedCount)
  const progress = friendsAsked > 0 ? (respondedCount / friendsAsked) * 100 : 0

  // Show summary when all responded or after some results
  useEffect(() => {
    if (respondedCount >= friendsAsked && friendsAsked > 0) {
      setTimeout(() => setShowSummary(true), 500)
    }
  }, [respondedCount, friendsAsked])

  // Listen for new results via custom events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail?.dialogId === dialogId) {
        // Results are already handled by the store via handleDialogUpdate
      }
    }
    window.addEventListener('agent_dialog_update' as any, handler)
    return () => window.removeEventListener('agent_dialog_update' as any, handler)
  }, [dialogId])

  const toggleSelect = (friendId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(friendId)) next.delete(friendId)
      else next.add(friendId)
      return next
    })
  }

  const handleOpenChat = (friendId: string) => {
    // Navigate to chat with this friend
    setActiveChat(friendId)
    navigate('/')
  }

  const handleCreateGroup = () => {
    // TODO: Call API to create group from selected friends
    const selectedNames = availableResults
      .filter(r => selectedIds.has(r.friendId))
      .map(r => r.friendName)
    console.log('[WhosFreeResults] Create group with:', selectedNames)
    // For now, close the sheet
    onClose()
  }

  const buildSummary = (): string => {
    if (availableResults.length === 0) {
      return 'К сожалению, никто не смог. Попробуйте другой день?'
    }
    const names = availableResults.map(r => r.friendName).join(', ')
    const timeNotes = availableResults
      .filter(r => r.message)
      .map(r => `${r.friendName}: ${r.message}`)

    let summary = `${availableResults.length === 1 ? 'Свободен' : 'Свободны'}: ${names}.`
    if (timeNotes.length > 0) {
      summary += ' ' + timeNotes.join('; ') + '.'
    }
    return summary
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-bg-secondary rounded-t-2xl border-t border-border max-h-[85vh] flex flex-col animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">👋</span>
              <h2 className="font-semibold text-lg bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                Давай соберёмся
              </h2>
            </div>
            <p className="text-sm text-text-secondary mt-0.5 pl-8">
              "{intentText}"
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Progress */}
        <div className="px-5 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-secondary">
              {respondedCount >= friendsAsked
                ? `Все ответили (${respondedCount})`
                : `Ответили ${respondedCount} из ${friendsAsked}`
              }
            </span>
            {waitingCount > 0 && (
              <span className="text-xs text-text-secondary flex items-center gap-1">
                <Clock size={10} className="animate-pulse" />
                Ждём ещё {waitingCount}
              </span>
            )}
          </div>
          <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
          {/* Available responses */}
          {availableResults.map((result, i) => (
            <ResponseCard
              key={result.friendId}
              result={result}
              available
              selected={selectedIds.has(result.friendId)}
              onToggle={() => toggleSelect(result.friendId)}
              onChat={() => handleOpenChat(result.friendId)}
              delay={i * 100}
            />
          ))}

          {/* Waiting placeholders */}
          {waitingCount > 0 && Array.from({ length: Math.min(waitingCount, 3) }).map((_, i) => (
            <WaitingCard key={`waiting-${i}`} />
          ))}

          {/* Unavailable responses */}
          {unavailableResults.map((result, i) => (
            <ResponseCard
              key={result.friendId}
              result={result}
              available={false}
              selected={false}
              onToggle={() => {}}
              onChat={() => handleOpenChat(result.friendId)}
              delay={(availableResults.length + i) * 100}
            />
          ))}

          {/* AI Summary */}
          {showSummary && respondedCount > 0 && (
            <div className="mt-3 bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3 animate-fade-in">
              <div className="flex items-start gap-2">
                <Sparkles size={16} className="text-purple-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs font-medium text-purple-400 mb-1">Итог от агента</div>
                  <p className="text-sm text-text-primary leading-relaxed">
                    {buildSummary()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Empty state: nobody responded yet */}
          {respondedCount === 0 && friendsAsked > 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
                <Users size={24} className="text-green-400 animate-pulse" />
              </div>
              <p className="text-sm text-text-secondary">Отправляем запросы друзьям...</p>
              <p className="text-xs text-text-secondary mt-1">Ответы появятся здесь в реальном времени</p>
            </div>
          )}

          {/* Empty state: all declined */}
          {respondedCount >= friendsAsked && availableResults.length === 0 && respondedCount > 0 && (
            <div className="flex flex-col items-center py-6 text-center">
              <p className="text-sm text-text-secondary">Сегодня не получилось 😔</p>
              <p className="text-xs text-text-secondary mt-1">Попробуйте другой день или других друзей</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {availableResults.length > 0 && (
          <div className="px-5 py-4 border-t border-border space-y-2">
            <button
              onClick={handleCreateGroup}
              disabled={selectedIds.size < 2}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <UserPlus size={16} />
              {selectedIds.size >= 2
                ? `Создать группу (${selectedIds.size})`
                : 'Выберите минимум 2 человека'
              }
            </button>
            {availableResults.length === 1 && (
              <button
                onClick={() => handleOpenChat(availableResults[0].friendId)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-text-secondary hover:text-text-primary text-sm transition-colors"
              >
                <MessageSquare size={14} />
                Написать {availableResults[0].friendName}
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }

        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }

        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </div>
  )
}

// ── Response Card ──────────────────────────────────────────────────────────────

function ResponseCard({
  result,
  available,
  selected,
  onToggle,
  onChat,
  delay,
}: {
  result: WhosFreePartialResult
  available: boolean
  selected: boolean
  onToggle: () => void
  onChat: () => void
  delay: number
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  if (!visible) return null

  return (
    <div
      className={`rounded-xl px-3.5 py-3 border transition-all animate-fade-in ${
        available
          ? 'bg-green-500/5 border-green-500/20'
          : 'bg-red-500/5 border-red-500/20'
      } ${selected ? 'ring-2 ring-green-400/50' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Checkbox (only for available) */}
        {available && (
          <button
            onClick={onToggle}
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              selected
                ? 'bg-green-500 border-green-500 scale-100'
                : 'border-green-500/40 hover:border-green-400'
            }`}
          >
            {selected && <CheckCircle size={12} className="text-white" />}
          </button>
        )}

        {/* Avatar */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
          available ? 'bg-green-500/20 text-green-400' : 'bg-red-500/15 text-red-400'
        }`}>
          {result.friendName?.[0]?.toUpperCase() || '?'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {result.friendName}
            </span>
            <span className={`text-xs font-medium flex items-center gap-1 flex-shrink-0 ${
              available ? 'text-green-400' : 'text-red-400'
            }`}>
              {available ? (
                <><CheckCircle size={12} /> Свободен</>
              ) : (
                <><XCircle size={12} /> Занят</>
              )}
            </span>
          </div>

          {/* Message */}
          {result.message && (
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              "{result.message}"
            </p>
          )}

          {/* Autonomy badge */}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] flex items-center gap-1 ${
              result.auto ? 'text-purple-400' : 'text-text-secondary'
            }`}>
              {result.auto ? (
                <><Bot size={9} /> Агент ответил</>
              ) : (
                <><User size={9} /> Ответил сам</>
              )}
            </span>
          </div>
        </div>

        {/* Quick chat action */}
        <button
          onClick={onChat}
          className="p-1.5 rounded-lg hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
          title={`Написать ${result.friendName}`}
        >
          <MessageSquare size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Waiting Card (skeleton) ────────────────────────────────────────────────────

function WaitingCard() {
  return (
    <div className="rounded-xl px-3.5 py-3 border border-border bg-bg-hover/50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-bg-hover animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 bg-bg-hover rounded animate-shimmer" />
            <span className="text-xs text-text-secondary flex items-center gap-1">
              <Clock size={10} className="animate-pulse" />
              Ждём...
            </span>
          </div>
          <div className="h-2 w-32 bg-bg-hover rounded animate-shimmer" />
        </div>
      </div>
    </div>
  )
}
