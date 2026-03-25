import { Timer, X } from 'lucide-react'

interface DisappearTimerModalProps {
  currentTimer: number | null
  onSet: (seconds: number | null) => void
  onClose: () => void
}

const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '5 minutes', value: 300 },
  { label: '1 hour', value: 3600 },
  { label: '1 day', value: 86400 },
  { label: '1 week', value: 604800 },
]

export default function DisappearTimerModal({ currentTimer, onSet, onClose }: DisappearTimerModalProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] bg-bg-secondary border border-border rounded-2xl shadow-2xl z-50 overflow-hidden fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Timer size={18} className="text-accent" />
            <span className="font-medium text-text-primary">Disappearing Messages</span>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="p-2">
          {TIMER_OPTIONS.map(opt => (
            <button key={opt.label} onClick={() => { onSet(opt.value); onClose() }}
              className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-colors ${
                currentTimer === opt.value ? 'bg-accent/15 text-accent' : 'text-text-primary hover:bg-bg-hover'
              }`}>
              {opt.label}
              {currentTimer === opt.value && <span className="float-right text-accent">✓</span>}
            </button>
          ))}
        </div>
        <p className="px-4 py-3 text-[11px] text-text-secondary border-t border-border">
          Messages will be automatically deleted after the selected time.
        </p>
      </div>
    </>
  )
}
