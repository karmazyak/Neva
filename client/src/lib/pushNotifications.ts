import { api } from './api'

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('SW registration failed:', err)
    return null
  }
}

export async function subscribeToPush() {
  try {
    const reg = await navigator.serviceWorker.ready
    const { publicKey } = await api.getVapidKey()
    if (!publicKey) return false

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

    const p256dh = btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!)))
    const auth = btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!)))
    await api.subscribePush({ endpoint: sub.endpoint, keys: { p256dh, auth } })
    return true
  } catch (err) {
    console.error('Push subscription failed:', err)
    return false
  }
}

export async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await api.unsubscribePush(sub.endpoint)
      await sub.unsubscribe()
    }
  } catch {}
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)))
}
