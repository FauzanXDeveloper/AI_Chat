/* Nexus service worker.
 *
 * Deliberately network-first for same-origin files: a cache-first worker would
 * happily serve a stale app.js after an edit, which is exactly the trap that
 * makes "I changed the code but nothing happened" bugs. The cache is only a
 * fallback for when the network is unavailable.
 */

const CACHE = 'alrajhi-ai-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json',
               './favicon.png', './alrajhi_logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;   // let CDN and API traffic go straight out

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
