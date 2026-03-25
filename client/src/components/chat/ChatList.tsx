import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { Menu, Search, Edit, Users, Megaphone } from 'lucide-react'
import ChatBriefing from './ChatBriefing'
import FolderTabs from './FolderTabs'
import { api } from '../../lib/api'

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i.test(url)
}

function isAudioUrl(url: string) {
  return /\.(mp3|wav|ogg|webm|m4a|aac)(\?|$)/i.test(url)
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|avi|mkv)(\?|$)/i.test(url)
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n/g, ' ')
    .trim()
}

function formatPreview(content: string | undefined): string {
  if (!content) return 'No messages yet'
  if (content.startsWith('/uploads/') || content.startsWith('http')) {
    if (isImageUrl(content)) return '\ud83d\udcf7 Photo'
    if (isAudioUrl(content)) return '\ud83c\udfa4 Voice message'
    if (isVideoUrl(content)) return '\ud83c\udfa5 Video'
    return '\ud83d\udcce File'
  }
  return stripMarkdown(content)
}

interface ChatListProps {
  onMenuClick: () => void
  onNewChat: () => void
}

function ChatSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="w-12 h-12 rounded-full bg-bg-hover flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex justify-between">
          <div className="h-4 bg-bg-hover rounded w-32" />
          <div className="h-3 bg-bg-hover rounded w-10" />
        </div>
        <div className="h-3 bg-bg-hover rounded w-48" />
      </div>
    </div>
  )
}

