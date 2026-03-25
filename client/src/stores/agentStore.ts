import { create } from 'zustand'
import { api } from '../lib/api'

interface Agent {
  id: string
  ownerId: string
  name: string
  description: string | null
  avatar: string | null
  systemPrompt: string
  model: string
  tools: string[]
  modes: string[]
  temperature: number
  maxTokens: number
  isPublic: boolean
  category: string | null
  rating: number
  downloads: number
  price: number
  skillSettings: Record<string, Record<string, any>>
  createdAt: string
}

interface UserSkill {
  id: string
  command: string
  customCommand?: string
  name: string
  description: string
  icon: string
  cost: number
  agentId: string
  agentName: string
  agentAvatar: string | null
}

interface AgentState {
  agents: Agent[]
  marketplaceAgents: any[]
  models: { id: string; name: string }[]
  mySkills: UserSkill[]
  loadAgents: () => Promise<void>
  createAgent: (data: Partial<Agent>) => Promise<Agent>
  updateAgent: (id: string, data: Partial<Agent>) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  loadMarketplace: (params?: any) => Promise<void>
  installAgent: (agentId: string) => Promise<any>
  loadModels: () => Promise<void>
  loadMySkills: () => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  marketplaceAgents: [],
  models: [],
  mySkills: [],

  loadAgents: async () => {
    const agents = await api.getAgents()
    set({ agents })
  },

  createAgent: async (data) => {
    const agent = await api.createAgent(data)
    await get().loadAgents()
    await get().loadMySkills()
    return agent
  },

  updateAgent: async (id, data) => {
    await api.updateAgent(id, data)
    await get().loadAgents()
    await get().loadMySkills()
  },

  deleteAgent: async (id) => {
    await api.deleteAgent(id)
    await get().loadAgents()
    await get().loadMySkills()
  },

  loadMarketplace: async (params) => {
    const agents = await api.getMarketplace(params)
    set({ marketplaceAgents: agents })
  },

  installAgent: async (agentId) => {
    const result = await api.installAgent(agentId)
    await get().loadAgents()
    await get().loadMySkills()
    return result
  },

  loadModels: async () => {
    const models = await api.getModels()
    set({ models })
  },

  loadMySkills: async () => {
    try {
      const skills = await api.getMySkills()
      set({ mySkills: skills })
    } catch {
      set({ mySkills: [] })
    }
  },
}))
