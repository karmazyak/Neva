import { useState, useRef, useEffect } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'

interface SearchBarProps {
  chatId: string
  onClose: () => void
  onResultClick: (messageId: string) => void
}

export default function SearchBar({ chatId, onClose, onResultClick }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.searchChatMessages(chatId, query)
        setResults(res)
        setActiveIndex(0)
      } catch {}
      setLoading(false)
    }, 300)
  }, [query, chatId])

  const navigateResult = (dir: 1 | -1) => {
    if (results.length === 0) return
    const next = (activeIndex + dir + results.length) % results.length
    setActiveIndex(next)
    onResultClick(results[next].id)
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-bg-input border-b border-border">
      <Search size={16} className="text-text-secondary flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск сообщений..."
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter') navigateResult(e.shiftKey ? -1 : 1)
        }}
      />
      {results.length > 0 && (
        <span className="text-xs text-text-secondary">{activeIndex + 1}/{results.length}</span>
      )}
      {loading && <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />}
      <button onClick={() => navigateResult(-1)} className="p-1 text-text-secondary hover:text-text-primary"><ChevronUp size={14} /></button>
      <button onClick={() => navigateResult(1)} className="p-1 text-text-secondary hover:text-text-primary"><ChevronDown size={14} /></button>
      <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary"><X size={16} /></button>
    </div>
  )
}
