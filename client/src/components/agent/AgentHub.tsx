import { useState, useEffect } from 'react'
import { Users, Search, ChevronRight, Undo2, CheckCircle, XCircle, Loader2, MapPin, Calendar, PartyPopper, X, Send, Heart, UserPlus, MessageCircle, Bell } from 'lucide-react'
import { useAgentHubStore } from '../../stores/agentHubStore'
import type { AgentActivity, GatherStatus } from '../../stores/agentHubStore'

// ── Undo Button with countdown ──────────────────────────────────────────────

function UndoButton({ activity }: { activity: AgentActivity }) {
  const { requestUndo } = useAgentHubStore()
  const [remaining, setRemaining] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activity.undoDeadline || activity.undoneAt) return
    const deadline = new Date(activity.undoDeadline).getTime()
    const tick = () => {
      const left = Math.max(0, deadline - Date.now())
      setRemaining(left)
      if (left <= 0) return
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [activity.undoDeadline, activity.undoneAt])

  if (!activity.undoable || activity.undoneAt || remaining <= 0) return null

  const mins = Math.floor(remaining / 60000)
  const secs = Math.floor((remaining % 60000) / 1000)

  const handleUndo = async () => {
    setLoading(true)
    await requestUndo(activity.id)
    setLoading(false)
  }

  return (
    <button
      onClick={handleUndo}
      disabled={loading}
      className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition"
    >
      <Undo2 className="w-3 h-3" />
      {loading ? '...' : `${mins}:${secs.toString().padStart(2, '0')}`}
    </button>
  )
}

// ── Activity Card ───────────────────────────────────────────────────────────

