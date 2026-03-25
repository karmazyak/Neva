import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAgentStore } from '../stores/agentStore'
import { api } from '../lib/api'
import {
  ArrowLeft,
  Plus,
  Bot,
  Trash2,
  Save,
  Globe,
  Lock,
  Sparkles,
  Terminal,
  Zap,
  Clock,
  Edit3,
  Play,
  Loader2,
  Settings,
  X,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'

interface SkillConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'toggle'
  placeholder?: string
  options?: { label: string; value: string }[]
  defaultValue?: any
  min?: number
  max?: number
}

interface FullSkillInfo {
  id: string
  command: string
  name: string
  description: string
  icon: string
  cost: number
  inputType?: 'audio' | 'image' | 'text' | 'any'
  configSchema?: {
    needsSystemPrompt: boolean
    needsModel: boolean
    needsTemperature: boolean
    fields: SkillConfigField[]
  }
  inputDescription: string
  outputDescription: string
}

interface PipelineMethod {
  id: string
  name: string
  description: string
  icon: string
  compatibleTriggers: string[]
  outputType: 'audio' | 'image' | 'text' | 'any'
  config?: { fields: SkillConfigField[] }
}

interface Pipeline {
  id: string
  name: string
  event: string
  condition: any
  action: any
  method: string
  outputMode: string
  enabled: boolean
  isDefault: boolean
  agentId: string
  chatId: string | null
}

type Tab = 'overview' | 'pipelines' | 'settings'

const TRIGGER_OPTIONS = [
  { id: 'on_audio', name: 'Audio', icon: '\u{1F3A4}', desc: 'Voice message received' },
  { id: 'on_image', name: 'Image', icon: '\u{1F5BC}\u{FE0F}', desc: 'Image received' },
  { id: 'on_message', name: 'Message', icon: '\u{1F4AC}', desc: 'Any text message' },
  { id: 'on_keyword', name: 'Keyword', icon: '#\u{FE0F}\u{20E3}', desc: 'Message contains keyword' },
  { id: 'on_schedule', name: 'Schedule', icon: '\u{23F0}', desc: 'On a timer/cron' },
]

const OUTPUT_MODES = [
  { id: 'ghost', name: 'Only me', icon: '\u{1F441}\u{FE0F}', desc: 'Only you see the result' },
  { id: 'normal', name: 'Send to chat', icon: '\u{1F4AC}', desc: 'Everyone in chat sees it' },
]

