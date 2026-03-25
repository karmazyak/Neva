import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Bot, MoreVertical, Search, BellOff, Trash2, Sparkles, Users, Megaphone, Eye, EyeOff, PanelRightOpen, PanelRightClose, Pin, Timer, FileText } from 'lucide-react'

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
}

export default function ChatHeader({ chat, onBack, onAgentToggle, typing, hasAgent, ghostLayerEnabled, onGhostToggle, contextPanelOpen, onToggleContextPanel, onSearch, onMeetingSummary, onDisappearTimer }: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
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

  const menuItems = [
    {
      icon: hasAgent ? Bot : Sparkles,
      label: hasAgent ? 'Manage AI Agent' : 'Add AI Agent',
      desc: hasAgent ? 'Change or remove agent' : 'Let AI reply for you',
      accent: true,
      onClick: () => { onAgentToggle(); setMenuOpen(false) },
    },
    { icon: Search, label: 'Search Messages', onClick: () => { onSearch?.(); setMenuOpen(false) } },
    { icon: FileText, label: 'Meeting Summary', onClick: () => { onMeetingSummary?.(); setMenuOpen(false) } },
    { icon: Timer, label: 'Disappearing Messages', onClick: () => { onDisappearTimer?.(); setMenuOpen(false) } },
    { icon: BellOff, label: 'Mute Notifications', onClick: () => setMenuOpen(false) },
    { icon: Trash2, label: 'Clear History', danger: true, onClick: () => setMenuOpen(false) },
  ]

  // Get the other user's status in private chats
  const otherMember = chat?.type === 'private' ? chat?.members?.find((m: any) => m.userId !== chat?.members?.[0]?.userId) || chat?.members?.[0] : null
  const userStatus = otherMember?.statusEmoji || otherMember?.statusText
    ? `${otherMember?.statusEmoji || ''} ${otherMember?.statusText || ''}`.trim()
    : null

  const getSubtitle = () => {
    if (typing.length > 0) return { text: `${typing.join(', ')} typing...`, dot: 'accent' }
    if (isChannel) return { text: `${chat?.members?.length || 0} subscribers`, dot: null }
    if (isGroup) return { text: `${chat?.members?.length || 0} members`, dot: null }
    if (online) return { text: userStatus ? `online · ${userStatus}` : 'online', dot: 'green' }
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
        <h2 className="font-semibold text-text-primary truncate leading-tight">{chat?.name || 'Chat'}</h2>
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
        <button onClick={onToggleContextPanel}
          className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            contextPanelOpen ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-bg-input text-text-secondary hover:text-text-primary border border-border'
          }`} title={contextPanelOpen ? 'Close Context Panel' : 'Open Context AI'}>
          {contextPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          <span>Context</span>
        </button>
      )}

      <button onClick={onAgentToggle}
        className={`p-2 rounded-full hover:bg-bg-hover transition-colors ${hasAgent ? 'text-accent' : 'text-text-secondary'}`}
        title={hasAgent ? 'AI Agent active' : 'Add AI Agent'}>
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
