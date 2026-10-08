/* Courier-only offline reads. Authenticated responses are partitioned by user + organization. */
const ASSETS = 'tezfarmo-courier-assets-v1';
const READS = 'tezfarmo-courier-reads-v1';
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  const scope = request.headers.get('X-Courier-Cache-Scope');
  if (scope && /^\/api\/v1\/courier\/(today|deliveries\/[^/]+)$/.test(url.pathname)) {
    const key = new Request(`${self.location.origin}/courier-cache/${encodeURIComponent(scope)}${url.pathname}`);
    event.respondWith((async () => {
      const cache = await caches.open(READS);
      try {
        const answer = await fetch(request);
        if (answer.ok) await cache.put(key, answer.clone());
        return answer;
      } catch (error) {
        const saved = await cache.match(key);
        if (saved) return saved;
        throw error;
      }
    })());
    return;
  }
  const asset = /\.(js|jsx|ts|tsx|css|woff2?|png|svg|webp)(\?|$)/.test(url.pathname + url.search);
  const shell = request.mode === 'navigate' && url.pathname.startsWith('/courier');
  if (!asset && !shell) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSETS);
    try {
      const answer = await fetch(request);
      if (answer.ok) await cache.put(shell ? '/courier' : request, answer.clone());
      return answer;
    } catch (error) {
      const saved = await cache.match(shell ? '/courier' : request);
      if (saved) return saved;
      throw error;
    }
  })());
});
