self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/' || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/ocho/')) return;
  event.respondWith(fetch(event.request));
});
