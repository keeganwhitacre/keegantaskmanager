var CACHE_VERSION = 'kw-v11'; // Bumped to v10 to clear out the old bloated caches
var STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app.js',
  '/state.js',
  '/sync.js',
  '/router.js',
  '/bel.js',
  '/dashboard.js',
  '/confnotes.js',
  '/lib/marked.min.js'
];

// ── Install: pre-cache all static assets ────────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activate: delete stale caches from old versions ─────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch: cache-first with background revalidation ─────────────────────────
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Only intercept same-origin GET requests.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Use a deferred promise so iOS Safari doesn't kill the SW thread early
  var revalidateDone;
  var revalidatePromise = new Promise(function(resolve) {
    revalidateDone = resolve;
  });
  e.waitUntil(revalidatePromise);

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) {
        // Serve cached immediately, revalidate in background
        fetch(e.request).then(function(fresh) {
          if (fresh && fresh.status === 200) {
            return caches.open(CACHE_VERSION).then(function(cache) {
              return cache.put(e.request, fresh);
            });
          }
        }).catch(function() {
          // Offline — nothing to revalidate
        }).then(function() {
          revalidateDone();
        });
        return cached;
      }

      // Not in cache — go to network, cache the response, then resolve
      return fetch(e.request).then(function(response) {
        if (!response || response.status !== 200) {
          revalidateDone();
          return response;
        }
        var toCache = response.clone();
        caches.open(CACHE_VERSION).then(function(cache) {
          return cache.put(e.request, toCache);
        }).then(function() {
          revalidateDone();
        });
        return response;
      }).catch(function(err) {
        revalidateDone();
        throw err;
      });
    })
  );
});
