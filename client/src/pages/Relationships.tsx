import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useChatStore } from '../stores/chatStore'
import {
  ArrowLeft,
  Heart,
  Search,
  Loader2,
  Target,
  Bot,
  Smile,
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  Lightbulb,
  Flame,
  Calendar,
  Bookmark,
  MessageSquare,
  Clock,
  Plus,
  Trash2,
  Play,
  Pause,
  CheckCircle,
  ChevronLeft,
  Sparkles,
  Edit3,
  RefreshCw,
  X,
  Globe,
  Link,
} from 'lucide-react'
import NetworkSheet from '../components/network/NetworkSheet'
import NetworkSection from '../components/network/NetworkSection'
import GiftIdeas from '../components/network/GiftIdeas'
import { useNetworkStore } from '../stores/networkStore'

interface ContactOverview {
  chatId: string
  name: string
  relationshipType: string | null
  mood: { mood: string; note: string | null } | null
  activeGoals: number
  hasAgent: boolean
  topDesire: string | null
}

interface ContactDetail {
  name: string
  username?: string
  chatId: string
  relationshipType: string | null
  mood: { mood: string; note: string | null; confidence: number } | null
  moodTrend: { trend: string; current: string; significantChange: boolean } | null
  memories: Array<{ fact: string; category: string }>
  goals: any[]
  agentConfig: { agentId: string; triggerMode: string } | null
  style: any
  myStylePreference: any
  proactiveActions: any[]
}

const REL_COLORS: Record<string, string> = {
  family: 'bg-pink-500/15 text-pink-400',
  friend: 'bg-green-500/15 text-green-400',
  work: 'bg-blue-500/15 text-blue-400',
  client: 'bg-amber-500/15 text-amber-400',
  acquaintance: 'bg-bg-hover text-text-secondary',
}
const REL_LABELS: Record<string, string> = {
  family: 'Семья', friend: 'Друг', work: 'Работа', client: 'Клиент', acquaintance: 'Знакомый',
}
const MOOD_EMOJI: Record<string, string> = {
  happy: '😊', normal: '😐', seems_off: '😟', stressed: '😰',
}

