// sw.js
// Cache-first service worker for Keegan’s Tasks PWA
// Bump CACHE_VERSION any time you deploy updated app.js or styles.css
// to force clients to fetch fresh files.

var CACHE_VERSION = ‘kw-v1’;
var STATIC_ASSETS = [
‘/’,
‘/index.html’,
‘/app.js’,
‘/styles.css’,
‘/manifest.json’
];

// ── Install: pre-cache all static assets ────────────────────────────────────
self.addEventListener(‘install’, function(e) {
e.waitUntil(
caches.open(CACHE_VERSION).then(function(cache) {
return cache.addAll(STATIC_ASSETS);
})
);
// Take control immediately rather than waiting for old SW to die
self.skipWaiting();
});

// ── Activate: delete stale caches from old versions ─────────────────────────
self.addEventListener(‘activate’, function(e) {
e.waitUntil(
caches.keys().then(function(keys) {
return Promise.all(
keys.filter(function(k) { return k !== CACHE_VERSION; })
.map(function(k) { return caches.delete(k); })
);
}).then(function() {
// Claim all open clients so the new SW is active without a reload
return self.clients.claim();
})
);
});

// ── Fetch: cache-first for static assets, network-first for everything else ──
self.addEventListener(‘fetch’, function(e) {
var url = new URL(e.request.url);

// Only intercept same-origin GET requests.
// Let GitHub API calls, font fetches, etc. go straight to network.
if (e.request.method !== ‘GET’ || url.origin !== self.location.origin) {
return;
}

e.respondWith(
caches.match(e.request).then(function(cached) {
if (cached) {
// Serve from cache immediately, then revalidate in the background
// so the next launch gets the freshest version.
var revalidate = fetch(e.request).then(function(fresh) {
if (fresh && fresh.status === 200) {
caches.open(CACHE_VERSION).then(function(cache) {
cache.put(e.request, fresh.clone());
});
}
return fresh;
}).catch(function() { /* offline — silently ignore */ });

```
    // Return the cached copy now; background fetch updates it for next time
    return cached;
  }

  // Not in cache — hit the network and cache the response
  return fetch(e.request).then(function(response) {
    if (!response || response.status !== 200) return response;
    var toCache = response.clone();
    caches.open(CACHE_VERSION).then(function(cache) {
      cache.put(e.request, toCache);
    });
    return response;
  });
})
```

);
});