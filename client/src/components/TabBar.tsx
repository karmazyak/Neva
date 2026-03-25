import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Sparkles, Bot, User } from 'lucide-react'

const tabs = [
  { icon: MessageCircle, label: 'Chats', path: '/' },
  { icon: Sparkles, label: 'AI', path: '/ai-chat' },
  { icon: Bot, label: 'Robots', path: '/robots' },
  { icon: User, label: 'Profile', path: '/profile' },
]

export default function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()

  // Hide tab bar when inside a chat conversation (mobile)
  const hideOnPaths = ['/saved']
  if (hideOnPaths.some(p => location.pathname.startsWith(p))) return null

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg-secondary border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-[52px]">
        {tabs.map((tab) => {
          const isActive = tab.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(tab.path)

          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                isActive ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              <tab.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
