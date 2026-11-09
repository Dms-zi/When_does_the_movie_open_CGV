self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data; try { data = event.data?.json(); } catch { return; }
    if (!Array.isArray(data?.events)) return;
    const cache = await caches.open('cgv-push-receipts-v1');
    const events = [];
    for (const item of data.events) {
      if (typeof item.id !== 'string' || typeof item.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
      const receipt = new URL(`push-receipt/${encodeURIComponent(item.id)}`, self.registration.scope).href;
      if (!await cache.match(receipt)) events.push({ ...item, receipt });
    }
    if (!events.length) return;
    const titles = [...new Set(events.map(item => item.title))];
    const title = titles.length === 1 ? `${titles[0]} · 새 날짜 예매 오픈` : `${titles.length}편의 새 예매 날짜가 열렸어요`;
    const body = events.map(item => `${item.title} — ${item.date.slice(5).replace('-', '월 ')}일`).join('\n').slice(0, 650);
    await self.registration.showNotification(title, { body, tag: events.map(item => item.id).sort().join('|'), renotify: false, icon: new URL('./icon.svg', self.registration.scope).href, data:{url:self.registration.scope} });
    await Promise.all(events.map(item => cache.put(item.receipt, new Response('received'))));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - 300)).map(key => cache.delete(key)));
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = self.registration.scope;
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const existing = windows.find(client => client.url.startsWith(url));
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
