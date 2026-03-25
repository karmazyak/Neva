import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useChatStore } from '../stores/chatStore'
import { useAgentStore } from '../stores/agentStore'
import {
  ArrowLeft,
  Zap,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  Sparkles,
  Play,
  Loader2,
} from 'lucide-react'

interface Trigger {
  id: string
  name: string
  event: string
  condition: any
  action: any
  outputMode: string
  enabled: boolean
  chatId: string | null
}

interface FullSkillInfo {
  id: string
  command: string
  name: string
  icon: string
  inputDescription: string
  outputDescription: string
}

const EVENT_OPTIONS = [
  { value: 'on_audio', label: 'Audio received', icon: '🎤' },
  { value: 'on_image', label: 'Image received', icon: '🖼️' },
  { value: 'on_message', label: 'Any message', icon: '💬' },
  { value: 'on_message_from', label: 'Message from user', icon: '👤' },
  { value: 'on_keyword', label: 'Keyword detected', icon: '#️⃣' },
]

const EVENT_ICONS: Record<string, string> = {
  on_audio: '🎤',
  on_image: '🖼️',
  on_message: '💬',
  on_message_from: '👤',
  on_keyword: '#️⃣',
}

const OUTPUT_MODES = [
  { value: 'ghost', label: 'Only me', icon: '👁️', desc: 'Only you see the result' },
  { value: 'normal', label: 'Send to chat', icon: '💬', desc: 'Everyone in chat sees it' },
]

const PRESETS = [
  {
    name: 'Auto-transcribe audio',
    event: 'on_audio',
    skillId: 'stt',
    outputMode: 'ghost',
    desc: 'Automatically transcribe voice messages',
  },
  {
    name: 'Smart reply suggestions',
    event: 'on_message',
    skillId: 'text_reply',
    outputMode: 'ghost',
    desc: 'Suggest reply variants for messages',
  },
]

