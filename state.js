// ══════════════════════════════════════════════════════════════════
// STATE MODULE — single source of truth
// Unified state, persistence, categories, habits, pub/sub event bus
// ══════════════════════════════════════════════════════════════════

// ── LOCALSTORAGE KEYS ──
const KEYS = {
  tasks:      'kw_tasks_v3',
  settings:   'kw_settings_v3',
  focus:      'kw_focus_v3',
  pending:    'kw_pending_v3',
  notes:      'kw_notes_v3',
  notesMono:  'kw_notes_mono_v3',
  dash:       'kw_dash_v1',
  projects:   'kw_proj_v1',
  bel:        'kw_bel_v1',
  shop:       'kw_shop_v1',
  collapsed:  'kw_collapsed_v1',
  migrated:   'kw_migrated_v1',
  theme:      'kw_theme_v2',
  confnotes:  'kw_confnotes_v1',
};

// ── CATEGORIES ──
const CAT_DEFAULTS = {
  manuscript: 'manuscript',
  lab:        'lab ops',
  phd:        'phd apps',
  conf:       'conference',
  bel:        'bel ♡',
  personal:   'personal',
  hobby:      'hobby',
};

let CAT_LABEL = Object.assign({}, CAT_DEFAULTS);

// ── HABITS ──
const HABIT_DEFAULTS = [
  { id: 'sleep', label: 'Slept 7h+', bad: false, days: [0,1,2,3,4,5,6] },
  { id: 'read',  label: 'Read',      bad: false, days: [0,1,2,3,4,5,6] },
  { id: 'lift',  label: 'Lifted',    bad: false, days: [0,1,2,3,4] },
  { id: 'doom',  label: 'Doom scrolled', bad: true, days: [0,1,2,3,4,5,6] },
];

let HABITS = HABIT_DEFAULTS.map(h => Object.assign({}, h, { days: h.days.slice() }));

// ── STATE OBJECTS ──
// Core app state
const state = {
  tasks:          [],
  projects:       [],
  settings:       { ghUser: '', ghRepo: '', ghToken: '' },
  focus:          null,
  filter:         'all',
  editingId:      null,
  activeProjectId: null,
  pendingSync:    false,
  sha:            null,
  focusMode:      false,
  notesOpen:      false,
  scratchpad:     '',
  collapsed:      {},
  _shaLoaded:     true,
};

// Bel (relationship) state
let belState = {
  annivDate: '',
  giftsList: [],
  datesList: [],
  favs:      '',
  love:      '',
};

// Pomodoro state
const pomo = {
  timer:    null,
  timeLeft: 25 * 60,
  mode:     'work',
  running:  false,
  cycles:   0,
};

// Dashboard state
let dState = {
  intention:      '',
  intentionWeek:  '',
  quoteIdx:       0,
  countdown:      { name: '', date: '' },
  reflection:     '',
  reflectionDate: '',
  book:           null,
  habits:         {},
  moods:          {},
};

// Shopping list
let shopItems = [];

// Conference notes
let cnNotes = [];

// ── UTILITIES ──
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtShort(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2000);
}

// ── PUB/SUB EVENT BUS ──
// Modules subscribe to state changes; anyone can emit.
// Events: 'tasks', 'projects', 'bel', 'dash', 'shop', 'confnotes',
//         'settings', 'focus', 'theme', 'render', 'sync-status'
const _listeners = {};

function on(event, fn) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(fn);
}

function off(event, fn) {
  if (!_listeners[event]) return;
  _listeners[event] = _listeners[event].filter(f => f !== fn);
}

function emit(event, data) {
  if (!_listeners[event]) return;
  _listeners[event].forEach(fn => fn(data));
}

// ── PERSISTENCE: LOAD ──
function _tryParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return fallback;
}

function loadLocal() {
  state.tasks      = _tryParse(KEYS.tasks, []);
  state.projects   = _tryParse(KEYS.projects, []);
  state.settings   = _tryParse(KEYS.settings, { ghUser: '', ghRepo: '', ghToken: '' });
  state.pendingSync = _tryParse(KEYS.pending, false);
  state.collapsed  = _tryParse(KEYS.collapsed, {});

  // Restore custom category labels
  if (state.settings.customCats) Object.assign(CAT_LABEL, state.settings.customCats);

  // Restore custom habits
  if (state.settings.customHabits) {
    HABITS = state.settings.customHabits.map(function(h) {
      return Object.assign({}, h, { days: (h.days || [0,1,2,3,4,5,6]).slice() });
    });
  }

  try { const f = localStorage.getItem(KEYS.focus); if (f) state.focus = f; } catch (e) { /* */ }
  try { const n = localStorage.getItem(KEYS.notes); if (n !== null) state.scratchpad = n; } catch (e) { /* */ }

  if (!state.tasks) state.tasks = [];
  if (!state.projects) state.projects = [];

  if (state.settings.ghToken && state.settings.ghUser && state.settings.ghRepo) {
    state._shaLoaded = false;
  }

  // ── MIGRATION ──
  let migrated = false;
  try { migrated = localStorage.getItem(KEYS.migrated) === '1'; } catch (e) { /* */ }
  if (!migrated) {
    state.tasks.forEach(t => {
      if (t.section === 'today') t.pinnedToday = true;
      if (t.category && !t.categories) t.categories = [t.category];
      delete t.section;
      delete t.category;
    });
    try { localStorage.setItem(KEYS.migrated, '1'); } catch (e) { /* */ }
    saveLocal();
  }

  // ── BEL ──
  belState = _tryParse(KEYS.bel, { annivDate: '', giftsList: [], datesList: [], favs: '', love: '' });
  if (!belState.giftsList) belState.giftsList = [];
  if (typeof belState.gifts === 'string' && belState.gifts) {
    belState.giftsList.push({ id: uid(), text: belState.gifts, done: false });
    delete belState.gifts;
  }
  if (!belState.datesList) belState.datesList = [];
  if (typeof belState.dates === 'string' && belState.dates) {
    belState.datesList.push({ id: uid(), text: belState.dates, done: false });
    delete belState.dates;
  }

  // ── DASH ──
  dState = _tryParse(KEYS.dash, dState);

  // ── SHOP ──
  shopItems = _tryParse(KEYS.shop, []);

  // ── CONFNOTES ──
  cnNotes = _tryParse(KEYS.confnotes, []);
}

