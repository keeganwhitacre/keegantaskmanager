// ══════════════════════════════════════════════════════════════════
// STATE MODULE — single source of truth
// ══════════════════════════════════════════════════════════════════

// ── LOCALSTORAGE KEYS ──
const KEYS = {
  tasks:     'kw_tasks_v3',
  settings:  'kw_settings_v3',
  pending:   'kw_pending_v3',
  dash:      'kw_dash_v1',
  bel:       'kw_bel_v1',
  collapsed: 'kw_collapsed_v1',
  migrated:  'kw_migrated_v1',
  theme:     'kw_theme_v3',
  confnotes: 'kw_confnotes_v1',
  folders:   'kw_folders_v1',
};

// ── CATEGORIES ──
const CAT_DEFAULTS = {
  manuscript: 'Manuscript',
  lab:        'Lab Ops',
  phd:        'PhD',
  conf:       'Conference',
  bel:        'Bel ♡',
  personal:   'Personal',
  hobby:      'Hobby',
};

let CAT_LABEL = Object.assign({}, CAT_DEFAULTS);

// ── HABITS ──
const HABIT_DEFAULTS = [
  { id: 'sleep', label: 'Slept 7h+',     bad: false, days: [0,1,2,3,4,5,6] },
  { id: 'read',  label: 'Read',           bad: false, days: [0,1,2,3,4,5,6] },
  { id: 'lift',  label: 'Lifted',         bad: false, days: [0,1,2,3,4] },
  { id: 'doom',  label: 'Doom scrolled',  bad: true,  days: [0,1,2,3,4,5,6] },
];

let HABITS = HABIT_DEFAULTS.map(h => Object.assign({}, h, { days: h.days.slice() }));

// ── STATE OBJECTS ──
const state = {
  tasks:       [],
  settings:    { ghToken: '', ghGistId: '' },
  filter:      'all',
  editingId:   null,
  pendingSync: false,
  sha:         null,
  collapsed:   {},
  _shaLoaded:  true,
};

let belState = {
  annivDate: '',
  giftsList: [],
  datesList: [],
  favs:      '',
  love:      '',
};

let dState = {
  habits:  {},
  moods:   {},
  affect:  {},
};

let cnNotes = [];
let folders = []; // [{ id, name }]

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
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2200);
}

// ── PUB/SUB EVENT BUS ──
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
  const savedSettings = _tryParse(KEYS.settings, {});
  // Merge saved settings over defaults, dropping old ghUser/ghRepo if present
  state.settings = Object.assign({ ghToken: '', ghGistId: '' }, savedSettings);
  state.pendingSync = _tryParse(KEYS.pending, false);
  state.collapsed  = _tryParse(KEYS.collapsed, {});

  // Restore custom categories
  if (state.settings.customCats) Object.assign(CAT_LABEL, state.settings.customCats);

  // Restore custom habits
  if (state.settings.customHabits) {
    HABITS = state.settings.customHabits.map(function(h) {
      return Object.assign({}, h, { days: (h.days || [0,1,2,3,4,5,6]).slice() });
    });
  }

  if (!state.tasks) state.tasks = [];

  if (state.settings.ghToken && state.settings.ghGistId) {
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
  if (!belState.datesList) belState.datesList = [];
  // Migrate legacy string fields
  if (typeof belState.gifts === 'string' && belState.gifts) {
    belState.giftsList.push({ id: uid(), text: belState.gifts, done: false });
    delete belState.gifts;
  }
  if (typeof belState.dates === 'string' && belState.dates) {
    belState.datesList.push({ id: uid(), text: belState.dates, done: false });
    delete belState.dates;
  }

  // ── DASH ──
  const savedDash = _tryParse(KEYS.dash, null);
  if (savedDash) Object.assign(dState, savedDash);
  if (!dState.habits) dState.habits = {};
  if (!dState.moods)  dState.moods  = {};
  if (!dState.affect) dState.affect = {};

  // ── CONFNOTES ──
  cnNotes = _tryParse(KEYS.confnotes, []);

  // ── FOLDERS ──
  folders = _tryParse(KEYS.folders, []);
}

