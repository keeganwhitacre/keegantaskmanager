var CACHE_VERSION = 'kw-v9';
var STATIC_ASSETS = [
  '/', '/index.html', '/app.js', '/styles.css',
  '/manifest.json',
  '/state.js', '/sync.js', '/router.js',
  '/dashboard.js', '/timeline.js', '/bel.js',
  '/lib/marked.min.js',
  '/fonts/dm-mono-v16-latin-regular.woff2',
  '/fonts/dm-mono-v16-latin-500.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).hostname === 'api.github.com') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
