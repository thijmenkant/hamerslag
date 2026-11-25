// Service worker van Hamerslag: ontvangt de meldingen, ook als de app dicht is.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titel: 'Hamerslag', tekst: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'Hamerslag', {
    body: d.tekst || '',
    icon: 'icon-192.png?v=2',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: !!d.urgent,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const doel = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const vensters = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of vensters) { if (v.url.startsWith(self.registration.scope)) { await v.focus(); if ('navigate' in v) v.navigate(doel).catch(() => {}); return; } }
    await self.clients.openWindow(doel);
  })());
});