export default function MyRobots() {
  const navigate = useNavigate()
  const { agents, loadAgents, createAgent, updateAgent, deleteAgent, models, loadModels } = useAgentStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [model, setModel] = useState('openai/gpt-4o')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [isPublic, setIsPublic] = useState(false)
  const [category, setCategory] = useState('')
  const [tools, setTools] = useState<string[]>(['text_reply'])
  const [modes, setModes] = useState<string[]>(['command'])
  const [saving, setSaving] = useState(false)
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [editingAlias, setEditingAlias] = useState<string | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [skillSettings, setSkillSettings] = useState<Record<string, Record<string, any>>>({})

  // Pipelines state
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [showPipelineBuilder, setShowPipelineBuilder] = useState(false)

  // Pipeline builder state
  const [pbTrigger, setPbTrigger] = useState('')
  const [pbMethod, setPbMethod] = useState('')
  const [pbSkill, setPbSkill] = useState('')
  const [pbOutput, setPbOutput] = useState('ghost')
  const [pbKeyword, setPbKeyword] = useState('')
  const [pbCron, setPbCron] = useState('0 8 * * *')
  const [pbSourceChats, setPbSourceChats] = useState<string[]>([])
  const [pbMethodCount, setPbMethodCount] = useState(20)
  const [pbCreating, setPbCreating] = useState(false)

  // Full skill list & methods from server
  const [fullSkillList, setFullSkillList] = useState<FullSkillInfo[]>([])
  const [methodsList, setMethodsList] = useState<PipelineMethod[]>([])

  // Schedule state (for background mode)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [cronExpression, setCronExpression] = useState('0 8 * * *')
  const [sourceChats, setSourceChats] = useState<string[]>([])
  const [runningNow, setRunningNow] = useState(false)
  const { chats, loadChats } = useChatStore()

  useEffect(() => {
    loadAgents()
    loadModels()
    loadChats()
    api.getAvailableSkills().then(setFullSkillList).catch(() => setFullSkillList([]))
    api.getMethods().then(setMethodsList).catch(() => setMethodsList([]))
  }, [])

  // Load aliases, schedule, and pipelines when robot is selected
  useEffect(() => {
    if (selected) {
      api.getAgentAliases(selected).then((als) => {
        const map: Record<string, string> = {}
        for (const a of als) map[a.skillId] = a.customCommand
        setAliases(map)
      }).catch(() => setAliases({}))

      api.getAgentSchedule(selected).then((sched) => {
        if (sched) {
          setScheduleEnabled(sched.enabled)
          setCronExpression(sched.cronExpression)
          setSourceChats(sched.config?.sourceChats || [])
        } else {
          setScheduleEnabled(false)
          setCronExpression('0 8 * * *')
          setSourceChats([])
        }
      }).catch(() => setScheduleEnabled(false))

      api.getAgentPipelines(selected).then(setPipelines).catch(() => setPipelines([]))
    }
  }, [selected])

  // Robot's own skills
  const agentSkills = useMemo(() => {
    return tools
      .map(toolId => fullSkillList.find(s => s.id === toolId))
      .filter(Boolean) as FullSkillInfo[]
  }, [tools, fullSkillList])

  // Merged config for settings tab
  const mergedConfig = useMemo(() => ({
    showSystemPrompt: agentSkills.some(s => s.configSchema?.needsSystemPrompt),
    showModel: agentSkills.some(s => s.configSchema?.needsModel),
    showTemperature: agentSkills.some(s => s.configSchema?.needsTemperature),
    customFields: agentSkills
      .filter(s => s.configSchema?.fields && s.configSchema.fields.length > 0)
      .map(s => ({ skillId: s.id, skillName: s.name, skillIcon: s.icon, fields: s.configSchema!.fields })),
  }), [agentSkills])

  // Pipeline builder: compatible methods for selected trigger
  const compatibleMethods = useMemo(() => {
    if (!pbTrigger) return []
    return methodsList.filter(m => m.compatibleTriggers.includes(pbTrigger))
  }, [pbTrigger, methodsList])

  // Pipeline builder: compatible skills for selected method
  const compatibleSkills = useMemo(() => {
    if (!pbMethod) return []
    const method = methodsList.find(m => m.id === pbMethod)
    if (!method) return []

    return agentSkills.filter(skill => {
      const skillInput = skill.inputType || 'text'
      if (method.outputType === 'any') {
        // Depends on trigger
        if (pbTrigger === 'on_audio') return skillInput === 'audio' || skillInput === 'any'
        if (pbTrigger === 'on_image') return skillInput === 'image' || skillInput === 'any'
        return skillInput === 'text' || skillInput === 'any'
      }
      return skillInput === method.outputType || skillInput === 'any'
    })
  }, [pbMethod, pbTrigger, methodsList, agentSkills])

  const handleSelectAgent = (agent: any) => {
    setSelected(agent.id)
    setIsNew(false)
    setActiveTab('overview')
    setName(agent.name)
    setDescription(agent.description || '')
    setSystemPrompt(agent.systemPrompt)
    setModel(agent.model)
    setTemperature(agent.temperature)
    setMaxTokens(agent.maxTokens)
    setIsPublic(agent.isPublic)
    setCategory(agent.category || '')
    setTools(agent.tools || ['text_reply'])
    setModes(agent.modes || ['command'])
    setSkillSettings(agent.skillSettings || {})
    setShowPipelineBuilder(false)
  }

  const handleNewAgent = () => {
    setSelected(null)
    setIsNew(true)
    setActiveTab('overview')
    setName('')
    setDescription('')
    setSystemPrompt('You are a helpful assistant. Respond naturally and concisely.')
    setModel('openai/gpt-4o')
    setTemperature(0.7)
    setMaxTokens(2048)
    setIsPublic(false)
    setCategory('')
    setTools(['text_reply'])
    setModes(['command'])
    setAliases({})
    setSkillSettings({})
    setPipelines([])
    setShowPipelineBuilder(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const finalSystemPrompt = mergedConfig.showSystemPrompt ? systemPrompt : '-'
      const data = {
        name, description,
        systemPrompt: finalSystemPrompt,
        model, tools, modes,
        temperature, maxTokens, isPublic,
        category: category || undefined,
        skillSettings,
      }
      if (isNew) {
        const agent = await createAgent(data)
        setSelected(agent.id)
        setIsNew(false)
      } else if (selected) {
        await updateAgent(selected, data)
      }
    } catch (err) {
      console.error('Failed to save robot:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!confirm('Delete this robot?')) return
    await deleteAgent(selected)
    setSelected(null)
    setIsNew(false)
  }

  const handleSaveAlias = async (skillId: string) => {
    if (!selected || !aliasInput.trim()) return
    const cmd = aliasInput.startsWith('/') ? aliasInput : `/${aliasInput}`
    try {
      await api.setCommandAlias({ agentId: selected, skillId, customCommand: cmd.toLowerCase() })
      setAliases(prev => ({ ...prev, [skillId]: cmd.toLowerCase() }))
    } catch (err: any) {
      alert(err.message)
    }
    setEditingAlias(null)
    setAliasInput('')
  }

  const handleTogglePipeline = async (pipelineId: string) => {
    try {
      const result = await api.toggleTrigger(pipelineId)
      setPipelines(prev => prev.map(p => p.id === pipelineId ? { ...p, enabled: result.enabled } : p))
    } catch (err) {
      console.error('Toggle pipeline error:', err)
    }
  }

  const handleDeletePipeline = async (pipelineId: string) => {
    if (!confirm('Delete this pipeline?')) return
    try {
      await api.deleteTrigger(pipelineId)
      setPipelines(prev => prev.filter(p => p.id !== pipelineId))
    } catch (err) {
      console.error('Delete pipeline error:', err)
    }
  }

  const handleCreatePipeline = async () => {
    if (!selected || !pbTrigger || !pbMethod || !pbSkill) return
    setPbCreating(true)
    try {
      const skill = agentSkills.find(s => s.id === pbSkill)
      const condition: any = {}
      if (pbTrigger === 'on_keyword') condition.keyword = pbKeyword
      if (pbTrigger === 'on_schedule') {
        condition.cronExpression = pbCron
        condition.sourceChats = pbSourceChats
      }

      const pipeline = await api.createAgentPipeline(selected, {
        name: `${TRIGGER_OPTIONS.find(t => t.id === pbTrigger)?.name || pbTrigger} → ${skill?.command || pbSkill}`,
        event: pbTrigger,
        condition,
        action: {
          type: skill?.id === 'stt' ? 'stt' : 'skill',
          skillCommand: skill?.command,
          skillId: skill?.id,
        },
        method: pbMethod,
        outputMode: pbOutput,
        enabled: true,
      })
      setPipelines(prev => [...prev, pipeline])
      setShowPipelineBuilder(false)
      resetPipelineBuilder()
    } catch (err: any) {
      console.error('Create pipeline error:', err)
      alert(`Pipeline error: ${err.message}`)
    } finally {
      setPbCreating(false)
    }
  }

  const resetPipelineBuilder = () => {
    setPbTrigger('')
    setPbMethod('')
    setPbSkill('')
    setPbOutput('ghost')
    setPbKeyword('')
    setPbCron('0 8 * * *')
    setPbSourceChats([])
    setPbMethodCount(20)
  }

  const updateSkillSetting = (skillId: string, key: string, value: any) => {
    setSkillSettings(prev => ({
      ...prev,
      [skillId]: { ...(prev[skillId] || {}), [key]: value },
    }))
  }

  const categories = ['Assistant', 'Copywriter', 'Translator', 'Coder', 'Customer Support', 'Creative', 'Education', 'Other']
  const showEditor = selected || isNew
  const hasSettings = mergedConfig.showSystemPrompt || mergedConfig.showModel || mergedConfig.showTemperature || mergedConfig.customFields.length > 0

  // Categorize pipelines
  const defaultPipelines = pipelines.filter(p => p.isDefault && p.event !== 'on_schedule')
  const customPipelines = pipelines.filter(p => !p.isDefault && p.event !== 'on_schedule')
  const autonomousPipelines = pipelines.filter(p => p.event === 'on_schedule')

  const pipelineCount = pipelines.filter(p => p.enabled).length

  const getTriggerIcon = (event: string) => TRIGGER_OPTIONS.find(t => t.id === event)?.icon || '\u{26A1}'
  const getOutputIcon = (mode: string) => OUTPUT_MODES.find(o => o.id === mode)?.icon || ''

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="hidden md:block p-1 text-text-secondary hover:text-text-primary">
          <ArrowLeft size={22} />
        </button>
        <Bot size={22} className="text-accent" />
        <h1 className="text-lg font-semibold text-text-primary">My Robots</h1>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Robot list (left panel) */}
        <div className={`${showEditor ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] border-r border-border bg-bg-secondary`}>
          <button
            onClick={handleNewAgent}
            className="flex items-center gap-3 px-4 py-3 text-accent hover:bg-bg-hover transition-colors border-b border-border"
          >
            <Plus size={20} />
            <span className="font-medium">Create New Robot</span>
          </button>

          <div className="flex-1 overflow-y-auto">
            {agents.map((agent) => {
              const agentModes = (agent.modes || ['command']) as string[]
              return (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent)}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors ${
                    selected === agent.id ? 'bg-accent/15' : ''
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                    <Bot size={18} className="text-accent" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-text-primary font-medium truncate">{agent.name}</div>
                    <div className="text-text-secondary text-xs truncate flex items-center gap-1.5">
                      {agentModes.map((m: string) => (
                        <span key={m} className="bg-bg-input px-1 py-0.5 rounded text-[10px]">{m}</span>
                      ))}
                    </div>
                  </div>
                  {agent.isPublic ? (
                    <Globe size={14} className="text-green-online flex-shrink-0" />
                  ) : (
                    <Lock size={14} className="text-text-secondary flex-shrink-0" />
                  )}
                </button>
              )
            })}

            {agents.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-14 h-14 rounded-full bg-bg-hover flex items-center justify-center mb-4">
                  <Bot size={26} className="text-text-secondary" />
                </div>
                <p className="text-text-primary font-medium mb-1">No robots yet</p>
                <p className="text-text-secondary text-sm mb-4">Create an AI robot to automate replies and tasks in your chats.</p>
                <button
                  onClick={() => { setIsNew(true); setSelected(null) }}
                  className="px-4 py-2 rounded-xl neva-gradient text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-[0_4px_16px_rgba(44,196,196,0.25)]"
                >
                  Create your first robot
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        {showEditor ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs (only for existing robots, not new) */}
            {!isNew && (
              <div className="flex border-b border-border bg-bg-secondary">
                {([
                  { id: 'overview' as Tab, label: 'Overview' },
                  { id: 'pipelines' as Tab, label: `Pipelines${pipelineCount > 0 ? ` (${pipelineCount})` : ''}` },
                  { id: 'settings' as Tab, label: 'Settings' },
                ]).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === tab.id
                        ? 'text-accent border-accent'
                        : 'text-text-secondary border-transparent hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-2xl mx-auto space-y-6">

                {/* ========== TAB: OVERVIEW (or new robot form) ========== */}
                {(activeTab === 'overview' || isNew) && (
                  <>
                    {/* Name & Description */}
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Robot Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary text-lg font-medium placeholder:text-text-secondary focus:outline-none focus:border-accent"
                        readOnly={!isNew && activeTab === 'overview'}
                      />
                      <input
                        type="text"
                        placeholder="Short description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm"
                        readOnly={!isNew && activeTab === 'overview'}
                      />
                    </div>

                    {/* Skills (read-only for existing, selectable for new) */}
                    <div className="space-y-2">
                      <label className="text-sm text-text-secondary font-medium">Skills</label>
                      {agentSkills.length > 0 ? (
                        <div className="space-y-2">
                          {agentSkills.map((skill) => {
                            const alias = aliases[skill.id]
                            return (
                              <div key={skill.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-bg-input">
                                <span className="text-lg">{skill.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-text-primary font-medium">{skill.name}</span>
                                    <span className="text-xs font-mono text-accent">{alias || skill.command}</span>
                                  </div>
                                  <div className="text-[11px] text-text-secondary">
                                    {skill.inputDescription} → {skill.outputDescription}
                                  </div>
                                </div>
                                <span className="text-[10px] text-text-secondary">{skill.cost} cr</span>

                                {/* Custom command alias */}
                                {skill.id !== 'text_reply' && selected && (
                                  editingAlias === skill.id ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        value={aliasInput}
                                        onChange={(e) => setAliasInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveAlias(skill.id)}
                                        placeholder={skill.command}
                                        className="w-20 bg-bg-secondary border border-border rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
                                        autoFocus
                                      />
                                      <button onClick={() => handleSaveAlias(skill.id)} className="text-accent text-xs hover:underline">OK</button>
                                      <button onClick={() => { setEditingAlias(null); setAliasInput('') }} className="text-text-secondary text-xs">✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setEditingAlias(skill.id); setAliasInput(alias || '') }}
                                      className="text-text-secondary hover:text-accent"
                                      title="Customize command"
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                  )
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-text-secondary text-sm bg-bg-input border border-border rounded-lg px-4 py-3">
                          No skills assigned.
                        </div>
                      )}

                      {/* Skill selector — only for new robots */}
                      {isNew && (
                        <div className="space-y-1.5 mt-2">
                          <label className="text-xs text-text-secondary">Add Skills</label>
                          <div className="grid grid-cols-1 gap-1.5">
                            {fullSkillList.map((skill) => {
                              const enabled = tools.includes(skill.id)
                              return (
                                <button
                                  key={skill.id}
                                  onClick={() => {
                                    if (skill.id === 'text_reply') return
                                    setTools(prev => enabled ? prev.filter(t => t !== skill.id) : [...prev, skill.id])
                                  }}
                                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${
                                    enabled ? 'border-accent/50 bg-accent/10' : 'border-border bg-bg-input hover:bg-bg-hover'
                                  }`}
                                >
                                  <span className="text-lg">{skill.icon}</span>
                                  <div className="flex-1">
                                    <span className="text-sm text-text-primary">{skill.name}</span>
                                    <span className="text-xs font-mono text-accent ml-2">{skill.command}</span>
                                  </div>
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                                    enabled ? 'bg-accent border-accent' : 'border-border'
                                  }`}>
                                    {enabled && <span className="text-white text-[10px]">✓</span>}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Status (for existing robots only) */}
                    {!isNew && (
                      <div className="bg-bg-input border border-border rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 rounded-full bg-green-online" />
                          <span className="text-text-primary font-medium">Active</span>
                          <span className="text-text-secondary">
                            · {pipelineCount} pipeline{pipelineCount !== 1 ? 's' : ''} enabled
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Create button for new robots */}
                    {isNew && (
                      <div className="flex gap-3">
                        <button
                          onClick={handleSave}
                          disabled={!name || saving}
                          className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-lg font-medium disabled:opacity-30 transition-colors"
                        >
                          <Save size={18} />
                          {saving ? 'Creating...' : 'Create Robot'}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* ========== TAB: PIPELINES ========== */}
                {activeTab === 'pipelines' && !isNew && (
                  <>
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-text-primary">Pipelines</h2>
                      <button
                        onClick={() => { setShowPipelineBuilder(true); resetPipelineBuilder() }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
                      >
                        <Plus size={16} />
                        New
                      </button>
                    </div>

                    {/* Default Pipelines */}
                    {defaultPipelines.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-xs text-text-secondary font-medium uppercase tracking-wider">Default</label>
                        {defaultPipelines.map(p => (
                          <PipelineCard key={p.id} pipeline={p} onToggle={handleTogglePipeline} />
                        ))}
                      </div>
                    )}

                    {/* Custom Pipelines */}
                    {customPipelines.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-xs text-text-secondary font-medium uppercase tracking-wider">Custom</label>
                        {customPipelines.map(p => (
                          <PipelineCard key={p.id} pipeline={p} onToggle={handleTogglePipeline} onDelete={handleDeletePipeline} />
                        ))}
                      </div>
                    )}

                    {/* Autonomous Pipelines */}
                    {autonomousPipelines.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-xs text-text-secondary font-medium uppercase tracking-wider">Autonomous</label>
                        {autonomousPipelines.map(p => (
                          <PipelineCard key={p.id} pipeline={p} onToggle={handleTogglePipeline} onDelete={p.isDefault ? undefined : handleDeletePipeline} />
                        ))}
                      </div>
                    )}

                    {pipelines.length === 0 && !showPipelineBuilder && (
                      <div className="text-center text-text-secondary py-8 text-sm">
                        No pipelines yet. Create your first automation!
                      </div>
                    )}

                    {/* Pipeline Builder Modal */}
                    {showPipelineBuilder && (
                      <div className="space-y-4 bg-bg-secondary border border-accent/30 rounded-xl p-5">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-text-primary">New Pipeline</h3>
                          <button onClick={() => setShowPipelineBuilder(false)} className="text-text-secondary hover:text-text-primary">
                            <X size={18} />
                          </button>
                        </div>

                        {/* Step 1: Trigger */}
                        <div className="space-y-2">
                          <label className="text-xs text-text-secondary font-medium">Step 1: Trigger</label>
                          <div className="flex flex-wrap gap-2">
                            {TRIGGER_OPTIONS.map(t => (
                              <button
                                key={t.id}
                                onClick={() => { setPbTrigger(t.id); setPbMethod(''); setPbSkill('') }}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                                  pbTrigger === t.id
                                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                    : 'bg-bg-input text-text-secondary border border-border hover:bg-bg-hover'
                                }`}
                              >
                                <span>{t.icon}</span>
                                <span>{t.name}</span>
                              </button>
                            ))}
                          </div>

                          {/* Keyword input */}
                          {pbTrigger === 'on_keyword' && (
                            <input
                              type="text"
                              value={pbKeyword}
                              onChange={e => setPbKeyword(e.target.value)}
                              placeholder="Enter keyword..."
                              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                            />
                          )}

                          {/* Schedule config */}
                          {pbTrigger === 'on_schedule' && (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {[
                                  { label: 'Daily 8am', cron: '0 8 * * *' },
                                  { label: 'Hourly', cron: '0 * * * *' },
                                  { label: 'Every 6h', cron: '0 */6 * * *' },
                                ].map(preset => (
                                  <button
                                    key={preset.cron}
                                    onClick={() => setPbCron(preset.cron)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                      pbCron === preset.cron
                                        ? 'bg-accent/15 text-accent border border-accent/30'
                                        : 'bg-bg-input text-text-secondary border border-border hover:bg-bg-hover'
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="text"
                                value={pbCron}
                                onChange={e => setPbCron(e.target.value)}
                                placeholder="Cron expression"
                                className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
                              />
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {chats.filter(c => c.type === 'channel').map(ch => (
                                  <label key={ch.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={pbSourceChats.includes(ch.id)}
                                      onChange={() => setPbSourceChats(prev =>
                                        prev.includes(ch.id) ? prev.filter(id => id !== ch.id) : [...prev, ch.id]
                                      )}
                                      className="accent-accent"
                                    />
                                    <span className="text-sm text-text-primary">{ch.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Step 2: Method */}
                        {pbTrigger && (
                          <div className="space-y-2">
                            <label className="text-xs text-text-secondary font-medium">Step 2: Method</label>
                            <div className="flex flex-wrap gap-2">
                              {compatibleMethods.map(m => (
                                <button
                                  key={m.id}
                                  onClick={() => { setPbMethod(m.id); setPbSkill('') }}
                                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    pbMethod === m.id
                                      ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                      : 'bg-bg-input text-text-secondary border border-border hover:bg-bg-hover'
                                  }`}
                                >
                                  <span>{m.icon}</span>
                                  <span>{m.name}</span>
                                </button>
                              ))}
                            </div>

                            {/* Method config fields (e.g., message count) */}
                            {pbMethod && (() => {
                              const selectedMethod = methodsList.find(m => m.id === pbMethod)
                              if (!selectedMethod?.config?.fields?.length) return null
                              return (
                                <div className="space-y-2 mt-2">
                                  {selectedMethod.config.fields.map(field => (
                                    <div key={field.key} className="flex items-center gap-3">
                                      <label className="text-xs text-text-secondary min-w-[80px]">{field.label}</label>
                                      <input
                                        type="number"
                                        min={field.min}
                                        max={field.max}
                                        value={pbMethodCount}
                                        onChange={e => setPbMethodCount(parseInt(e.target.value) || field.defaultValue)}
                                        className="w-24 bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                                      />
                                    </div>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        )}

                        {/* Step 3: Skill + Output */}
                        {pbMethod && (
                          <div className="space-y-2">
                            <label className="text-xs text-text-secondary font-medium">Step 3: Skill</label>
                            <div className="space-y-1.5">
                              {compatibleSkills.map(skill => (
                                <button
                                  key={skill.id}
                                  onClick={() => setPbSkill(skill.id)}
                                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                                    pbSkill === skill.id
                                      ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                      : 'bg-bg-input text-text-secondary border border-border hover:bg-bg-hover'
                                  }`}
                                >
                                  <span className="text-lg">{skill.icon}</span>
                                  <div className="flex-1">
                                    <span className="text-sm text-text-primary">{skill.name}</span>
                                    <span className="text-xs font-mono text-accent ml-2">{skill.command}</span>
                                  </div>
                                </button>
                              ))}
                              {compatibleSkills.length === 0 && (
                                <div className="text-text-secondary text-xs py-2">
                                  No compatible skills for this trigger + method combination.
                                </div>
                              )}
                            </div>

                            {/* Output mode */}
                            {pbSkill && (
                              <div className="space-y-2 mt-3">
                                <label className="text-xs text-text-secondary font-medium">Output</label>
                                <div className="flex gap-2">
                                  {OUTPUT_MODES.map(o => (
                                    <button
                                      key={o.id}
                                      onClick={() => setPbOutput(o.id)}
                                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                                        pbOutput === o.id
                                          ? 'bg-accent/15 text-accent border border-accent/30'
                                          : 'bg-bg-input text-text-secondary border border-border hover:bg-bg-hover'
                                      }`}
                                    >
                                      <span>{o.icon}</span>
                                      <span>{o.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Create button */}
                        {pbSkill && (
                          <button
                            onClick={handleCreatePipeline}
                            disabled={pbCreating}
                            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                          >
                            <Sparkles size={16} />
                            {pbCreating ? 'Creating...' : 'Create Pipeline'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ========== TAB: SETTINGS ========== */}
                {activeTab === 'settings' && !isNew && (
                  <>
                    {/* System Prompt */}
                    {mergedConfig.showSystemPrompt && (
                      <div>
                        <label className="text-text-secondary text-xs mb-1.5 block">System Prompt</label>
                        <textarea
                          value={systemPrompt}
                          onChange={(e) => setSystemPrompt(e.target.value)}
                          rows={5}
                          className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none font-mono"
                          placeholder="Describe how the robot should behave..."
                        />
                      </div>
                    )}

                    {/* Model & Temperature */}
                    {(mergedConfig.showModel || mergedConfig.showTemperature) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {mergedConfig.showModel && (
                          <>
                            <div>
                              <label className="text-text-secondary text-xs mb-1.5 block">Model</label>
                              <select
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="w-full bg-bg-input border border-border rounded-lg px-4 py-2.5 text-text-primary focus:outline-none focus:border-accent text-sm"
                              >
                                {models.length > 0 ? models.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                )) : (
                                  <>
                                    <option value="openai/gpt-4o">GPT-4o</option>
                                    <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                                    <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                                    <option value="meta-llama/llama-3.1-70b-instruct">Llama 3.1 70B</option>
                                  </>
                                )}
                              </select>
                            </div>
                            <div>
                              <label className="text-text-secondary text-xs mb-1.5 block">Category</label>
                              <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full bg-bg-input border border-border rounded-lg px-4 py-2.5 text-text-primary focus:outline-none focus:border-accent text-sm"
                              >
                                <option value="">None</option>
                                {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-text-secondary text-xs mb-1.5 block">Max Tokens: {maxTokens}</label>
                              <input type="range" min="256" max="8192" step="256" value={maxTokens}
                                onChange={(e) => setMaxTokens(parseInt(e.target.value))} className="w-full accent-accent" />
                            </div>
                          </>
                        )}
                        {mergedConfig.showTemperature && (
                          <div>
                            <label className="text-text-secondary text-xs mb-1.5 block">Temperature: {temperature.toFixed(1)}</label>
                            <input type="range" min="0" max="2" step="0.1" value={temperature}
                              onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-accent" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Custom Skill Settings */}
                    {mergedConfig.customFields.length > 0 && (
                      <div className="space-y-3">
                        {mergedConfig.customFields.map(({ skillId, skillName, skillIcon, fields }) => (
                          <div key={skillId} className="bg-bg-input border border-border rounded-lg p-3 space-y-2.5">
                            <div className="flex items-center gap-2 text-sm text-text-primary font-medium">
                              <span>{skillIcon}</span>
                              <span>{skillName}</span>
                            </div>
                            {fields.map((field) => {
                              const value = skillSettings[skillId]?.[field.key] ?? field.defaultValue
                              return (
                                <div key={field.key} className="flex items-center gap-3">
                                  <label className="text-xs text-text-secondary min-w-[100px]">{field.label}</label>
                                  {field.type === 'select' && field.options && (
                                    <select value={value ?? ''} onChange={(e) => updateSkillSetting(skillId, field.key, e.target.value)}
                                      className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent">
                                      {field.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                  )}
                                  {field.type === 'number' && (
                                    <input type="number" min={field.min} max={field.max} value={value ?? ''}
                                      onChange={(e) => updateSkillSetting(skillId, field.key, parseInt(e.target.value) || field.defaultValue)}
                                      className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent" />
                                  )}
                                  {field.type === 'text' && (
                                    <input type="text" placeholder={field.placeholder} value={value ?? ''}
                                      onChange={(e) => updateSkillSetting(skillId, field.key, e.target.value)}
                                      className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent" />
                                  )}
                                  {field.type === 'toggle' && (
                                    <button onClick={() => updateSkillSetting(skillId, field.key, !value)}
                                      className={`w-10 h-5 rounded-full transition-colors ${value ? 'bg-accent' : 'bg-border'}`}>
                                      <div className={`w-4 h-4 bg-white rounded-full transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Schedule config for background mode */}
                    {modes.includes('background') && (
                      <div className="space-y-3">
                        <label className="text-sm text-text-secondary font-medium">Schedule</label>
                        <div className="bg-bg-input border border-border rounded-xl p-4 space-y-3">
                          <div>
                            <label className="text-xs text-text-secondary mb-1.5 block">Schedule</label>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { label: 'Daily 8am', cron: '0 8 * * *' },
                                { label: 'Hourly', cron: '0 * * * *' },
                                { label: 'Every 6h', cron: '0 */6 * * *' },
                              ].map(preset => (
                                <button key={preset.cron} onClick={() => setCronExpression(preset.cron)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    cronExpression === preset.cron
                                      ? 'bg-accent/15 text-accent border border-accent/30'
                                      : 'bg-bg-secondary text-text-secondary border border-border hover:bg-bg-hover'
                                  }`}>
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                            <input type="text" value={cronExpression} onChange={e => setCronExpression(e.target.value)}
                              placeholder="Custom cron" className="w-full mt-2 bg-bg-secondary border border-border rounded-lg px-3 py-2 text-text-primary text-xs font-mono focus:outline-none focus:border-accent" />
                          </div>
                          <div>
                            <label className="text-xs text-text-secondary mb-1.5 block">Source Channels</label>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {chats.filter(c => c.type === 'channel').map(ch => (
                                <label key={ch.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover cursor-pointer">
                                  <input type="checkbox" checked={sourceChats.includes(ch.id)}
                                    onChange={() => setSourceChats(prev => prev.includes(ch.id) ? prev.filter(id => id !== ch.id) : [...prev, ch.id])}
                                    className="accent-accent" />
                                  <span className="text-sm text-text-primary">{ch.name}</span>
                                </label>
                              ))}
                              {chats.filter(c => c.type === 'channel').length === 0 && (
                                <span className="text-xs text-text-secondary">No channels available</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 pt-2 border-t border-border/50">
                            <button onClick={async () => {
                              if (!selected) return
                              await api.saveAgentSchedule(selected, { cronExpression, taskType: 'digest', config: { sourceChats }, enabled: true })
                              setScheduleEnabled(true)
                            }} className="flex-1 bg-accent/15 text-accent py-2 rounded-lg text-sm font-medium hover:bg-accent/25 transition-colors">
                              Save Schedule
                            </button>
                            <button onClick={async () => {
                              if (!selected) return
                              setRunningNow(true)
                              try {
                                await api.runAgentSchedule(selected)
                                alert('Digest task completed!')
                              } catch (err: any) { alert(`Error: ${err.message}`) }
                              finally { setRunningNow(false) }
                            }} disabled={runningNow || sourceChats.length === 0}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-bg-secondary text-text-primary hover:bg-bg-hover border border-border transition-colors disabled:opacity-30">
                              {runningNow ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                              Run Now
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Publish toggle */}
                    <div className="flex items-center justify-between bg-bg-input border border-border rounded-lg px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Globe size={18} className="text-text-secondary" />
                        <div>
                          <div className="text-text-primary text-sm font-medium">Publish to Robot Store</div>
                          <div className="text-text-secondary text-xs">Make this robot available to everyone</div>
                        </div>
                      </div>
                      <button onClick={() => setIsPublic(!isPublic)}
                        className={`w-12 h-6 rounded-full transition-colors ${isPublic ? 'bg-accent' : 'bg-border'}`}>
                        <div className={`w-5 h-5 bg-white rounded-full transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>

                    {/* Save & Delete */}
                    <div className="flex gap-3">
                      <button onClick={handleSave} disabled={!name || saving}
                        className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-lg font-medium disabled:opacity-30 transition-colors">
                        <Save size={18} />
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                      {selected && (
                        <button onClick={handleDelete}
                          className="px-4 py-3 rounded-lg text-danger hover:bg-danger/10 transition-colors">
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </>
                )}

              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 hidden md:flex items-center justify-center">
            <div className="text-center">
              <Sparkles size={48} className="text-text-secondary/30 mx-auto mb-4" />
              <h2 className="text-xl text-text-primary font-medium">My Robots</h2>
              <p className="text-text-secondary mt-2">Select a robot to configure</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ========== Pipeline Card Component ==========
function PipelineCard({ pipeline, onToggle, onDelete }: {
  pipeline: Pipeline
  onToggle: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const getTriggerIcon = (event: string) => {
    const map: Record<string, string> = {
      on_audio: '\u{1F3A4}', on_image: '\u{1F5BC}\u{FE0F}', on_message: '\u{1F4AC}',
      on_keyword: '#\u{FE0F}\u{20E3}', on_schedule: '\u{23F0}', on_message_from: '\u{1F464}',
    }
    return map[event] || '\u{26A1}'
  }

  const getOutputIcon = (mode: string) => {
    const map: Record<string, string> = { ghost: '\u{1F441}\u{FE0F}', normal: '\u{1F4AC}' }
    return map[mode] || ''
  }

  const getMethodName = (method: string) => {
    const map: Record<string, string> = {
      pass_content: 'pass_content', last_n_messages: 'last_n_messages', collect_from_channels: 'from_channels',
    }
    return map[method] || method
  }

  const action = pipeline.action as any
  const condition = pipeline.condition as any

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-bg-input ${
      pipeline.enabled ? 'border-border' : 'border-border/50 opacity-60'
    }`}>
      <span className="text-lg">{getTriggerIcon(pipeline.event)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">
          {pipeline.name}
        </div>
        <div className="text-[11px] text-text-secondary">
          {pipeline.event} → {getMethodName(pipeline.method || 'pass_content')} → {action?.skillCommand || action?.type}
          {' '}{getOutputIcon(pipeline.outputMode)} {pipeline.outputMode}
          {condition?.keyword && <span className="ml-1 text-accent">"{condition.keyword}"</span>}
          {condition?.cronExpression && <span className="ml-1 font-mono">{condition.cronExpression}</span>}
        </div>
      </div>

      {/* Toggle */}
      <button
        onClick={() => onToggle(pipeline.id)}
        className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 ${pipeline.enabled ? 'bg-accent' : 'bg-border'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${pipeline.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>

      {/* Delete (only for non-default) */}
      {onDelete && (
        <button onClick={() => onDelete(pipeline.id)} className="text-text-secondary hover:text-danger flex-shrink-0">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}
