import { useState, useEffect } from 'react'
import { Sparkles, TrendingUp, MessageSquare, Shield, Brain, Rocket, Heart, ChevronRight, X } from 'lucide-react'

/**
 * AIValueTracker — shows users how AI has been helping them.
 * Tracks actions in localStorage and displays a summary.
 * This creates a feedback loop: users see AI's value growing over time.
 */

interface AIStats {
  briefingsViewed: number
  missionsLaunched: number
  toneWarningsShown: number
  toneSoftened: number
  contextPanelOpened: number
  simulationsRun: number
  replySuggestionsUsed: number
  nudgesActedOn: number
  totalInteractions: number
  firstUse: string | null
}

const STORAGE_KEY = 'neva_ai_stats'

function getStats(): AIStats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : defaultStats()
  } catch {
    return defaultStats()
  }
}

function defaultStats(): AIStats {
  return {
    briefingsViewed: 0,
    missionsLaunched: 0,
    toneWarningsShown: 0,
    toneSoftened: 0,
    contextPanelOpened: 0,
    simulationsRun: 0,
    replySuggestionsUsed: 0,
    nudgesActedOn: 0,
    totalInteractions: 0,
    firstUse: null,
  }
}

/**
 * Call this from anywhere in the app to track an AI action.
 */
export function trackAIAction(action: keyof Omit<AIStats, 'totalInteractions' | 'firstUse'>) {
  const stats = getStats()
  stats[action] = (stats[action] as number) + 1
  stats.totalInteractions += 1
  if (!stats.firstUse) stats.firstUse = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
}

interface AIValueTrackerProps {
  compact?: boolean
  className?: string
}

export default function AIValueTracker({ compact = false, className = '' }: AIValueTrackerProps) {
  const [stats, setStats] = useState<AIStats>(defaultStats())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setStats(getStats())
  }, [])

  const total = stats.totalInteractions
  const daysSinceStart = stats.firstUse
    ? Math.max(1, Math.floor((Date.now() - new Date(stats.firstUse).getTime()) / 86400000))
    : 0

  // Don't show if no interactions yet
  if (total === 0) {
    return compact ? null : (
      <div className={`bg-bg-secondary/50 border border-border/50 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">AI ещё учится</span>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          Пользуйся Neva, и AI станет умнее — начни с утреннего брифинга или запусти миссию в переговорах.
        </p>
        <div className="mt-3 flex gap-1">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex-1 h-1 rounded-full bg-bg-input" />
          ))}
        </div>
        <p className="text-[10px] text-text-secondary mt-1">0 / 5 AI-действий для персонализации</p>
      </div>
    )
  }

  const highlights = [
    stats.briefingsViewed > 0 && { icon: Sparkles, label: 'Брифингов', count: stats.briefingsViewed, color: 'text-accent' },
    stats.missionsLaunched > 0 && { icon: Rocket, label: 'Миссий', count: stats.missionsLaunched, color: 'text-purple-400' },
    stats.toneSoftened > 0 && { icon: Shield, label: 'Смягчений', count: stats.toneSoftened, color: 'text-amber-400' },
    stats.contextPanelOpened > 0 && { icon: Brain, label: 'Анализов', count: stats.contextPanelOpened, color: 'text-accent' },
    stats.simulationsRun > 0 && { icon: MessageSquare, label: 'Симуляций', count: stats.simulationsRun, color: 'text-purple-400' },
    stats.nudgesActedOn > 0 && { icon: Heart, label: 'Напоминаний', count: stats.nudgesActedOn, color: 'text-pink-400' },
  ].filter(Boolean) as { icon: React.ElementType; label: string; count: number; color: string }[]

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-text-secondary ${className}`}>
        <TrendingUp size={12} className="text-accent" />
        <span>{total} AI-действий</span>
        {daysSinceStart > 0 && <span>за {daysSinceStart}д</span>}
      </div>
    )
  }

  return (
    <div className={`bg-bg-secondary/50 border border-border/50 rounded-xl overflow-hidden ${className}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-bg-hover/50 transition-colors"
      >
        <TrendingUp size={16} className="text-accent flex-shrink-0" />
        <div className="flex-1 text-left">
          <span className="text-sm font-medium text-text-primary">
            {total} AI-действий
          </span>
          {daysSinceStart > 0 && (
            <span className="text-xs text-text-secondary ml-1.5">
              за {daysSinceStart} {daysSinceStart === 1 ? 'день' : daysSinceStart < 5 ? 'дня' : 'дней'}
            </span>
          )}
        </div>
        <ChevronRight size={14} className={`text-text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 fade-in border-t border-border/50">
          <div className="grid grid-cols-2 gap-2 pt-2">
            {highlights.map(({ icon: Icon, label, count, color }) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <Icon size={12} className={color} />
                <span className="text-text-secondary">{label}:</span>
                <span className="text-text-primary font-medium">{count}</span>
              </div>
            ))}
          </div>

          {/* Progress bar toward personalization */}
          <div className="mt-2">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={`flex-1 h-1 rounded-full ${total >= i * 5 ? 'bg-accent' : 'bg-bg-input'}`} />
              ))}
            </div>
            <p className="text-[10px] text-text-secondary mt-1">
              {total >= 25
                ? 'AI полностью адаптирован под тебя'
                : `${Math.min(total, 25)} / 25 действий до полной персонализации`
              }
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
