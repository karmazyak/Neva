import { useState } from 'react'
import { Gift, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api'

interface Props {
  chatId: string
  contactName: string
}

export default function GiftIdeas({ chatId, contactName }: Props) {
  const [ideas, setIdeas] = useState<string | null>(null)
  const [factsUsed, setFactsUsed] = useState(0)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [occasion, setOccasion] = useState('')

  const loadIdeas = async () => {
    setLoading(true)
    try {
      // We need contactId (userId), not chatId — get it from contact summary
      const summary = await api.getContactSummary(chatId)
      const contactId = (summary as any)?.contact?.userId
      if (!contactId) return

      const res = await api.getGiftIdeas(contactId, chatId, occasion || undefined)
      setIdeas(res.ideas)
      setFactsUsed(res.factsUsed)
      setExpanded(true)
    } catch {} finally { setLoading(false) }
  }

  return (
    <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
      <button
        onClick={() => {
          if (ideas) { setExpanded(!expanded) }
          else { loadIdeas() }
        }}
        className="w-full flex items-center justify-between"
        disabled={loading}
      >
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Gift size={16} className="text-orange-400" />
          Идеи подарков
        </h3>
        {loading ? (
          <Loader2 size={14} className="text-accent animate-spin" />
        ) : ideas ? (
          expanded ? <ChevronUp size={16} className="text-text-secondary" /> : <ChevronDown size={16} className="text-text-secondary" />
        ) : (
          <span className="text-xs text-accent">Подобрать</span>
        )}
      </button>

      {/* Occasion input (before loading) */}
      {!ideas && !loading && (
        <div className="flex gap-2">
          <input
            type="text"
            value={occasion}
            onChange={e => setOccasion(e.target.value)}
            placeholder="Повод (день рождения, просто так...)"
            className="flex-1 text-xs bg-bg-hover rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none border border-border"
          />
          <button
            onClick={loadIdeas}
            className="px-3 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-xs rounded-lg transition-colors"
          >
            <Gift size={12} />
          </button>
        </div>
      )}

      {/* Ideas content */}
      {expanded && ideas && (
        <div className="space-y-2">
          <div className="text-sm text-text-primary bg-bg-hover rounded-lg px-3.5 py-3 leading-relaxed whitespace-pre-line max-h-80 overflow-y-auto">
            {ideas}
          </div>
          <div className="text-[10px] text-text-secondary text-right">
            На основе {factsUsed} фактов из памяти
          </div>
        </div>
      )}
    </section>
  )
}
