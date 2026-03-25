import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAgentStore } from '../stores/agentStore'
import {
  ArrowLeft,
  Sparkles,
  Send,
  Trash2,
  Bot,
  ChevronDown,
  Loader2,
  Search,
  MessageSquare,
  BarChart3,
  Zap,
  Check,
  X,
  Edit3,
  MessageCircle,
  Target,
  Bell,
} from 'lucide-react'

interface PendingAction {
  id: string
  type: 'send_message'
  chatId: string
  chatName: string
  content: string
  status?: 'pending' | 'sent' | 'error'
  errorMessage?: string
}

interface AutopilotEvent {
  type: 'message_sent' | 'waiting_reply' | 'reply_received' | 'task_complete' | 'task_failed'
  chatName?: string
  content?: string
  timestamp: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolsUsed?: string[]
  pendingActions?: PendingAction[]
  autopilotEvents?: AutopilotEvent[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderMarkdown(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n?([\s\S]*?)```/)
      if (match) {
        return (
          <pre key={i} className="bg-[#0d1117] rounded-lg p-3 my-2 overflow-x-auto text-[13px] leading-relaxed">
            {match[2] && <div className="text-text-secondary text-[11px] mb-1 uppercase">{match[1]}</div>}
            <code className="font-mono text-green-300">{match[2] || match[1]}</code>
          </pre>
        )
      }
    }
    const lines = part.split('\n')
    return lines.map((line, j) => {
      // Escape HTML first to prevent XSS, then apply safe formatting
      const escaped = escapeHtml(line)
      let formatted = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      formatted = formatted.replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono">$1</code>')
      return (
        <span key={`${i}-${j}`}>
          <span dangerouslySetInnerHTML={{ __html: formatted }} />
          {j < lines.length - 1 && <br />}
        </span>
      )
    })
  })
}

const TOOL_LABELS: Record<string, string> = {
  get_my_chats: 'Получаю список чатов',
  get_chat_history: 'Читаю историю чата',
  search_messages: 'Ищу в сообщениях',
  get_contacts: 'Загружаю контакты',
  draft_message: 'Готовлю сообщение',
  get_chat_stats: 'Считаю статистику',
  web_search: 'Ищу в интернете',
  search_channels: 'Ищу в каналах',
  forward_message: 'Пересылаю сообщение',
  send_message: 'Отправляю сообщение',
  wait_for_reply: 'Жду ответ...',
}

const QUICK_ACTIONS = [
  { icon: MessageCircle, label: 'Ответить', prompt: 'Помоги написать ответ в чате ' },
  { icon: Target, label: 'Продать', prompt: 'Помоги продать/убедить клиента в чате ' },
  { icon: Bell, label: 'Напомнить', prompt: 'Напомни в чате ' },
  { icon: Search, label: 'Поиск', prompt: 'Найди в моих сообщениях ' },
  { icon: MessageSquare, label: 'Саммари', prompt: 'Расскажи что нового в чате ' },
  { icon: BarChart3, label: 'Статистика', prompt: 'Покажи статистику общения за ' },
]

export default function AIChat() {
  const navigate = useNavigate()
  const { agents, loadAgents } = useAgentStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [showAgentSelect, setShowAgentSelect] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [autopilot, setAutopilot] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    loadAgents()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTools])

  const handleSend = async (customMessage?: string) => {
    const text = customMessage || input.trim()
    if (!text || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)
    setActiveTools([])

    if (inputRef.current) inputRef.current.style.height = 'auto'

    try {
      const result = await api.aiChat({
        message: text,
        agentId: selectedAgent || undefined,
        autopilot: autopilot || undefined,
      })

      setActiveTools([])
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.response,
          toolsUsed: result.toolsUsed,
          pendingActions: result.pendingActions,
          autopilotEvents: result.autopilotEvents,
        },
      ])
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Ошибка: ${err.message}` },
      ])
    } finally {
      setLoading(false)
      setActiveTools([])
      inputRef.current?.focus()
    }
  }

  const handleConfirmAction = async (actionId: string, msgIndex: number) => {
    try {
      await api.confirmAiAction(actionId)

      // Update the action card inline to show "sent" status
      setMessages((prev) =>
        prev.map((msg, i) => {
          if (i === msgIndex && msg.pendingActions) {
            return {
              ...msg,
              pendingActions: msg.pendingActions.map((a) =>
                a.id === actionId ? { ...a, status: 'sent' as const } : a
              ),
            }
          }
          return msg
        })
      )
    } catch (err: any) {
      // Show error inline on the action card
      setMessages((prev) =>
        prev.map((msg, i) => {
          if (i === msgIndex && msg.pendingActions) {
            return {
              ...msg,
              pendingActions: msg.pendingActions.map((a) =>
                a.id === actionId ? { ...a, status: 'error' as const, errorMessage: err.message } : a
              ),
            }
          }
          return msg
        })
      )
    }
  }

  const handleRejectAction = (actionId: string, msgIndex: number) => {
    setMessages((prev) =>
      prev.map((msg, i) => {
        if (i === msgIndex && msg.pendingActions) {
          return {
            ...msg,
            pendingActions: msg.pendingActions.filter((a) => a.id !== actionId),
          }
        }
        return msg
      })
    )
  }

  const handleClear = async () => {
    setMessages([])
    await api.clearAiHistory().catch(() => {})
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }

  const currentAgent = agents.find((a) => a.id === selectedAgent)

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button onClick={() => navigate('/')} className="hidden md:block p-1 text-text-secondary hover:text-text-primary">
          <ArrowLeft size={22} />
        </button>

        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} className="text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-text-primary">
            {currentAgent ? currentAgent.name : 'AI Assistant'}
          </h2>
        </div>

        {/* Agent selector */}
        <div className="relative">
          <button
            onClick={() => setShowAgentSelect(!showAgentSelect)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-input text-text-secondary text-sm hover:bg-bg-hover transition-colors"
          >
            <Bot size={16} />
            <ChevronDown size={14} />
          </button>

          {showAgentSelect && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowAgentSelect(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-bg-secondary border border-border rounded-xl shadow-xl z-20 py-1 max-h-[300px] overflow-y-auto">
                <button
                  onClick={() => { setSelectedAgent(''); setShowAgentSelect(false) }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-bg-hover transition-colors ${
                    !selectedAgent ? 'text-accent' : 'text-text-primary'
                  }`}
                >
                  Default Assistant
                </button>
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => { setSelectedAgent(agent.id); setShowAgentSelect(false) }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-bg-hover transition-colors ${
                      selectedAgent === agent.id ? 'text-accent' : 'text-text-primary'
                    }`}
                  >
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-xs text-text-secondary truncate">{agent.description}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Autopilot toggle */}
        <button
          onClick={() => setAutopilot(!autopilot)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            autopilot
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'bg-bg-input text-text-secondary hover:bg-bg-hover border border-transparent'
          }`}
          title={autopilot ? 'Автопилот включён' : 'Включить автопилот'}
        >
          <Zap size={14} className={autopilot ? 'animate-pulse' : ''} />
          <span className="hidden sm:inline">Автопилот</span>
        </button>

        <button
          onClick={handleClear}
          className="p-2 rounded-full hover:bg-bg-hover text-text-secondary transition-colors"
          title="Clear history"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{
        backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(147, 51, 234, 0.05) 0%, transparent 50%), radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.05) 0%, transparent 50%)',
      }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center mb-4">
              <Zap size={36} className="text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">AI Assistant</h3>
            <p className="text-text-secondary max-w-md text-sm mb-6">
              Я могу отправлять сообщения, вести переговоры, искать в переписках и делать задачи за тебя.
            </p>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-3 gap-2 max-w-sm w-full">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    setInput(action.prompt)
                    inputRef.current?.focus()
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-bg-secondary border border-border rounded-xl text-sm text-text-secondary hover:text-accent hover:border-accent/30 transition-colors"
                >
                  <action.icon size={20} />
                  <span className="text-xs">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
              <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0 self-end">
                    <Sparkles size={14} className="text-white" />
                  </div>
                )}
                <div>
                  {/* Tool usage badges */}
                  {msg.role === 'assistant' && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {[...new Set(msg.toolsUsed)].map((tool, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-[11px] text-purple-300"
                        >
                          <Zap size={10} />
                          {TOOL_LABELS[tool] || tool}
                        </span>
                      ))}
                    </div>
                  )}

                  <div
                    className={`rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-bg-bubble-own rounded-br-sm'
                        : 'bg-bg-bubble-other rounded-bl-sm'
                    }`}
                  >
                    <div className={`text-text-primary break-words text-[15px] leading-relaxed ${msg.role === 'assistant' ? 'ai-message' : 'whitespace-pre-wrap'}`}>
                      {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pending Actions — message preview cards */}
            {msg.pendingActions && msg.pendingActions.length > 0 && (
              <div className="ml-10 mt-2 space-y-2">
                {msg.pendingActions.map((action) => {
                  const isSent = action.status === 'sent'
                  const isError = action.status === 'error'
                  return (
                    <div
                      key={action.id}
                      className={`border rounded-xl p-3 max-w-[80%] ${
                        isSent
                          ? 'border-green-500/30 bg-green-500/5'
                          : isError
                          ? 'border-red-500/30 bg-red-500/5'
                          : 'border-accent/30 bg-accent/5'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare size={14} className={isSent ? 'text-green-400' : isError ? 'text-red-400' : 'text-accent'} />
                        <span className="text-xs text-text-secondary">
                          {isSent ? 'Отправлено в' : isError ? 'Ошибка отправки в' : 'Отправить в'} <strong className="text-text-primary">{action.chatName}</strong>
                        </span>
                      </div>
                      <div className="text-sm text-text-primary bg-bg-primary rounded-lg p-2.5 mb-2">
                        {action.content}
                      </div>
                      {!isSent && !isError && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleConfirmAction(action.id, i)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-xs transition-colors"
                          >
                            <Check size={14} />
                            Отправить
                          </button>
                          <button
                            onClick={() => handleRejectAction(action.id, i)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs transition-colors"
                          >
                            <X size={14} />
                            Отмена
                          </button>
                          <button
                            onClick={() => {
                              setInput(`Перепиши сообщение для "${action.chatName}": ${action.content}`)
                              handleRejectAction(action.id, i)
                              inputRef.current?.focus()
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-text-secondary rounded-lg text-xs transition-colors"
                          >
                            <Edit3 size={14} />
                            Изменить
                          </button>
                        </div>
                      )}
                      {isSent && (
                        <div className="flex items-center gap-1 text-green-400 text-xs">
                          <Check size={14} />
                          Сообщение отправлено
                        </div>
                      )}
                      {isError && (
                        <div className="flex items-center gap-1 text-red-400 text-xs">
                          <X size={14} />
                          {action.errorMessage || 'Ошибка отправки'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Autopilot Timeline */}
            {msg.autopilotEvents && msg.autopilotEvents.length > 0 && (
              <div className="ml-10 mt-2 space-y-1.5">
                {msg.autopilotEvents.map((event, j) => {
                  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  const preview = event.content ? (event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content) : ''

                  return (
                    <div key={j} className="flex items-start gap-2 text-xs">
                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                        event.type === 'message_sent' ? 'bg-green-400' :
                        event.type === 'waiting_reply' ? 'bg-amber-400 animate-pulse' :
                        event.type === 'reply_received' ? 'bg-blue-400' :
                        event.type === 'task_complete' ? 'bg-green-400' :
                        'bg-red-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className={`font-medium ${
                          event.type === 'message_sent' ? 'text-green-400' :
                          event.type === 'waiting_reply' ? 'text-amber-400' :
                          event.type === 'reply_received' ? 'text-blue-400' :
                          event.type === 'task_complete' ? 'text-green-400' :
                          'text-red-400'
                        }`}>
                          {event.type === 'message_sent' && `Отправлено в ${event.chatName}`}
                          {event.type === 'waiting_reply' && `Ожидание ответа в ${event.chatName}...`}
                          {event.type === 'reply_received' && `Ответ от ${event.chatName}`}
                          {event.type === 'task_complete' && 'Задача выполнена'}
                          {event.type === 'task_failed' && `Ошибка: ${event.chatName}`}
                        </span>
                        {preview && (
                          <p className="text-text-secondary truncate">{preview}</p>
                        )}
                      </div>
                      <span className="text-text-secondary flex-shrink-0">{time}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 message-enter">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <div className="bg-bg-bubble-other rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="typing-indicator flex gap-1">
                <span className="w-2 h-2 bg-text-secondary rounded-full" />
                <span className="w-2 h-2 bg-text-secondary rounded-full" />
                <span className="w-2 h-2 bg-text-secondary rounded-full" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions bar when there are messages */}
      {messages.length > 0 && !loading && (
        <div className="flex gap-1.5 px-4 py-2 overflow-x-auto no-scrollbar">
          {QUICK_ACTIONS.slice(0, 4).map((action) => (
            <button
              key={action.label}
              onClick={() => {
                setInput(action.prompt)
                inputRef.current?.focus()
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-bg-secondary border border-border rounded-full text-xs text-text-secondary hover:text-accent hover:border-accent/30 transition-colors whitespace-nowrap flex-shrink-0"
            >
              <action.icon size={12} />
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 px-4 py-3 bg-bg-secondary border-t border-border">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Напиши задачу для AI..."
            rows={1}
            className="w-full bg-bg-input rounded-2xl px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none resize-none text-[15px] leading-[1.35] max-h-[150px]"
          />
        </div>
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          className="p-2.5 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 rounded-full text-white transition-all disabled:opacity-30 flex-shrink-0 self-end"
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
        </button>
      </div>
    </div>
  )
}
