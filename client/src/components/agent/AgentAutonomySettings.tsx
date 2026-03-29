import { useEffect, useState } from 'react'
import { Shield, Check } from 'lucide-react'
import { useAgentDialogStore } from '../../stores/agentDialogStore'

// Scenario-based settings: human-readable rules
interface Scenario {
  key: string // maps to rel:dtype
  title: string
  description: string
  defaultAction: 'auto_approve' | 'ask_user' | 'auto_deny'
  locked?: boolean // can't change (always ask_user)
}

const SCENARIOS: Scenario[] = [
  {
    key: 'close:whos_free',
    title: 'Близкий друг спрашивает, свободен ли я',
    description: 'Ваш агент ответит автоматически на основе вашего контекста',
    defaultAction: 'auto_approve',
  },
  {
    key: 'friend:whos_free',
    title: 'Друг спрашивает, свободен ли я',
    description: 'Вам придёт уведомление с быстрыми кнопками ответа',
    defaultAction: 'ask_user',
  },
  {
    key: 'acquaintance:whos_free',
    title: 'Знакомый спрашивает, свободен ли я',
    description: 'Вам придёт уведомление для подтверждения',
    defaultAction: 'ask_user',
  },
  {
    key: 'close:get_interests',
    title: 'Близкий друг запрашивает мои интересы',
    description: 'Агент поделится вашими интересами автоматически',
    defaultAction: 'auto_approve',
  },
  {
    key: 'friend:get_interests',
    title: 'Друг запрашивает мои интересы',
    description: 'Агент поделится вашими интересами автоматически',
    defaultAction: 'auto_approve',
  },
  {
    key: 'acquaintance:get_interests',
    title: 'Знакомый запрашивает мои интересы',
    description: 'Вам придёт уведомление для подтверждения',
    defaultAction: 'ask_user',
  },
  {
    key: 'close:match_proposal',
    title: 'Кто-то хочет познакомить через близкого друга',
    description: 'Запросы на знакомство всегда требуют вашего одобрения',
    defaultAction: 'ask_user',
    locked: true,
  },
  {
    key: 'friend:match_proposal',
    title: 'Кто-то хочет познакомить через друга',
    description: 'Запросы на знакомство всегда требуют вашего одобрения',
    defaultAction: 'ask_user',
    locked: true,
  },
  {
    key: 'acquaintance:match_proposal',
    title: 'Кто-то хочет познакомить через знакомого',
    description: 'Запросы на знакомство всегда требуют вашего одобрения',
    defaultAction: 'ask_user',
    locked: true,
  },
]

// Group scenarios by category for cleaner display
const GROUPS = [
  {
    label: 'Кто свободен?',
    emoji: '👋',
    keys: ['close:whos_free', 'friend:whos_free', 'acquaintance:whos_free'],
  },
  {
    label: 'Запрос интересов',
    emoji: '👀',
    keys: ['close:get_interests', 'friend:get_interests', 'acquaintance:get_interests'],
  },
  {
    label: 'Знакомства',
    emoji: '🤝',
    keys: ['close:match_proposal', 'friend:match_proposal', 'acquaintance:match_proposal'],
  },
]

export default function AgentAutonomySettings() {
  const { autonomyRules, loadAutonomyRules, updateAutonomyRules } = useAgentDialogStore()
  const [localRules, setLocalRules] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadAutonomyRules()
  }, [])

  useEffect(() => {
    const map: Record<string, string> = {}
    for (const rule of autonomyRules) {
      map[`${rule.relationshipLevel}:${rule.dialogType}`] = rule.action
    }
    setLocalRules(map)
  }, [autonomyRules])

  function isAutoApprove(key: string): boolean {
    const scenario = SCENARIOS.find(s => s.key === key)
    const currentAction = localRules[key] || scenario?.defaultAction || 'ask_user'
    return currentAction === 'auto_approve'
  }

  function toggleScenario(key: string) {
    const scenario = SCENARIOS.find(s => s.key === key)
    if (scenario?.locked) return

    setLocalRules(prev => ({
      ...prev,
      [key]: prev[key] === 'auto_approve' || (!prev[key] && scenario?.defaultAction === 'auto_approve')
        ? 'ask_user'
        : 'auto_approve',
    }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const rules = Object.entries(localRules).map(([key, action]) => {
      const [relationshipLevel, dialogType] = key.split(':')
      return { relationshipLevel, dialogType, action }
    }) as any[]
    await updateAutonomyRules(rules)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center gap-2 mb-1">
        <Shield size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Как работает ваш агент</h3>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        Настройте, когда агент может действовать самостоятельно
      </p>

      <div className="space-y-5">
        {GROUPS.map(group => (
          <div key={group.label}>
            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <span>{group.emoji}</span>
              {group.label}
            </h4>
            <div className="space-y-1">
              {group.keys.map(key => {
                const scenario = SCENARIOS.find(s => s.key === key)!
                const isAuto = isAutoApprove(key)
                const isLocked = scenario.locked

                return (
                  <button
                    key={key}
                    onClick={() => toggleScenario(key)}
                    disabled={isLocked}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                      isLocked
                        ? 'opacity-60 cursor-not-allowed'
                        : 'hover:bg-bg-hover cursor-pointer'
                    }`}
                  >
                    {/* Toggle */}
                    <div className={`w-10 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                      isAuto ? 'bg-green-500 justify-end' : 'bg-bg-input justify-start'
                    } ${isLocked ? '' : ''}`}>
                      <div className={`w-5 h-5 rounded-full bg-white shadow-sm mx-0.5 flex items-center justify-center transition-all ${
                        isAuto ? 'translate-x-0' : 'translate-x-0'
                      }`}>
                        {isLocked && <Shield size={10} className="text-text-secondary" />}
                      </div>
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary leading-snug">
                        {scenario.title}
                      </div>
                      <div className="text-[11px] text-text-secondary mt-0.5">
                        {isAuto
                          ? 'Отвечать автоматически'
                          : isLocked
                          ? 'Всегда спрашивать (нельзя изменить)'
                          : 'Всегда спрашивать меня'
                        }
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
          saved
            ? 'bg-green-500/20 text-green-400'
            : 'bg-accent/15 text-accent hover:bg-accent/25'
        } disabled:opacity-50`}
      >
        {saving ? 'Сохранение...' : saved ? (
          <span className="flex items-center justify-center gap-1.5">
            <Check size={14} />
            Сохранено
          </span>
        ) : 'Сохранить настройки'}
      </button>
    </div>
  )
}
