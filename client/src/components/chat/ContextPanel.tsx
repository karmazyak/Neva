import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, MessageSquare, Target, ListChecks, Smile, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import { useChatStore } from '../../stores/chatStore'

interface ContextPanelProps {
  chatId: string
  onClose: () => void
}

interface ChatAnalysis {
  topics: string[]
  decisions: string[]
  actions: string[]
  mood: string
}

export default function ContextPanel({ chatId, onClose }: ContextPanelProps) {
  const { chats, messages } = useChatStore()
  const [analysis, setAnalysis] = useState<ChatAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerLoading, setAnswerLoading] = useState(false)
  const [queryHistory, setQueryHistory] = useState<{ q: string; a: string }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const chat = chats.find(c => c.id === chatId)
  const chatMessages = messages[chatId] || []

  // Auto-analyze on mount and when chat changes
  useEffect(() => {
    setAnalysis(null)
    setAnswer(null)
    setQueryHistory([])
    if (chatMessages.length > 0) {
      loadAnalysis()
    }
  }, [chatId])

  const loadAnalysis = async () => {
    setLoading(true)
    try {
      const res = await api.getChatContext({ chatId })
      if (res.result && res.type === 'analysis') {
        setAnalysis(res.result as ChatAnalysis)
      }
    } catch (err) {
      console.error('Context analysis failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAsk = async () => {
    if (!query.trim() || answerLoading) return

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

  const moodEmoji: Record<string, string> = {
    positive: '😊',
    negative: '😟',
    neutral: '😐',
    excited: '🤩',
    formal: '👔',
    casual: '😎',
    urgent: '⚡',
    friendly: '🤗',
    tense: '😬',
    productive: '💪',
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [queryHistory.length, answer])

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

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
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

            {/* Refresh button */}
            <button
              onClick={loadAnalysis}
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
        {(analysis || queryHistory.length > 0) && (
          <div className="border-t border-border pt-3">
            <div className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
              Ask about this chat
            </div>
          </div>
        )}

        {/* Query history */}
        {queryHistory.map((item, i) => (
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
        {answerLoading && (
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
        {answer && !answerLoading && queryHistory.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-bg-bubble-other text-text-primary text-sm rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%]">
              {answer}
            </div>
          </div>
        )}
      </div>

      {/* Query input */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this chat..."
            className="flex-1 bg-bg-input rounded-full px-4 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
          />
          <button
            onClick={handleAsk}
            disabled={!query.trim() || answerLoading}
            className="p-2 bg-accent hover:bg-accent-hover rounded-full text-white transition-colors disabled:opacity-30"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {['What was decided?', 'Key takeaways?', 'What\'s pending?'].map(suggestion => (
            <button
              key={suggestion}
              onClick={() => { setQuery(suggestion); }}
              className="text-[11px] text-text-secondary bg-bg-input hover:bg-bg-hover px-2 py-1 rounded-full transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
