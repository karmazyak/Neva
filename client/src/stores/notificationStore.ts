import { create } from 'zustand'

interface NotificationSettings {
  soundEnabled: boolean
  notificationsEnabled: boolean
  mutedChats: Set<string>
  volume: number // 0-1
}

interface NotificationState extends NotificationSettings {
  setSoundEnabled: (enabled: boolean) => void
  setNotificationsEnabled: (enabled: boolean) => void
  muteChat: (chatId: string) => void
  unmuteChat: (chatId: string) => void
  isMuted: (chatId: string) => boolean
  setVolume: (volume: number) => void
}

function loadSettings(): Partial<NotificationSettings> {
  try {
    const raw = localStorage.getItem('notification_settings')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return {
      soundEnabled: parsed.soundEnabled ?? true,
      notificationsEnabled: parsed.notificationsEnabled ?? true,
      mutedChats: new Set(parsed.mutedChats || []),
      volume: parsed.volume ?? 0.5,
    }
  } catch {
    return {}
  }
}

function saveSettings(state: NotificationSettings) {
  localStorage.setItem('notification_settings', JSON.stringify({
    soundEnabled: state.soundEnabled,
    notificationsEnabled: state.notificationsEnabled,
    mutedChats: Array.from(state.mutedChats),
    volume: state.volume,
  }))
}

const defaults = loadSettings()

export const useNotificationStore = create<NotificationState>((set, get) => ({
  soundEnabled: defaults.soundEnabled ?? true,
  notificationsEnabled: defaults.notificationsEnabled ?? true,
  mutedChats: defaults.mutedChats ?? new Set(),
  volume: defaults.volume ?? 0.5,

  setSoundEnabled: (enabled) => {
    set({ soundEnabled: enabled })
    saveSettings({ ...get(), soundEnabled: enabled })
  },

  setNotificationsEnabled: (enabled) => {
    set({ notificationsEnabled: enabled })
    saveSettings({ ...get(), notificationsEnabled: enabled })
  },

  muteChat: (chatId) => {
    const mutedChats = new Set(get().mutedChats)
    mutedChats.add(chatId)
    set({ mutedChats })
    saveSettings({ ...get(), mutedChats })
  },

  unmuteChat: (chatId) => {
    const mutedChats = new Set(get().mutedChats)
    mutedChats.delete(chatId)
    set({ mutedChats })
    saveSettings({ ...get(), mutedChats })
  },

  isMuted: (chatId) => get().mutedChats.has(chatId),

  setVolume: (volume) => {
    set({ volume })
    saveSettings({ ...get(), volume })
  },
}))
