self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Allow own server files
  if (url.pathname === '/' || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;

  // Already proxied?
  if (url.pathname.startsWith('/ocho/')) return;

  event.respondWith(clients.get(event.clientId).then(client => {
      if (!client) return fetch(event.request);
      const clientUrl = new URL(client.url);
      if (clientUrl.pathname.startsWith('/ocho/')) return fetch(event.request);
      return fetch(event.request);
  }));
});;
