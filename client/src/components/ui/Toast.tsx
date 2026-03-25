import { useEffect, useState } from 'react'
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react'

export interface ToastMessage {
  id: string
  type: 'error' | 'success' | 'info'
  message: string
}

let toastListeners: ((toast: ToastMessage) => void)[] = []

// Deduplication: track recently shown messages to prevent spam
const recentMessages = new Map<string, number>()
const DEDUP_WINDOW_MS = 3000 // same message can't appear more than once per 3 seconds

export function showToast(type: ToastMessage['type'], message: string) {
  const key = `${type}:${message}`
  const now = Date.now()
  const lastShown = recentMessages.get(key)
  if (lastShown && now - lastShown < DEDUP_WINDOW_MS) return // suppress duplicate

  recentMessages.set(key, now)
  // Clean up old entries periodically
  if (recentMessages.size > 50) {
    for (const [k, t] of recentMessages) {
      if (now - t > DEDUP_WINDOW_MS) recentMessages.delete(k)
    }
  }

  const toast: ToastMessage = { id: now.toString() + Math.random(), type, message }
  toastListeners.forEach((fn) => fn(toast))
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    const handler = (toast: ToastMessage) => {
      setToasts((prev) => {
        // Keep max 3 toasts visible at once
        const next = [...prev, toast]
        return next.slice(-3)
      })
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, 4000)
    }
    toastListeners.push(handler)
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== handler)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed z-50 space-y-2 bottom-16 left-4 right-4 md:bottom-auto md:left-auto md:top-4 md:right-4 md:max-w-sm">
      {toasts.map((toast) => {
        const Icon = toast.type === 'error' ? AlertCircle : toast.type === 'success' ? CheckCircle : Info
        const colors = toast.type === 'error'
          ? 'bg-red-900/90 border-red-700 text-red-100'
          : toast.type === 'success'
          ? 'bg-green-900/90 border-green-700 text-green-100'
          : 'bg-blue-900/90 border-blue-700 text-blue-100'

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm ${colors} animate-slide-in`}
          >
            <Icon size={18} className="flex-shrink-0 mt-0.5" />
            <p className="text-sm flex-1">{toast.message}</p>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="flex-shrink-0 opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
