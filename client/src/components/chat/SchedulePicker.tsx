import { useState } from 'react'
import { Clock, X } from 'lucide-react'

interface SchedulePickerProps {
  onSchedule: (date: Date) => void
  onClose: () => void
}

export default function SchedulePicker({ onSchedule, onClose }: SchedulePickerProps) {
  const [customDate, setCustomDate] = useState('')
  const [customTime, setCustomTime] = useState('')

  const presets = [
    { label: 'Tonight 20:00', getDate: () => { const d = new Date(); d.setHours(20, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d } },
    { label: 'Tomorrow 9:00', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d } },
    { label: 'Monday 9:00', getDate: () => { const d = new Date(); const day = d.getDay(); const diff = day === 0 ? 1 : day === 1 ? 7 : 8 - day; d.setDate(d.getDate() + diff); d.setHours(9, 0, 0, 0); return d } },
  ]

  const handleCustom = () => {
    if (!customDate || !customTime) return
    const date = new Date(`${customDate}T${customTime}`)
    if (date > new Date()) onSchedule(date)
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mx-4 mb-2 bg-bg-secondary border border-border rounded-xl shadow-xl z-40 overflow-hidden fade-in">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Schedule Message</span>
        </div>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={16} /></button>
      </div>
      <div className="p-2 space-y-1">
        {presets.map(p => (
          <button key={p.label} onClick={() => onSchedule(p.getDate())}
            className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors text-text-primary">
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-2 px-3 py-2">
          <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
            className="flex-1 bg-bg-input rounded-lg px-2 py-1.5 text-sm text-text-primary" />
          <input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)}
            className="bg-bg-input rounded-lg px-2 py-1.5 text-sm text-text-primary" />
          <button onClick={handleCustom}
            className="px-3 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover">Set</button>
        </div>
      </div>
    </div>
  )
}
