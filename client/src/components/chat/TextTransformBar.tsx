import { useState, useEffect } from 'react'
import { Sparkles, Briefcase, SmilePlus, Minimize2, Maximize2, Languages, CheckCheck, Loader2, Undo2, Theater, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'

interface TextTransformBarProps {
  text: string
  onTransform: (newText: string) => void
  onClose: () => void
  chatId?: string
}

const TRANSFORM_OPTIONS = [
  { mode: 'professional', label: 'Professional', icon: Briefcase, color: 'text-blue-400' },
  { mode: 'casual', label: 'Casual', icon: SmilePlus, color: 'text-yellow-400' },
  { mode: 'shorter', label: 'Shorter', icon: Minimize2, color: 'text-green-400' },
  { mode: 'longer', label: 'Expand', icon: Maximize2, color: 'text-purple-400' },
  { mode: 'fix_grammar', label: 'Fix Grammar', icon: CheckCheck, color: 'text-emerald-400' },
  { mode: 'translate_en', label: 'EN', icon: Languages, color: 'text-orange-400' },
  { mode: 'translate_ru', label: 'RU', icon: Languages, color: 'text-red-400' },
]

interface StyleOption {
  id: string
  label: string
  icon: string
  type: 'preset' | 'profile'
  userId?: string
}

export default function TextTransformBar({ text, onTransform, onClose, chatId }: TextTransformBarProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [originalText] = useState(text)
  const [showStyleMenu, setShowStyleMenu] = useState(false)
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  const [stylesLoaded, setStylesLoaded] = useState(false)

  // Load style options on first open
  useEffect(() => {
    if (showStyleMenu && !stylesLoaded) {
      loadStyles()
    }
  }, [showStyleMenu])

  const loadStyles = async () => {
    try {
      const [presets, profiles] = await Promise.all([
        api.getStylePresets(),
        api.getStyleProfiles(),
      ])

      const options: StyleOption[] = []

      // Add cached profiles first (real people)
      for (const p of profiles.profiles) {
        options.push({
          id: `profile:${p.userId}`,
          label: p.sourceName,
          icon: p.confidence === 'high' ? '✅' : p.confidence === 'medium' ? '⚡' : '⚠️',
          type: 'profile',
          userId: p.userId,
        })
      }

      // Add presets
      for (const p of presets.presets) {
        options.push({
          id: `preset:${p.id}`,
          label: p.name,
          icon: p.icon,
          type: 'preset',
        })
      }

      setStyleOptions(options)
      setStylesLoaded(true)
    } catch (err) {
      console.error('Failed to load styles:', err)
    }
  }

  const handleTransform = async (mode: string) => {
    if (loading) return
    setLoading(mode)

    try {
      const res = await api.transformText({ text, mode })
      if (res.result) {
        onTransform(res.result)
      }
    } catch (err) {
      console.error('Transform failed:', err)
    } finally {
      setLoading(null)
    }
  }

  const handleStyleGenerate = async (option: StyleOption) => {
    if (loading || !chatId) return
    setLoading(option.id)
    setShowStyleMenu(false)

    try {
      const params: any = { chatId, intent: text }
      if (option.type === 'preset') {
        params.presetId = option.id.replace('preset:', '')
      } else {
        params.targetUserId = option.userId
      }

      const res = await api.generateStyled(params)
      if (res.reply) {
        onTransform(res.reply)
      }
    } catch (err) {
      console.error('Style generation failed:', err)
    } finally {
      setLoading(null)
    }
  }

  const handleUndo = () => {
    onTransform(originalText)
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mx-2 mb-1 fade-in">
      <div className="bg-bg-secondary/95 backdrop-blur-sm border border-border rounded-xl px-3 py-2 shadow-xl">
        <div className="flex items-center gap-1 mb-1.5">
          <Sparkles size={12} className="text-accent" />
          <span className="text-[11px] text-text-secondary font-medium">Rewrite before sending</span>
          <div className="flex-1" />
          {text !== originalText && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent transition-colors"
            >
              <Undo2 size={11} />
              Undo
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          {TRANSFORM_OPTIONS.map(opt => (
            <button
              key={opt.mode}
              onClick={() => handleTransform(opt.mode)}
              disabled={!!loading}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-all ${
                loading === opt.mode
                  ? 'bg-accent/15 text-accent'
                  : 'bg-bg-input hover:bg-bg-hover text-text-secondary hover:text-text-primary'
              } disabled:opacity-50`}
            >
              {loading === opt.mode ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <opt.icon size={12} className={opt.color} />
              )}
              {opt.label}
            </button>
          ))}

          {/* Style dropdown button */}
          {chatId && (
            <div className="relative">
              <button
                onClick={() => setShowStyleMenu(!showStyleMenu)}
                disabled={!!loading}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-all ${
                  showStyleMenu || loading?.startsWith('preset:') || loading?.startsWith('profile:')
                    ? 'bg-accent/15 text-accent'
                    : 'bg-bg-input hover:bg-bg-hover text-text-secondary hover:text-text-primary'
                } disabled:opacity-50`}
              >
                {loading?.startsWith('preset:') || loading?.startsWith('profile:') ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Theater size={12} className="text-pink-400" />
                )}
                Write as...
                <ChevronDown size={10} className={`transition-transform ${showStyleMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown menu */}
              {showStyleMenu && (
                <div className="absolute bottom-full left-0 mb-1 w-52 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden z-50">
                  <div className="max-h-60 overflow-y-auto">
                    {styleOptions.length === 0 && !stylesLoaded && (
                      <div className="px-3 py-2 text-[11px] text-text-secondary flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" />
                        Loading styles...
                      </div>
                    )}
                    {styleOptions.filter(o => o.type === 'profile').length > 0 && (
                      <div className="px-3 py-1.5 text-[10px] text-text-secondary uppercase font-semibold tracking-wider bg-bg-input/50">
                        From chats
                      </div>
                    )}
                    {styleOptions.filter(o => o.type === 'profile').map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => handleStyleGenerate(opt)}
                        className="w-full px-3 py-2 text-left text-[12px] hover:bg-bg-hover transition-colors flex items-center gap-2"
                      >
                        <span>{opt.icon}</span>
                        <span className="text-text-primary">{opt.label}</span>
                      </button>
                    ))}
                    <div className="px-3 py-1.5 text-[10px] text-text-secondary uppercase font-semibold tracking-wider bg-bg-input/50">
                      Presets
                    </div>
                    {styleOptions.filter(o => o.type === 'preset').map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => handleStyleGenerate(opt)}
                        className="w-full px-3 py-2 text-left text-[12px] hover:bg-bg-hover transition-colors flex items-center gap-2"
                      >
                        <span>{opt.icon}</span>
                        <span className="text-text-primary">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
