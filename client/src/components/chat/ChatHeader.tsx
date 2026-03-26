import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Bot, MoreVertical, Search, BellOff, Bell, Trash2, Sparkles, Users, Megaphone, Eye, EyeOff, PanelRightOpen, PanelRightClose, Pin, Timer, FileText } from 'lucide-react'
import { useNotificationStore } from '../../stores/notificationStore'
import { api } from '../../lib/api'
import { showToast } from '../ui/Toast'
import { PulseBeacon } from '../GuidedTour'

interface ChatHeaderProps {
  chat: any
  onBack: () => void
  onAgentToggle: () => void
  typing: string[]
  hasAgent?: boolean
  ghostLayerEnabled?: boolean
  onGhostToggle?: () => void
  contextPanelOpen?: boolean
  onToggleContextPanel?: () => void
  onSearch?: () => void
  onMeetingSummary?: () => void
  onDisappearTimer?: () => void
  relationshipType?: string | null
}

export default function ChatHeader({ chat, onBack, onAgentToggle, typing, hasAgent, ghostLayerEnabled, onGhostToggle, contextPanelOpen, onToggleContextPanel, onSearch, onMeetingSummary, onDisappearTimer, relationshipType }: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [moodIndicator, setMoodIndicator] = useState<{ mood: string; note: string | null; confidence: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { isMuted, muteChat, unmuteChat } = useNotificationStore()
  const chatMuted = chat?.id ? isMuted(chat.id) : false
  const online = chat?.type === 'private' && chat?.members?.some((m: any) => m.online && m.userId !== chat?.members?.[0]?.userId)
  const isGroup = chat?.type === 'group'
  const isChannel = chat?.type === 'channel'

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Mood radar for family/friend chats
  useEffect(() => {
    setMoodIndicator(null)
    if (!chat?.id || chat?.type !== 'private') return

    const timer = setTimeout(async () => {
      try {
        const res = await api.checkMood(chat.id)
        if (res.mood !== 'normal' && res.mood !== 'happy' && res.confidence > 50) {
          setMoodIndicator(res)
        }
      } catch {}
    }, 1500) // debounced

    return () => clearTimeout(timer)
  }, [chat?.id])

  const menuItems = [
    {
      icon: hasAgent ? Bot : Sparkles,
      label: hasAgent ? 'Управление AI агентом' : 'Добавить AI агента',
      desc: hasAgent ? 'Изменить или удалить' : 'ИИ ответит за вас',
      accent: true,
      onClick: () => { onAgentToggle(); setMenuOpen(false) },
    },
    { icon: Search, label: 'Поиск сообщений', onClick: () => { onSearch?.(); setMenuOpen(false) } },
    { icon: FileText, label: 'Итоги встречи', onClick: () => { onMeetingSummary?.(); setMenuOpen(false) } },
    { icon: Timer, label: 'Исчезающие сообщения', onClick: () => { onDisappearTimer?.(); setMenuOpen(false) } },
    { icon: chatMuted ? Bell : BellOff, label: chatMuted ? 'Включить уведомления' : 'Выключить уведомления', onClick: () => { if (chat?.id) { chatMuted ? unmuteChat(chat.id) : muteChat(chat.id) } setMenuOpen(false) } },
    { icon: Trash2, label: 'Очистить историю', danger: true, onClick: () => setMenuOpen(false) },
  ]

  // Get the other user's status in private chats
  const otherMember = chat?.type === 'private' ? chat?.members?.find((m: any) => m.userId !== chat?.members?.[0]?.userId) || chat?.members?.[0] : null
  const userStatus = otherMember?.statusEmoji || otherMember?.statusText
    ? `${otherMember?.statusEmoji || ''} ${otherMember?.statusText || ''}`.trim()
    : null

  const getSubtitle = () => {
    if (typing.length > 0) return { text: `${typing.join(', ')} печатает...`, dot: 'accent' }
    if (isChannel) return { text: `${chat?.members?.length || 0} подписчиков`, dot: null }
    if (isGroup) return { text: `${chat?.members?.length || 0} участников`, dot: null }
    if (online) return { text: userStatus ? `в сети · ${userStatus}` : 'в сети', dot: 'green' }
    if (userStatus) return { text: userStatus, dot: null }
    return { text: '', dot: null }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border relative">
      <button onClick={onBack} className="md:hidden p-1 rounded-full hover:bg-bg-hover text-text-secondary">
        <ArrowLeft size={22} />
      </button>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
        isChannel ? 'bg-blue-400/30 text-blue-400' : isGroup ? 'bg-purple-400/30 text-purple-400' : 'bg-accent/30 text-accent'
      }`}>
        {isChannel ? <Megaphone size={18} /> : isGroup ? <Users size={18} /> : chat?.name?.[0]?.toUpperCase() || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-text-primary truncate leading-tight flex items-center gap-1.5">
          {chat?.name || 'Чат'}
          {moodIndicator && (
            <button
              onClick={() => moodIndicator.note && showToast('info', moodIndicator.note)}
              className="flex-shrink-0"
              title={moodIndicator.note || 'Mood changed'}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${
                moodIndicator.mood === 'stressed' ? 'bg-orange-400' : 'bg-yellow-400'
              }`} />
            </button>
          )}
          {chatMuted && <BellOff size={14} className="text-text-secondary flex-shrink-0" />}
        </h2>
        {getSubtitle().text && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {getSubtitle().dot === 'green' && <span className="w-1.5 h-1.5 rounded-full bg-green-online flex-shrink-0" />}
            {getSubtitle().dot === 'accent' && <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 animate-pulse" />}
            <p className={`text-xs truncate ${getSubtitle().dot === 'green' ? 'text-green-online' : 'text-text-secondary'}`}>
              {getSubtitle().text}
            </p>
          </div>
        )}
      </div>

      <button onClick={onGhostToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          ghostLayerEnabled ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-bg-input text-text-secondary hover:text-text-primary border border-border'
        }`}>
        {ghostLayerEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
        <span>AI</span>
      </button>

      {onToggleContextPanel && (
        <PulseBeacon step="context_button">
          <button onClick={onToggleContextPanel}
            className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              contextPanelOpen ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-bg-input text-text-secondary hover:text-text-primary border border-border'
            }`} title={contextPanelOpen ? 'Закрыть панель контекста' : 'Открыть AI контекст'}>
            {contextPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            <span>Контекст</span>
          </button>
        </PulseBeacon>
      )}

      <button onClick={onAgentToggle}
        className={`p-2 rounded-full hover:bg-bg-hover transition-colors ${hasAgent ? 'text-accent' : 'text-text-secondary'}`}
        title={hasAgent ? 'AI агент активен' : 'Добавить AI агента'}>
        <Bot size={20} />
        {hasAgent && <span className="absolute w-2 h-2 bg-green-online rounded-full top-3 right-14" />}
      </button>

      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenuOpen(!menuOpen)} className="p-2 rounded-full hover:bg-bg-hover text-text-secondary transition-colors">
          <MoreVertical size={20} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-bg-secondary border border-border rounded-xl shadow-xl z-50 overflow-hidden fade-in">
            {menuItems.map((item, i) => (
              <button key={item.label} onClick={item.onClick}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-hover ${
                  (item as any).danger ? 'text-danger' : (item as any).accent ? 'text-accent' : 'text-text-primary'
                } ${i < menuItems.length - 1 ? 'border-b border-border/50' : ''}`}>
                <item.icon size={18} />
                <div className="text-left">
                  <div>{item.label}</div>
                  {(item as any).desc && <div className="text-[11px] text-text-secondary mt-0.5">{(item as any).desc}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