// ── PERSISTENCE: SAVE ──
function saveLocal() {
  try { localStorage.setItem(KEYS.tasks, JSON.stringify(state.tasks)); } catch(e) {}
}

function saveBel(sync) {
  try { localStorage.setItem(KEYS.bel, JSON.stringify(belState)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveDash(sync) {
  try { localStorage.setItem(KEYS.dash, JSON.stringify(dState)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveCN(sync) {
  try { localStorage.setItem(KEYS.confnotes, JSON.stringify(cnNotes)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveFolders(sync) {
  try { localStorage.setItem(KEYS.folders, JSON.stringify(folders)); } catch (e) { /* */ }
  if (sync) emit('request-sync');
}

function saveSettings() {
  try { localStorage.setItem(KEYS.settings, JSON.stringify(state.settings)); } catch(e) {}
  emit('request-sync');
}

function savePending(v) {
  state.pendingSync = v;
  try { localStorage.setItem(KEYS.pending, JSON.stringify(v)); } catch(e) {}
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
    return Object.assign({}, h, { id: h.id || uid(), days: (h.days || [0,1,2,3,4,5,6]).slice() });
  });
  state.settings.customHabits = HABITS.map(function(h) {
    return { id: h.id, label: h.label, bad: !!h.bad, days: h.days.slice() };
  });
  saveSettings();
}

// ── SYNC PAYLOAD ──
function buildSyncPayload() {
  return {
    tasks:    state.tasks,
    bel:      belState,
    dash:     dState,
    cnNotes:  cnNotes,
    folders:  folders,
    settings: {
      customCats:   state.settings.customCats,
      customHabits: state.settings.customHabits,
    },
    updated: new Date().toISOString(),
  };
}

function applySyncPayload(dec) {
  // Tasks — handle legacy format (array at root)
  if (Array.isArray(dec)) {
    state.tasks = dec;
  } else {
    state.tasks = dec.tasks || [];
  }

  if (dec.bel)      belState = dec.bel;
  if (dec.dash)     Object.assign(dState, dec.dash);
 if (dec.cnNotes)  cnNotes = dec.cnNotes;
  if (dec.folders)  folders = dec.folders; 

  // Custom settings
  if (dec.settings) {
    if (dec.settings.customCats) {
      Object.keys(CAT_LABEL).forEach(k => delete CAT_LABEL[k]);
      Object.assign(CAT_LABEL, dec.settings.customCats);
      state.settings.customCats = Object.assign({}, dec.settings.customCats);
    }
    if (dec.settings.customHabits) {
      HABITS = dec.settings.customHabits.map(function(h) {
        return Object.assign({}, h, { days: (h.days || [0,1,2,3,4,5,6]).slice() });
      });
      state.settings.customHabits = dec.settings.customHabits;
    }
    try { localStorage.setItem(KEYS.settings, JSON.stringify(state.settings)); } catch(e) {}
  }

  // Normalize old category field
  state.tasks.forEach(t => {
    if (t.category && !t.categories) t.categories = [t.category];
    delete t.category;
  });

  // Persist locally
  saveLocal();
  saveBel(false);
  saveDash(false);
  try { localStorage.setItem(KEYS.confnotes, JSON.stringify(cnNotes)); } catch (e) { /* */ }
  try { localStorage.setItem(KEYS.folders, JSON.stringify(folders)); } catch (e) { /* */ }
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
  dState,
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
  saveCN,
  saveFolders,
  saveSettings,
  savePending,
  saveCollapsed,
  updateCategories,
  getHabits,
  updateHabits,
  buildSyncPayload,
  applySyncPayload,
};

export function setCnNotes(notes)  { cnNotes = notes; }
export function setBelState(obj)   { belState = obj; }
export function setDState(obj)     { Object.assign(dState, obj); }
export function getCnNotes()       { return cnNotes; }
export function getFolders()       { return folders; }
export function setFolders(f)      { folders = f; }
export function getBelState()      { return belState; }
export function getDState()        { return dState; }
