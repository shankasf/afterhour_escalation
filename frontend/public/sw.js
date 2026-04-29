/* eslint-disable no-restricted-globals */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'On-Call Alert', body: event.data.text() };
  }
  const {
    title = 'On-Call Alert',
    body = '',
    eventId,
    severity = 'medium',
    action = 'update',
  } = payload || {};

  const options = {
    body,
    requireInteraction: severity === 'critical',
    tag: eventId || `oncall-${Date.now()}`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: { eventId, severity, action },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const eventId = event.notification.data?.eventId;
  const targetPath = eventId ? `/incidents/${eventId}` : '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          try {
            const url = new URL(client.url);
            if (url.origin === self.location.origin) {
              client.focus();
              client.postMessage({ type: 'navigate', path: targetPath });
              return;
            }
          } catch (e) {
            // ignore
          }
        }
        return self.clients.openWindow(targetPath);
      })
  );
});
