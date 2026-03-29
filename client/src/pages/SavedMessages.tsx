import { useState, useEffect } from 'react'
import { Bookmark, ArrowLeft, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

export default function SavedMessages() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api.getSavedMessages().then(res => { setItems(res); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const handleUnsave = async (messageId: string) => {
    await api.unsaveMessage(messageId)
    setItems(items.filter(i => i.messageId !== messageId))
  }

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="p-1 rounded-full hover:bg-bg-hover text-text-secondary"><ArrowLeft size={22} /></button>
        <Bookmark size={20} className="text-accent" />
        <h1 className="font-semibold text-text-primary">Сохранённые</h1>
        <span className="text-sm text-text-secondary">{items.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-full bg-bg-input flex items-center justify-center mb-4">
              <Bookmark size={28} className="text-text-secondary" />
            </div>
            <p className="text-text-primary font-medium mb-1">Пока ничего не сохранено</p>
            <p className="text-text-secondary text-sm">Нажмите и удерживайте сообщение, чтобы сохранить его.</p>
          </div>
        ) : items.map(item => (
          <div key={item.id} className="px-4 py-3 border-b border-border hover:bg-bg-hover transition-colors group">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-accent">{item.senderName}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-time">{new Date(item.messageCreatedAt).toLocaleDateString()}</span>
                <button onClick={() => handleUnsave(item.messageId)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary hover:text-danger transition-all"><Trash2 size={12} /></button>
              </div>
            </div>
            <p className="text-sm text-text-primary line-clamp-3">{item.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
