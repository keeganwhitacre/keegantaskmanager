var CACHE_VERSION = 'kw-v8';
var STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.json',
  '/confnotes.js',
  '/confnotes-styles.css',
  '/bel.js',
  '/dashboard.js',
  '/router.js',
  '/state.js',
  '/sync.js',
  '/timeline.js',
  '/lib/marked.min.js',

  // DM Mono only — system-ui handles everything else
  '/fonts/dm-mono-v16-latin-regular.woff2',
  '/fonts/dm-mono-v16-latin-500.woff2',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Don't cache GitHub API calls
  if (url.hostname === 'api.github.com') return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(function(cache) { cache.put(e.request, clone); });
        return response;
      });
    })
  );
});
