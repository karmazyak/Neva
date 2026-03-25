import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import {
  MessageCircle,
  Bot,
  Store,
  Sparkles,
  User,
  LogOut,
  X,
  Bookmark,
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  if (!open) return null

  const menuItems = [
    { icon: MessageCircle, label: 'Chats', path: '/' },
    { icon: Sparkles, label: 'AI Chat', path: '/ai-chat' },
    { icon: Bot, label: 'My Robots', path: '/robots' },
    { icon: Store, label: 'Robot Store', path: '/store' },
    { icon: Bookmark, label: 'Saved Messages', path: '/saved' },
    { icon: User, label: 'Profile', path: '/profile' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Sidebar */}
      <div className="fixed left-0 top-0 bottom-0 w-[300px] bg-bg-secondary z-50 flex flex-col shadow-2xl sidebar-enter border-r border-[rgba(255,255,255,0.05)]">
        {/* Header */}
        <div className="p-4 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d3d3d 0%, #0a1a2e 100%)' }}>
          {/* Ambient */}
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #2cc4c4 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />

          <button onClick={onClose} className="text-white/60 hover:text-white mb-5 transition-colors relative z-10">
            <X size={22} />
          </button>

          <div className="flex items-center gap-3 relative z-10">
            <div className="w-12 h-12 rounded-full neva-gradient flex items-center justify-center text-white text-lg font-bold shadow-[0_0_16px_rgba(44,196,196,0.3)]">
              {user?.displayName?.[0]?.toUpperCase()}
            </div>
            <div>
              <div className="text-white font-semibold text-sm">{user?.displayName}</div>
              <div className="text-white/50 text-xs mt-0.5">@{user?.username}</div>
            </div>
          </div>
        </div>

        {/* Menu */}
        <nav className="flex-1 py-2">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path)
                onClose()
              }}
              className="w-full flex items-center gap-4 px-5 py-3 text-text-primary hover:bg-bg-hover transition-colors group"
            >
              <item.icon size={20} className="text-text-secondary group-hover:text-accent transition-colors" />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Logout */}
        <button
          onClick={() => {
            logout()
            navigate('/login')
          }}
          className="flex items-center gap-4 px-5 py-4 text-danger hover:bg-bg-hover transition-colors border-t border-[rgba(255,255,255,0.05)]"
        >
          <LogOut size={20} />
          <span className="text-sm">Log Out</span>
        </button>
      </div>
    </>
  )
}
