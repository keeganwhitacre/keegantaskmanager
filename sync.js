// ══════════════════════════════════════════════════════════════════
// SYNC MODULE — Gist persistence
// Fetch, push (debounced), offline queue
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

function gistUrl() {
  return GH_API + '/gists/' + state.settings.ghGistId;
}

// ── SYNC STATUS UI ──
let syncTimer = null;

function showSync(type, msg) {
  if (type === 'syncing' || type === 'success') return;
  const bar = document.getElementById('syncBar');
  bar.className = 'sync-bar show ' + type;
  document.getElementById('syncMsg').textContent = msg;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { bar.classList.remove('show'); }, 4000);
}

// ── FETCH (pull from Gist) ──
let ghPushQueued = false;

function ghFetch(retries) {
  if (!state.settings.ghToken || !state.settings.ghGistId) return;
  retries = retries || 0;

  fetch(gistUrl(), { headers: ghHeaders() })
    .then(r => {
      if (r.status === 404) { state._shaLoaded = true; ghPush(); return null; }
      if (r.status === 401 || r.status === 403) { state._shaLoaded = true; showSync('error', 'Auth failed — check token'); return null; }
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(d => {
      if (!d) return;
      state._shaLoaded = true;

      const dec = JSON.parse(d.files['tasks.json'].content);
      applySyncPayload(dec);

      const sp = document.getElementById('scratchpad');
      if (sp && document.activeElement !== sp) sp.value = state.scratchpad;

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

// ── PUSH (write to Gist) ──
function ghPushNow() {
  if (!state.settings.ghToken || !state.settings.ghGistId) {
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
  showSync('syncing', 'Saving…');

  const payload = buildSyncPayload();
  const body = JSON.stringify({
    files: { 'tasks.json': { content: JSON.stringify(payload, null, 2) } }
  });

  fetch(gistUrl(), { method: 'PATCH', headers: ghHeaders(), body })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(() => { savePending(false); showSync('success', 'Saved'); })
    .catch(() => { savePending(true); showSync('error', 'Save failed — stored locally'); });
}

// Debounced public entry point
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
  if (!state.settings.ghToken || !state.settings.ghGistId) return Promise.resolve(false);
  return fetch(gistUrl(), { headers: ghHeaders() })
    .then(r => r.ok)
    .catch(() => false);
}

// ── WIRE UP ──
on('request-sync', () => { ghPush(); });
window.addEventListener('online', () => { if (state.pendingSync) ghPush(true); });

// ── EXPORTS ──
export { ghFetch, ghPush, testGhConnection, showSync };
