import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useAgentStore } from '../stores/agentStore'
import { useChatStore } from '../stores/chatStore'
import { api } from '../lib/api'
import {
  ArrowLeft,
  User,
  Mail,
  AtSign,
  Bot,
  Coins,
  MessageCircle,
  Shield,
  Palette,
  ChevronRight,
  LogOut,
  Check,
  Fingerprint,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import NevaLogo from '../components/NevaLogo'
import NotificationSettings from '../components/settings/NotificationSettings'
import AIValueTracker from '../components/AIValueTracker'
import { useTour } from '../components/GuidedTour'
import { RotateCcw } from 'lucide-react'

export default function Profile() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { agents, loadAgents } = useAgentStore()
  const { chats, loadChats } = useChatStore()
  const [balance, setBalance] = useState<number | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark')
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [statusText, setStatusText] = useState((user as any)?.statusText || '')
  const [statusEmoji, setStatusEmoji] = useState((user as any)?.statusEmoji || '')
  const [editingStatus, setEditingStatus] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [styleProfile, setStyleProfile] = useState<any>(null)
  const [styleUpdatedAt, setStyleUpdatedAt] = useState<string | null>(null)
  const [styleLoading, setStyleLoading] = useState(false)
  const [showStyle, setShowStyle] = useState(false)

  useEffect(() => {
    loadAgents()
    loadChats()
    api.getBalance().then(d => setBalance(d.balance)).catch(() => {})
    api.getMyStyleProfile().then(d => {
      if (d.profile) {
        setStyleProfile(d.profile)
        setStyleUpdatedAt(d.updatedAt)
      }
    }).catch(() => {})
  }, [])

  if (!user) return null

  const stats = [
    { label: 'Кредиты', value: balance ?? '...', icon: Coins, color: 'text-accent' },
    { label: 'Мои агенты', value: agents.length, icon: Bot, color: 'text-accent' },
    { label: 'Чаты', value: chats.length, icon: MessageCircle, color: 'text-accent' },
  ]

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="hidden md:block p-1 text-text-secondary hover:text-text-primary">
          <ArrowLeft size={22} />
        </button>
        <h2 className="font-semibold text-text-primary text-lg">Профиль</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Avatar & Name */}
        <div className="flex flex-col items-center py-8 bg-bg-secondary">
          <div className="w-24 h-24 rounded-full neva-gradient flex items-center justify-center text-white text-3xl font-bold mb-4 shadow-[0_0_32px_rgba(44,196,196,0.25)]">
            {user.displayName?.[0]?.toUpperCase() || 'U'}
          </div>
          <h2 className="text-xl font-bold text-text-primary">{user.displayName}</h2>
          <p className="text-text-secondary text-sm mt-1">@{user.username}</p>
          {user.email && (
            <p className="text-text-secondary text-xs mt-1 flex items-center gap-1">
              <Mail size={12} />
              {user.email}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 px-4 py-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-bg-secondary rounded-xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center ${stat.color}`}>
                <stat.icon size={20} />
              </div>
              <div>
                <div className="text-lg font-bold text-text-primary">{stat.value}</div>
                <div className="text-xs text-text-secondary">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Info Section */}
        <div className="mx-4 bg-bg-secondary rounded-xl overflow-hidden mb-4">
          <button
            onClick={() => setEditingName(true)}
            className="w-full px-4 py-3 flex items-center gap-3 border-b border-border hover:bg-bg-hover transition-colors text-left"
          >
            <User size={20} className="text-accent flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-secondary">Имя</div>
              {editingName ? (
                <input
                  autoFocus
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onBlur={async () => {
                    if (displayName.trim() && displayName !== user.displayName) {
                      await api.updateProfile({ displayName: displayName.trim() }).catch(() => {})
                    }
                    setEditingName(false)
                  }}
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      if (displayName.trim() && displayName !== user.displayName) {
                        await api.updateProfile({ displayName: displayName.trim() }).catch(() => {})
                      }
                      setEditingName(false)
                    } else if (e.key === 'Escape') {
                      setDisplayName(user.displayName || '')
                      setEditingName(false)
                    }
                  }}
                  className="w-full bg-transparent text-text-primary text-sm focus:outline-none border-b border-accent"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <div className="text-text-primary text-sm">{displayName || user.displayName}</div>
              )}
            </div>
            {!editingName && <ChevronRight size={16} className="text-text-secondary flex-shrink-0" />}
          </button>
          <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
            <AtSign size={20} className="text-accent" />
            <div className="flex-1">
              <div className="text-xs text-text-secondary">Логин</div>
              <div className="text-text-primary text-sm">@{user.username}</div>
            </div>
          </div>
          <div className="px-4 py-3 flex items-center gap-3">
            <Mail size={20} className="text-accent" />
            <div className="flex-1">
              <div className="text-xs text-text-secondary">Email</div>
              <div className="text-text-primary text-sm">{user.email || 'Не указан'}</div>
            </div>
          </div>
        </div>

        {/* Custom Status */}
        <div className="mx-4 bg-bg-secondary rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3">
            <div className="text-xs text-text-secondary mb-2">Статус</div>
            {editingStatus ? (
              <div className="flex items-center gap-2">
                <input
                  value={statusEmoji}
                  onChange={e => setStatusEmoji(e.target.value)}
                  placeholder="😊"
                  className="w-10 bg-bg-input rounded-lg px-2 py-1.5 text-center text-lg"
                  maxLength={2}
                />
                <input
                  value={statusText}
                  onChange={e => setStatusText(e.target.value)}
                  placeholder="What's on your mind?"
                  className="flex-1 bg-bg-input rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
                  maxLength={100}
                />
                <button
                  onClick={async () => {
                    await api.updateStatus({ statusText: statusText || undefined, statusEmoji: statusEmoji || undefined })
                    setEditingStatus(false)
                  }}
                  className="p-1.5 text-accent hover:bg-accent/10 rounded-lg"
                >
                  <Check size={18} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className="w-full text-left flex items-center gap-2 text-sm"
              >
                {statusEmoji && <span className="text-lg">{statusEmoji}</span>}
                <span className={statusText ? 'text-text-primary' : 'text-text-secondary'}>
                  {statusText || 'Установить статус...'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Settings */}
        <div className="mx-4 bg-bg-secondary rounded-xl overflow-hidden mb-4">
          {/* Appearance */}
          <button
            onClick={() => setShowThemePicker(!showThemePicker)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors border-b border-border"
          >
            <Palette size={20} className="text-text-secondary" />
            <div className="flex-1 text-left">
              <div className="text-text-primary text-sm">Оформление</div>
              <div className="text-xs text-text-secondary">{theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'}</div>
            </div>
            <ChevronRight size={16} className={`text-text-secondary transition-transform ${showThemePicker ? 'rotate-90' : ''}`} />
          </button>

          {/* Theme picker — directly under Appearance */}
          {showThemePicker && (
            <div className="border-b border-border px-4 py-3 space-y-2 bg-bg-primary/30">
              {[
                { id: 'dark' as const, label: 'Тёмная', desc: 'Бережёт глаза' },
                { id: 'light' as const, label: 'Светлая', desc: 'Классический вид' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id)
                    document.documentElement.setAttribute('data-theme', t.id)
                    localStorage.setItem('theme', t.id)
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    theme === t.id ? 'bg-accent/20' : 'hover:bg-bg-hover'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full border-2 ${t.id === 'dark' ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`} />
                  <div className="flex-1 text-left">
                    <div className="text-sm text-text-primary">{t.label}</div>
                    <div className="text-xs text-text-secondary">{t.desc}</div>
                  </div>
                  {theme === t.id && <Check size={16} className="text-accent" />}
                </button>
              ))}
            </div>
          )}

          {/* Privacy & Security */}
          <button
            onClick={() => alert('Privacy settings coming soon')}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors"
          >
            <Shield size={20} className="text-text-secondary" />
            <div className="flex-1 text-left">
              <div className="text-text-primary text-sm">Конфиденциальность</div>
              <div className="text-xs text-text-secondary">Сквозное шифрование</div>
            </div>
            <ChevronRight size={16} className="text-text-secondary" />
          </button>
        </div>

        {/* Notification Settings */}
        <div className="mx-4 bg-bg-secondary rounded-xl overflow-hidden mb-4 px-4 py-3">
          <NotificationSettings />
        </div>

        {/* AI Value Tracker */}
        <div className="mx-4 mb-4">
          <AIValueTracker />
        </div>

        {/* Restart Tour Button */}
        <div className="mx-4 mb-4">
          <RestartTourButton />
        </div>

        {/* My Writing Style */}
        <div className="mx-4 bg-bg-secondary rounded-xl overflow-hidden mb-4">
          <button
            onClick={() => setShowStyle(!showStyle)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors"
          >
            <Fingerprint size={20} className="text-accent" />
            <div className="flex-1 text-left">
              <div className="text-text-primary text-sm">Мой стиль общения</div>
              <div className="text-xs text-text-secondary">
                {styleProfile ? `${styleProfile.tone}` : 'Ещё не определён — отправьте 30+ сообщений'}
              </div>
            </div>
            <ChevronRight size={16} className={`text-text-secondary transition-transform ${showStyle ? 'rotate-90' : ''}`} />
          </button>

          {showStyle && (
            <div className="border-t border-border px-4 py-4 space-y-3 bg-bg-primary/30">
              {styleProfile ? (
                <>
                  {/* Main style card */}
                  {styleProfile.styleInstruction && (
                    <div className="bg-bg-secondary rounded-xl p-4 border border-border/50">
                      <div className="text-sm text-text-primary leading-relaxed">{styleProfile.styleInstruction}</div>
                    </div>
                  )}

                  {/* Style traits as visual bars/tags */}
                  <div className="space-y-2.5">
                    {(() => {
                      const formalityMap: Record<string, string> = {
                        'very_casual': 'Очень неформально', 'casual': 'Неформально', 'neutral': 'Нейтрально',
                        'formal': 'Формально', 'very_formal': 'Очень формально',
                      }
                      const humorMap: Record<string, string> = {
                        'none': 'Без юмора', 'rare': 'Иногда шутит', 'moderate': 'Часто шутит',
                        'frequent': 'Много юмора', 'always': 'Постоянно шутит',
                      }
                      const emojiMap: Record<string, string> = {
                        'никогда': 'Не использует', 'never': 'Не использует', 'редко': 'Редко', 'rare': 'Редко',
                        'иногда': 'Иногда', 'moderate': 'Иногда', 'часто': 'Часто', 'frequent': 'Часто',
                        'очень часто': 'Постоянно', 'always': 'Постоянно',
                      }
                      const traits = [
                        { icon: '🎭', label: 'Тон', value: styleProfile.tone },
                        { icon: '👔', label: 'Формальность', value: formalityMap[styleProfile.formality] || styleProfile.formality },
                        { icon: '😄', label: 'Юмор', value: humorMap[styleProfile.humor] || styleProfile.humor },
                        { icon: '😀', label: 'Эмодзи', value: emojiMap[styleProfile.emojiFrequency] || styleProfile.emojiFrequency },
                        { icon: '📏', label: 'Длина сообщений', value: `~${styleProfile.avgMessageLength} символов` },
                      ]
                      return traits.map((t, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2 bg-bg-secondary rounded-lg">
                          <span className="text-base w-6 text-center flex-shrink-0">{t.icon}</span>
                          <span className="text-xs text-text-secondary w-32 flex-shrink-0">{t.label}</span>
                          <span className="text-sm text-text-primary font-medium">{t.value}</span>
                        </div>
                      ))
                    })()}
                  </div>

                  {/* Common phrases */}
                  {styleProfile.commonPhrases?.length > 0 && (
                    <div>
                      <div className="text-xs text-text-secondary mb-2 px-1">Ваши фразы</div>
                      <div className="flex flex-wrap gap-1.5">
                        {styleProfile.commonPhrases.map((phrase: string, i: number) => (
                          <span key={i} className="px-2.5 py-1 bg-accent/10 text-accent text-xs rounded-full border border-accent/20">
                            {phrase}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {styleUpdatedAt && (
                    <div className="text-[10px] text-text-secondary/50 text-center pt-1">
                      Обновлено: {new Date(styleUpdatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={async () => {
                        setStyleLoading(true)
                        try {
                          const res = await api.reanalyzeMyStyle()
                          setStyleProfile(res.profile)
                          setStyleUpdatedAt(new Date().toISOString())
                        } catch {}
                        setStyleLoading(false)
                      }}
                      disabled={styleLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={styleLoading ? 'animate-spin' : ''} />
                      {styleLoading ? 'Анализирую...' : 'Обновить анализ'}
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm('Удалить профиль стиля? Он создастся заново после 30 сообщений.')) {
                          await api.deleteMyStyleProfile().catch(() => {})
                          setStyleProfile(null)
                          setStyleUpdatedAt(null)
                        }
                      }}
                      className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <Fingerprint size={36} className="mx-auto text-text-secondary/20 mb-3" />
                  <p className="text-sm text-text-secondary mb-1">Neva ещё изучает ваш стиль</p>
                  <p className="text-xs text-text-secondary/60 mb-4">Автоматически определится после 30 сообщений</p>
                  <button
                    onClick={async () => {
                      setStyleLoading(true)
                      try {
                        const res = await api.reanalyzeMyStyle()
                        setStyleProfile(res.profile)
                        setStyleUpdatedAt(new Date().toISOString())
                      } catch {}
                      setStyleLoading(false)
                    }}
                    disabled={styleLoading}
                    className="px-5 py-2.5 rounded-xl neva-gradient text-white text-xs font-medium disabled:opacity-50 shadow-[0_2px_12px_rgba(44,196,196,0.25)]"
                  >
                    {styleLoading ? 'Анализирую...' : 'Определить сейчас'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="mx-4 mb-8">
          <button
            onClick={() => { logout(); navigate('/login') }}
            className="w-full bg-bg-secondary rounded-xl px-4 py-3 flex items-center gap-3 text-danger hover:bg-bg-hover transition-colors"
          >
            <LogOut size={20} />
            <span className="text-sm font-medium">Выйти</span>
          </button>
        </div>

        {/* Version */}
        <div className="text-center pb-8 flex flex-col items-center gap-2">
          <NevaLogo size={28} />
          <p className="text-text-secondary text-xs neva-gradient-text font-medium">Neva v0.1.0</p>
          <p className="text-text-secondary/40 text-[10px]">Intelligence that flows</p>
        </div>
      </div>
    </div>
  )
}

function RestartTourButton() {
  const { startTour, isActive } = useTour()
  const navigate = useNavigate()

  if (isActive) return null

  return (
    <button
      onClick={() => { startTour(); navigate('/') }}
      className="w-full flex items-center gap-3 bg-bg-secondary rounded-xl px-4 py-3 hover:bg-bg-hover transition-colors"
    >
      <RotateCcw size={20} className="text-accent" />
      <div className="flex-1 text-left">
        <div className="text-text-primary text-sm">Пройти тур заново</div>
        <div className="text-text-secondary text-xs">Покажем ключевые фичи с пульсирующими подсказками</div>
      </div>
      <ChevronRight size={16} className="text-text-secondary" />
    </button>
  )
}