// ── PERSISTENCE: SAVE ──
// Each domain has a targeted save, plus a saveAll for bulk operations.

function saveLocal() {
  localStorage.setItem(KEYS.tasks, JSON.stringify(state.tasks));
  localStorage.setItem(KEYS.projects, JSON.stringify(state.projects));
  localStorage.setItem(KEYS.focus, state.focus || '');
  localStorage.setItem(KEYS.notes, state.scratchpad || '');
}

function saveBel(sync) {
  try { localStorage.setItem(KEYS.bel, JSON.stringify(belState)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveDash(sync) {
  try { localStorage.setItem(KEYS.dash, JSON.stringify(dState)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveShop() {
  try { localStorage.setItem(KEYS.shop, JSON.stringify(shopItems)); } catch (e) { /* */ }
  emit('request-sync');
}

function saveCN(sync) {
  try { localStorage.setItem(KEYS.confnotes, JSON.stringify(cnNotes)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveSettings() {
  localStorage.setItem(KEYS.settings, JSON.stringify(state.settings));
}

function savePending(v) {
  state.pendingSync = v;
  localStorage.setItem(KEYS.pending, JSON.stringify(v));
}

function saveCollapsed() {
  try { localStorage.setItem(KEYS.collapsed, JSON.stringify(state.collapsed)); } catch (e) { /* */ }
}

// ── CATEGORY MANAGEMENT ──
function updateCategories(newCats) {
  Object.keys(CAT_LABEL).forEach(k => delete CAT_LABEL[k]);
  Object.assign(CAT_LABEL, newCats);
  state.settings.customCats = Object.assign({}, CAT_LABEL);
  saveSettings();
}

// ── HABIT MANAGEMENT ──
function getHabits() { return HABITS; }

function updateHabits(newHabits) {
  HABITS = newHabits.map(function(h) {
    return Object.assign({}, h, { days: (h.days || [0,1,2,3,4,5,6]).slice() });
  });
  state.settings.customHabits = HABITS.map(function(h) {
    return { id: h.id, label: h.label, bad: !!h.bad, days: h.days.slice() };
  });
  saveSettings();
}

// ── FULL SYNC PAYLOAD ──
// Used by sync module to build the GitHub push payload
function buildSyncPayload() {
  const payload = {
    tasks:      state.tasks,
    projects:   state.projects,
    bel:        belState,
    scratchpad: state.scratchpad,
    shop:       shopItems,
    dash:       dState,
    cnNotes:    cnNotes,
    updated:    new Date().toISOString(),
  };
  return payload;
}

// Used by sync module to apply data pulled from GitHub
function applySyncPayload(dec) {
  state.tasks = dec.tasks || dec;
  if (!state.tasks) state.tasks = [];
  if (dec.projects) state.projects = dec.projects;
  if (!state.projects) state.projects = [];

  if (dec.bel) belState = dec.bel;
  if (dec.scratchpad !== undefined) state.scratchpad = dec.scratchpad;
  if (dec.shop !== undefined) shopItems = dec.shop;
  if (dec.dash !== undefined) Object.assign(dState, dec.dash);
  if (dec.cnNotes !== undefined) cnNotes = dec.cnNotes;

  // Normalize old category field
  state.tasks.forEach(t => {
    if (t.category && !t.categories) t.categories = [t.category];
    delete t.category;
  });

  // Persist everything locally
  saveLocal();
  saveBel(false);
  try { localStorage.setItem(KEYS.shop, JSON.stringify(shopItems)); } catch (e) { /* */ }
  saveDash(false);
  try { localStorage.setItem(KEYS.confnotes, JSON.stringify(cnNotes)); } catch (e) { /* */ }
}

// ── EXPORTS ──
export {
  KEYS,
  CAT_DEFAULTS,
  CAT_LABEL,
  HABIT_DEFAULTS,
  HABITS,
  state,
  belState,
  pomo,
  dState,
  shopItems,
  cnNotes,
  uid,
  esc,
  fmtShort,
  showToast,
  on,
  off,
  emit,
  loadLocal,
  saveLocal,
  saveBel,
  saveDash,
  saveShop,
  saveCN,
  saveSettings,
  savePending,
  saveCollapsed,
  updateCategories,
  getHabits,
  updateHabits,
  buildSyncPayload,
  applySyncPayload,
};

// Re-export setters for arrays that get reassigned (since import bindings are read-only)
export function setShopItems(items) { shopItems = items; }
export function setCnNotes(notes)   { cnNotes = notes; }
export function setBelState(obj)    { belState = obj; }
export function setDState(obj)      { Object.assign(dState, obj); }

// Provide mutable access for sync module
export function getShopItems() { return shopItems; }
export function getCnNotes()   { return cnNotes; }
export function getBelState()  { return belState; }
export function getDState()    { return dState; }
