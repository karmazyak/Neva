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
  mutualContactName?: string
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

interface NetworkState {
  needs: Need[]
  offers: Offer[]
  matches: Match[]
  consentRequests: ConsentRequest[]
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
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  needs: [],
  offers: [],
  matches: [],
  consentRequests: [],
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
}))
