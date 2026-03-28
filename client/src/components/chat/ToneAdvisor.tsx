import { useState, useEffect, useRef } from 'react'
import { AlertTriangle, X, Sparkles, Target } from 'lucide-react'
import { api } from '../../lib/api'
import { trackAIAction } from '../AIValueTracker'

interface ToneAdvisorProps {
  chatId: string
  text: string
  onApplySuggestion: (text: string) => void
}

export default function ToneAdvisor({ chatId, text, onApplySuggestion }: ToneAdvisorProps) {
  const [warning, setWarning] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [goalConflict, setGoalConflict] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const lastCheckedRef = useRef('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const dismissCountRef = useRef(0)
  const appliedSuggestionRef = useRef('') // skip re-checking our own suggestion

  useEffect(() => {
    setWarning(null)
    setSuggestion(null)
    setDismissed(false)
  }, [chatId])

  useEffect(() => {
    // Only check if text is long enough and changed significantly
    if (text.length < 25 || dismissed || dismissCountRef.current >= 3) {
      setWarning(null)
      return
    }

    // Don't re-check text that we just suggested (prevents loop)
    if (appliedSuggestionRef.current && text === appliedSuggestionRef.current) {
      appliedSuggestionRef.current = ''
      return
    }

    // Don't recheck if text hasn't changed much
    if (Math.abs(text.length - lastCheckedRef.current.length) < 10 && warning) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      if (text === lastCheckedRef.current) return
      lastCheckedRef.current = text
      setChecking(true)

      try {
        const res = await api.checkTone(chatId, text)
        if (res.needsWarning && res.warning) {
          setWarning(res.warning)
          setSuggestion(res.suggestion || null)
          setGoalConflict(!!(res as any).goalConflict)
          trackAIAction('toneWarningsShown')
        } else {
          setWarning(null)
          setSuggestion(null)
          setGoalConflict(false)
        }
      } catch {
        // Silently fail
      } finally {
        setChecking(false)
      }
    }, 2000) // 2s debounce

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text, chatId, dismissed])

  if (!warning || dismissed) return null

  return (
    <div className={`mx-4 mb-2 rounded-xl px-3 py-2 flex items-center gap-2 fade-in ${
      goalConflict
        ? 'bg-purple-500/10 border border-purple-500/20'
        : 'bg-amber-500/10 border border-amber-500/20'
    }`}>
      {goalConflict
        ? <Target size={14} className="text-purple-400 flex-shrink-0" />
        : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
      }
      <span className={`text-xs flex-1 ${goalConflict ? 'text-purple-300' : 'text-amber-300'}`}>{warning}</span>
      {suggestion && (
        <button
          onClick={() => {
            appliedSuggestionRef.current = suggestion
            lastCheckedRef.current = suggestion
            onApplySuggestion(suggestion)
            setWarning(null)
            trackAIAction('toneSoftened')
          }}
          className="flex items-center gap-1 text-[11px] text-accent bg-accent/10 hover:bg-accent/20 px-2 py-1 rounded-full transition-colors flex-shrink-0"
        >
          <Sparkles size={10} />
          {goalConflict ? 'Back to strategy' : 'Soften'}
        </button>
      )}
      <button
        onClick={() => { setDismissed(true); dismissCountRef.current++ }}
        className="p-0.5 text-text-secondary hover:text-text-primary flex-shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}
