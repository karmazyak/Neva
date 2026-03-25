import { create } from 'zustand'
import { api } from '../lib/api'

interface User {
  id: string
  username: string
  displayName: string
  email: string
  avatar: string | null
  bio: string | null
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (login: string, password: string) => Promise<void>
  register: (username: string, displayName: string, email: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (login, password) => {
    const { token, user } = await api.login({ login, password })
    api.setToken(token)
    set({ user })
  },

  register: async (username, displayName, email, password) => {
    const { token, user } = await api.register({ username, displayName, email, password })
    api.setToken(token)
    set({ user })
  },

  logout: () => {
    api.setToken(null)
    set({ user: null })
  },

  checkAuth: async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) {
        set({ loading: false })
        return
      }
      api.setToken(token)
      const user = await api.getMe()
      set({ user, loading: false })
    } catch {
      api.setToken(null)
      set({ user: null, loading: false })
    }
  },
}))
