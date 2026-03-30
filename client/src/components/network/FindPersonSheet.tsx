import { useState } from 'react'
import {
  X, Search, Loader2, MessageSquare, UserPlus, Star,
  Sparkles, Send, Shuffle, Lock,
} from 'lucide-react'
import { useNetworkStore } from '../../stores/networkStore'
import { useChatStore } from '../../stores/chatStore'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Match, MutualMatchResult } from '../../stores/networkStore'

const SUGGESTION_CHIPS = [
  'Дизайнер',
  'Репетитор',
  'Разработчик',
  'Юрист',
  'Врач',
  'Фотограф',
]

export default function FindPersonSheet() {
  const navigate = useNavigate()
  const { setActiveChat } = useChatStore()
  const { createNeed, triggerMatch, searchMutualMatch, initiateMutualMatch } = useNetworkStore()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Match[] | null>(null)
  const [mutualResults, setMutualResults] = useState<MutualMatchResult[]>([])
  const [currentNeedId, setCurrentNeedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [introLoading, setIntroLoading] = useState<string | null>(null) // offerId being processed
  const [introResult, setIntroResult] = useState<{ targetName: string; status: string } | null>(null)
  const [mutualMatchInitiated, setMutualMatchInitiated] = useState<Set<string>>(new Set())

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    setResults(null)
    setMutualResults([])
    setCurrentNeedId(null)

    try {
      // Use mutual match search (returns both mutual and one-way)
      const { mutual, oneWay, needId } = await searchMutualMatch(query.trim())
      setMutualResults(mutual)
      setResults(oneWay)
      if (needId) setCurrentNeedId(needId)
    } catch (err) {
      console.error('[FindPersonSheet] Search failed:', err)
      setError('Не удалось выполнить поиск. Попробуйте ещё раз.')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleInitiateMutualMatch = async (offerId: string) => {
    if (!currentNeedId) return
    setIntroLoading(offerId)
    const ok = await initiateMutualMatch(currentNeedId, offerId)
    if (ok) {
      setMutualMatchInitiated(prev => new Set(prev).add(offerId))
    }
    setIntroLoading(null)
  }

  const handleChipClick = (chip: string) => {
    setQuery(chip)
  }

  const handleOpenChat = (chatId: string) => {
    setActiveChat(chatId)
    setOpen(false)
    navigate('/')
  }

  const handleRequestIntro = async (match: Match) => {
    setIntroLoading(match.offerId)
    try {
      const res = await fetch('/api/agent/warm-intro', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({
          targetUserId: match.providerId || match.userId,
          mutualContactId: match.mutualContactId || '',
          needDescription: query,
        }),
      })
      const data = await res.json()
      setIntroResult({ targetName: match.displayName || 'Контакт', status: data.status })
    } catch (err) {
      console.error('[FindPerson] Warm intro failed:', err)
    } finally {
      setIntroLoading(null)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setQuery('')
    setResults(null)
    setMutualResults([])
    setCurrentNeedId(null)
    setError(null)
    setIntroResult(null)
    setMutualMatchInitiated(new Set())
  }

  // Separate results by social distance
  const directContacts = results?.filter(m => !m.mutualContactName && m.socialDistance <= 1) || []
  const throughFriends = results?.filter(m => m.mutualContactName || (m.socialDistance > 1 && m.socialDistance <= 2)) || []
  const networkWide = results?.filter(m => m.socialDistance > 2) || []

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500/15 to-cyan-500/15 border border-blue-500/20 hover:border-blue-400/40 transition-all text-left"
      >
        <span className="text-lg">🔍</span>
        <span className="text-sm font-medium text-blue-400">Найти человека</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-bg-secondary rounded-t-2xl border-t border-border max-h-[85vh] flex flex-col animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3">
          <div className="flex items-center gap-2">
            <Search size={20} className="text-blue-400" />
            <h2 className="font-semibold text-text-primary text-lg">Найти человека</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search Input */}
        <div className="px-5 pb-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Кого ищете? Опишите своими словами..."
              className="flex-1 text-sm bg-bg-primary rounded-xl px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none border border-border focus:border-blue-500/40 transition-colors"
              autoFocus
              disabled={searching}
            />
            <button
              onClick={handleSearch}
              disabled={!query.trim() || searching}
              className="p-3 rounded-xl bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 disabled:opacity-40 transition-colors"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>

          {/* Suggestion Chips */}
          {!results && !searching && (
            <div className="flex flex-wrap gap-2 mt-3">
              {SUGGESTION_CHIPS.map(chip => (
                <button
                  key={chip}
                  onClick={() => handleChipClick(chip)}
                  className="text-xs px-3 py-1.5 rounded-full bg-bg-hover border border-border text-text-secondary hover:text-blue-400 hover:border-blue-500/30 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
          {/* Loading */}
          {searching && (
            <div className="flex flex-col items-center py-8">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Sparkles size={16} className="text-blue-400 animate-pulse" />
                Ищу в вашей сети...
              </div>
              <div className="mt-4 space-y-2 w-full">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-xl p-3 border border-border bg-bg-hover/50">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-bg-hover animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-28 bg-bg-hover rounded animate-pulse" />
                        <div className="h-2 w-36 bg-bg-hover rounded animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-center py-6">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Results */}
          {(results || mutualResults.length > 0) && !searching && (
            <>
              {(results?.length === 0 && mutualResults.length === 0) ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <Search size={40} className="text-text-secondary/30 mb-3" />
                  <p className="text-sm text-text-secondary">Не нашёл среди знакомых</p>
                  <p className="text-xs text-text-secondary mt-1">Попробуйте другой запрос или расширьте видимость</p>
                </div>
              ) : (
                <>
                  {/* Mutual Matches — shown first with special styling */}
                  {mutualResults.length > 0 && (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                        <Shuffle size={14} className="text-emerald-400" />
                        Взаимные совпадения
                        <span className="ml-1 text-[9px] font-normal text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                          анонимно до подтверждения
                        </span>
                      </h3>
                      {mutualResults.map((mm) => (
                        <div key={mm.offerId} className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 rounded-xl px-3.5 py-3 border border-emerald-500/20">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
                              <Lock size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-text-primary">Анонимный матч</div>
                              <div className="text-xs text-text-secondary truncate mt-0.5">
                                {mm.offerDescription}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-emerald-400">
                                  {Math.round(mm.similarity * 100)}% совпадение
                                </span>
                                <span className="flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <Star
                                      key={s}
                                      size={8}
                                      className={s <= Math.round(mm.trustScore)
                                        ? 'text-amber-400 fill-amber-400'
                                        : 'text-text-secondary/30'
                                      }
                                    />
                                  ))}
                                </span>
                                {mm.hasMutualContact && (
                                  <span className="text-[10px] text-text-secondary">есть общие друзья</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleInitiateMutualMatch(mm.offerId)}
                              disabled={introLoading === mm.offerId || mutualMatchInitiated.has(mm.offerId)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors flex-shrink-0 font-medium flex items-center gap-1.5"
                            >
                              {introLoading === mm.offerId ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : mutualMatchInitiated.has(mm.offerId) ? (
                                'Отправлено'
                              ) : (
                                'Подтвердить'
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/* Direct Contacts */}
                  {directContacts.length > 0 && (
                    <ResultSection
                      title="Прямые контакты"
                      icon={<MessageSquare size={14} className="text-green-400" />}
                      matches={directContacts}
                      onAction={handleOpenChat}
                      actionLabel="Написать"
                    />
                  )}

                  {/* Through Friends */}
                  {throughFriends.length > 0 && (
                    <ResultSection
                      title="Через друзей"
                      icon={<UserPlus size={14} className="text-blue-400" />}
                      matches={throughFriends}
                      onAction={(matchId) => {
                        const match = throughFriends.find(m => m.offerId === matchId)
                        if (match) handleRequestIntro(match)
                      }}
                      actionLabel="Попросить представить"
                      loadingId={introLoading}
                    />
                  )}

                  {/* Network Wide */}
                  {networkWide.length > 0 && (
                    <ResultSection
                      title="В сети"
                      icon={<Sparkles size={14} className="text-purple-400" />}
                      matches={networkWide}
                      onAction={() => {}}
                      actionLabel="Запросить знакомство"
                    />
                  )}

                  {/* If all in one bucket (no social distance info) */}
                  {directContacts.length === 0 && throughFriends.length === 0 && networkWide.length === 0 && (results?.length || 0) > 0 && (
                    <ResultSection
                      title="Результаты"
                      icon={<Sparkles size={14} className="text-blue-400" />}
                      matches={results || []}
                      onAction={handleOpenChat}
                      actionLabel="Написать"
                    />
                  )}
                </>
              )}
            </>
          )}

          {introResult && (
            <div className="mt-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
              <span className="text-sm text-green-400">
                {introResult.status === 'consent_granted'
                  ? `Вас представили ${introResult.targetName}!`
                  : introResult.status === 'consent_pending'
                  ? `Запрос на знакомство с ${introResult.targetName} отправлен`
                  : `${introResult.targetName} отклонил знакомство`}
              </span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
      `}</style>
    </div>
  )
}

// ── Result Section ─────────────────────────────────────────────────────────────

function ResultSection({
  title,
  icon,
  matches,
  onAction,
  actionLabel,
  loadingId,
}: {
  title: string
  icon: React.ReactNode
  matches: Match[]
  onAction: (chatId: string) => void
  actionLabel: string
  loadingId?: string | null
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {matches.map((match) => (
        <MatchCard
          key={match.offerId}
          match={match}
          onAction={() => onAction(match.offerId)}
          actionLabel={actionLabel}
          loading={loadingId === match.offerId}
        />
      ))}
    </section>
  )
}

// ── Match Card ─────────────────────────────────────────────────────────────────

function MatchCard({
  match,
  onAction,
  actionLabel,
  loading,
}: {
  match: Match
  onAction: () => void
  actionLabel: string
  loading?: boolean
}) {
  return (
    <div className="bg-bg-hover rounded-xl px-3.5 py-3 border border-border">
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {match.displayName?.[0]?.toUpperCase() || '?'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">
            {match.displayName || 'Контакт'}
          </div>
          <div className="text-xs text-text-secondary truncate mt-0.5">
            {match.offerDescription}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {/* Trust score as visual dots instead of percentage */}
            <span className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(s => (
                <Star
                  key={s}
                  size={8}
                  className={s <= Math.round(match.trustScore)
                    ? 'text-amber-400 fill-amber-400'
                    : 'text-text-secondary/30'
                  }
                />
              ))}
            </span>
            {match.mutualContactName && (
              <span className="text-[10px] text-text-secondary flex items-center gap-0.5">
                через {match.mutualContactName}
              </span>
            )}
          </div>
        </div>

        {/* Action */}
        <button
          onClick={onAction}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 disabled:opacity-50 transition-colors flex-shrink-0 font-medium flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : null}
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
