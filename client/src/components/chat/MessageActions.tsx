import { useState } from 'react'
import { BookOpen, Languages, MessageSquareReply, FileText, Copy, Loader2, X } from 'lucide-react'
import { api } from '../../lib/api'

interface MessageActionsProps {
  messageText: string
  position: { x: number; y: number }
  onClose: () => void
  onInsertReply: (text: string) => void
  chatContext?: string
  chatId?: string
}

export default function MessageActions({ messageText, position, onClose, onInsertReply, chatContext, chatId }: MessageActionsProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ type: string; content: string | string[] } | null>(null)

  const handleAction = async (action: string) => {
    if (loading) return
    setLoading(action)
    setResult(null)

    try {
      const res = await api.analyzeMessage({
        text: messageText,
        action,
        chatContext,
        chatId,
      })

      setResult({ type: action, content: res.result })
    } catch (err) {
      console.error('Action failed:', err)
      setResult({ type: action, content: 'Failed to process. Try again.' })
    } finally {
      setLoading(null)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Calculate position so menu stays in viewport
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 100,
    left: Math.min(position.x, window.innerWidth - 300),
    top: Math.min(position.y, window.innerHeight - 400),
  }

  const actions = [
    { key: 'summarize', label: 'Summarize', icon: FileText, color: 'text-blue-400' },
    { key: 'explain', label: 'Explain', icon: BookOpen, color: 'text-purple-400' },
    { key: 'translate_en', label: 'Translate to EN', icon: Languages, color: 'text-orange-400' },
    { key: 'translate_ru', label: 'Translate to RU', icon: Languages, color: 'text-red-400' },
    { key: 'reply_suggestions', label: 'Suggest Replies', icon: MessageSquareReply, color: 'text-green-400' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[99]" onClick={onClose} />

      {/* Menu */}
      <div style={menuStyle} className="fade-in">
        <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden w-[260px]">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <span className="text-[11px] text-text-secondary font-medium">AI Actions</span>
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
              <X size={14} />
            </button>
          </div>

          {/* Actions */}
          {!result && (
            <div className="py-1">
              {actions.map(act => (
                <button
                  key={act.key}
                  onClick={() => handleAction(act.key)}
                  disabled={!!loading}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-hover transition-colors disabled:opacity-50"
                >
                  {loading === act.key ? (
                    <Loader2 size={16} className="text-accent animate-spin" />
                  ) : (
                    <act.icon size={16} className={act.color} />
                  )}
                  <span className="text-text-primary">{act.label}</span>
                </button>
              ))}

              {/* Copy original */}
              <button
                onClick={() => { handleCopy(messageText); onClose() }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-hover transition-colors border-t border-border/50"
              >
                <Copy size={16} className="text-text-secondary" />
                <span className="text-text-primary">Copy Text</span>
              </button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="p-3 space-y-2">
              <div className="text-[11px] text-text-secondary font-medium uppercase tracking-wider">
                {actions.find(a => a.key === result.type)?.label}
              </div>

              {result.type === 'reply_suggestions' && Array.isArray(result.content) ? (
                <div className="space-y-1.5">
                  {(result.content as string[]).map((reply, i) => (
                    <button
                      key={i}
                      onClick={() => { onInsertReply(reply); onClose() }}
                      className="w-full text-left px-3 py-2 bg-bg-input hover:bg-bg-hover rounded-lg text-sm text-text-primary transition-colors"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-text-primary leading-relaxed">
                    {result.content as string}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { handleCopy(result.content as string); onClose() }}
                      className="flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Copy size={12} />
                      Copy
                    </button>
                    <button
                      onClick={() => setResult(null)}
                      className="text-xs text-text-secondary hover:text-text-primary"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
