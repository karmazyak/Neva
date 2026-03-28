import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, MessageSquare, Target, ListChecks, Smile, RefreshCw, Sparkles, User, TrendingUp, TrendingDown, Minus, Clock, Brain, Theater, GitBranch, Eye, ShieldCheck, Lightbulb, AlertTriangle, PartyPopper, Bookmark, Rocket, Heart, Bot, Play, Pause, Plus, Trash2, Gift, Calendar, Flame, CheckCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useChatStore } from '../../stores/chatStore'
import { trackAIAction } from '../AIValueTracker'

interface ContextPanelProps {
  chatId: string
  onClose: () => void
  onInsertDraft?: (text: string) => void
}

interface ChatAnalysis {
  topics: string[]
  decisions: string[]
  actions: string[]
  mood: string
  nextAction?: { text: string; draftMessage?: string; priority: string } | null
  risk?: string | null
  celebration?: string | null
}

interface PersonProfile {
  name: string
  username?: string
  relationshipType?: string
  communicationStyle: string
  avgResponseTime: string
  activeHours: string
  sharedTopics: string[]
  unresolvedItems: string[]
  moodTrend: string
  moodNote: string
  totalMessages: number
  aiAssistedMessages?: number
  usesAiFrequently?: boolean
  personalMemory?: Array<{ text: string; when: string; category: string }>
}

interface RelationshipInsights {
  situation: string | null
  recommendations: Array<{ text: string; draftMessage?: string; type: string }>
}

interface ContactDesires {
  desires: Array<{ text: string; category: string; confidence: number }>
  dates: Array<{ label: string; category: string }>
}

type Tab = 'chat' | 'person' | 'strategy'

