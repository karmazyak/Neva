import { create } from 'zustand'
import { api } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentActivity {
  id: string
  type: string
  title: string
  body?: string
  relatedDialogId?: string
  relatedChatId?: string
  relatedUserId?: string
  metadata?: Record<string, any>
  undoable: boolean
  undoneAt?: string
  undoDeadline?: string
  createdAt: string
}

export interface GatherStatus {
  parentDialogId: string
  phase: 'asking' | 'planning' | 'confirming' | 'complete'
  context: string
  friendsAsked: number
  available: Array<{ userId: string; name: string; message?: string; auto?: boolean }>
  unavailable: Array<{ userId: string; name: string; reason?: string; auto?: boolean }>
  pending: number
  plan: { what: string; when: string; where?: string } | null
  status: string
}

export interface IncomingRequest {
  id: string
  dialogId: string
  type: string
  initiatorName: string
  message: string
  contextData?: Record<string, any>
  receivedAt: number
}

// ── Store ────────────────────────────────────────────────────────────────────

interface AgentHubState {
  activities: AgentActivity[]
  pendingCount: number
  currentGather: GatherStatus | null
  incomingRequests: IncomingRequest[]

  loadActivities: (limit?: number) => Promise<void>
  loadPendingCount: () => Promise<void>
  requestUndo: (activityId: string) => Promise<boolean>

  startGather: (context: string, timeoutMinutes?: number, filter?: { minRelationship?: string }) => Promise<string | null>
  loadGatherStatus: (parentDialogId: string) => Promise<void>
  confirmGather: (parentDialogId: string, plan: { what: string; when: string; where?: string }) => Promise<boolean>
  cancelGather: (parentDialogId: string) => Promise<void>
  clearGather: () => void

  respondToRequest: (dialogId: string, approved: boolean, message?: string) => Promise<void>
  dismissRequest: (dialogId: string) => void

  // WS handlers
  handleActivity: (data: any) => void
  handleActivityUndone: (data: any) => void
  handleGatherProgress: (data: any) => void
  handleGatherPlanReady: (data: any) => void
  handleGatherComplete: (data: any) => void
  handleDialogRequest: (data: any) => void
  handleDialogAuto: (data: any) => void
}

export const useAgentHubStore = create<AgentHubState>((set, get) => ({
  activities: [],
  pendingCount: 0,
  currentGather: null,
  incomingRequests: [],

  loadActivities: async (limit = 20) => {
    try {
      const res = await fetch(`/api/agent/activities?limit=${limit}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()
      set({ activities: data.activities || [] })
    } catch (err) {
      console.error('[AgentHub] Failed to load activities:', err)
    }
  },

  loadPendingCount: async () => {
    try {
      const res = await fetch('/api/agent/pending', {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()
      set({ pendingCount: data.count || 0 })
    } catch {}
  },

  requestUndo: async (activityId) => {
    try {
      const res = await fetch(`/api/agent/undo/${activityId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      if (res.ok) {
        set(s => ({
          activities: s.activities.map(a =>
            a.id === activityId ? { ...a, undoneAt: new Date().toISOString(), undoable: false } : a
          ),
        }))
        get().loadPendingCount()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  startGather: async (context, timeoutMinutes = 30, filter) => {
    try {
      const res = await fetch('/api/agent/gather', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ context, timeoutMinutes, filter }),
      })
      const data = await res.json()
      if (data.parentDialogId) {
        set({
          currentGather: {
            parentDialogId: data.parentDialogId,
            phase: 'asking',
            context,
            friendsAsked: data.friendsAsked,
            available: [],
            unavailable: [],
            pending: data.friendsAsked,
            plan: null,
            status: 'pending',
          },
        })
        return data.parentDialogId
      }
      return null
    } catch {
      return null
    }
  },

  loadGatherStatus: async (parentDialogId) => {
    try {
      const res = await fetch(`/api/agent/gather/${parentDialogId}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      if (res.ok) {
        const data = await res.json()
        set({ currentGather: data })
      }
    } catch {}
  },

  confirmGather: async (parentDialogId, plan) => {
    try {
      const res = await fetch(`/api/agent/gather/${parentDialogId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ plan }),
      })
      if (res.ok) {
        set(s => ({
          currentGather: s.currentGather
            ? { ...s.currentGather, phase: 'complete' }
            : null,
        }))
        get().loadActivities()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  cancelGather: async (parentDialogId) => {
    try {
      await fetch(`/api/agent/gather/${parentDialogId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
    } catch {}
    set({ currentGather: null })
  },

  clearGather: () => set({ currentGather: null }),

  respondToRequest: async (dialogId, approved, message) => {
    try {
      await fetch(`/api/agent/dialogs/${dialogId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ approved, message }),
      })
      set(s => ({
        incomingRequests: s.incomingRequests.filter(r => r.dialogId !== dialogId),
        pendingCount: Math.max(0, s.pendingCount - 1),
      }))
    } catch {}
  },

  dismissRequest: (dialogId) => {
    set(s => ({
      incomingRequests: s.incomingRequests.filter(r => r.dialogId !== dialogId),
    }))
  },

  // ── WebSocket handlers ────────────────────────────────────────────────

  handleActivity: (data) => {
    if (data.activity) {
      set(s => ({
        activities: [data.activity, ...s.activities].slice(0, 50),
      }))
    }
  },

  handleActivityUndone: (data) => {
    set(s => ({
      activities: s.activities.map(a =>
        a.id === data.activityId ? { ...a, undoneAt: new Date().toISOString(), undoable: false } : a
      ),
    }))
  },

  handleGatherProgress: (data) => {
    set(s => {
      if (!s.currentGather || s.currentGather.parentDialogId !== data.parentDialogId) return s
      return {
        currentGather: {
          ...s.currentGather,
          available: data.available || s.currentGather.available,
          unavailable: data.unavailable || s.currentGather.unavailable,
          pending: data.pending ?? s.currentGather.pending,
          phase: data.phase || s.currentGather.phase,
        },
      }
    })
  },

  handleGatherPlanReady: (data) => {
    set(s => {
      if (!s.currentGather || s.currentGather.parentDialogId !== data.parentDialogId) return s
      return {
        currentGather: {
          ...s.currentGather,
          phase: data.plan ? 'confirming' : 'complete',
          plan: data.plan,
          available: data.available || s.currentGather.available,
          unavailable: data.unavailable || s.currentGather.unavailable,
          pending: 0,
        },
      }
    })
  },

  handleGatherComplete: (data) => {
    set(s => ({
      currentGather: s.currentGather?.parentDialogId === data.parentDialogId
        ? { ...s.currentGather, phase: 'complete' }
        : s.currentGather,
    }))
    get().loadActivities()
  },

  handleDialogRequest: (data) => {
    const dialog = data.dialog || {}
    set(s => ({
      pendingCount: s.pendingCount + 1,
      incomingRequests: [
        ...s.incomingRequests,
        {
          id: crypto.randomUUID(),
          dialogId: dialog.id || data.dialogId,
          type: dialog.type || 'consent',
          initiatorName: dialog.initiatorName || 'Кто-то',
          message: dialog.message || '',
          contextData: dialog.contextData,
          receivedAt: Date.now(),
        },
      ],
    }))
  },

  handleDialogAuto: () => {
    get().loadActivities()
  },
}))
