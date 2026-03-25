import { Pin, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

interface PinnedBarProps {
  chatId: string
  onClickPinned?: (messageId: string) => void
}

export default function PinnedBar({ chatId, onClickPinned }: PinnedBarProps) {
  const [pinned, setPinned] = useState<any[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
    api.getPinnedMessages(chatId).then(setPinned).catch(() => {})
  }, [chatId])

  if (pinned.length === 0 || dismissed) return null
  const latest = pinned[0]

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-accent/5 border-b border-accent/20 cursor-pointer hover:bg-accent/10 transition-colors"
      onClick={() => onClickPinned?.(latest.messageId)}>
      <Pin size={14} className="text-accent flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-accent font-medium">Pinned Message</span>
        <p className="text-sm text-text-primary truncate">{latest.content}</p>
      </div>
      {pinned.length > 1 && <span className="text-[10px] text-text-secondary">{pinned.length} pinned</span>}
      <button onClick={(e) => { e.stopPropagation(); setDismissed(true) }} className="text-text-secondary hover:text-text-primary">
        <X size={14} />
      </button>
    </div>
  )
}
