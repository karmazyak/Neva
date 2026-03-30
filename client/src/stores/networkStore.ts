import { create } from 'zustand'
import { api } from '../lib/api'

export interface Need {
  id: string
  description: string
  category: string
  urgency: string
  visibility: string
  status: string
  source: string
  createdAt: string
  expiresAt: string
}

export interface Offer {
  id: string
  description: string
  category: string
  availability: string
}

export interface Match {
  userId: string
  offerId: string
  offerDescription: string
  similarity: number
  trustScore: number
  socialDistance: number
  finalScore: number
  displayName?: string
  mutualContactId?: string
  mutualContactName?: string
  providerId?: string
}

export interface ConsentRequest {
  id: string
  fromUserId: string
  fromName?: string
  type: string
  context: string
  status: string
  createdAt: string
}

export interface PrivacyVaultSettings {
  shareInterests: boolean
  shareExpertise: boolean
  shareAvailability: boolean
  shareMood: boolean
  shareFacts: boolean
  publicBio: string | null
  publicInterests: string[]
  publicExpertise: string[]
  blockedUserIds: string[]
}

export interface MutualMatchResult {
  offerId: string
  offerDescription: string
  similarity: number
  trustScore: number
  socialDistance: number
  hasMutualContact: boolean
  finalScore: number
}

export interface MutualMatchEntry {
  id: string
  side: 'requester' | 'provider'
  needDescription?: string
  offerDescription?: string
  similarityScore?: number
  socialDistance?: number
  myConsent: string
  otherConsent: string
  status: string
  partnerName?: string | null
  partnerId?: string | null
  createdAt: string
}

interface NetworkState {
  needs: Need[]
  offers: Offer[]
  matches: Match[]
  consentRequests: ConsentRequest[]
  vault: PrivacyVaultSettings | null
  mutualMatches: MutualMatchEntry[]
  loading: boolean
  sheetOpen: boolean

  setSheetOpen: (open: boolean) => void
  loadNeeds: () => Promise<void>
  loadOffers: () => Promise<void>
  loadMatches: () => Promise<void>
  loadConsent: () => Promise<void>
  loadAll: () => Promise<void>
  createNeed: (data: { description: string; category: string; urgency?: string; visibility?: string }) => Promise<Need | null>
  createOffer: (data: { description: string; category: string }) => Promise<void>
  deleteNeed: (id: string) => Promise<void>
  deleteOffer: (id: string) => Promise<void>
  triggerMatch: (needId: string) => Promise<Match[]>
  respondConsent: (requestId: string, approved: boolean) => Promise<void>
  // Privacy Vault
  loadVault: () => Promise<void>
  updateVault: (updates: Partial<PrivacyVaultSettings>) => Promise<void>
  // Mutual Match
  searchMutualMatch: (description: string, category?: string, visibility?: string) => Promise<{ mutual: MutualMatchResult[]; oneWay: Match[]; needId?: string }>
  initiateMutualMatch: (needId: string, offerId: string) => Promise<boolean>
  respondMutualMatch: (mutualMatchId: string, approved: boolean) => Promise<boolean>
  loadMutualMatches: () => Promise<void>
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  needs: [],
  offers: [],
  matches: [],
  consentRequests: [],
  vault: null,
  mutualMatches: [],
  loading: false,
  sheetOpen: false,

  setSheetOpen: (open) => set({ sheetOpen: open }),

  loadNeeds: async () => {
    try {
      const res = await api.getMyNeeds()
      set({ needs: res.needs || [] })
    } catch {}
  },

  loadOffers: async () => {
    try {
      const res = await api.getMyOffers()
      set({ offers: res.offers || [] })
    } catch {}
  },

  loadMatches: async () => {
    try {
      const res = await api.getMyMatches()
      set({ matches: res.matches || [] })
    } catch {}
  },

  loadConsent: async () => {
    try {
      const res = await api.getConsentRequests()
      set({ consentRequests: res.requests || [] })
    } catch {}
  },

  loadAll: async () => {
    set({ loading: true })
    await Promise.all([get().loadNeeds(), get().loadOffers(), get().loadMatches(), get().loadConsent()])
    set({ loading: false })
  },

  createNeed: async (data) => {
    const res = await api.createNeed(data)
    await get().loadNeeds()
    return (res?.need as Need) || null
  },

  createOffer: async (data) => {
    await api.createOffer(data)
    await get().loadOffers()
  },

  deleteNeed: async (id) => {
    await api.deleteNeed(id)
    set({ needs: get().needs.filter(n => n.id !== id) })
  },

  deleteOffer: async (id) => {
    await api.deleteOffer(id)
    set({ offers: get().offers.filter(o => o.id !== id) })
  },

  triggerMatch: async (needId) => {
    const res = await api.triggerMatch(needId)
    set({ matches: res.matches || [] })
    return res.matches || []
  },

  respondConsent: async (requestId, approved) => {
    await api.respondConsent(requestId, approved)
    set({ consentRequests: get().consentRequests.filter(c => c.id !== requestId) })
  },

  // ── Privacy Vault ─────────────────────────────────────────────────────

  loadVault: async () => {
    try {
      const res = await fetch('/api/agent/vault', {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()
      set({ vault: data.vault })
    } catch {}
  },

  updateVault: async (updates) => {
    try {
      const res = await fetch('/api/agent/vault', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (data.ok) set({ vault: data.vault })
    } catch {}
  },

  // ── Mutual Match ──────────────────────────────────────────────────────

  searchMutualMatch: async (description, category = 'professional', visibility = 'friends_of_friends') => {
    try {
      const res = await fetch('/api/agent/mutual-match/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ description, category, visibility }),
      })
      const data = await res.json()
      return { mutual: data.mutual || [], oneWay: data.oneWay || [], needId: data.needId }
    } catch {
      return { mutual: [], oneWay: [] }
    }
  },

  initiateMutualMatch: async (needId, offerId) => {
    try {
      const res = await fetch('/api/agent/mutual-match/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ needId, offerId }),
      })
      return res.ok
    } catch {
      return false
    }
  },

  respondMutualMatch: async (mutualMatchId, approved) => {
    try {
      const res = await fetch(`/api/agent/mutual-match/${mutualMatchId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ approved }),
      })
      return res.ok
    } catch {
      return false
    }
  },

  loadMutualMatches: async () => {
    try {
      const res = await fetch('/api/agent/mutual-matches', {
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      const data = await res.json()
      set({ mutualMatches: data.matches || [] })
    } catch {}
  },
}))
