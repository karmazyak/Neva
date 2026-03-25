import { useState, useEffect } from 'react'
import { X, Bot, Zap, MessageSquare, Terminal, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useAgentStore } from '../../stores/agentStore'

interface AgentToggleProps {
  chatId: string
  onClose: () => void
}

export default function AgentToggle({ chatId, onClose }: AgentToggleProps) {
  const { agents, loadAgents } = useAgentStore()
  const [config, setConfig] = useState<any>(null)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [triggerMode, setTriggerMode] = useState('auto')
  const [sharedWithGroup, setSharedWithGroup] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAgents()
    loadConfig()
  }, [chatId])

  const loadConfig = async () => {
    try {
      const cfg = await api.getAgentConfig(chatId)
      setConfig(cfg)
      if (cfg) {
        setSelectedAgent(cfg.agentId)
        setTriggerMode(cfg.triggerMode)
      }
    } catch {} finally {
      setLoading(false)
    }
  }

  const handleAssign = async () => {
    if (!selectedAgent) return
    try {
      await api.assignAgent({ agentId: selectedAgent, chatId, triggerMode })
      await loadConfig()
    } catch (err) {
      console.error('Failed to assign agent:', err)
    }
  }

  const handleRemove = async () => {
    try {
      await api.removeAgentFromChat(chatId)
      setConfig(null)
      setSelectedAgent('')
    } catch {}
  }

  const triggerModes = [
    { value: 'auto', label: 'Auto-reply', icon: Zap, desc: 'Responds to all messages' },
    { value: 'mention', label: 'On mention', icon: MessageSquare, desc: 'When @mentioned' },
    { value: 'command', label: 'Commands', icon: Terminal, desc: 'On / commands only' },
  ]

  return (
    <div className="bg-bg-secondary border-b border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-accent" />
          <span className="font-medium text-text-primary text-sm">AI Agent</span>
        </div>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
          <X size={18} />
        </button>
      </div>

      {loading ? (
        <div className="text-text-secondary text-sm">Loading...</div>
      ) : config ? (
        <div className="space-y-2">
          <div className="bg-accent/10 rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-accent font-medium text-sm">{config.agentName}</div>
              <div className="text-text-secondary text-xs">{config.agentModel} &middot; {config.triggerMode}</div>
            </div>
            <button
              onClick={handleRemove}
              className="text-danger text-xs hover:underline"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.length === 0 ? (
            <p className="text-text-secondary text-sm">
              No agents yet. Create one in "My Agents".
            </p>
          ) : (
            <>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Select an agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>

              <div className="flex gap-2">
                {triggerModes.map((mode) => (
                  <button
                    key={mode.value}
                    onClick={() => setTriggerMode(mode.value)}
                    className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-colors ${
                      triggerMode === mode.value
                        ? 'bg-accent/20 text-accent'
                        : 'bg-bg-input text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    <mode.icon size={16} />
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>

              {/* Shared with group toggle */}
              <label className="flex items-center gap-2.5 bg-bg-input rounded-lg px-3 py-2.5 cursor-pointer">
                <Users size={16} className={sharedWithGroup ? 'text-accent' : 'text-text-secondary'} />
                <span className="flex-1 text-sm text-text-primary">Shared with group</span>
                <div
                  onClick={() => setSharedWithGroup(!sharedWithGroup)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${sharedWithGroup ? 'bg-accent' : 'bg-bg-hover'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sharedWithGroup ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </label>
              <p className="text-[11px] text-text-secondary -mt-1 px-1">
                {sharedWithGroup ? 'All group members can use this agent' : 'Only you can use this agent in this chat'}
              </p>

              <button
                onClick={handleAssign}
                disabled={!selectedAgent}
                className="w-full bg-accent hover:bg-accent-hover text-white py-2 rounded-lg text-sm font-medium disabled:opacity-30 transition-colors"
              >
                Enable Agent
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
