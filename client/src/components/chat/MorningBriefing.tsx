import { useState, useEffect } from 'react'
import { Sparkles, X, ChevronRight, Loader2, AlertTriangle, Clock, MessageSquare, CheckCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { useChatStore } from '../../stores/chatStore'
import { PulseBeacon } from '../GuidedTour'

interface Nudge {
  chatId: string
  chatName: string
  type: string
  text: string
  priority: string
}

export default function MorningBriefing() {
  const [nudges, setNudges] = useState<Nudge[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { setActiveChat } = useChatStore()

  useEffect(() => {
    // Only load once per session
    const lastLoad = sessionStorage.getItem('nudges_loaded')
    if (lastLoad) {
      const data = JSON.parse(lastLoad)
      setNudges(data.nudges || [])
      setSummary(data.summary)
      setLoaded(true)
      return
    }
    loadNudges()
  }, [])

  const loadNudges = async () => {
    setLoading(true)
    try {
      const data = await api.getNudges()
      setNudges(data.nudges || [])
      setSummary(data.summary)
      sessionStorage.setItem('nudges_loaded', JSON.stringify(data))
      setLoaded(true)
    } catch {
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  // Show coaching empty state for new users instead of hiding completely
  if (dismissed) return null

  const isEmptyState = !loading && loaded && nudges.length === 0
  const hasSeenEmptyCoaching = sessionStorage.getItem('nudges_empty_coached')

  if (isEmptyState && hasSeenEmptyCoaching) return null

  const typeIcon = (type: string) => {
    switch (type) {
      case 'unanswered': return <MessageSquare size={12} />
      case 'deadline': return <Clock size={12} />
      case 'decision': return <CheckCircle size={12} />
      case 'followup': return <AlertTriangle size={12} />
      default: return <Sparkles size={12} />
    }
  }

  const priorityColor = (p: string) => {
    switch (p) {
      case 'high': return 'text-red-400'
      case 'medium': return 'text-amber-400'
      default: return 'text-text-secondary'
    }
  }

  return (
    <PulseBeacon step="morning_briefing" className="mx-3 mt-2 mb-1 fade-in">
      <div className={`${isEmptyState ? 'bg-accent/3 border border-accent/10' : 'bg-accent/5 border border-accent/20'} rounded-xl overflow-hidden`}>
        {/* Empty coaching state */}
        {isEmptyState ? (
          <div className="px-3 py-2.5 flex items-center gap-2">
            <Sparkles size={16} className="text-accent/50 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-text-secondary">
                ☕ <strong className="text-text-primary">Утренний брифинг</strong> — AI анализирует чаты и подсказывает, кому стоит написать. Появится, когда накопятся диалоги.
              </span>
            </div>
            <button
              onClick={() => { sessionStorage.setItem('nudges_empty_coached', '1'); setDismissed(true) }}
              className="p-0.5 rounded-full hover:bg-bg-hover text-text-secondary flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            {/* Collapsed header */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpanded(!expanded)}
              onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(!expanded) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-accent/10 transition-colors cursor-pointer"
            >
              <Sparkles size={16} className="text-accent flex-shrink-0" />
              <div className="flex-1 text-left min-w-0">
                {loading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="text-accent animate-spin" />
                    <span className="text-xs text-text-secondary">Analyzing your chats...</span>
                  </div>
                ) : (
                  <span className="text-xs text-text-primary">
                    {summary || `${nudges.length} chats need attention`}
                  </span>
                )}
              </div>
              <ChevronRight
                size={14}
                className={`text-text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
              <button
                onClick={(e) => { e.stopPropagation(); setDismissed(true) }}
                className="p-0.5 rounded-full hover:bg-bg-hover text-text-secondary"
              >
                <X size={14} />
              </button>
            </div>

            {/* Expanded nudge list */}
            {expanded && !loading && nudges.length > 0 && (
              <div className="border-t border-accent/10 px-3 py-2 space-y-1.5">
                {nudges.map((nudge, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveChat(nudge.chatId)}
                    className="w-full flex items-start gap-2 p-2 rounded-lg hover:bg-bg-hover transition-colors text-left"
                  >
                    <span className={`mt-0.5 ${priorityColor(nudge.priority)}`}>
                      {typeIcon(nudge.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-text-primary">{nudge.chatName}</span>
                      <p className="text-[11px] text-text-secondary truncate">{nudge.text}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PulseBeacon>
  )
}