export default function Relationships() {
  const navigate = useNavigate()
  const { setActiveChat } = useChatStore()
  const [contacts, setContacts] = useState<ContactOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Detail sub-data
  const [insights, setInsights] = useState<{ situation: string | null; recommendations: any[] } | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [desires, setDesires] = useState<{ desires: any[]; dates: any[] } | null>(null)
  const [desiresLoading, setDesiresLoading] = useState(false)
  const [newGoalText, setNewGoalText] = useState('')
  const [showNewGoal, setShowNewGoal] = useState(false)

  useEffect(() => {
    loadContacts()
  }, [])

  const loadContacts = async () => {
    setLoading(true)
    try {
      const res = await api.getContactsOverview()
      setContacts(res.contacts || [])
    } catch {} finally { setLoading(false) }
  }

  const loadDetail = async (chatId: string) => {
    setSelectedChatId(chatId)
    setDetailLoading(true)
    setDetail(null)
    setInsights(null)
    setDesires(null)
    try {
      const res = await api.getContactSummary(chatId)
      setDetail(res.contact)
      // Load insights and desires in parallel
      loadInsights(chatId)
      loadDesires(chatId)
    } catch {} finally { setDetailLoading(false) }
  }

  const loadInsights = async (chatId: string) => {
    setInsightsLoading(true)
    try {
      const res = await api.getRelationshipInsights(chatId)
      setInsights(res)
    } catch {} finally { setInsightsLoading(false) }
  }

  const loadDesires = async (chatId: string) => {
    setDesiresLoading(true)
    try {
      const res = await api.getContactDesires(chatId)
      setDesires(res)
    } catch {} finally { setDesiresLoading(false) }
  }

  const handleCreateGoal = async () => {
    if (!newGoalText.trim() || !selectedChatId) return
    try {
      await api.createGoal({ goal: newGoalText.trim(), chatId: selectedChatId, mode: 'strategic' })
      setNewGoalText('')
      setShowNewGoal(false)
      loadDetail(selectedChatId)
    } catch {}
  }

  const handleGoBack = () => {
    setSelectedChatId(null)
    setDetail(null)
  }

  const handleOpenChat = (chatId: string) => {
    setActiveChat(chatId)
    navigate('/')
  }

  const filtered = contacts.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase())
  )

  const trendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return <TrendingUp size={14} className="text-green-400" />
      case 'declining': return <TrendingDown size={14} className="text-red-400" />
      default: return <Minus size={14} className="text-text-secondary" />
    }
  }

  // ── Detail View ──
  if (selectedChatId && (detail || detailLoading)) {
    return (
      <div className="h-screen bg-bg-primary flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
          <button onClick={handleGoBack} className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary">
            <ChevronLeft size={22} />
          </button>
          {detail && (
            <>
              <div className="w-10 h-10 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-lg">
                {detail.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-text-primary truncate">{detail.name}</h2>
                <div className="flex items-center gap-2">
                  {detail.username && <span className="text-xs text-text-secondary">@{detail.username}</span>}
                  {detail.relationshipType && detail.relationshipType !== 'other' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${REL_COLORS[detail.relationshipType] || ''}`}>
                      {REL_LABELS[detail.relationshipType] || detail.relationshipType}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleOpenChat(detail.chatId)}
                className="text-xs text-accent bg-accent/10 hover:bg-accent/15 px-3 py-1.5 rounded-full transition-colors"
              >
                Открыть чат
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-accent animate-spin" />
              <span className="ml-3 text-text-secondary">Загружаю данные...</span>
            </div>
          ) : detail ? (
            <div className="max-w-2xl mx-auto space-y-4">
              {/* Emotions Section */}
              <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <Smile size={16} className="text-pink-400" />
                  Эмоции
                </h3>

                {/* Current mood */}
                <div className="flex items-center gap-3 bg-bg-hover rounded-lg px-3 py-2.5">
                  <span className="text-2xl">{MOOD_EMOJI[detail.mood?.mood || 'normal'] || '😐'}</span>
                  <div>
                    <div className="text-sm text-text-primary font-medium capitalize">{detail.mood?.mood || 'Нет данных'}</div>
                    {detail.mood?.note && <div className="text-xs text-text-secondary">{detail.mood.note}</div>}
                  </div>
                  {detail.moodTrend && (
                    <div className="ml-auto flex items-center gap-1">
                      {trendIcon(detail.moodTrend.trend)}
                      <span className="text-xs text-text-secondary capitalize">{detail.moodTrend.trend}</span>
                    </div>
                  )}
                </div>

                {/* Psychologist */}
                {insightsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                    <Loader2 size={12} className="animate-spin" /> Анализирую отношения...
                  </div>
                ) : insights?.situation ? (
                  <div className="space-y-2">
                    <div className="text-sm text-text-primary bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2.5">
                      <Brain size={12} className="inline mr-1.5 text-purple-400" />
                      {insights.situation}
                    </div>
                    {insights.recommendations.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs text-text-secondary font-medium">Рекомендации:</div>
                        {insights.recommendations.map((rec: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-sm bg-bg-hover rounded-lg px-3 py-2">
                            <span className="mt-0.5 flex-shrink-0">
                              {rec.type === 'support' ? '💛' : rec.type === 'activity' ? '🎯' : rec.type === 'gift' ? '🎁' : '📱'}
                            </span>
                            <div className="flex-1">
                              <span className="text-text-primary">{rec.text}</span>
                              {rec.draftMessage && (
                                <button
                                  onClick={() => { handleOpenChat(detail.chatId) }}
                                  className="ml-2 text-[10px] text-accent bg-accent/10 hover:bg-accent/20 px-2 py-0.5 rounded-full transition-colors"
                                >
                                  Написать
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => selectedChatId && loadInsights(selectedChatId)}
                    className="text-xs text-accent hover:underline flex items-center gap-1"
                  >
                    <Lightbulb size={12} /> Получить рекомендации психолога
                  </button>
                )}
              </section>

              {/* Desires & Interests Section */}
              <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <Flame size={16} className="text-orange-400" />
                  Интересы и желания
                </h3>

                {desiresLoading ? (
                  <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                    <Loader2 size={12} className="animate-spin" /> Загружаю...
                  </div>
                ) : desires ? (
                  <div className="space-y-2">
                    {desires.desires.length > 0 ? desires.desires.map((d: any, i: number) => {
                      const icon = d.category === 'preference' ? '❤️' : d.category === 'plan' ? '🗓' : d.category === 'life_event' ? '💫' : '💼'
                      return (
                        <div key={i} className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                          {icon} {d.text}
                        </div>
                      )
                    }) : (
                      <div className="text-xs text-text-secondary">Пока нет данных об интересах</div>
                    )}
                    {desires.dates.length > 0 && desires.dates.map((d: any, i: number) => (
                      <div key={`date-${i}`} className="text-sm text-text-primary bg-pink-500/10 border border-pink-500/20 rounded-lg px-3 py-2">
                        🎂 {d.label}
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => selectedChatId && loadDesires(selectedChatId)}
                    className="text-xs text-accent hover:underline"
                  >
                    Загрузить интересы
                  </button>
                )}
              </section>

              {/* Network Section */}
              <NetworkSection chatId={detail.chatId} contactName={detail.name} />

              {/* Gift Ideas */}
              <GiftIdeas chatId={detail.chatId} contactName={detail.name} />

              {/* Strategy Section */}
              <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Target size={16} className="text-accent" />
                    Стратегия
                  </h3>
                  <button
                    onClick={() => setShowNewGoal(!showNewGoal)}
                    className="text-accent hover:text-accent-hover transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                {/* New goal form */}
                {showNewGoal && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newGoalText}
                      onChange={e => setNewGoalText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateGoal()}
                      placeholder="Новая цель..."
                      className="flex-1 text-sm bg-bg-input rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none"
                    />
                    <button onClick={handleCreateGoal} className="p-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors">
                      <CheckCircle size={14} />
                    </button>
                  </div>
                )}

                {/* Goals list */}
                {detail.goals.length > 0 ? (
                  <div className="space-y-2">
                    {detail.goals.map((goal: any) => (
                      <div key={goal.id} className="bg-bg-hover rounded-lg px-3 py-2.5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm text-text-primary flex-1">{goal.goal}</span>
                          <button
                            onClick={async () => { await api.deleteGoal(goal.id); selectedChatId && loadDetail(selectedChatId) }}
                            className="text-text-secondary hover:text-danger transition-colors flex-shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-bg-input rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${goal.progress || 0}%` }} />
                          </div>
                          <span className="text-[10px] text-text-secondary">{goal.progress || 0}%</span>
                        </div>
                        {goal.strategy && <div className="text-[11px] text-text-secondary">Стратегия: {goal.strategy}</div>}
                        <div className="flex gap-1.5">
                          {goal.status === 'active' && (
                            <button
                              onClick={async () => { await api.updateGoal(goal.id, { status: 'in_progress' }); selectedChatId && loadDetail(selectedChatId) }}
                              className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full hover:bg-accent/20 transition-colors flex items-center gap-1"
                            >
                              <Play size={8} /> Запустить
                            </button>
                          )}
                          {goal.status === 'in_progress' && (
                            <button
                              onClick={async () => { await api.updateGoal(goal.id, { status: 'paused' }); selectedChatId && loadDetail(selectedChatId) }}
                              className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors flex items-center gap-1"
                            >
                              <Pause size={8} /> Пауза
                            </button>
                          )}
                          <button
                            onClick={async () => { await api.updateGoal(goal.id, { status: 'completed' }); selectedChatId && loadDetail(selectedChatId) }}
                            className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full hover:bg-green-500/20 transition-colors flex items-center gap-1"
                          >
                            <CheckCircle size={8} /> Готово
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-secondary">Нет активных целей</div>
                )}

                {/* Autopilot */}
                <div className="flex items-center gap-3 bg-bg-hover rounded-lg px-3 py-2.5">
                  <Bot size={16} className={detail.agentConfig ? 'text-accent' : 'text-text-secondary'} />
                  <div className="flex-1">
                    <div className="text-sm text-text-primary">
                      Автопилот: {detail.agentConfig ? 'Включен' : 'Выключен'}
                    </div>
                    {detail.agentConfig && (
                      <div className="text-[11px] text-text-secondary">
                        Режим: {detail.agentConfig.triggerMode === 'auto' ? 'Авто-ответ' : detail.agentConfig.triggerMode === 'mention' ? 'По упоминанию' : 'По команде'}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Communication Style Section */}
              <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <MessageSquare size={16} className="text-blue-400" />
                  Как общаться
                </h3>
                {detail.style ? (
                  <div className="space-y-2">
                    <div className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                      {typeof detail.style === 'string' ? detail.style : (detail.style as any)?.tone || 'Стиль не определен'}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-text-secondary">Стиль общения пока не определен</div>
                )}
              </section>

              {/* Memory Section */}
              {detail.memories.length > 0 && (
                <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Bookmark size={16} className="text-amber-400" />
                    Память
                  </h3>
                  <div className="space-y-1.5">
                    {detail.memories.map((m, i) => {
                      const catIcon: Record<string, string> = {
                        plan: '🏖', life_event: '💫', date: '🎂', health: '💊', work: '💼', preference: '❤️', person: '👤',
                      }
                      return (
                        <div key={i} className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                          {catIcon[m.category] || '📌'} {m.fact}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Proactive Actions History */}
              {detail.proactiveActions.length > 0 && (
                <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
                  <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Sparkles size={16} className="text-purple-400" />
                    История подсказок
                  </h3>
                  <div className="space-y-1.5">
                    {detail.proactiveActions.map((a: any) => (
                      <div key={a.id} className="text-xs bg-bg-hover rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                          a.status === 'acted' ? 'bg-green-500/15 text-green-400' :
                          a.status === 'dismissed' ? 'bg-bg-input text-text-secondary' :
                          'bg-accent/15 text-accent'
                        }`}>
                          {a.status === 'acted' ? 'Выполнено' : a.status === 'dismissed' ? 'Пропущено' : 'Ожидает'}
                        </span>
                        <span className="text-text-primary">{a.title}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // ── Grid View ──
  return (
    <div className="h-screen bg-bg-primary flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary">
          <ArrowLeft size={22} />
        </button>
        <Heart size={20} className="text-pink-400" />
        <h1 className="font-semibold text-text-primary text-lg">Мои отношения</h1>
        <div className="flex-1" />
        <button
          onClick={() => useNetworkStore.getState().setSheetOpen(true)}
          className="p-1.5 rounded-full hover:bg-bg-hover text-accent relative"
          title="Моя сеть"
        >
          <Globe size={18} />
        </button>
        <button onClick={loadContacts} className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск контакта..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-secondary rounded-xl text-sm text-text-primary placeholder:text-text-secondary focus:outline-none border border-border"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-20">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="text-accent animate-spin" />
            <span className="ml-3 text-text-secondary">Загружаю контакты...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Heart size={48} className="mx-auto text-text-secondary/30 mb-3" />
            <p className="text-text-secondary">
              {search ? 'Никого не найдено' : 'Нет данных о контактах. Начните общаться!'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 py-2">
            {filtered.map(contact => (
              <button
                key={contact.chatId}
                onClick={() => loadDetail(contact.chatId)}
                className="bg-bg-secondary rounded-xl p-4 border border-border hover:border-accent/30 transition-all text-left space-y-2.5 group"
              >
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-lg group-hover:bg-accent/30 transition-colors">
                    {contact.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text-primary text-sm truncate">{contact.name}</div>
                    {contact.relationshipType && contact.relationshipType !== 'other' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${REL_COLORS[contact.relationshipType] || ''}`}>
                        {REL_LABELS[contact.relationshipType] || contact.relationshipType}
                      </span>
                    )}
                  </div>
                  {contact.mood && (
                    <span className="text-lg">{MOOD_EMOJI[contact.mood.mood] || '😐'}</span>
                  )}
                </div>

                {/* Info chips */}
                <div className="flex flex-wrap gap-1.5">
                  {contact.activeGoals > 0 && (
                    <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Target size={8} /> {contact.activeGoals} {contact.activeGoals === 1 ? 'цель' : 'целей'}
                    </span>
                  )}
                  {contact.hasAgent && (
                    <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Bot size={8} /> Автопилот
                    </span>
                  )}
                </div>

                {/* Top desire */}
                {contact.topDesire && (
                  <div className="text-xs text-text-secondary truncate">
                    💡 {contact.topDesire}
                  </div>
                )}

                {/* Mood note */}
                {contact.mood?.note && (
                  <div className="text-xs text-text-secondary truncate">
                    {contact.mood.note}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <NetworkSheet />
    </div>
  )
}
