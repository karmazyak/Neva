import { useState, useEffect } from 'react'
import { Shield, Eye, EyeOff, Plus, X, Loader2 } from 'lucide-react'
import { useNetworkStore } from '../../stores/networkStore'

const DATA_TYPES = [
  { key: 'shareInterests', label: 'Интересы', desc: 'Чем увлекаетесь', icon: '🎯' },
  { key: 'shareExpertise', label: 'Экспертиза', desc: 'Что умеете', icon: '💼' },
  { key: 'shareAvailability', label: 'Доступность', desc: 'Свободны ли вы', icon: '📅' },
  { key: 'shareMood', label: 'Настроение', desc: 'Как у вас дела', icon: '😊' },
  { key: 'shareFacts', label: 'Факты', desc: 'Детали из переписок', icon: '📝' },
] as const

export default function PrivacyVaultSettings() {
  const { vault, loadVault, updateVault } = useNetworkStore()
  const [loading, setLoading] = useState(false)
  const [newInterest, setNewInterest] = useState('')
  const [newExpertise, setNewExpertise] = useState('')

  useEffect(() => {
    loadVault()
  }, [])

  if (!vault) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-text-secondary" />
      </div>
    )
  }

  const handleToggle = async (key: string, value: boolean) => {
    setLoading(true)
    await updateVault({ [key]: value })
    setLoading(false)
  }

  const addInterest = async () => {
    if (!newInterest.trim()) return
    const updated = [...(vault.publicInterests || []), newInterest.trim()]
    await updateVault({ publicInterests: updated })
    setNewInterest('')
  }

  const removeInterest = async (interest: string) => {
    const updated = (vault.publicInterests || []).filter(i => i !== interest)
    await updateVault({ publicInterests: updated })
  }

  const addExpertise = async () => {
    if (!newExpertise.trim()) return
    const updated = [...(vault.publicExpertise || []), newExpertise.trim()]
    await updateVault({ publicExpertise: updated })
    setNewExpertise('')
  }

  const removeExpertise = async (exp: string) => {
    const updated = (vault.publicExpertise || []).filter(e => e !== exp)
    await updateVault({ publicExpertise: updated })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Shield size={16} className="text-green-400" />
        <h3 className="text-sm font-semibold text-text-primary">Privacy Vault</h3>
        <span className="text-[10px] text-text-secondary ml-auto">Что агент может раскрыть</span>
      </div>

      {/* Toggle switches */}
      <div className="space-y-1">
        {DATA_TYPES.map(dt => {
          const enabled = vault[dt.key as keyof typeof vault] as boolean
          return (
            <div
              key={dt.key}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-bg-hover/50 border border-border"
            >
              <span className="text-base">{dt.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-text-primary">{dt.label}</div>
                <div className="text-[10px] text-text-secondary">{dt.desc}</div>
              </div>
              <button
                onClick={() => handleToggle(dt.key, !enabled)}
                disabled={loading}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  enabled ? 'bg-green-500/40' : 'bg-white/10'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                    enabled
                      ? 'translate-x-5 bg-green-400'
                      : 'translate-x-0.5 bg-white/40'
                  }`}
                />
              </button>
              {enabled
                ? <Eye size={14} className="text-green-400 shrink-0" />
                : <EyeOff size={14} className="text-text-secondary shrink-0" />
              }
            </div>
          )
        })}
      </div>

      {/* Public Interests */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-text-secondary px-1">Публичные интересы</div>
        <div className="flex flex-wrap gap-1.5 px-1">
          {(vault.publicInterests || []).map(interest => (
            <span
              key={interest}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20"
            >
              {interest}
              <button onClick={() => removeInterest(interest)} className="hover:text-red-400">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5 px-1">
          <input
            type="text"
            value={newInterest}
            onChange={e => setNewInterest(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addInterest()}
            placeholder="Добавить интерес..."
            className="flex-1 text-[11px] bg-bg-primary rounded-lg px-2.5 py-1.5 text-text-primary placeholder:text-text-secondary focus:outline-none border border-border"
          />
          <button
            onClick={addInterest}
            disabled={!newInterest.trim()}
            className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 disabled:opacity-30"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Public Expertise */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-text-secondary px-1">Публичная экспертиза</div>
        <div className="flex flex-wrap gap-1.5 px-1">
          {(vault.publicExpertise || []).map(exp => (
            <span
              key={exp}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/20"
            >
              {exp}
              <button onClick={() => removeExpertise(exp)} className="hover:text-red-400">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5 px-1">
          <input
            type="text"
            value={newExpertise}
            onChange={e => setNewExpertise(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addExpertise()}
            placeholder="Добавить экспертизу..."
            className="flex-1 text-[11px] bg-bg-primary rounded-lg px-2.5 py-1.5 text-text-primary placeholder:text-text-secondary focus:outline-none border border-border"
          />
          <button
            onClick={addExpertise}
            disabled={!newExpertise.trim()}
            className="p-1.5 rounded-lg bg-purple-500/15 text-purple-400 disabled:opacity-30"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="px-2 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
        <p className="text-[10px] text-amber-300/70 leading-relaxed">
          Ваш агент знает всё, но рассказывает только то, что вы разрешили.
          Отключённые типы данных будут скрыты от запросов других агентов.
        </p>
      </div>
    </div>
  )
}
