import { useState, useEffect } from 'react'
import {
  X, Plus, Search, Loader2, Trash2, Sparkles, Globe, Users, Briefcase,
  PartyPopper, Heart, ChevronRight, Star, CheckCircle, Clock,
} from 'lucide-react'
import { useNetworkStore } from '../../stores/networkStore'
import type { Need, Offer, Match } from '../../stores/networkStore'

const CATEGORIES = [
  { value: 'professional', label: 'Работа', icon: Briefcase, color: 'text-blue-400' },
  { value: 'social', label: 'Досуг', icon: PartyPopper, color: 'text-green-400' },
  { value: 'care', label: 'Забота', icon: Heart, color: 'text-pink-400' },
]

const URGENCY_LABELS: Record<string, string> = {
  now: 'Срочно', this_week: 'На этой неделе', whenever: 'Когда-нибудь',
}

const VISIBILITY_LABELS: Record<string, string> = {
  friends: 'Друзья', friends_of_friends: 'Друзья друзей', network: 'Вся сеть',
}

export default function NetworkSheet() {
  const {
    sheetOpen, setSheetOpen, needs, offers, matches, consentRequests,
    loading, loadAll, createNeed, createOffer, deleteNeed, deleteOffer, triggerMatch, respondConsent,
  } = useNetworkStore()

  const [showNewNeed, setShowNewNeed] = useState(false)
  const [showNewOffer, setShowNewOffer] = useState(false)
  const [newNeedText, setNewNeedText] = useState('')
  const [newNeedCategory, setNewNeedCategory] = useState('professional')
  const [newNeedUrgency, setNewNeedUrgency] = useState('whenever')
  const [newNeedVisibility, setNewNeedVisibility] = useState('friends')
  const [newOfferText, setNewOfferText] = useState('')
  const [newOfferCategory, setNewOfferCategory] = useState('professional')
  const [matchingNeedId, setMatchingNeedId] = useState<string | null>(null)
  const [matchResults, setMatchResults] = useState<Match[] | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (sheetOpen) loadAll()
  }, [sheetOpen])

  if (!sheetOpen) return null

  const handleCreateNeed = async () => {
    if (!newNeedText.trim()) return
    setSubmitting(true)
    try {
      await createNeed({ description: newNeedText.trim(), category: newNeedCategory, urgency: newNeedUrgency, visibility: newNeedVisibility })
      setNewNeedText('')
      setShowNewNeed(false)
    } catch {} finally { setSubmitting(false) }
  }

  const handleCreateOffer = async () => {
    if (!newOfferText.trim()) return
    setSubmitting(true)
    try {
      await createOffer({ description: newOfferText.trim(), category: newOfferCategory })
      setNewOfferText('')
      setShowNewOffer(false)
    } catch {} finally { setSubmitting(false) }
  }

  const handleMatch = async (needId: string) => {
    setMatchingNeedId(needId)
    setMatchResults(null)
    try {
      const results = await triggerMatch(needId)
      setMatchResults(results)
    } catch (err) {
      console.error('[NetworkSheet] Match failed:', err)
      setMatchResults([])
    } finally { setMatchingNeedId(null) }
  }

  const daysLeft = (expiresAt: string) => {
    const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)
    return days > 0 ? `${days} дн` : 'истекло'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSheetOpen(false)} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-bg-secondary rounded-t-2xl border-t border-border max-h-[85vh] flex flex-col animate-slide-up">
        {/* Handle + Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Globe size={20} className="text-accent" />
            <h2 className="font-semibold text-text-primary text-lg">Моя сеть</h2>
          </div>
          <button onClick={() => setSheetOpen(false)} className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-accent animate-spin" />
              <span className="ml-3 text-text-secondary text-sm">Загружаю...</span>
            </div>
          ) : (
            <>
              {/* ── My Needs ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Search size={15} className="text-cyan-400" />
                    Мои запросы
                  </h3>
                  <button onClick={() => setShowNewNeed(!showNewNeed)} className="text-accent hover:text-accent-hover">
                    <Plus size={16} />
                  </button>
                </div>

                {/* New need form */}
                {showNewNeed && (
                  <div className="bg-bg-hover rounded-xl p-3 space-y-2.5 border border-border">
                    <input
                      type="text"
                      value={newNeedText}
                      onChange={e => setNewNeedText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateNeed()}
                      placeholder="Что ищете? (напр. дизайнер для лендинга)"
                      className="w-full text-sm bg-bg-primary rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none border border-border"
                      autoFocus
                    />
                    <div className="flex gap-2 flex-wrap">
                      {CATEGORIES.filter(c => c.value !== 'hobby').map(cat => (
                        <button
                          key={cat.value}
                          onClick={() => setNewNeedCategory(cat.value)}
                          className={`text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
                            newNeedCategory === cat.value
                              ? 'bg-accent/20 text-accent border border-accent/30'
                              : 'bg-bg-primary text-text-secondary border border-border hover:border-accent/20'
                          }`}
                        >
                          <cat.icon size={10} /> {cat.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(URGENCY_LABELS).map(([k, v]) => (
                        <button
                          key={k}
                          onClick={() => setNewNeedUrgency(k)}
                          className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                            newNeedUrgency === k
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-bg-primary text-text-secondary border border-border'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(VISIBILITY_LABELS).map(([k, v]) => (
                        <button
                          key={k}
                          onClick={() => setNewNeedVisibility(k)}
                          className={`text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
                            newNeedVisibility === k
                              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                              : 'bg-bg-primary text-text-secondary border border-border'
                          }`}
                        >
                          <Users size={9} /> {v}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={handleCreateNeed}
                      disabled={!newNeedText.trim() || submitting}
                      className="w-full py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {submitting ? 'Создаю...' : 'Создать запрос'}
                    </button>
                  </div>
                )}

                {/* Needs list */}
                {needs.length > 0 ? needs.map(need => (
                  <div key={need.id} className="bg-bg-hover rounded-xl px-3.5 py-3 border border-border space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary">{need.description}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">
                            {VISIBILITY_LABELS[need.visibility] || need.visibility}
                          </span>
                          <span className="text-[10px] text-text-secondary flex items-center gap-1">
                            <Clock size={9} /> {daysLeft(need.expiresAt)}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => deleteNeed(need.id)} className="text-text-secondary hover:text-danger flex-shrink-0 p-1">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <button
                      onClick={() => handleMatch(need.id)}
                      disabled={matchingNeedId === need.id}
                      className="w-full py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {matchingNeedId === need.id ? (
                        <><Loader2 size={12} className="animate-spin" /> Ищу совпадения...</>
                      ) : (
                        <><Sparkles size={12} /> Найти совпадения</>
                      )}
                    </button>
                  </div>
                )) : !showNewNeed && (
                  <div className="text-xs text-text-secondary text-center py-3">
                    Нет активных запросов
                  </div>
                )}

                {/* Match results */}
                {matchResults !== null && (
                  <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-accent flex items-center gap-1.5">
                      <Sparkles size={12} />
                      {matchResults.length > 0 ? `Найдено ${matchResults.length} совпадений` : 'Совпадений не найдено'}
                    </h4>
                    {matchResults.map(m => (
                      <div key={m.offerId} className="bg-bg-secondary rounded-lg px-3 py-2.5 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold flex-shrink-0">
                          {m.displayName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary font-medium">{m.displayName || 'Контакт'}</div>
                          <div className="text-xs text-text-secondary truncate">{m.offerDescription}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-accent">{Math.round(m.similarity * 100)}% совпадение</span>
                            {m.mutualContactName && (
                              <span className="text-[10px] text-text-secondary">через {m.mutualContactName}</span>
                            )}
                            <span className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5].map(s => (
                                <Star key={s} size={8} className={s <= Math.round(m.trustScore) ? 'text-amber-400 fill-amber-400' : 'text-text-secondary/30'} />
                              ))}
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-text-secondary flex-shrink-0" />
                      </div>
                    ))}
                    <button onClick={() => setMatchResults(null)} className="text-xs text-text-secondary hover:text-text-primary w-full text-center pt-1">
                      Скрыть
                    </button>
                  </div>
                )}
              </section>

              {/* ── My Offers ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Briefcase size={15} className="text-emerald-400" />
                    Мои навыки
                  </h3>
                  <button onClick={() => setShowNewOffer(!showNewOffer)} className="text-accent hover:text-accent-hover">
                    <Plus size={16} />
                  </button>
                </div>

                {showNewOffer && (
                  <div className="bg-bg-hover rounded-xl p-3 space-y-2.5 border border-border">
                    <input
                      type="text"
                      value={newOfferText}
                      onChange={e => setNewOfferText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateOffer()}
                      placeholder="Что умеете? (напр. React разработка)"
                      className="w-full text-sm bg-bg-primary rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none border border-border"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      {CATEGORIES.map(cat => (
                        <button
                          key={cat.value}
                          onClick={() => setNewOfferCategory(cat.value)}
                          className={`text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
                            newOfferCategory === cat.value
                              ? 'bg-accent/20 text-accent border border-accent/30'
                              : 'bg-bg-primary text-text-secondary border border-border'
                          }`}
                        >
                          <cat.icon size={10} /> {cat.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={handleCreateOffer}
                      disabled={!newOfferText.trim() || submitting}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {submitting ? 'Добавляю...' : 'Добавить навык'}
                    </button>
                  </div>
                )}

                {offers.length > 0 ? offers.map(offer => (
                  <div key={offer.id} className="bg-bg-hover rounded-xl px-3.5 py-2.5 border border-border flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary">{offer.description}</div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 inline-block mt-1">
                        {offer.availability === 'available' ? 'Доступен' : 'Занят'}
                      </span>
                    </div>
                    <button onClick={() => deleteOffer(offer.id)} className="text-text-secondary hover:text-danger p-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )) : !showNewOffer && (
                  <div className="text-xs text-text-secondary text-center py-3">
                    Добавьте навыки, чтобы друзья могли вас найти
                  </div>
                )}
              </section>

              {/* ── Incoming Consent / Match proposals ── */}
              {consentRequests.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Heart size={15} className="text-pink-400" />
                    Входящие запросы
                  </h3>
                  {consentRequests.map(req => (
                    <div key={req.id} className="bg-pink-500/5 border border-pink-500/20 rounded-xl px-3.5 py-3 space-y-2">
                      <div className="text-sm text-text-primary">
                        <span className="font-medium">{req.fromName || 'Кто-то'}</span> {req.context}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => respondConsent(req.id, true)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg text-xs font-medium transition-colors"
                        >
                          <CheckCircle size={12} /> Разрешить
                        </button>
                        <button
                          onClick={() => respondConsent(req.id, false)}
                          className="px-3 py-1.5 text-text-secondary hover:text-text-primary text-xs transition-colors"
                        >
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </>
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