function ActivityItem({ activity }: { activity: AgentActivity }) {
  const icon = activity.type === 'auto_response'
    ? (activity.metadata?.decision === 'deny' ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <CheckCircle className="w-3.5 h-3.5 text-green-400" />)
    : activity.type === 'gather_started' ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
    : activity.type === 'gather_result' ? <PartyPopper className="w-3.5 h-3.5 text-purple-400" />
    : activity.type === 'intro_requested' ? <UserPlus className="w-3.5 h-3.5 text-blue-400" />
    : activity.type === 'intro_complete' ? <UserPlus className="w-3.5 h-3.5 text-green-400" />
    : activity.type === 'interest_poll_started' ? <MessageCircle className="w-3.5 h-3.5 text-cyan-400" />
    : activity.type === 'interest_poll_result' ? <MessageCircle className="w-3.5 h-3.5 text-cyan-300" />
    : activity.type === 'nudge' && activity.metadata?.trigger === 'mood' ? <Heart className="w-3.5 h-3.5 text-pink-400" />
    : activity.type === 'nudge' && activity.metadata?.trigger === 'detected_need' ? <Users className="w-3.5 h-3.5 text-cyan-400" />
    : activity.type === 'nudge' ? <Bell className="w-3.5 h-3.5 text-amber-400" />
    : activity.type === 'undo' ? <Undo2 className="w-3.5 h-3.5 text-gray-400" />
    : <CheckCircle className="w-3.5 h-3.5 text-gray-400" />

  const isUndone = !!activity.undoneAt

  return (
    <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/3 ${isUndone ? 'opacity-40 line-through' : ''}`}>
      {icon}
      <span className="text-xs text-gray-300 flex-1 truncate">{activity.title}</span>
      <span className="text-[10px] text-gray-500 shrink-0">
        {timeAgo(activity.createdAt)}
      </span>
      {!isUndone && <UndoButton activity={activity} />}
    </div>
  )
}

// ── Gather Progress (inline) ────────────────────────────────────────────────

function GatherProgress({ gather, onCancel }: { gather: GatherStatus; onCancel: () => void }) {
  const { confirmGather } = useAgentHubStore()
  const [editPlan, setEditPlan] = useState(false)
  const [planWhat, setPlanWhat] = useState('')
  const [planWhen, setPlanWhen] = useState('')
  const [planWhere, setPlanWhere] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (gather.plan) {
      setPlanWhat(gather.plan.what)
      setPlanWhen(gather.plan.when)
      setPlanWhere(gather.plan.where || '')
    }
  }, [gather.plan])

  const total = gather.available.length + gather.unavailable.length + gather.pending
  const progress = total > 0 ? ((gather.available.length + gather.unavailable.length) / total) * 100 : 0

  const handleConfirm = async () => {
    setConfirming(true)
    await confirmGather(gather.parentDialogId, {
      what: planWhat || gather.plan?.what || gather.context,
      when: planWhen || gather.plan?.when || '',
      where: planWhere || gather.plan?.where,
    })
    setConfirming(false)
  }

  // Phase: asking
  if (gather.phase === 'asking') {
    return (
      <div className="mx-4 mb-3 rounded-xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-emerald-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Loader2 className="w-4 h-4 animate-spin text-green-400" />
          Собираю компанию
        </div>
        <p className="text-xs text-gray-400 mt-1 italic">"{gather.context}"</p>

        <div className="mt-3 space-y-1.5">
          {gather.available.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-xs">
              <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span className="font-medium text-white w-16 truncate">{f.name}</span>
              <span className="text-green-300 flex-1 truncate">{f.message || 'свободен'}</span>
            </div>
          ))}
          {gather.unavailable.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-xs">
              <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span className="font-medium text-white w-16 truncate">{f.name}</span>
              <span className="text-red-300">занят</span>
            </div>
          ))}
          {Array.from({ length: gather.pending }).map((_, i) => (
            <div key={`p${i}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-xs">
              <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin shrink-0" />
              <span className="text-gray-500">ожидаем...</span>
            </div>
          ))}
        </div>

        <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <button onClick={onCancel} className="mt-2 text-xs text-gray-500 hover:text-gray-300 transition">
          Отменить
        </button>
      </div>
    )
  }

  // Phase: confirming (plan ready)
  if (gather.phase === 'confirming' || gather.phase === 'planning') {
    return (
      <div className="mx-4 mb-3 rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-pink-500/10 p-4">
        <div className="flex items-center gap-2 text-base font-semibold text-white">
          <PartyPopper className="w-5 h-5 text-purple-400" />
          Компания собрана!
        </div>
        <p className="text-sm text-gray-400 mt-1">{gather.available.length} из {gather.friendsAsked} свободны</p>

        {gather.plan && !editPlan && (
          <div className="mt-3 bg-white/5 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-gray-200">
              <MapPin className="w-3.5 h-3.5" /> {gather.plan.what}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-200">
              <Calendar className="w-3.5 h-3.5" /> {gather.plan.when}
            </div>
            {gather.plan.where && (
              <div className="flex items-center gap-2 text-sm text-gray-200">
                <MapPin className="w-3.5 h-3.5" /> {gather.plan.where}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-200">
              <Users className="w-3.5 h-3.5" /> {gather.available.map(f => f.name).join(', ')}
            </div>
          </div>
        )}

        {editPlan && (
          <div className="mt-3 space-y-2">
            <input value={planWhat} onChange={e => setPlanWhat(e.target.value)} placeholder="Что"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            <input value={planWhen} onChange={e => setPlanWhen(e.target.value)} placeholder="Когда"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            <input value={planWhere} onChange={e => setPlanWhere(e.target.value)} placeholder="Где"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="w-full h-[44px] bg-green-500 hover:bg-green-400 text-white rounded-xl font-medium text-sm transition mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Подтвердить
        </button>

        <div className="flex gap-2 mt-2">
          <button onClick={() => setEditPlan(!editPlan)}
            className="flex-1 h-[36px] bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl text-xs font-medium transition">
            {editPlan ? 'Готово' : 'Изменить'}
          </button>
          <button onClick={onCancel}
            className="flex-1 h-[36px] bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl text-xs font-medium transition">
            Отменить
          </button>
        </div>
      </div>
    )
  }

  // Phase: complete
  return null
}

// ── Filter Chips ────────────────────────────────────────────────────────────

const ACTIVITY_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'auto_response', label: 'Авто-ответы' },
  { key: 'gather', label: 'Сборы' },
  { key: 'nudge', label: 'Подсказки' },
  { key: 'intro', label: 'Знакомства' },
  { key: 'interest', label: 'Опросы' },
] as const

function matchesFilter(a: AgentActivity, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'auto_response') return a.type === 'auto_response'
  if (filter === 'gather') return a.type === 'gather_started' || a.type === 'gather_result'
  if (filter === 'nudge') return a.type === 'nudge'
  if (filter === 'intro') return a.type === 'intro_requested' || a.type === 'intro_complete'
  if (filter === 'interest') return a.type === 'interest_poll_started' || a.type === 'interest_poll_result'
  return true
}

// ── Activity Feed Sheet ─────────────────────────────────────────────────────

function ActivityFeedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activities, loadActivities } = useAgentHubStore()
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (open) loadActivities(100)
  }, [open])

  if (!open) return null

  const filtered = activities.filter(a => matchesFilter(a, filter))

  // Stats
  const autoCount = activities.filter(a => a.type === 'auto_response' && !a.undoneAt).length
  const undoneCount = activities.filter(a => a.undoneAt).length
  const totalCount = activities.length

  // Group by date
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()

  const grouped: Record<string, AgentActivity[]> = {}
  for (const a of filtered) {
    const dateStr = new Date(a.createdAt).toDateString()
    const label = dateStr === today ? 'СЕГОДНЯ' : dateStr === yesterday ? 'ВЧЕРА' : new Date(a.createdAt).toLocaleDateString('ru')
    if (!grouped[label]) grouped[label] = []
    grouped[label].push(a)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] bg-[#1a1a2e] rounded-t-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-600 rounded-full mx-auto mt-3" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <h3 className="text-base font-semibold text-white">Действия агента</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats bar */}
        {totalCount > 0 && (
          <div className="flex gap-3 px-5 pb-2">
            <span className="text-[10px] text-gray-500">
              Всего: <span className="text-gray-300">{totalCount}</span>
            </span>
            <span className="text-[10px] text-gray-500">
              Авто: <span className="text-green-400">{autoCount}</span>
            </span>
            {undoneCount > 0 && (
              <span className="text-[10px] text-gray-500">
                Отменено: <span className="text-amber-400">{undoneCount}</span>
              </span>
            )}
          </div>
        )}

        {/* Filter chips */}
        <div className="flex gap-1.5 px-5 pb-3 overflow-x-auto no-scrollbar">
          {ACTIVITY_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                filter === f.key
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-safe">
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label} className="mb-4">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{label}</div>
              <div className="space-y-2">
                {items.map(a => <ActivityItem key={a.id} activity={a} />)}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-gray-500 py-12 text-sm">
              {filter === 'all' ? 'Агент ещё ничего не делал' : 'Нет действий этого типа'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Agent Hub ──────────────────────────────────────────────────────────

export default function AgentHub({ findPersonSlot }: { findPersonSlot?: React.ReactNode }) {
  const { activities, currentGather, loadActivities, loadPendingCount, cancelGather, clearGather } = useAgentHubStore()
  const [gatherInput, setGatherInput] = useState('')
  const [gatherOpen, setGatherOpen] = useState(false)
  const [gatherLoading, setGatherLoading] = useState(false)
  const [feedOpen, setFeedOpen] = useState(false)
  const { startGather } = useAgentHubStore()

  useEffect(() => {
    loadActivities()
    loadPendingCount()
  }, [])

  const handleStartGather = async () => {
    if (!gatherInput.trim()) return
    setGatherLoading(true)
    await startGather(gatherInput.trim())
    setGatherInput('')
    setGatherOpen(false)
    setGatherLoading(false)
  }

  const recentActivities = activities.filter(a => !a.undoneAt).slice(0, 3)

  // If gather is in progress, show progress instead of hub
  if (currentGather && currentGather.phase !== 'complete') {
    return (
      <GatherProgress
        gather={currentGather}
        onCancel={() => {
          cancelGather(currentGather.parentDialogId)
          clearGather()
        }}
      />
    )
  }

  return (
    <>
      {/* Quick Action Cards */}
      <div className="flex gap-3 px-4 mb-3">
        {!gatherOpen ? (
          <button
            onClick={() => setGatherOpen(true)}
            className="flex-1 flex flex-col gap-1 p-3 h-[72px] rounded-xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 hover:border-green-400/40 transition-all active:scale-[0.98]"
          >
            <span className="text-lg">👋</span>
            <span className="text-sm font-medium text-green-400">Собрать компанию</span>
          </button>
        ) : (
          <div className="flex-1 flex gap-2">
            <input
              value={gatherInput}
              onChange={e => setGatherInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStartGather()}
              placeholder="Пятница вечером, бар..."
              autoFocus
              disabled={gatherLoading}
              className="flex-1 bg-bg-secondary border border-green-500/30 rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-green-400/50 disabled:opacity-50"
            />
            <button onClick={handleStartGather} disabled={gatherLoading || !gatherInput.trim()}
              className="p-2.5 rounded-xl bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-40 transition-colors">
              {gatherLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
            <button onClick={() => setGatherOpen(false)}
              className="p-2.5 rounded-xl text-text-secondary hover:bg-bg-hover transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {!gatherOpen && findPersonSlot}
      </div>

      {/* Activity Preview */}
      {recentActivities.length > 0 && (
        <div className="mx-4 mb-3 bg-white/5 rounded-xl p-3">
          <button
            onClick={() => setFeedOpen(true)}
            className="flex items-center justify-between w-full mb-2"
          >
            <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              🤖 Агент сегодня
            </span>
            <span className="text-xs text-purple-400 flex items-center gap-1">
              {activities.length} <ChevronRight className="w-3 h-3" />
            </span>
          </button>
          <div className="space-y-1.5">
            {recentActivities.map(a => <ActivityItem key={a.id} activity={a} />)}
          </div>
        </div>
      )}

      <ActivityFeedSheet open={feedOpen} onClose={() => setFeedOpen(false)} />
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000) return 'сейчас'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}м`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}ч`
  return `${Math.floor(diff / 86400000)}д`
}
