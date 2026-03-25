import { useState, useEffect } from 'react'
import { Sparkles, X, Copy, Check } from 'lucide-react'
import { api } from '../../lib/api'

interface MeetingSummaryProps {
  chatId: string
  onClose: () => void
}

export default function MeetingSummary({ chatId, onClose }: MeetingSummaryProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getMeetingSummary(chatId).then(res => {
      setSummary(res.summary)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [chatId])

  const handleCopy = () => {
    if (summary) {
      navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[500px] max-h-[80vh] bg-bg-secondary border border-border rounded-2xl shadow-2xl z-50 overflow-hidden fade-in flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            <span className="font-medium text-text-primary">Meeting Summary</span>
          </div>
          <div className="flex items-center gap-2">
            {summary && (
              <button onClick={handleCopy} className="p-1.5 text-text-secondary hover:text-text-primary rounded-full hover:bg-bg-hover">
                {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            )}
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-text-secondary">Analyzing conversation...</p>
            </div>
          ) : summary ? (
            <p className="text-text-primary whitespace-pre-wrap text-sm leading-relaxed">{summary}</p>
          ) : (
            <p className="text-center text-text-secondary py-8">No messages to summarize</p>
          )}
        </div>
      </div>
    </>
  )
}
