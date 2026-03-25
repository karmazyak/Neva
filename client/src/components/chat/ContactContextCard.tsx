import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { api } from '../../lib/api'

interface ContactContextCardProps {
  chatId: string
}

export default function ContactContextCard({ chatId }: ContactContextCardProps) {
  const [context, setContext] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setDismissed(false)
    setLoading(true)
    api.getContactContext(chatId).then(res => {
      setContext(res.context)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [chatId])

  if (dismissed || loading || !context) return null

  return (
    <div className="mx-4 mt-2 mb-1 px-3 py-2 bg-accent/5 border border-accent/20 rounded-xl flex items-start gap-2 fade-in">
      <Sparkles size={14} className="text-accent flex-shrink-0 mt-0.5" />
      <p className="text-xs text-text-secondary flex-1 leading-relaxed">{context}</p>
      <button onClick={() => setDismissed(true)} className="text-text-secondary hover:text-text-primary flex-shrink-0">
        <X size={12} />
      </button>
    </div>
  )
}
