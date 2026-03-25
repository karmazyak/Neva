import { useState, useEffect } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'

interface ChatBriefingProps {
  chatId: string
  unreadCount: number
  onDismiss: () => void
}

export default function ChatBriefing({ chatId, unreadCount, onDismiss }: ChatBriefingProps) {
  const [briefing, setBriefing] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const loadBriefing = async () => {
    if (loading || briefing) return
    setLoading(true)
    setError(false)
    try {
      const res = await api.getChatBriefing({ chatId, messageCount: unreadCount })
      if (res.briefing) {
        setBriefing(res.briefing)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // Only show for 5+ unread messages
  if (unreadCount < 5) return null

  if (!briefing && !loading && !expanded) {
    return (
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded(true)
          loadBriefing()
        }}
        className="flex items-center gap-1 mt-0.5 cursor-pointer"
      >
        <Sparkles size={10} className="text-accent" />
        <span className="text-[11px] text-accent">AI Summary</span>
      </span>
    )
  }

  if (!expanded) return null

  return (
    <div className="mt-1 bg-accent/5 border border-accent/20 rounded-lg px-2.5 py-1.5 fade-in" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Sparkles size={10} className="text-accent" />
        <span className="text-[10px] text-accent font-medium">AI Briefing</span>
        <span role="button" onClick={(e) => { e.stopPropagation(); onDismiss(); setExpanded(false) }} className="ml-auto text-text-secondary hover:text-text-primary cursor-pointer">
          <X size={12} />
        </span>
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 py-1">
          <Loader2 size={12} className="text-accent animate-spin" />
          <span className="text-[11px] text-text-secondary">Summarizing {unreadCount} messages...</span>
        </div>
      ) : error ? (
        <p className="text-[11px] text-text-secondary">Could not generate summary</p>
      ) : briefing ? (
        <p className="text-[11px] text-text-primary leading-relaxed">{briefing}</p>
      ) : null}
    </div>
  )
}
