import { useState } from 'react'
import { X, Share2, Loader2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { api } from '../../lib/api'

interface ForwardModalProps {
  messageIds: string[]
  onClose: () => void
}

export default function ForwardModal({ messageIds, onClose }: ForwardModalProps) {
  const { chats } = useChatStore()
  const [sending, setSending] = useState<string | null>(null)
  const [sent, setSent] = useState<string[]>([])

  const handleForward = async (targetChatId: string) => {
    setSending(targetChatId)
    try {
      for (const messageId of messageIds) {
        await api.forwardMessage(messageId, targetChatId)
      }
      setSent((prev) => [...prev, targetChatId])
    } catch (err) {
      console.error('Forward failed:', err)
    } finally {
      setSending(null)
    }
  }

  const count = messageIds.length

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto bg-bg-secondary border border-border rounded-2xl shadow-xl z-50 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-accent" />
            <h3 className="font-semibold text-text-primary">
              Forward{count > 1 ? ` ${count} messages` : ''} to...
            </h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {chats.map((chat) => {
            const isSent = sent.includes(chat.id)
            const isSending = sending === chat.id
            return (
              <button
                key={chat.id}
                onClick={() => !isSent && handleForward(chat.id)}
                disabled={isSent || !!sending}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold flex-shrink-0">
                  {chat.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium text-text-primary text-sm truncate">{chat.name}</div>
                  <div className="text-xs text-text-secondary">{chat.type}</div>
                </div>
                {isSending && <Loader2 size={16} className="animate-spin text-accent" />}
                {isSent && <span className="text-xs text-green-400">Sent</span>}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