export default function Triggers() {
  const navigate = useNavigate()
  const { chats, loadChats } = useChatStore()
  const { mySkills, loadMySkills } = useAgentStore()
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [fullSkillList, setFullSkillList] = useState<FullSkillInfo[]>([])
  const [runningTriggerId, setRunningTriggerId] = useState<string | null>(null)

  // Create form — WHEN
  const [event, setEvent] = useState('on_audio')
  const [chatId, setChatId] = useState('')
  const [fromUserId, setFromUserId] = useState('')
  const [keyword, setKeyword] = useState('')

  // Create form — THEN
  const [selectedSkillId, setSelectedSkillId] = useState('')

  // Create form — OUTPUT
  const [outputMode, setOutputMode] = useState('ghost')

  useEffect(() => {
    loadTriggers()
    loadChats()
    loadMySkills()
    api.getAvailableSkills().then(setFullSkillList).catch(() => setFullSkillList([]))
  }, [])

  // Build enriched skill list from mySkills + fullSkillList
  const enrichedSkills = useMemo(() => {
    return mySkills.map(ms => {
      const full = fullSkillList.find(f => f.id === ms.id)
      return {
        ...ms,
        inputDescription: full?.inputDescription || '',
        outputDescription: full?.outputDescription || '',
      }
    })
  }, [mySkills, fullSkillList])

  // Selected skill info
  const selectedSkill = useMemo(() => {
    return enrichedSkills.find(s => s.id === selectedSkillId)
  }, [selectedSkillId, enrichedSkills])

  // Chat members for "from" dropdown
  const [chatMembers, setChatMembers] = useState<any[]>([])
  useEffect(() => {
    if (chatId) {
      const chat = chats.find(c => c.id === chatId) as any
      if (chat?.members) {
        setChatMembers(chat.members)
      } else {
        setChatMembers([])
      }
    } else {
      setChatMembers([])
      setFromUserId('')
    }
  }, [chatId, chats])

  const loadTriggers = async () => {
    try {
      const data = await api.getTriggers()
      setTriggers(data)
    } catch {
      setTriggers([])
    }
  }

  const handleToggle = async (id: string) => {
    await api.toggleTrigger(id)
    loadTriggers()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this trigger?')) return
    await api.deleteTrigger(id)
    loadTriggers()
  }

  const handleCreate = async () => {
    if (!selectedSkillId) return

    const skill = enrichedSkills.find(s => s.id === selectedSkillId)
    if (!skill) return

    const eventLabel = EVENT_OPTIONS.find(e => e.value === event)?.label || event
    const triggerName = `${eventLabel} → ${skill.command}`

    const condition: any = {}
    if (event === 'on_keyword' && keyword) condition.keyword = keyword
    if (event === 'on_message_from' && fromUserId) condition.fromUserId = fromUserId
    if (chatId) condition.chatId = chatId

    const action: any = {
      type: 'skill',
      skillId: selectedSkillId,
      skillCommand: skill.command,
    }

    await api.createTrigger({
      name: triggerName,
      event,
      condition: Object.keys(condition).length ? condition : undefined,
      action,
      outputMode,
      chatId: chatId || undefined,
    })

    setShowCreate(false)
    resetForm()
    loadTriggers()
  }

  const resetForm = () => {
    setEvent('on_audio')
    setChatId('')
    setFromUserId('')
    setKeyword('')
    setSelectedSkillId('')
    setOutputMode('ghost')
  }

  const handlePreset = (preset: typeof PRESETS[0]) => {
    setShowCreate(true)
    setEvent(preset.event)
    setSelectedSkillId(preset.skillId)
    setOutputMode(preset.outputMode)
    setChatId('')
    setFromUserId('')
    setKeyword('')
  }

  const getSkillLabel = (action: any) => {
    if (action?.skillCommand) return action.skillCommand
    if (action?.skillId) {
      const skill = fullSkillList.find(s => s.id === action.skillId)
      return skill?.command || action.skillId
    }
    if (action?.type === 'stt') return '/transcribe'
    if (action?.type === 'agent_reply') return '/reply'
    return action?.type || 'action'
  }

  const getOutputIcon = (mode: string) => {
    const m = OUTPUT_MODES.find(o => o.value === mode)
    return m?.icon || '👻'
  }

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="p-1 text-text-secondary hover:text-text-primary">
          <ArrowLeft size={22} />
        </button>
        <Zap size={22} className="text-accent" />
        <h1 className="text-lg font-semibold text-text-primary">Triggers</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Quick presets */}
        <div className="space-y-2">
          <h2 className="text-sm text-text-secondary font-medium">Quick Setup</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handlePreset(preset)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-bg-input hover:bg-bg-hover transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <Zap size={18} className="text-accent" />
                </div>
                <div>
                  <div className="text-sm font-medium text-text-primary">{preset.name}</div>
                  <div className="text-[11px] text-text-secondary">{preset.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Create trigger */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-text-secondary font-medium">My Triggers</h2>
            <button
              onClick={() => { setShowCreate(!showCreate); if (!showCreate) resetForm() }}
              className="flex items-center gap-1.5 text-accent text-sm hover:underline"
            >
              <Plus size={14} />
              Create
            </button>
          </div>

          {/* Visual flow: When → Then → Output */}
          {showCreate && (
            <div className="space-y-0 fade-in">
              {/* WHEN card */}
              <div className="bg-bg-secondary border border-blue-500/30 rounded-xl p-4 space-y-3" >
                <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
                  <span>🔔</span>
                  <span>When this happens:</span>
                </div>

                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Event</label>
                  <select
                    value={event}
                    onChange={e => setEvent(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    {EVENT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Chat selector */}
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Chat</label>
                  <select
                    value={chatId}
                    onChange={e => setChatId(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="">Any chat</option>
                    {chats.map(ch => (
                      <option key={ch.id} value={ch.id}>{ch.name || 'Private chat'}</option>
                    ))}
                  </select>
                </div>

                {/* From user — only when specific chat selected or on_message_from */}
                {(chatId || event === 'on_message_from') && (
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">From</label>
                    <select
                      value={fromUserId}
                      onChange={e => setFromUserId(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                    >
                      <option value="">Anyone</option>
                      {chatMembers.map((m: any) => (
                        <option key={m.userId || m.id} value={m.userId || m.id}>
                          {m.displayName || m.username || m.userId}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Keyword — only for on_keyword */}
                {event === 'on_keyword' && (
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">Keyword</label>
                    <input
                      type="text"
                      placeholder="Keyword to match"
                      value={keyword}
                      onChange={e => setKeyword(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>

              {/* Arrow connector */}
              <div className="flex flex-col items-center py-1">
                <div className="w-px h-3 bg-border" />
                <ChevronDown size={16} className="text-text-secondary -my-0.5" />
              </div>

              {/* THEN card */}
              <div className="bg-bg-secondary border border-green-500/30 rounded-xl p-4 space-y-3" >
                <div className="flex items-center gap-2 text-sm font-medium text-green-400">
                  <span>⚡</span>
                  <span>Do this:</span>
                </div>

                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Skill</label>
                  <select
                    value={selectedSkillId}
                    onChange={e => setSelectedSkillId(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="">Select a skill...</option>
                    {enrichedSkills.map(s => (
                      <option key={`${s.agentId}-${s.id}`} value={s.id}>
                        {s.icon} {s.command} ({s.agentName})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Input/Output description */}
                {selectedSkill && (
                  <div className="bg-bg-input border border-border rounded-lg px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <span>📥</span>
                      <span>Input:</span>
                      <span className="text-text-primary">{selectedSkill.inputDescription || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <span>📤</span>
                      <span>Output:</span>
                      <span className="text-text-primary">{selectedSkill.outputDescription || '—'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Arrow connector */}
              <div className="flex flex-col items-center py-1">
                <div className="w-px h-3 bg-border" />
                <ChevronDown size={16} className="text-text-secondary -my-0.5" />
              </div>

              {/* OUTPUT card */}
              <div className="bg-bg-secondary border border-purple-500/30 rounded-xl p-4 space-y-3" >
                <div className="flex items-center gap-2 text-sm font-medium text-purple-400">
                  <span>📤</span>
                  <span>Show result as:</span>
                </div>

                <div className="flex gap-2">
                  {OUTPUT_MODES.map(mode => (
                    <button
                      key={mode.value}
                      onClick={() => setOutputMode(mode.value)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-colors ${
                        outputMode === mode.value
                          ? 'border-accent/50 bg-accent/10 text-text-primary'
                          : 'border-border bg-bg-input text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      <span className="text-lg">{mode.icon}</span>
                      <span className="text-xs font-medium">{mode.label}</span>
                      <span className="text-[10px] text-text-secondary">{mode.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Create button */}
              <div className="flex gap-2 pt-3">
                <button
                  onClick={handleCreate}
                  disabled={!selectedSkillId}
                  className="flex-1 flex items-center justify-center gap-2 bg-accent text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-accent-hover transition-colors"
                >
                  <Sparkles size={16} />
                  Create Trigger
                </button>
                <button
                  onClick={() => { setShowCreate(false); resetForm() }}
                  className="px-4 py-2.5 rounded-lg text-text-secondary hover:bg-bg-hover text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Existing triggers — compact */}
          {triggers.length === 0 && !showCreate && (
            <div className="text-center py-8 text-text-secondary text-sm">
              No triggers yet. Use quick presets or create a custom one.
            </div>
          )}

          {triggers.map(trigger => {
            const eventIcon = EVENT_ICONS[trigger.event] || '⚡'
            const eventLabel = EVENT_OPTIONS.find(e => e.value === trigger.event)?.label || trigger.event
            const skillLabel = getSkillLabel(trigger.action)
            const outputIcon = getOutputIcon(trigger.outputMode)

            return (
              <div
                key={trigger.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                  trigger.enabled
                    ? 'border-accent/30 bg-accent/5'
                    : 'border-border bg-bg-secondary'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">
                    {eventIcon} {eventLabel} → <span className="font-mono text-accent">{skillLabel}</span> → {outputIcon} {trigger.outputMode.charAt(0).toUpperCase() + trigger.outputMode.slice(1)}
                  </div>
                  <div className="text-[10px] text-text-secondary mt-0.5">
                    in: {trigger.chatId ? (chats.find(c => c.id === trigger.chatId)?.name || 'Specific chat') : 'Any chat'}
                    {trigger.condition?.fromUserId && ' · from: Specific user'}
                    {trigger.condition?.keyword && ` · keyword: "${trigger.condition.keyword}"`}
                  </div>
                </div>

                {/* Run Now — for scheduled triggers or any trigger with an agent */}
                {trigger.agentId && (
                  <button
                    onClick={async () => {
                      setRunningTriggerId(trigger.id)
                      try {
                        await api.runAgentSchedule(trigger.agentId!)
                        alert('Done! Check your chats.')
                      } catch (err: any) {
                        alert(`Error: ${err.message}`)
                      } finally {
                        setRunningTriggerId(null)
                      }
                    }}
                    disabled={runningTriggerId === trigger.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {runningTriggerId === trigger.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Play size={12} />}
                    Run
                  </button>
                )}

                <button
                  onClick={() => handleToggle(trigger.id)}
                  className="text-text-secondary hover:text-accent transition-colors flex-shrink-0"
                >
                  {trigger.enabled ? <ToggleRight size={24} className="text-accent" /> : <ToggleLeft size={24} />}
                </button>

                <button
                  onClick={() => handleDelete(trigger.id)}
                  className="text-text-secondary hover:text-danger transition-colors flex-shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