export default function ChatList({ onMenuClick, onNewChat }: ChatListProps) {
  const { chats, activeChat, setActiveChat, typingUsers, createChat } = useChatStore()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [dismissedBriefings, setDismissedBriefings] = useState<Set<string>>(new Set())
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [activeFolderName, setActiveFolderName] = useState<string | null>(null)
  const [globalUsers, setGlobalUsers] = useState<any[]>([])
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (search.length < 2) { setGlobalUsers([]); return }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const q = search.startsWith('@') ? search.slice(1) : search
        const results = await api.searchUsers(q)
        // Filter out users already in chats
        const existingUserIds = new Set(chats.flatMap(c => (c as any).members?.map((m: any) => m.userId) || []))
        setGlobalUsers(results.filter((u: any) => u.id !== user?.id))
      } catch { setGlobalUsers([]) }
    }, 300)
  }, [search])

  useEffect(() => {
    if (chats.length > 0) setLoading(false)
    const t = setTimeout(() => setLoading(false), 2000)
    return () => clearTimeout(t)
  }, [chats.length])

  const filteredChats = chats.filter((chat) => {
    // Search filter
    if (search && !chat.name?.toLowerCase().includes(search.toLowerCase())) return false
    // Folder filter
    if (!activeFolder) return true
    if (activeFolderName === 'Personal') return chat.type === 'private'
    if (activeFolderName === 'Work') return chat.type === 'group' || chat.type === 'channel'
    if (activeFolderName === 'AI Bots') return false // TODO: filter by agent presence
    return true
  })

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    }

    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary">
        {/* Desktop: hamburger menu, Mobile: title (tab bar handles nav) */}
        <button
          onClick={onMenuClick}
          className="hidden md:block p-2 rounded-full hover:bg-bg-hover transition-colors text-text-secondary"
        >
          <Menu size={22} />
        </button>
        <h1 className="md:hidden text-lg font-semibold text-text-primary pl-1">Chats</h1>

        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg-input rounded-full pl-10 pr-4 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
          />
        </div>
      </div>

      {/* Folder tabs */}
      <FolderTabs activeFolder={activeFolder} onFolderChange={(id, name) => { setActiveFolder(id); setActiveFolderName(name || null) }} />

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto pb-20">
        {/* Global user search results */}
        {search.length >= 2 && globalUsers.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-xs text-text-secondary font-medium uppercase tracking-wider">Пользователи</p>
            {globalUsers.map((u: any) => (
              <button
                key={u.id}
                onClick={async () => {
                  const chatId = await createChat([u.id])
                  setActiveChat(chatId)
                  setSearch('')
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors"
              >
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-lg">
                    {u.displayName?.[0]?.toUpperCase() || u.username?.[0]?.toUpperCase()}
                  </div>
                  {u.online && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-bg-secondary" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-text-primary font-medium truncate">{u.displayName}</p>
                  <p className="text-text-secondary text-sm truncate">@{u.username}</p>
                </div>
              </button>
            ))}
            {filteredChats.length > 0 && <p className="px-4 pt-3 pb-1 text-xs text-text-secondary font-medium uppercase tracking-wider">Чаты</p>}
          </div>
        )}
        {loading && chats.length === 0 ? (
          <>
            {[...Array(6)].map((_, i) => <ChatSkeleton key={i} />)}
          </>
        ) : filteredChats.length === 0 && globalUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-full bg-bg-input flex items-center justify-center mb-4">
              <Edit size={28} className="text-text-secondary" />
            </div>
            <p className="text-text-primary font-medium mb-1">No conversations yet</p>
            <p className="text-text-secondary text-sm mb-5">Start chatting with friends or try the AI assistant</p>
            <button
              onClick={onNewChat}
              className="px-5 py-2.5 rounded-xl neva-gradient text-white font-medium text-sm hover:opacity-90 transition-opacity shadow-[0_4px_16px_rgba(44,196,196,0.25)]"
            >
              New conversation
            </button>
          </div>
        ) : (
          filteredChats.map((chat) => (
            <div key={chat.id}>
              <button
                onClick={() => setActiveChat(chat.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors relative ${
                  activeChat === chat.id ? 'bg-accent/10 border-l-2 border-accent' : 'border-l-2 border-transparent'
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                    chat.type === 'channel' ? 'bg-blue-400/30 text-blue-400' :
                    chat.type === 'group' ? 'bg-purple-400/30 text-purple-400' :
                    'bg-accent/30 text-accent'
                  }`}>
                    {chat.type === 'channel' ? <Megaphone size={20} /> :
                     chat.type === 'group' ? <Users size={20} /> :
                     chat.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  {chat.type === 'private' && (chat as any).members?.some((m: any) => m.online && m.userId !== user?.id) && (
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-online rounded-full border-2 border-bg-primary" />
                  )}
                </div>

                {/* Chat info */}
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary truncate">
                      {chat.name || 'Unknown'}
                    </span>
                    <span className="text-xs text-text-time ml-2 flex-shrink-0">
                      {formatTime(chat.lastMessage?.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    {typingUsers[chat.id] && Object.keys(typingUsers[chat.id]).length > 0 ? (
                      <div className="flex items-center gap-1.5 text-accent">
                        <div className="typing-indicator flex gap-0.5">
                          <span className="w-1.5 h-1.5 bg-accent rounded-full" />
                          <span className="w-1.5 h-1.5 bg-accent rounded-full" />
                          <span className="w-1.5 h-1.5 bg-accent rounded-full" />
                        </div>
                        <span className="text-sm">typing...</span>
                      </div>
                    ) : (
                      <p className="text-sm text-text-secondary truncate">
                        {formatPreview(chat.lastMessage?.content)}
                      </p>
                    )}
                    {chat.unreadCount > 0 && (
                      <span className="ml-2 bg-accent text-white text-xs rounded-full px-2 py-0.5 flex-shrink-0">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* AI Briefing for chats with many unreads */}
                  {chat.unreadCount >= 5 && activeChat !== chat.id && !dismissedBriefings.has(chat.id) && (
                    <ChatBriefing
                      chatId={chat.id}
                      unreadCount={chat.unreadCount}
                      onDismiss={() => setDismissedBriefings(prev => new Set(prev).add(chat.id))}
                    />
                  )}
                </div>
              </button>
            </div>
          ))
        )}
      </div>

      {/* FAB - New chat */}
      <button
        onClick={onNewChat}
        className="absolute bottom-6 right-6 md:right-auto md:left-[370px] w-14 h-14 neva-gradient rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(44,196,196,0.4)] transition-opacity hover:opacity-90 z-10"
      >
        <Edit size={22} className="text-white" />
      </button>
    </>
  )
}
