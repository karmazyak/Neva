import webpush from 'web-push'
import { db, schema } from './db'
import { eq } from 'drizzle-orm'

// Initialize VAPID — generate keys if not in env
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@mlsendger.local',
    vapidPublicKey,
    vapidPrivateKey
  )
}

export function getVapidPublicKey() { return vapidPublicKey }

export async function sendPushNotification(userId: string, payload: { title: string; body: string; data?: any }) {
  if (!vapidPublicKey) return

  const subs = db.select().from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId)).all()

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keysP256dh, auth: sub.keysAuth } },
        JSON.stringify(payload)
      )
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired, clean up
        db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id)).run()
      }
    }
  }
}

export async function sendPushToOfflineUsers(chatId: string, senderId: string, senderName: string, content: string, isUserOnline: (userId: string) => boolean) {
  if (!vapidPublicKey) return

  const members = db.select({ userId: schema.chatMembers.userId })
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.chatId, chatId)).all()

  for (const member of members) {
    if (member.userId === senderId) continue
    if (isUserOnline(member.userId)) continue

    sendPushNotification(member.userId, {
      title: senderName,
      body: content.length > 100 ? content.slice(0, 100) + '...' : content,
      data: { chatId, senderId }
    }).catch(err => console.error('Push error:', err))
  }
}
