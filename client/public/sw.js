self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'MLSendger'
  const options = {
    body: data.body || 'New message',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: data.data || {},
    tag: data.data?.chatId || 'default',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const chatId = event.notification.data?.chatId
  const url = chatId ? '/?chat=' + chatId : '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return clients.openWindow(url)
    })
  )
})