export default function ContextPanel({ chatId, onClose, onInsertDraft }: ContextPanelProps) {
  const navigate = useNavigate()
  const { chats, messages } = useChatStore()
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  // Chat tab state
  const [analysis, setAnalysis] = useState<ChatAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerLoading, setAnswerLoading] = useState(false)
  const [queryHistory, setQueryHistory] = useState<{ q: string; a: string }[]>([])

  // Simulation mode (v2: persona-based with branching + confidence)
  const [simMode, setSimMode] = useState(false)
  const [simHistory, setSimHistory] = useState<{
    role: string
    content: string
    confidence?: number
    branches?: Array<{ response: string; probability: number; label: string }>
    innerMonologue?: string
  }[]>([])
  const [simLoading, setSimLoading] = useState(false)
  const [simPersonName, setSimPersonName] = useState('')
  const [simBranching, setSimBranching] = useState(false)
  const [simHasPersona, setSimHasPersona] = useState(false)
  const [expandedBranch, setExpandedBranch] = useState<number | null>(null)

  // Person tab state
  const [person, setPerson] = useState<PersonProfile | null>(null)
  const [personLoading, setPersonLoading] = useState(false)

  // Person tab — psychologist & desires
  const [insights, setInsights] = useState<RelationshipInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [desires, setDesires] = useState<ContactDesires | null>(null)
  const [desiresLoading, setDesiresLoading] = useState(false)

  // Strategy tab state
  const [goals, setGoals] = useState<any[]>([])
  const [goalsLoading, setGoalsLoading] = useState(false)
  const [agentConfig, setAgentConfig] = useState<{ agentId: string; triggerMode: string } | null>(null)
  const [proactiveActions, setProactiveActions] = useState<any[]>([])
  const [newGoalText, setNewGoalText] = useState('')
  const [showNewGoal, setShowNewGoal] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  const chat = chats.find(c => c.id === chatId)
  const chatMessages = messages[chatId] || []

  // Auto-analyze on mount and when chat changes
  useEffect(() => {
    setAnalysis(null)
    setAnswer(null)
    setQueryHistory([])
    setPerson(null)
    setSimMode(false)
    setSimHistory([])
    // Debounce to avoid rapid-fire LLM calls when switching chats
    const timer = setTimeout(() => {
      if (chatMessages.length > 0) {
        loadAnalysis()
        trackAIAction('contextPanelOpened')
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [chatId])

  const loadAnalysis = async (forceRefresh = false) => {
    setLoading(true)
    try {
      const res = await api.getChatContext({ chatId, forceRefresh })
      if (res.result && res.type === 'analysis') {
        setAnalysis(res.result as ChatAnalysis)
      }
    } catch (err) {
      console.error('Context analysis failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadPerson = async () => {
    if (person) return // already loaded
    setPersonLoading(true)
    try {
      const res = await api.getPersonContext(chatId)
      if (res.person) {
        setPerson(res.person)
      }
    } catch (err) {
      console.error('Person context failed:', err)
    } finally {
      setPersonLoading(false)
    }
  }

  const loadInsights = async (force = false) => {
    if (insights && !force) return // use cached
    setInsightsLoading(true)
    try {
      const res = await api.getRelationshipInsights(chatId)
      setInsights(res)
    } catch {} finally { setInsightsLoading(false) }
  }

  const loadDesires = async (force = false) => {
    if (desires && !force) return // use cached
    setDesiresLoading(true)
    try {
      const res = await api.getContactDesires(chatId)
      setDesires(res)
    } catch {} finally { setDesiresLoading(false) }
  }

  const loadStrategy = async () => {
    setGoalsLoading(true)
    try {
      const [goalsRes, configRes, actionsRes] = await Promise.all([
        api.getGoalsForChat(chatId),
        api.getAgentConfig(chatId).catch(() => null),
        api.getProactiveActions().catch(() => ({ actions: [] })),
      ])
      setGoals(goalsRes.goals || [])
      setAgentConfig((configRes as any)?.triggerMode ? { agentId: (configRes as any).agentId, triggerMode: (configRes as any).triggerMode } : null)
      setProactiveActions((actionsRes.actions || []).filter((a: any) => a.chatId === chatId).slice(0, 5))
    } catch {} finally { setGoalsLoading(false) }
  }

  const handleCreateGoal = async () => {
    if (!newGoalText.trim()) return
    try {
      await api.createGoal({ goal: newGoalText.trim(), chatId, mode: 'strategic' })
      setNewGoalText('')
      setShowNewGoal(false)
      loadStrategy()
    } catch {}
  }

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    if (tab === 'person' && !person) {
      loadPerson()
    }
    if (tab === 'person' && !insights) {
      loadInsights()
      loadDesires()
    }
    if (tab === 'strategy') {
      loadStrategy()
    }
  }

  const handleAsk = async () => {
    if (!query.trim() || answerLoading) return

    // Simulation mode (v2: persona-based)
    if (simMode) {
      const msg = query.trim()
      setQuery('')
      setSimHistory(prev => [...prev, { role: 'user', content: msg }])
      setSimLoading(true)

      try {
        const plainHistory = simHistory.map(h => ({ role: h.role, content: h.content }))
        const res = await api.simulateChat(chatId, msg, plainHistory, simBranching)
        setSimPersonName(res.personName)
        if (res.hasPersona !== undefined) setSimHasPersona(res.hasPersona)
        setSimHistory(prev => [...prev, {
          role: 'contact',
          content: res.response,
          confidence: res.confidence,
          branches: res.branches,
          innerMonologue: res.innerMonologue,
        }])
      } catch {
        setSimHistory(prev => [...prev, { role: 'contact', content: 'Simulation error. Try again.' }])
      } finally {
        setSimLoading(false)
        setExpandedBranch(null)
      }
      return
    }

    // Normal Q&A mode
    const q = query.trim()
    setQuery('')
    setAnswerLoading(true)
    setAnswer(null)

    try {
      const res = await api.getChatContext({ chatId, query: q })
      if (res.result && res.type === 'answer') {
        const a = res.result as string
        setAnswer(a)
        setQueryHistory(prev => [...prev, { q, a }])
      }
    } catch (err) {
      setAnswer('Failed to get answer. Please try again.')
    } finally {
      setAnswerLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  const toggleSimMode = () => {
    if (!simMode) trackAIAction('simulationsRun')
    setSimMode(!simMode)
    setSimHistory([])
    setQuery('')
    setSimHasPersona(false)
    setExpandedBranch(null)
  }

  const moodEmoji: Record<string, string> = {
    positive: '😊', negative: '😟', neutral: '😐', excited: '🤩',
    formal: '👔', casual: '😎', urgent: '⚡', friendly: '🤗',
    tense: '😬', productive: '💪',
  }

  const trendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return <TrendingUp size={14} className="text-green-400" />
      case 'declining': return <TrendingDown size={14} className="text-red-400" />
      default: return <Minus size={14} className="text-text-secondary" />
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [queryHistory.length, answer, simHistory.length])

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <h3 className="font-semibold text-text-primary text-sm">Context AI</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-bg-hover text-text-secondary transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => handleTabChange('chat')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'chat'
              ? 'text-accent border-b-2 border-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Brain size={14} />
          Chat
        </button>
        <button
          onClick={() => handleTabChange('person')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'person'
              ? 'text-accent border-b-2 border-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <User size={14} />
          Person
        </button>
        <button
          onClick={() => handleTabChange('strategy')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'strategy'
              ? 'text-accent border-b-2 border-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Target size={14} />
          Strategy
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {activeTab === 'chat' && (
          <>
            {/* Chat info header */}
            <div className="text-xs text-text-secondary">
              Analyzing: <span className="text-text-primary font-medium">{chat?.name || 'Chat'}</span>
              <span className="text-text-secondary"> · {chatMessages.length} messages</span>
            </div>

            {/* Analysis section */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="text-accent animate-spin" />
                <span className="ml-2 text-sm text-text-secondary">Analyzing conversation...</span>
              </div>
            ) : analysis ? (
              <>
                {/* Topics */}
                {analysis.topics.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <MessageSquare size={12} />
                      Topics
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.topics.map((topic, i) => (
                        <span key={i} className="px-2.5 py-1 bg-accent/10 text-accent text-xs rounded-full font-medium">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mood */}
                {analysis.mood && (
                  <div className="flex items-center gap-2">
                    <Smile size={12} className="text-text-secondary" />
                    <span className="text-xs text-text-secondary">Mood:</span>
                    <span className="text-xs text-text-primary">
                      {moodEmoji[analysis.mood.toLowerCase()] || '💬'} {analysis.mood}
                    </span>
                  </div>
                )}

                {/* Decisions */}
                {analysis.decisions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <Target size={12} />
                      Decisions
                    </div>
                    <div className="space-y-1">
                      {analysis.decisions.map((dec, i) => (
                        <div key={i} className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                          {dec}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Items */}
                {analysis.actions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <ListChecks size={12} />
                      Action Items
                    </div>
                    <div className="space-y-1">
                      {analysis.actions.map((action, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                          <span className="text-accent mt-0.5">•</span>
                          <span>{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Celebration */}
                {analysis.celebration && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      🎉 Celebration
                    </div>
                    <div className="text-sm text-text-primary bg-green-500/5 border border-green-500/20 rounded-lg px-3 py-2">
                      {analysis.celebration} 🎊
                    </div>
                  </div>
                )}

                {/* Next Action */}
                {analysis.nextAction && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <Lightbulb size={12} />
                      Next Action
                    </div>
                    <div className="bg-accent/10 border border-accent/20 rounded-lg px-3 py-2 space-y-1.5">
                      <p className="text-sm text-text-primary">{analysis.nextAction.text}</p>
                      {analysis.nextAction.draftMessage && onInsertDraft && (
                        <button
                          onClick={() => onInsertDraft(analysis.nextAction!.draftMessage!)}
                          className="flex items-center gap-1 text-[11px] text-accent bg-accent/10 hover:bg-accent/20 px-2 py-1 rounded-full transition-colors"
                        >
                          <Sparkles size={10} />
                          Use draft ✨
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Risk */}
                {analysis.risk && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <AlertTriangle size={12} />
                      Risk
                    </div>
                    <div className="text-sm text-text-primary bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      {analysis.risk}
                    </div>
                  </div>
                )}

                {/* Proactive Feature Suggestions */}
                {(() => {
                  const suggestions: { icon: React.ElementType; text: string; color: string; onClick: () => void }[] = []

                  // If there are action items or decisions — suggest Mission
                  if ((analysis.actions.length > 0 || analysis.decisions.length > 0) && analysis.nextAction) {
                    suggestions.push({
                      icon: Rocket,
                      text: 'Запусти миссию — AI спланирует стратегию для этой задачи',
                      color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
                      onClick: () => window.location.href = '/ai',
                    })
                  }

                  // If mood is negative — suggest empathetic response
                  if (['negative', 'tense', 'urgent', '😟', '😬', '⚡'].some(m => analysis.mood?.toLowerCase().includes(m))) {
                    suggestions.push({
                      icon: Heart,
                      text: 'Собеседник кажется напряжённым — попробуй Tone Advisor при ответе',
                      color: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
                      onClick: () => {},
                    })
                  }

                  // Suggest simulation if not yet tried
                  if (!localStorage.getItem('neva_feature_tips_seen')?.includes('simulation')) {
                    suggestions.push({
                      icon: Theater,
                      text: 'Попробуй симуляцию — узнай, как собеседник отреагирует на твоё сообщение',
                      color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
                      onClick: toggleSimMode,
                    })
                  }

                  if (suggestions.length === 0) return null

                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                        <Lightbulb size={12} />
                        Suggestions
                      </div>
                      {suggestions.slice(0, 2).map((s, i) => (
                        <button
                          key={i}
                          onClick={s.onClick}
                          className={`w-full flex items-start gap-2 text-left text-xs border rounded-lg px-3 py-2 hover:opacity-80 transition-opacity ${s.color}`}
                        >
                          <s.icon size={14} className="mt-0.5 flex-shrink-0" />
                          <span>{s.text}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}

                {/* Refresh button */}
                <button
                  onClick={() => loadAnalysis(true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors"
                >
                  <RefreshCw size={12} />
                  Refresh analysis
                </button>
              </>
            ) : chatMessages.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-text-secondary">No messages to analyze yet.</p>
                <p className="text-xs text-text-secondary mt-1">Start chatting and the AI will analyze context automatically.</p>
              </div>
            ) : (
              <button
                onClick={loadAnalysis}
                className="w-full py-3 bg-accent/10 text-accent text-sm rounded-xl hover:bg-accent/15 transition-colors"
              >
                Analyze conversation
              </button>
            )}

            {/* Divider */}
            {(analysis || queryHistory.length > 0 || simMode) && (
              <div className="border-t border-border pt-3">
                <div className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                  {simMode ? 'Simulation Mode' : 'Ask about this chat'}
                </div>
              </div>
            )}

            {/* Simulation Mode Content (v2: persona + branching + confidence) */}
            {simMode && (
              <>
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2 text-xs text-purple-300">
                  <Theater size={12} className="inline mr-1" />
                  Simulating how <strong>{simPersonName || 'contact'}</strong> would respond.
                  {simHasPersona && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] bg-purple-500/20 px-1.5 py-0.5 rounded-full">
                      <Brain size={8} /> Persona active
                    </span>
                  )}
                </div>

                {/* Branching toggle */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSimBranching(!simBranching)}
                    className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full transition-colors ${
                      simBranching
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : 'bg-bg-input text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    <GitBranch size={10} />
                    {simBranching ? 'Branches ON' : 'Branches'}
                  </button>
                </div>

                {simHistory.map((item, i) => (
                  <div key={i} className="space-y-1">
                    <div className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`text-sm rounded-2xl px-3 py-2 max-w-[85%] ${
                        item.role === 'user'
                          ? 'bg-bg-bubble-own rounded-br-sm text-text-primary'
                          : 'bg-purple-500/10 border border-purple-500/20 rounded-bl-sm text-text-primary'
                      }`}>
                        {item.role === 'contact' && (
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-[10px] text-purple-400">
                              <Theater size={10} className="inline mr-0.5" />
                              {simPersonName} (simulated)
                            </span>
                            {item.confidence !== undefined && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                item.confidence >= 70 ? 'bg-green-500/20 text-green-400'
                                  : item.confidence >= 40 ? 'bg-yellow-500/20 text-yellow-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}>
                                {item.confidence}%
                              </span>
                            )}
                          </div>
                        )}
                        {item.content}
                      </div>
                    </div>

                    {/* Inner monologue (thinking) */}
                    {item.innerMonologue && (
                      <div className="flex justify-start">
                        <div className="text-[10px] text-text-secondary/60 italic flex items-center gap-1 px-3">
                          <Eye size={9} />
                          {item.innerMonologue}
                        </div>
                      </div>
                    )}

                    {/* Branching responses */}
                    {item.branches && item.branches.length > 0 && (
                      <div className="flex justify-start pl-3">
                        <div className="space-y-1 w-full max-w-[85%]">
                          <div className="text-[10px] text-purple-400/70 flex items-center gap-1">
                            <GitBranch size={9} />
                            Alternative responses:
                          </div>
                          {item.branches.map((branch, bi) => (
                            <button
                              key={bi}
                              onClick={() => setExpandedBranch(expandedBranch === i * 10 + bi ? null : i * 10 + bi)}
                              className="w-full text-left text-[11px] bg-purple-500/5 border border-purple-500/10 rounded-lg px-2 py-1.5 hover:bg-purple-500/10 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-purple-400/80">{branch.label}</span>
                                <span className="text-[9px] text-text-secondary">{branch.probability}%</span>
                              </div>
                              {expandedBranch === i * 10 + bi && (
                                <div className="mt-1 text-text-primary text-xs">{branch.response}</div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {simLoading && (
                  <div className="flex justify-start">
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl rounded-bl-sm px-3 py-2">
                      <div className="typing-indicator flex gap-1">
                        <span className="w-2 h-2 bg-purple-400 rounded-full" />
                        <span className="w-2 h-2 bg-purple-400 rounded-full" />
                        <span className="w-2 h-2 bg-purple-400 rounded-full" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Normal Q&A history */}
            {!simMode && queryHistory.map((item, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-end">
                  <div className="bg-bg-bubble-own text-text-primary text-sm rounded-2xl rounded-br-sm px-3 py-2 max-w-[85%]">
                    {item.q}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-bg-bubble-other text-text-primary text-sm rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%]">
                    {item.a}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading answer */}
            {answerLoading && !simMode && (
              <div className="flex justify-start">
                <div className="bg-bg-bubble-other rounded-2xl rounded-bl-sm px-3 py-2">
                  <div className="typing-indicator flex gap-1">
                    <span className="w-2 h-2 bg-text-secondary rounded-full" />
                    <span className="w-2 h-2 bg-text-secondary rounded-full" />
                    <span className="w-2 h-2 bg-text-secondary rounded-full" />
                  </div>
                </div>
              </div>
            )}

            {/* Current answer */}
            {answer && !answerLoading && !simMode && queryHistory.length === 0 && (
              <div className="flex justify-start">
                <div className="bg-bg-bubble-other text-text-primary text-sm rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%]">
                  {answer}
                </div>
              </div>
            )}
          </>
        )}
        {activeTab === 'person' && (
          /* Person Tab */
          <>
            {personLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="text-accent animate-spin" />
                <span className="ml-2 text-sm text-text-secondary">Analyzing relationship...</span>
              </div>
            ) : person ? (
              <>
                {/* Person header */}
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-lg">
                    {person.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <h4 className="font-semibold text-text-primary text-sm">{person.name}</h4>
                    <div className="flex items-center gap-2">
                      {person.username && (
                        <span className="text-xs text-text-secondary">@{person.username}</span>
                      )}
                      {person.relationshipType && person.relationshipType !== 'other' && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          person.relationshipType === 'family' ? 'bg-pink-500/15 text-pink-400' :
                          person.relationshipType === 'friend' ? 'bg-green-500/15 text-green-400' :
                          person.relationshipType === 'work' ? 'bg-blue-500/15 text-blue-400' :
                          person.relationshipType === 'client' ? 'bg-amber-500/15 text-amber-400' :
                          'bg-bg-hover text-text-secondary'
                        }`}>
                          {person.relationshipType === 'family' ? '👨‍👩‍👧 Family' :
                           person.relationshipType === 'friend' ? '🤝 Friend' :
                           person.relationshipType === 'work' ? '💼 Work' :
                           person.relationshipType === 'client' ? '🤝 Client' :
                           person.relationshipType === 'acquaintance' ? '👋 Acquaintance' :
                           person.relationshipType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Communication Style */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    <MessageSquare size={12} />
                    Communication
                  </div>
                  <div className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                    {person.communicationStyle}
                  </div>
                  <div className="flex gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <Clock size={12} />
                      Response: <span className="text-text-primary">{person.avgResponseTime}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                      Active: <span className="text-text-primary">{person.activeHours}</span>
                    </div>
                  </div>
                </div>

                {/* Shared Topics */}
                {person.sharedTopics.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <Target size={12} />
                      Shared Topics
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {person.sharedTopics.map((topic, i) => (
                        <span key={i} className="px-2.5 py-1 bg-accent/10 text-accent text-xs rounded-full font-medium">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Personal Memory */}
                {person.personalMemory && person.personalMemory.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <Bookmark size={12} />
                      Memory
                    </div>
                    <div className="space-y-1">
                      {person.personalMemory.map((item, i) => {
                        const catIcon: Record<string, string> = { plans: '🏖', life: '💫', dates: '🎂', health: '💊', work: '💼' }
                        return (
                          <div key={i} className="bg-bg-hover rounded-lg px-3 py-2">
                            <div className="text-sm text-text-primary">
                              {catIcon[item.category] || '📌'} {item.text}
                            </div>
                            <div className="text-[11px] text-text-secondary mt-0.5">
                              {item.when}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Unresolved Items */}
                {person.unresolvedItems.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <ListChecks size={12} />
                      Unresolved
                    </div>
                    <div className="space-y-1">
                      {person.unresolvedItems.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-text-primary bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                          <span className="text-amber-400 mt-0.5">!</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mood Trend */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    <Smile size={12} />
                    Mood Trend
                  </div>
                  <div className="flex items-center gap-2 text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                    {trendIcon(person.moodTrend)}
                    <span>{person.moodNote}</span>
                  </div>
                </div>

                {/* Psychologist Block */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    <Brain size={12} />
                    Психолог
                  </div>
                  {insightsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                      <Loader2 size={12} className="animate-spin" /> Анализирую...
                    </div>
                  ) : insights?.situation ? (
                    <div className="space-y-2">
                      <div className="text-sm text-text-primary bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                        <Lightbulb size={12} className="inline mr-1 text-purple-400" />
                        {insights.situation}
                      </div>
                      {insights.recommendations.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[11px] text-text-secondary font-medium">Что можно сделать:</div>
                          {insights.recommendations.map((rec, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm bg-bg-hover rounded-lg px-3 py-2">
                              <span className="mt-0.5 flex-shrink-0">
                                {rec.type === 'support' ? '💛' : rec.type === 'activity' ? '🎯' : rec.type === 'gift' ? '🎁' : '📱'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="text-text-primary">{rec.text}</span>
                                {rec.draftMessage && onInsertDraft && (
                                  <button
                                    onClick={() => onInsertDraft(rec.draftMessage!)}
                                    className="ml-2 text-[10px] text-accent bg-accent/10 hover:bg-accent/20 px-2 py-0.5 rounded-full transition-colors"
                                  >
                                    Вставить
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : !insightsLoading && (
                    <button onClick={loadInsights} className="text-xs text-accent hover:underline">
                      Получить рекомендации
                    </button>
                  )}
                </div>

                {/* Desires & Interests Map */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    <Flame size={12} />
                    Интересы и желания
                  </div>
                  {desiresLoading ? (
                    <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                      <Loader2 size={12} className="animate-spin" /> Загружаю...
                    </div>
                  ) : desires ? (
                    <div className="space-y-2">
                      {desires.desires.length > 0 && (
                        <div className="space-y-1">
                          {desires.desires.map((d, i) => {
                            const icon = d.category === 'preference' ? '❤️' : d.category === 'plan' ? '🗓' : d.category === 'life_event' ? '💫' : '💼'
                            return (
                              <div key={i} className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2">
                                {icon} {d.text}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {desires.dates.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[11px] text-text-secondary font-medium flex items-center gap-1">
                            <Calendar size={10} /> Важные даты
                          </div>
                          {desires.dates.map((d, i) => (
                            <div key={i} className="text-sm text-text-primary bg-pink-500/10 border border-pink-500/20 rounded-lg px-3 py-2">
                              🎂 {d.label}
                            </div>
                          ))}
                        </div>
                      )}
                      {desires.desires.length === 0 && desires.dates.length === 0 && (
                        <div className="text-xs text-text-secondary">Пока нет данных. Общайтесь больше — AI запомнит интересы.</div>
                      )}
                    </div>
                  ) : !desiresLoading && (
                    <button onClick={loadDesires} className="text-xs text-accent hover:underline">
                      Загрузить интересы
                    </button>
                  )}
                </div>

                {/* Quick link to Relationships page */}
                <button
                  onClick={() => navigate('/relationships')}
                  className="w-full flex items-center justify-center gap-2 text-xs text-accent bg-accent/10 hover:bg-accent/15 py-2.5 rounded-lg transition-colors"
                >
                  <Heart size={12} />
                  Подробнее на странице отношений
                </button>

                {/* Stats */}
                <div className="text-xs text-text-secondary space-y-1">
                  <div>Based on {person.totalMessages} human messages analyzed</div>
                  {(person.aiAssistedMessages ?? 0) > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={10} className="text-purple-400" />
                      <span>
                        {person.aiAssistedMessages} AI-assisted messages
                        {person.usesAiFrequently && (
                          <span className="text-purple-400 ml-1">(uses AI often)</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* Refresh */}
                <button
                  onClick={() => { setPerson(null); loadPerson() }}
                  className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors"
                >
                  <RefreshCw size={12} />
                  Refresh profile
                </button>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-text-secondary">No data available yet.</p>
                <button
                  onClick={loadPerson}
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  Analyze relationship
                </button>
              </div>
            )}
          </>
        )}
        {activeTab === 'strategy' && (
          /* Strategy Tab */
          <>
            {goalsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="text-accent animate-spin" />
                <span className="ml-2 text-sm text-text-secondary">Загружаю стратегию...</span>
              </div>
            ) : (
              <>
                {/* Active Goals */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <Target size={12} />
                      Активные цели
                    </div>
                    <button
                      onClick={() => setShowNewGoal(!showNewGoal)}
                      className="text-accent hover:text-accent-hover transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

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

                  {goals.length > 0 ? (
                    <div className="space-y-1.5">
                      {goals.map((goal: any) => (
                        <div key={goal.id} className="bg-bg-hover rounded-lg px-3 py-2 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm text-text-primary flex-1">{goal.goal}</span>
                            <button
                              onClick={async () => { await api.deleteGoal(goal.id); loadStrategy() }}
                              className="text-text-secondary hover:text-danger transition-colors flex-shrink-0"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {/* Progress bar */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-bg-input rounded-full overflow-hidden">
                              <div
                                className="h-full bg-accent rounded-full transition-all"
                                style={{ width: `${goal.progress || 0}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-text-secondary">{goal.progress || 0}%</span>
                          </div>
                          {goal.strategy && (
                            <div className="text-[11px] text-text-secondary">Стратегия: {goal.strategy}</div>
                          )}
                          <div className="flex gap-1.5">
                            {goal.status === 'active' && (
                              <button
                                onClick={async () => { await api.updateGoal(goal.id, { status: 'in_progress' }); loadStrategy() }}
                                className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full hover:bg-accent/20 transition-colors flex items-center gap-1"
                              >
                                <Play size={8} /> Запустить
                              </button>
                            )}
                            {goal.status === 'in_progress' && (
                              <button
                                onClick={async () => { await api.updateGoal(goal.id, { status: 'paused' }); loadStrategy() }}
                                className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors flex items-center gap-1"
                              >
                                <Pause size={8} /> Пауза
                              </button>
                            )}
                            <button
                              onClick={async () => { await api.updateGoal(goal.id, { status: 'completed' }); loadStrategy() }}
                              className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full hover:bg-green-500/20 transition-colors flex items-center gap-1"
                            >
                              <CheckCircle size={8} /> Готово
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-text-secondary py-2">Нет активных целей для этого чата</div>
                  )}
                </div>

                {/* Autopilot Toggle */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    <Bot size={12} />
                    Автопилот
                  </div>
                  <div className="flex items-center gap-3 bg-bg-hover rounded-lg px-3 py-2.5">
                    <div className="flex-1">
                      <div className="text-sm text-text-primary">
                        {agentConfig ? 'Включен' : 'Выключен'}
                      </div>
                      {agentConfig && (
                        <div className="text-[11px] text-text-secondary">
                          Режим: {agentConfig.triggerMode === 'auto' ? 'Авто-ответ' : agentConfig.triggerMode === 'mention' ? 'По упоминанию' : 'По команде'}
                        </div>
                      )}
                    </div>
                    <div className={`w-8 h-4.5 rounded-full transition-colors cursor-pointer flex items-center ${
                      agentConfig ? 'bg-accent justify-end' : 'bg-bg-input justify-start'
                    }`}>
                      <div className="w-3.5 h-3.5 bg-white rounded-full mx-0.5 shadow-sm" />
                    </div>
                  </div>
                </div>

                {/* Recent Proactive Actions */}
                {proactiveActions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      <Sparkles size={12} />
                      Последние подсказки
                    </div>
                    <div className="space-y-1">
                      {proactiveActions.map((action: any) => {
                        const triggerIcon = action.trigger === 'silence' ? '💛' : action.trigger === 'mood_change' ? '💜' : action.trigger === 'goal_progress' ? '🎯' : '💬'
                        return (
                          <div key={action.id} className="text-xs bg-bg-hover rounded-lg px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span>{triggerIcon}</span>
                              <span className="text-text-primary font-medium">{action.title}</span>
                              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                                action.status === 'acted' ? 'bg-green-500/15 text-green-400' :
                                action.status === 'dismissed' ? 'bg-bg-input text-text-secondary' :
                                'bg-accent/15 text-accent'
                              }`}>
                                {action.status === 'acted' ? 'Выполнено' : action.status === 'dismissed' ? 'Пропущено' : 'Ожидает'}
                              </span>
                            </div>
                            {action.body && <div className="text-text-secondary mt-0.5">{action.body}</div>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Launch Mission button */}
                <button
                  onClick={() => navigate('/ai-chat')}
                  className="w-full flex items-center justify-center gap-2 text-xs text-purple-400 bg-purple-500/10 hover:bg-purple-500/15 py-2.5 rounded-lg transition-colors border border-purple-500/20"
                >
                  <Rocket size={12} />
                  Запустить миссию
                </button>

                {/* Link to Relationships page */}
                <button
                  onClick={() => navigate('/relationships')}
                  className="w-full flex items-center justify-center gap-2 text-xs text-accent bg-accent/10 hover:bg-accent/15 py-2.5 rounded-lg transition-colors"
                >
                  <Heart size={12} />
                  Управление на странице отношений
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* Query input (Chat tab only) */}
      {activeTab === 'chat' && (
        <div className="px-3 py-3 border-t border-border">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={simMode ? 'Type your message...' : 'Ask about this chat...'}
              className={`flex-1 rounded-full px-4 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none ${
                simMode ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-bg-input'
              }`}
            />
            <button
              onClick={handleAsk}
              disabled={!query.trim() || answerLoading || simLoading}
              className={`p-2 rounded-full text-white transition-colors disabled:opacity-30 ${
                simMode ? 'bg-purple-500 hover:bg-purple-600' : 'bg-accent hover:bg-accent-hover'
              }`}
            >
              <Send size={16} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {!simMode ? (
              <>
                {['What was decided?', 'Key takeaways?', 'What\'s pending?'].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => { setQuery(suggestion); }}
                    className="text-[11px] text-text-secondary bg-bg-input hover:bg-bg-hover px-2 py-1 rounded-full transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
                <button
                  onClick={toggleSimMode}
                  className="text-[11px] text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 px-2 py-1 rounded-full transition-colors flex items-center gap-1"
                >
                  <Theater size={10} />
                  What if I said...
                </button>
              </>
            ) : (
              <button
                onClick={toggleSimMode}
                className="text-[11px] text-text-secondary bg-bg-input hover:bg-bg-hover px-2 py-1 rounded-full transition-colors"
              >
                Exit simulation
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
