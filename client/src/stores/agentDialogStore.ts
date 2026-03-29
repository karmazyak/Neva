import { create } from 'zustand'
import { api } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

export type DialogType = 'whos_free' | 'get_interests' | 'match_proposal' | 'consent'
export type DialogStatus = 'pending' | 'auto_approved' | 'approved' | 'denied' | 'expired' | 'cancelled'

export interface AgentDialog {
  id: string
  type: DialogType
  status: DialogStatus
  initiatorUserId: string
  targetUserId: string
  initiatorName: string
  targetName: string
  contextData: Record<string, any>
  result: Record<string, any> | null
  parentDialogId: string | null
  messagesCount: number
  lastMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface DialogMessage {
  id: string
  agentRole: 'initiator' | 'target'
  content: string
  metadata: Record<string, any> | null
  createdAt: string
}

export interface AutonomyRule {
  id: string
  relationshipLevel: 'close' | 'friend' | 'acquaintance'
  dialogType: string
  action: 'auto_approve' | 'auto_deny' | 'ask_user'
}

export interface WhosFreePartialResult {
  friendId: string
  friendName: string
  available: boolean
  message?: string
  auto: boolean
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface WhosFreeSession {
  dialogId: string
  intentText: string
  friendsAsked: number
}

interface AgentDialogState {
  dialogs: AgentDialog[]
  pendingCount: number
  selectedDialogId: string | null
  selectedDialog: { dialog: AgentDialog; messages: DialogMessage[] } | null
  autonomyRules: AutonomyRule[]
  panelOpen: boolean
  whosFreeResults: Map<string, WhosFreePartialResult[]> // parentDialogId -> results
  activeWhosFreeSession: WhosFreeSession | null

  setPanelOpen: (open: boolean) => void
  setSelectedDialog: (id: string | null) => void
  setActiveWhosFreeSession: (session: WhosFreeSession | null) => void
  loadDialogs: (filters?: { status?: string; type?: string }) => Promise<void>
  loadDialog: (id: string) => Promise<void>
  respondToDialog: (id: string, approved: boolean, message?: string) => Promise<void>
  loadAutonomyRules: () => Promise<void>
  updateAutonomyRules: (rules: Omit<AutonomyRule, 'id'>[]) => Promise<void>
  requestWhosFree: (context: string, timeoutMinutes?: number) => Promise<string>
  requestGetInterests: (targetUserId: string) => Promise<any>

  // Called from WebSocket events
  handleDialogRequest: (data: any) => void
  handleDialogUpdate: (data: any) => void
  handleDialogAuto: (data: any) => void
}

export const useAgentDialogStore = create<AgentDialogState>((set, get) => ({
  dialogs: [],
  pendingCount: 0,
  selectedDialogId: null,
  selectedDialog: null,
  autonomyRules: [],
  panelOpen: false,
  whosFreeResults: new Map(),
  activeWhosFreeSession: null,

  setActiveWhosFreeSession: (session) => set({ activeWhosFreeSession: session }),

  setPanelOpen: (open) => {
    set({ panelOpen: open })
    if (open) get().loadDialogs()
  },

  setSelectedDialog: (id) => {
    set({ selectedDialogId: id })
    if (id) get().loadDialog(id)
    else set({ selectedDialog: null })
  },

  loadDialogs: async (filters) => {
    try {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.type) params.set('type', filters.type)
      params.set('limit', '50')

      const res = await fetch(`/api/agent/dialogs?${params}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()

      set({ dialogs: data.dialogs || [] })

      // Also update pending count
      const pendingRes = await fetch('/api/agent/pending', {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const pendingData = await pendingRes.json()
      set({ pendingCount: pendingData.count || 0 })
    } catch (err) {
      console.error('Failed to load agent dialogs:', err)
    }
  },

  loadDialog: async (id) => {
    try {
      const res = await fetch(`/api/agent/dialogs/${id}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()
      set({ selectedDialog: data })
    } catch (err) {
      console.error('Failed to load dialog:', err)
    }
  },

  respondToDialog: async (id, approved, message) => {
    try {
      await fetch(`/api/agent/dialogs/${id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ approved, message }),
      })

      // Refresh dialogs
      get().loadDialogs()
      if (get().selectedDialogId === id) get().loadDialog(id)
    } catch (err) {
      console.error('Failed to respond to dialog:', err)
    }
  },

  loadAutonomyRules: async () => {
    try {
      const res = await fetch('/api/agent/autonomy', {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()
      set({ autonomyRules: data.rules || [] })
    } catch (err) {
      console.error('Failed to load autonomy rules:', err)
    }
  },

  updateAutonomyRules: async (rules) => {
    try {
      await fetch('/api/agent/autonomy', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ rules }),
      })
      get().loadAutonomyRules()
    } catch (err) {
      console.error('Failed to update autonomy rules:', err)
    }
  },

  requestWhosFree: async (context, timeoutMinutes = 120) => {
    const res = await fetch('/api/agent/whos-free', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.getToken()}`,
      },
      body: JSON.stringify({ context, timeoutMinutes }),
    })
    const data = await res.json()

    // Initialize results for this dialog
    const results = new Map(get().whosFreeResults)
    results.set(data.dialogId, [])
    set({
      whosFreeResults: results,
      activeWhosFreeSession: {
        dialogId: data.dialogId,
        intentText: context,
        friendsAsked: data.friendsAsked || data.friendCount || 5,
      },
    })

    get().loadDialogs()
    return data.dialogId
  },

  requestGetInterests: async (targetUserId) => {
    const res = await fetch('/api/agent/get-interests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.getToken()}`,
      },
      body: JSON.stringify({ targetUserId }),
    })
    const data = await res.json()
    get().loadDialogs()
    return data
  },

  // ── WebSocket Event Handlers ──────────────────────────────────────────────

  handleDialogRequest: (data) => {
    // New dialog request — update pending count
    set(s => ({ pendingCount: s.pendingCount + 1 }))
    // Refresh dialog list if panel is open
    if (get().panelOpen) get().loadDialogs()
  },

  handleDialogUpdate: (data) => {
    // A dialog got updated (response, partial result, etc.)
    if (data.partialResult) {
      // Who's free partial result
      const results = new Map(get().whosFreeResults)
      const dialogResults = results.get(data.dialogId) || []
      dialogResults.push(data.partialResult)
      results.set(data.dialogId, dialogResults)
      set({ whosFreeResults: results })
    }

    // Refresh dialogs
    if (get().panelOpen) get().loadDialogs()
    if (get().selectedDialogId === data.dialogId) get().loadDialog(data.dialogId)
  },

  handleDialogAuto: (data) => {
    // My agent auto-responded to something
    if (get().panelOpen) get().loadDialogs()
  },
}))
