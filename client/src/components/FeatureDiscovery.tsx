import { useState, useEffect } from 'react'
import { X, Sparkles, Rocket, Heart, Shield, Brain, Theater, Coffee, Zap, ChevronRight } from 'lucide-react'

/**
 * FeatureDiscovery — contextual hints system for new users.
 * Shows non-intrusive tips as users navigate through the app,
 * guiding them to discover Strategic Advisor and Relationship Care features.
 *
 * Tips are shown once per feature, tracked in localStorage.
 */

interface Tip {
  id: string
  title: string
  description: string
  icon: React.ElementType
  color: string
  bgColor: string
  action?: { label: string; onClick?: () => void }
}

const TIPS: Record<string, Tip> = {
  // Shown when user opens a chat for the first time
  context_panel: {
    id: 'context_panel',
    title: 'AI-контекст',
    description: 'Нажми кнопку "Контекст" вверху — AI покажет темы, решения, задачи и подскажет следующий шаг.',
    icon: Brain,
    color: 'text-accent',
    bgColor: 'bg-accent/10 border-accent/20',
  },
  // Shown when user types a message
  tone_advisor: {
    id: 'tone_advisor',
    title: 'Tone Advisor',
    description: 'AI проверит тон перед отправкой. Если сообщение слишком резкое для этого контакта — предупредит и предложит мягче.',
    icon: Shield,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10 border-amber-500/20',
  },
  // Shown on first visit to AI Chat
  ai_chat_intro: {
    id: 'ai_chat_intro',
    title: 'Что умеет AI Assistant',
    description: 'Начни с "Брифинга" ☕ — AI покажет, кому стоит написать. Или запусти "Миссию" 🚀 — AI спланирует стратегию переговоров.',
    icon: Sparkles,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
  },
  // Shown when user has family/friend chats
  relationship_care: {
    id: 'relationship_care',
    title: 'Relationship Care',
    description: 'Для близких людей AI работает в режиме эмпатии — напомнит написать, заметит смену настроения и запомнит важные события.',
    icon: Heart,
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10 border-pink-500/20',
  },
  // Shown when simulation mode is available
  simulation: {
    id: 'simulation',
    title: 'Симуляция ответа',
    description: 'Нажми "What if I said..." в панели контекста — AI предскажет реакцию собеседника до отправки сообщения.',
    icon: Theater,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
  },
  // Shown after first successful mission
  mission_intro: {
    id: 'mission_intro',
    title: 'Стратегические миссии',
    description: 'Задай цель → AI создаст 3 стратегии с симуляцией ответа. Выбери лучшую → AI выполнит пошагово и адаптируется.',
    icon: Rocket,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
  },
  // Shown on morning (first session of the day)
  morning_briefing: {
    id: 'morning_briefing',
    title: 'Утренний брифинг',
    description: 'Каждое утро AI анализирует все чаты и подсказывает, кому стоит ответить и что требует внимания.',
    icon: Coffee,
    color: 'text-accent',
    bgColor: 'bg-accent/10 border-accent/20',
  },
}

const STORAGE_KEY = 'neva_feature_tips_seen'

function getSeenTips(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

function markTipSeen(tipId: string) {
  const seen = getSeenTips()
  seen.add(tipId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]))
}

interface FeatureDiscoveryProps {
  tipId: string
  className?: string
  onAction?: () => void
}

export default function FeatureDiscovery({ tipId, className = '', onAction }: FeatureDiscoveryProps) {
  const [visible, setVisible] = useState(false)
  const [animatingOut, setAnimatingOut] = useState(false)

  useEffect(() => {
    const seen = getSeenTips()
    if (!seen.has(tipId)) {
      // Small delay for natural appearance
      const timer = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(timer)
    }
  }, [tipId])

  const tip = TIPS[tipId]
  if (!tip || !visible) return null

  const handleDismiss = () => {
    setAnimatingOut(true)
    markTipSeen(tipId)
    setTimeout(() => setVisible(false), 300)
  }

  const handleAction = () => {
    onAction?.()
    handleDismiss()
  }

  return (
    <div className={`${className} ${animatingOut ? 'animate-fade-out' : 'fade-in'}`}>
      <div className={`border rounded-xl p-3 ${tip.bgColor}`}>
        <div className="flex items-start gap-2.5">
          <div className={`p-1.5 rounded-lg bg-white/5 flex-shrink-0 ${tip.color}`}>
            <tip.icon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-text-primary">{tip.title}</h4>
              <button
                onClick={handleDismiss}
                className="p-0.5 rounded-full hover:bg-white/10 text-text-secondary flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed mt-1">{tip.description}</p>
            {onAction && (
              <button
                onClick={handleAction}
                className={`mt-2 flex items-center gap-1 text-xs font-medium ${tip.color} hover:opacity-80 transition-opacity`}
              >
                Попробовать <ChevronRight size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Compact inline tip — shown as a small badge/chip
 */
export function FeatureHint({ tipId, className = '' }: { tipId: string; className?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const seen = getSeenTips()
    if (!seen.has(tipId)) {
      setVisible(true)
    }
  }, [tipId])

  const tip = TIPS[tipId]
  if (!tip || !visible) return null

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-medium ${className}`}
      onClick={() => { markTipSeen(tipId); setVisible(false) }}
    >
      <Sparkles size={8} />
      new
    </span>
  )
}

/**
 * Reset all tips (for testing or re-onboarding)
 */
export function resetAllTips() {
  localStorage.removeItem(STORAGE_KEY)
}
