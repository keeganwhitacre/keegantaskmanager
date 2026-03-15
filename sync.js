// ══════════════════════════════════════════════════════════════════
// SYNC MODULE — GitHub persistence
// Fetch, push (debounced), conflict resolution, offline queue
// ══════════════════════════════════════════════════════════════════

import {
  state, savePending, buildSyncPayload, applySyncPayload,
  saveLocal, saveBel, saveDash,
  on, emit,
} from './state.js';

const GH_API = 'https://api.github.com';

function ghHeaders() {
  return {
    'Authorization':        'token ' + state.settings.ghToken,
    'Content-Type':         'application/json',
    'Accept':               'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function ghPath() {
  return GH_API + '/repos/' + state.settings.ghUser + '/' + state.settings.ghRepo + '/contents/tasks.json';
}

// ── SYNC STATUS UI ──
let syncTimer = null;

function showSync(type, msg) {
  // Suppress syncing/success to reduce noise (original behavior)
  if (type === 'syncing' || type === 'success') return;
  const bar = document.getElementById('syncBar');
  bar.className = 'sync-bar show ' + type;
  document.getElementById('syncMsg').textContent = msg;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { bar.classList.remove('show'); }, 4000);
}

// ── FETCH (pull from GitHub) ──
let ghPushQueued = false;

function ghFetch(retries) {
  if (!state.settings.ghToken || !state.settings.ghUser || !state.settings.ghRepo) return;
  retries = retries || 0;

  fetch(ghPath(), { headers: ghHeaders() })
    .then(r => {
      if (r.status === 404) { state._shaLoaded = true; ghPush(); return null; }
      if (r.status === 401 || r.status === 403) { state._shaLoaded = true; showSync('error', 'Auth failed — check token'); return null; }
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(d => {
      if (!d) return;
      state.sha = d.sha;
      state._shaLoaded = true;

      const dec = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g, '')))));
      applySyncPayload(dec);

      // Update scratchpad UI if not focused
      const sp = document.getElementById('scratchpad');
      if (sp && document.activeElement !== sp) sp.value = state.scratchpad;

      // Tell the world data changed — the router/renderers will pick it up
      emit('data-pulled');

      if (ghPushQueued) { ghPush(); } else { savePending(false); }
    })
    .catch(() => {
      state._shaLoaded = true;
      if (retries < 1 && navigator.onLine) {
        setTimeout(() => { ghFetch(1); }, 3000);
      } else {
        showSync(
          navigator.onLine ? 'error' : 'offline',
          navigator.onLine ? 'Sync failed' : 'Offline — saved locally'
        );
      }
    });
}

// ── PUSH (write to GitHub) ──
// Raw push — called only by the debounced wrapper
function ghPushNow() {
  if (!state.settings.ghToken || !state.settings.ghUser || !state.settings.ghRepo) {
    savePending(true);
    return;
  }
  if (!navigator.onLine) {
    savePending(true);
    showSync('offline', 'Offline — will sync when reconnected');
    return;
  }
  if (!state._shaLoaded) {
    ghPushQueued = true;
    return;
  }
  ghPushQueued = false;
  showSync('syncing', 'Saving to GitHub…');

  const payload = buildSyncPayload();
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const body = { message: 'Update tasks ' + new Date().toLocaleTimeString(), content: content };
  if (state.sha) body.sha = state.sha;

  fetch(ghPath(), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) })
    .then(r => {
      if (r.status === 409 || r.status === 422) {
        // Conflict: re-fetch SHA and retry
        return fetch(ghPath(), { headers: ghHeaders() })
          .then(r2 => r2.json())
          .then(d2 => {
            state.sha = d2.sha;
            body.sha = state.sha;
            return fetch(ghPath(), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
          })
          .then(r3 => { if (!r3.ok) throw new Error(r3.status); return r3.json(); });
      }
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(d => {
      state.sha = d.content.sha;
      savePending(false);
      showSync('success', 'Saved');
    })
    .catch(() => {
      savePending(true);
      showSync('error', 'Save failed — stored locally');
    });
}

// Debounced public entry point — all callers use this (or emit 'request-sync')
let ghPushDebounceTimer = null;

function ghPush(immediate) {
  if (immediate) {
    if (ghPushDebounceTimer) { clearTimeout(ghPushDebounceTimer); ghPushDebounceTimer = null; }
    ghPushNow();
    return;
  }
  if (ghPushDebounceTimer) clearTimeout(ghPushDebounceTimer);
  ghPushDebounceTimer = setTimeout(() => { ghPushDebounceTimer = null; ghPushNow(); }, 2500);
}

// ── CONNECTION TEST ──
function testGhConnection() {
  const s = state.settings;
  if (!s.ghToken || !s.ghUser || !s.ghRepo) return Promise.resolve(false);
  return fetch(GH_API + '/repos/' + s.ghUser + '/' + s.ghRepo, { headers: ghHeaders() })
    .then(r => r.ok)
    .catch(() => false);
}

// ── WIRE UP ──
// Listen for sync requests from state module
on('request-sync', () => { ghPush(); });

// Auto-push when coming back online
window.addEventListener('online', () => { if (state.pendingSync) ghPush(true); });

// ── EXPORTS ──
export { ghFetch, ghPush, testGhConnection, showSync };
