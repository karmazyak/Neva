import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAgentStore } from '../stores/agentStore'
import {
  ArrowLeft,
  Store,
  Search,
  Star,
  Download,
  Check,
  Bot,
  TrendingUp,
  Clock,
  Terminal,
  Zap,
  X,
} from 'lucide-react'

const SKILL_MAP: Record<string, { name: string; icon: string; command: string }> = {
  text_reply: { name: 'Text Reply', icon: '💬', command: '/reply' },
  image_generate: { name: 'Image Gen', icon: '🎨', command: '/image' },
  translate: { name: 'Translate', icon: '🌍', command: '/translate' },
  summarize: { name: 'Summarize', icon: '📋', command: '/summarize' },
  web_search: { name: 'Search', icon: '🔍', command: '/search' },
  stt: { name: 'Speech-to-Text', icon: '🎤', command: '/transcribe' },
}

export default function Marketplace() {
  const navigate = useNavigate()
  const { marketplaceAgents, loadMarketplace, installAgent } = useAgentStore()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('popular')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [showInstallCard, setShowInstallCard] = useState<any>(null)

  useEffect(() => {
    loadMarketplace({ q: search || undefined, category: category || undefined, sort })
  }, [search, category, sort])

  const handleInstall = async (agent: any) => {
    setInstalling(agent.id)
    try {
      const result = await installAgent(agent.id)
      setInstalled((prev) => new Set([...prev, agent.id]))
      // Show install success card with commands
      setShowInstallCard({ ...agent, installedId: result.id })
    } catch (err) {
      console.error('Failed to install agent:', err)
    } finally {
      setInstalling(null)
    }
  }

  const categories = [
    'All', 'Assistant', 'Copywriter', 'Translator',
    'Coder', 'Customer Support', 'Creative', 'Education',
  ]

  const sortOptions = [
    { value: 'popular', label: 'Popular', icon: TrendingUp },
    { value: 'rating', label: 'Top Rated', icon: Star },
    { value: 'newest', label: 'Newest', icon: Clock },
  ]

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate('/')} className="p-1 text-text-secondary hover:text-text-primary">
            <ArrowLeft size={22} />
          </button>
          <Store size={22} className="text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">Agent Store</h1>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-input rounded-full pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat === 'All' ? '' : cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                (cat === 'All' && !category) || category === cat
                  ? 'bg-accent text-white'
                  : 'bg-bg-input text-text-secondary hover:bg-bg-hover'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex gap-4 px-4 pb-3">
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                sort === opt.value ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <opt.icon size={14} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Agent grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {marketplaceAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <Bot size={48} className="opacity-30 mb-4" />
            <p>No agents found</p>
            <p className="text-sm mt-1">Try a different search or category</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {marketplaceAgents.map((agent) => {
              const agentTools = (agent.tools as string[]) || []
              const agentModes = (agent.modes as string[]) || ['command']
              const skills = agentTools
                .filter(t => t !== 'text_reply' && SKILL_MAP[t])
                .map(t => SKILL_MAP[t])

              return (
                <div
                  key={agent.id}
                  className="bg-bg-secondary rounded-xl p-4 border border-border hover:border-accent/30 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
                      <Bot size={24} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-text-primary font-semibold truncate">{agent.name}</h3>
                      <p className="text-text-secondary text-xs">by {agent.ownerName}</p>
                    </div>
                    {agent.featured && (
                      <span className="bg-accent/20 text-accent text-xs px-2 py-0.5 rounded-full">Featured</span>
                    )}
                  </div>

                  <p className="text-text-secondary text-sm mb-3 line-clamp-2">
                    {agent.description || 'No description'}
                  </p>

                  {/* Skills/Commands provided */}
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {skills.map(s => (
                        <span key={s.command} className="inline-flex items-center gap-1 bg-bg-input text-text-secondary text-[11px] px-2 py-0.5 rounded-full">
                          <span>{s.icon}</span>
                          <span className="font-mono">{s.command}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Modes */}
                  <div className="flex items-center gap-2 mb-3">
                    {agentModes.map(m => (
                      <span key={m} className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
                        {m === 'command' && <Terminal size={10} />}
                        {m === 'auto' && <Zap size={10} />}
                        {m === 'background' && <Clock size={10} />}
                        {m}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-text-secondary mb-3">
                    <span className="flex items-center gap-1">
                      <Star size={12} className="text-yellow-500" />
                      {(agent.rating || 0).toFixed(1)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Download size={12} />
                      {agent.downloads || 0}
                    </span>
                    {agent.category && (
                      <span className="bg-bg-input px-2 py-0.5 rounded-full">
                        {agent.category}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleInstall(agent)}
                    disabled={installing === agent.id || installed.has(agent.id)}
                    className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                      installed.has(agent.id)
                        ? 'bg-green-online/20 text-green-online'
                        : 'bg-accent hover:bg-accent-hover text-white disabled:opacity-50'
                    }`}
                  >
                    {installed.has(agent.id) ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Check size={16} /> Installed
                      </span>
                    ) : installing === agent.id ? (
                      'Installing...'
                    ) : agent.price ? (
                      `$${agent.price}`
                    ) : (
                      'Install Free'
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Install success card */}
      {showInstallCard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-secondary rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Agent Installed!</h3>
              <button onClick={() => setShowInstallCard(null)} className="text-text-secondary hover:text-text-primary">
                <X size={20} />
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <Bot size={24} className="text-accent" />
              </div>
              <div>
                <div className="text-text-primary font-medium">{showInstallCard.name}</div>
                <div className="text-text-secondary text-xs">{showInstallCard.description}</div>
              </div>
            </div>

            {/* Commands this agent provides */}
            {(() => {
              const tools = (showInstallCard.tools as string[]) || []
              const skills = tools
                .filter((t: string) => t !== 'text_reply' && SKILL_MAP[t])
                .map((t: string) => SKILL_MAP[t])

              return skills.length > 0 ? (
                <div className="mb-4">
                  <p className="text-sm text-text-secondary mb-2">New commands available in chat:</p>
                  <div className="space-y-1.5">
                    {skills.map((s: any) => (
                      <div key={s.command} className="flex items-center gap-2 bg-bg-input rounded-lg px-3 py-2">
                        <span className="text-lg">{s.icon}</span>
                        <span className="font-mono text-accent text-sm">{s.command}</span>
                        <span className="text-text-secondary text-xs">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            })()}

            <p className="text-xs text-text-secondary mb-4">
              Type <span className="font-mono text-accent">/</span> in any chat to see available commands. You can customize commands in Agent Builder.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setShowInstallCard(null)}
                className="flex-1 py-2.5 rounded-lg bg-bg-input text-text-primary text-sm font-medium hover:bg-bg-hover transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { setShowInstallCard(null); navigate('/agents') }}
                className="flex-1 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Customize
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
