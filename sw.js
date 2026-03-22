
var CACHE_VERSION = 'kw-v7';
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
  '/pomo.js',
  '/router.js',
  '/shopping.js',
  '/state.js',
  '/sync.js',
  '/timeline.js',

  // ── Self-hosted: marked (move from cdnjs to local) ──
  // Download https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.7/marked.min.js
  // and place it at /lib/marked.min.js, then update the <script> in index.html
  '/lib/marked.min.js',

  // ── Self-hosted fonts: existing ──
  '/fonts/dm-sans-v17-latin-300.woff2',
  '/fonts/dm-sans-v17-latin-regular.woff2',
  '/fonts/dm-sans-v17-latin-500.woff2',
  '/fonts/dm-sans-v17-latin-600.woff2',
  '/fonts/dm-sans-v17-latin-700.woff2',
  '/fonts/dm-mono-v16-latin-regular.woff2',
  '/fonts/dm-mono-v16-latin-500.woff2',
  '/fonts/syne-v24-latin-regular.woff2',
  '/fonts/syne-v24-latin-500.woff2',
  '/fonts/syne-v24-latin-700.woff2',
  '/fonts/syne-v24-latin-800.woff2',
  '/fonts/ibm-plex-mono-v20-latin-300.woff2',
  '/fonts/ibm-plex-mono-v20-latin-regular.woff2',
  '/fonts/ibm-plex-mono-v20-latin-500.woff2',
  '/fonts/ibm-plex-mono-v20-latin-700.woff2',
  '/fonts/bebas-neue-v16-latin-regular.woff2',

  // ── Self-hosted fonts: Manrope ──
  '/fonts/manrope-v20-latin-300.woff2',
  '/fonts/manrope-v20-latin-regular.woff2',
  '/fonts/manrope-v20-latin-500.woff2',
  '/fonts/manrope-v20-latin-600.woff2',
  '/fonts/manrope-v20-latin-700.woff2',
  '/fonts/manrope-v20-latin-800.woff2',

  // ── Self-hosted fonts: Nunito ──
  '/fonts/nunito-v32-latin-300.woff2',
  '/fonts/nunito-v32-latin-regular.woff2',
  '/fonts/nunito-v32-latin-500.woff2',
  '/fonts/nunito-v32-latin-600.woff2',
  '/fonts/nunito-v32-latin-700.woff2',
  '/fonts/nunito-v32-latin-800.woff2',

  // ── Self-hosted fonts: Source Serif 4 ──
  '/fonts/source-serif-4-v14-latin-regular.woff2',
  '/fonts/source-serif-4-v14-latin-500.woff2',
  '/fonts/source-serif-4-v14-latin-600.woff2',
  '/fonts/source-serif-4-v14-latin-700.woff2',
  '/fonts/source-serif-4-v14-latin-italic.woff2',
  '/fonts/source-serif-4-v14-latin-500italic.woff2',
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
// Key difference from before: the revalidation promise is held by waitUntil()
// so iOS Safari won't kill the SW thread before cache.put() completes.
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Only intercept same-origin GET requests.
  // GitHub API, external CDNs, etc. go straight to network.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // We need to call waitUntil() synchronously (not inside a .then),
  // so we create a deferred promise that the revalidation resolves later.
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
