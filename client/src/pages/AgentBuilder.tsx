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
  configSchema?: {
    needsSystemPrompt: boolean
    needsModel: boolean
    needsTemperature: boolean
    fields: SkillConfigField[]
  }
  inputDescription: string
  outputDescription: string
}

export default function AgentBuilder() {
  const navigate = useNavigate()
  const { agents, loadAgents, createAgent, updateAgent, deleteAgent, models, loadModels } = useAgentStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)

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

  // Full skill list from server (with configSchema)
  const [fullSkillList, setFullSkillList] = useState<FullSkillInfo[]>([])

  // Schedule state (for background mode)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [cronExpression, setCronExpression] = useState('0 8 * * *')
  const [sourceChats, setSourceChats] = useState<string[]>([])
  const [runningNow, setRunningNow] = useState(false)
  const { chats, loadChats } = useChatStore()

  const agentModes = [
    { id: 'command', name: 'Command', icon: Terminal, desc: 'Responds to /commands' },
    { id: 'auto', name: 'Auto-Reply', icon: Zap, desc: 'Auto-replies to messages' },
    { id: 'background', name: 'Background', icon: Clock, desc: 'Runs on schedule' },
  ]

  useEffect(() => {
    loadAgents()
    loadModels()
    loadChats()
    api.getAvailableSkills().then(setFullSkillList).catch(() => setFullSkillList([]))
  }, [])

  // Load aliases and schedule when agent is selected
  useEffect(() => {
    if (selected) {
      api.getAgentAliases(selected).then((als) => {
        const map: Record<string, string> = {}
        for (const a of als) {
          map[a.skillId] = a.customCommand
        }
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
      }).catch(() => {
        setScheduleEnabled(false)
      })
    }
  }, [selected])

  // Agent's own skills (from its tools array), enriched with full info
  const agentSkills = useMemo(() => {
    return tools
      .map(toolId => fullSkillList.find(s => s.id === toolId))
      .filter(Boolean) as FullSkillInfo[]
  }, [tools, fullSkillList])

  // Merged config based on agent's skills
  const mergedConfig = useMemo(() => {
    return {
      showSystemPrompt: agentSkills.some(s => s.configSchema?.needsSystemPrompt),
      showModel: agentSkills.some(s => s.configSchema?.needsModel),
      showTemperature: agentSkills.some(s => s.configSchema?.needsTemperature),
      customFields: agentSkills
        .filter(s => s.configSchema?.fields && s.configSchema.fields.length > 0)
        .map(s => ({
          skillId: s.id,
          skillName: s.name,
          skillIcon: s.icon,
          fields: s.configSchema!.fields,
        })),
    }
  }, [agentSkills])

  const handleSelectAgent = (agent: any) => {
    setSelected(agent.id)
    setIsNew(false)
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
  }

  const handleNewAgent = () => {
    setSelected(null)
    setIsNew(true)
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
      console.error('Failed to save agent:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!confirm('Delete this agent?')) return
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

  const toggleMode = (modeId: string) => {
    setModes(prev => {
      if (prev.includes(modeId)) {
        if (prev.length === 1) return prev
        return prev.filter(m => m !== modeId)
      }
      return [...prev, modeId]
    })
  }

  const updateSkillSetting = (skillId: string, key: string, value: any) => {
    setSkillSettings(prev => ({
      ...prev,
      [skillId]: { ...(prev[skillId] || {}), [key]: value },
    }))
  }

  const categories = [
    'Assistant', 'Copywriter', 'Translator', 'Coder',
    'Customer Support', 'Creative', 'Education', 'Other',
  ]

  const showEditor = selected || isNew
  const hasSettings = mergedConfig.showSystemPrompt || mergedConfig.showModel || mergedConfig.showTemperature || mergedConfig.customFields.length > 0

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="p-1 text-text-secondary hover:text-text-primary">
          <ArrowLeft size={22} />
        </button>
        <Bot size={22} className="text-accent" />
        <h1 className="text-lg font-semibold text-text-primary">My Agents</h1>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Agent list */}
        <div className={`${showEditor ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] border-r border-border bg-bg-secondary`}>
          <button
            onClick={handleNewAgent}
            className="flex items-center gap-3 px-4 py-3 text-accent hover:bg-bg-hover transition-colors border-b border-border"
          >
            <Plus size={20} />
            <span className="font-medium">Create New Agent</span>
          </button>

          <div className="flex-1 overflow-y-auto">
            {agents.map((agent) => (
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
                    {(agent.modes || ['command']).map((m: string) => (
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
            ))}

            {agents.length === 0 && (
              <div className="text-center text-text-secondary py-8 text-sm">
                No agents yet. Create your first one!
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        {showEditor ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Name & Description */}
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Agent Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary text-lg font-medium placeholder:text-text-secondary focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  placeholder="Short description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm"
                />
              </div>

              {/* Agent Modes */}
              <div className="space-y-2">
                <label className="text-sm text-text-secondary font-medium">Agent Modes</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {agentModes.map((mode) => {
                    const enabled = modes.includes(mode.id)
                    return (
                      <button
                        key={mode.id}
                        onClick={() => toggleMode(mode.id)}
                        className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors text-center ${
                          enabled
                            ? 'border-accent/50 bg-accent/10'
                            : 'border-border bg-bg-input hover:bg-bg-hover'
                        }`}
                      >
                        <mode.icon size={20} className={enabled ? 'text-accent' : 'text-text-secondary'} />
                        <div>
                          <div className="text-sm text-text-primary font-medium">{mode.name}</div>
                          <div className="text-[10px] text-text-secondary mt-0.5">{mode.desc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Agent's Skills — read-only list with command aliases */}
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
                    No skills assigned. Select skills when creating the agent.
                  </div>
                )}

                {/* Skill selector — only when creating new agent */}
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
                              setTools(prev =>
                                enabled ? prev.filter(t => t !== skill.id) : [...prev, skill.id]
                              )
                            }}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${
                              enabled
                                ? 'border-accent/50 bg-accent/10'
                                : 'border-border bg-bg-input hover:bg-bg-hover'
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

              {/* Dynamic Settings Block */}
              {hasSettings && (
                <div className="space-y-4">
                  <label className="text-sm text-text-secondary font-medium flex items-center gap-2">
                    <Settings size={14} />
                    Settings
                  </label>

                  {/* System Prompt */}
                  {mergedConfig.showSystemPrompt && (
                    <div>
                      <label className="text-text-secondary text-xs mb-1.5 block">System Prompt</label>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        rows={5}
                        className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none font-mono"
                        placeholder="Describe how the agent should behave..."
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
                              {models.length > 0 ? (
                                models.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))
                              ) : (
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
                              {categories.map((cat) => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-text-secondary text-xs mb-1.5 block">
                              Max Tokens: {maxTokens}
                            </label>
                            <input
                              type="range"
                              min="256"
                              max="8192"
                              step="256"
                              value={maxTokens}
                              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                              className="w-full accent-accent"
                            />
                          </div>
                        </>
                      )}

                      {mergedConfig.showTemperature && (
                        <div>
                          <label className="text-text-secondary text-xs mb-1.5 block">
                            Temperature: {temperature.toFixed(1)}
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={temperature}
                            onChange={(e) => setTemperature(parseFloat(e.target.value))}
                            className="w-full accent-accent"
                          />
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
                                  <select
                                    value={value ?? ''}
                                    onChange={(e) => updateSkillSetting(skillId, field.key, e.target.value)}
                                    className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                                  >
                                    {field.options.map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                )}
                                {field.type === 'number' && (
                                  <input
                                    type="number"
                                    min={field.min}
                                    max={field.max}
                                    value={value ?? ''}
                                    onChange={(e) => updateSkillSetting(skillId, field.key, parseInt(e.target.value) || field.defaultValue)}
                                    className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                                  />
                                )}
                                {field.type === 'text' && (
                                  <input
                                    type="text"
                                    placeholder={field.placeholder}
                                    value={value ?? ''}
                                    onChange={(e) => updateSkillSetting(skillId, field.key, e.target.value)}
                                    className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                                  />
                                )}
                                {field.type === 'toggle' && (
                                  <button
                                    onClick={() => updateSkillSetting(skillId, field.key, !value)}
                                    className={`w-10 h-5 rounded-full transition-colors ${value ? 'bg-accent' : 'bg-border'}`}
                                  >
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
                          <button
                            key={preset.cron}
                            onClick={() => setCronExpression(preset.cron)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              cronExpression === preset.cron
                                ? 'bg-accent/15 text-accent border border-accent/30'
                                : 'bg-bg-secondary text-text-secondary border border-border hover:bg-bg-hover'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={cronExpression}
                        onChange={e => setCronExpression(e.target.value)}
                        placeholder="Custom cron (e.g. 0 8 * * *)"
                        className="w-full mt-2 bg-bg-secondary border border-border rounded-lg px-3 py-2 text-text-primary text-xs font-mono focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-text-secondary mb-1.5 block">Source Channels</label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {chats.filter(c => c.type === 'channel').map(ch => (
                          <label key={ch.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sourceChats.includes(ch.id)}
                              onChange={() => {
                                setSourceChats(prev =>
                                  prev.includes(ch.id) ? prev.filter(id => id !== ch.id) : [...prev, ch.id]
                                )
                              }}
                              className="accent-accent"
                            />
                            <span className="text-sm text-text-primary">{ch.name}</span>
                          </label>
                        ))}
                        {chats.filter(c => c.type === 'channel').length === 0 && (
                          <span className="text-xs text-text-secondary">No channels available</span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-border/50">
                      <button
                        onClick={async () => {
                          if (!selected) return
                          await api.saveAgentSchedule(selected, {
                            cronExpression,
                            taskType: 'digest',
                            config: { sourceChats },
                            enabled: true,
                          })
                          setScheduleEnabled(true)
                        }}
                        className="flex-1 bg-accent/15 text-accent py-2 rounded-lg text-sm font-medium hover:bg-accent/25 transition-colors"
                      >
                        Save Schedule
                      </button>
                      <button
                        onClick={async () => {
                          if (!selected) return
                          setRunningNow(true)
                          try {
                            await api.runAgentSchedule(selected)
                            alert('Digest task completed!')
                          } catch (err: any) {
                            alert(`Error: ${err.message}`)
                          } finally {
                            setRunningNow(false)
                          }
                        }}
                        disabled={runningNow || sourceChats.length === 0}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-bg-secondary text-text-primary hover:bg-bg-hover border border-border transition-colors disabled:opacity-30"
                      >
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
                    <div className="text-text-primary text-sm font-medium">Publish to Agent Store</div>
                    <div className="text-text-secondary text-xs">Make this agent available to everyone</div>
                  </div>
                </div>
                <button
                  onClick={() => setIsPublic(!isPublic)}
                  className={`w-12 h-6 rounded-full transition-colors ${isPublic ? 'bg-accent' : 'bg-border'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={!name || saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-lg font-medium disabled:opacity-30 transition-colors"
                >
                  <Save size={18} />
                  {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
                </button>

                {selected && (
                  <button
                    onClick={handleDelete}
                    className="px-4 py-3 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 hidden md:flex items-center justify-center">
            <div className="text-center">
              <Sparkles size={48} className="text-text-secondary/30 mx-auto mb-4" />
              <h2 className="text-xl text-text-primary font-medium">My Agents</h2>
              <p className="text-text-secondary mt-2">Select an agent to configure</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
