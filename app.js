// ══════════════════════════════════════════════════════════════════
// APP.JS — main module
// ══════════════════════════════════════════════════════════════════

import {
  KEYS, CAT_LABEL,
  state,
  uid, esc, fmtShort, showToast,
  on, emit,
  loadLocal, saveLocal,
  saveSettings, updateCategories,
  getHabits, updateHabits,
  buildSyncPayload, applySyncPayload,
  setBelState,
} from './state.js';

import { ghFetch, ghPush, testGhConnection } from './sync.js';
import { register, switchView, currentViewName } from './router.js';
import { initDashboard, renderReflectToday, onReflectEnter, onReflectExit, getReflectMode } from './dashboard.js';
import { initTimeline, onTimelineEnter } from './timeline.js';
import { initBel, renderBel } from './bel.js';
import { renderCNList } from './confnotes.js';


// ══════════════════════════════════════════════════════════════════
// catCls — exported for confnotes.js
// In the new design categories are plain text, no color injection.
// We keep the function signature so confnotes doesn't break.
// ══════════════════════════════════════════════════════════════════

export function catCls(cat) {
  // New design: categories are just mono text, no color classes.
  // Return a generic class that confnotes can use safely.
  return 'cat-tag';
}

// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════

function dueClass(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return '';
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff <= 2) return 'soon';
  return '';
}

function fmtDue(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return due;
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'overdue (' + fmtShort(d) + ')';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 6)  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return fmtShort(d);
}

// ══════════════════════════════════════════════════════════════════
// CATEGORY FILTER CHIPS
// ══════════════════════════════════════════════════════════════════

function rebuildCategoryUI() {
  const filterRow = document.getElementById('filterRow');
  if (!filterRow) return;
  const active = filterRow.querySelector('.chip.active')?.dataset.filter || 'all';
  filterRow.innerHTML = '';
  ['all', 'today', 'blocked', 'archive'].forEach(function(k) {
    const c = document.createElement('div');
    c.className = 'chip' + (k === active ? ' active' : '');
    c.dataset.filter = k;
    c.textContent = k;
    filterRow.appendChild(c);
  });
  Object.keys(CAT_LABEL).forEach(function(key) {
    const c = document.createElement('div');
    c.className = 'chip' + (key === active ? ' active' : '');
    c.dataset.filter = key;
    c.textContent = key;
    filterRow.appendChild(c);
  });
}

// ══════════════════════════════════════════════════════════════════
// TASK RENDERING
// ══════════════════════════════════════════════════════════════════

function render() {
  const list = document.getElementById('taskList');
  if (!list) return;

  const filter = state.filter || 'all';
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const today  = new Date(); today.setHours(0, 0, 0, 0);

  let tasks = state.tasks.filter(function(t) {
    if (filter === 'archive') return t.done;
    if (t.done) return false;
    if (filter === 'today') return t.pinnedToday || (t.due && new Date(t.due + 'T00:00:00') <= today);
    if (filter === 'blocked') return t.status === 'blocked' || t.status === 'waiting';
    if (filter !== 'all') return (t.categories || []).includes(filter);
    return true;
  });

  if (search) {
    tasks = tasks.filter(function(t) {
      return (t.title || '').toLowerCase().includes(search) ||
             (t.note  || '').toLowerCase().includes(search);
    });
  }

  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state">nothing here</div>';
    return;
  }

  let html = '';

  if (filter === 'all' && !search) {
    const pinned    = tasks.filter(t => t.pinnedToday);
    const rest      = tasks.filter(t => !t.pinnedToday);
    const grouped   = {};
    const ungrouped = [];

    if (pinned.length) {
      html += '<div class="section-label">today</div>';
      pinned.forEach(function(t) { html += taskRow(t); });
    }

    rest.forEach(function(t) {
      const cat = (t.categories || [])[0];
      if (cat) { if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(t); }
      else ungrouped.push(t);
    });

    Object.keys(CAT_LABEL).forEach(function(cat) {
      if (!grouped[cat]?.length) return;
      html += '<div class="section-label">' + esc(cat) + '</div>';
      grouped[cat].forEach(function(t) { html += taskRow(t); });
    });

    if (ungrouped.length) {
      html += '<div class="section-label">other</div>';
      ungrouped.forEach(function(t) { html += taskRow(t); });
    }
  } else {
    tasks.forEach(function(t) { html += taskRow(t); });
  }

  list.innerHTML = html;
  attachTaskListeners(list);
}

function taskRow(t) {
  const cats = (t.categories || []).map(function(c) {
    return '<span class="cat">' + esc(c) + '</span>';
  }).join('');

  const statusMap = { waiting: 'waiting', blocked: 'blocked', review: 'review' };
  const statusHtml = (t.status && t.status !== 'active')
    ? '<span class="status ' + t.status + '">' + esc(statusMap[t.status] || t.status) + '</span>' : '';

  const dc      = dueClass(t.due);
  const dueHtml = t.due ? '<span class="task-due ' + dc + '">' + esc(fmtDue(t.due)) + '</span>' : '';
  const noteDot = (t.note && t.note.trim()) ? '<span class="note-dot"></span>' : '';
  const metaHtml = (cats || statusHtml || noteDot)
    ? '<div class="task-meta-row">' + cats + statusHtml + noteDot + '</div>' : '';

  const priCls    = ' ' + (t.priority || 'md');
  const doneCls   = t.done ? ' done' : '';
  const dimmedCls = (!t.done && (t.status === 'blocked' || t.status === 'waiting')) ? ' dimmed' : '';

  return '<div class="task' + priCls + doneCls + dimmedCls + '" data-id="' + esc(t.id) + '">' +
    '<div class="task-dot"></div>' +
    '<div class="task-body"><div class="task-title">' + esc(t.title || '') + '</div>' + metaHtml + '</div>' +
    dueHtml +
    '<div class="swipe-action-left">delete</div>' +
    '<div class="swipe-action-right">defer</div>' +
    '</div>';
}

function attachTaskListeners(list) {
  list.querySelectorAll('.task').forEach(function(el) {
    el.addEventListener('click', function() {
      if (el.dataset.swiped === '1') { el.dataset.swiped = '0'; return; }
      openTaskSheet(el.dataset.id);
    });
    attachSwipe(el, el.dataset.id);
  });
}

// ══════════════════════════════════════════════════════════════════
// SWIPE
// ══════════════════════════════════════════════════════════════════

function attachSwipe(el, id) {
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false;
  const THRESHOLD = 72;

  el.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dragging = false; decided = false;
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    if (!decided) {
      if (Math.abs(cy - startY) > Math.abs(cx - startX) + 6) { decided = true; return; }
      if (Math.abs(cx - startX) > 6) { dragging = true; decided = true; }
      else return;
    }
    if (!dragging) return;
    e.preventDefault();
    dx = cx - startX;
    const clamped = Math.max(-110, Math.min(110, dx));
    el.style.transform  = 'translate3d(' + clamped + 'px,0,0)';
    el.style.transition = 'none';
    const L = el.querySelector('.swipe-action-left');
    const R = el.querySelector('.swipe-action-right');
    if (L) L.style.opacity = dx < -20 ? Math.min(1, (-dx - 20) / 40) + '' : '0';
    if (R) R.style.opacity = dx >  20 ? Math.min(1, (dx  - 20) / 40) + '' : '0';
  }, { passive: false });

  el.addEventListener('touchend', function() {
    if (!dragging) return;
    el.style.transition = '';
    el.style.transform  = '';
    const L = el.querySelector('.swipe-action-left');
    const R = el.querySelector('.swipe-action-right');
    if (L) L.style.opacity = '0';
    if (R) R.style.opacity = '0';
    if (dx < -THRESHOLD) { el.dataset.swiped = '1'; deleteWithUndo(id); }
    else if (dx > THRESHOLD) { el.dataset.swiped = '1'; deferTask(id); }
    dx = 0; dragging = false;
  }, { passive: true });
}

function deleteWithUndo(id) {
  const backup = state.tasks.find(x => x.id === id);
  if (!backup) return;
  const saved = Object.assign({}, backup);
  state.tasks = state.tasks.filter(x => x.id !== id);
  saveLocal(); render(); ghPush();

  const toast = document.getElementById('toastUndo');
  const msg   = document.getElementById('toastUndoMsg');
  if (msg)   msg.textContent = '"' + (saved.title || 'Task') + '" deleted';
  if (toast) { toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('show'), 3500); }
  document.getElementById('toastUndoBtn').onclick = function() {
    state.tasks.push(saved); saveLocal(); render(); ghPush(); toast.classList.remove('show'); showToast('Restored');
  };
}

function deferTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.due) {
    const d = new Date(t.due + 'T00:00:00'); d.setDate(d.getDate() + 1);
    t.due = d.toISOString().split('T')[0];
  } else {
    const d = new Date(); d.setDate(d.getDate() + 1);
    t.due = d.toISOString().split('T')[0];
  }
  t.pinnedToday = false;
  saveLocal(); render(); ghPush();
  showToast('Deferred to ' + fmtDue(t.due));
}

// ══════════════════════════════════════════════════════════════════
// TASK SHEET
// ══════════════════════════════════════════════════════════════════

let _editingId = null;

function openTaskSheet(id) {
  const t = id ? state.tasks.find(x => x.id === id) : null;
  _editingId = id || null;

  document.getElementById('taskSheetTitle').value = t ? (t.title || '') : '';
  document.getElementById('taskSheetNote').value  = t ? (t.note  || '') : '';
  document.getElementById('taskSheetDue').value   = t ? (t.due   || '') : '';

  document.querySelectorAll('#taskSheetPriority .seg-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.val === (t?.priority || 'md'));
  });
  document.querySelectorAll('#taskSheetStatus .seg-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.val === (t?.status || 'active'));
  });

  const catGrid    = document.getElementById('taskSheetCats');
  const activeCats = t ? (t.categories || []) : [];
  catGrid.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(function(key) {
    const tog = document.createElement('div');
    tog.className = 'cat-toggle' + (activeCats.includes(key) ? ' active' : '');
    tog.dataset.cat = key;
    tog.textContent = key;
    catGrid.appendChild(tog);
  });

  const pinBtn = document.getElementById('taskSheetPin');
  if (pinBtn) pinBtn.textContent = (t?.pinnedToday) ? 'unpin today' : 'pin today';
  const delBtn = document.getElementById('taskSheetDelete');
  if (delBtn) delBtn.style.display = t ? '' : 'none';

  document.getElementById('taskSheet').classList.add('open');
  document.getElementById('taskSheetBackdrop').classList.add('open');
}

function saveTaskSheet() {
  const title = document.getElementById('taskSheetTitle').value.trim();
  if (!title) { showToast('add a title'); return; }

  const priority = document.querySelector('#taskSheetPriority .seg-btn.active')?.dataset.val || 'md';
  const status   = document.querySelector('#taskSheetStatus .seg-btn.active')?.dataset.val || 'active';
  const due      = document.getElementById('taskSheetDue').value || '';
  const note     = document.getElementById('taskSheetNote').value.trim();
  const cats     = Array.from(document.querySelectorAll('#taskSheetCats .cat-toggle.active')).map(el => el.dataset.cat);

  if (_editingId) {
    const t = state.tasks.find(x => x.id === _editingId);
    if (t) Object.assign(t, { title, priority, status, due, note, categories: cats });
  } else {
    state.tasks.push({ id: uid(), title, priority, status, due, note, categories: cats, done: false, pinnedToday: false, pomodoros: 0 });
  }
  saveLocal(); render(); ghPush();
  document.getElementById('taskSheet').classList.remove('open');
  document.getElementById('taskSheetBackdrop').classList.remove('open');
}

// Sheet wiring
document.querySelectorAll('.seg-control').forEach(function(ctrl) {
  ctrl.addEventListener('click', function(e) {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    ctrl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('taskSheetCats').addEventListener('click', function(e) {
  e.target.closest('.cat-toggle')?.classList.toggle('active');
});

document.getElementById('taskSheetSave').addEventListener('click', saveTaskSheet);

document.getElementById('taskSheetDelete').addEventListener('click', function() {
  if (!_editingId) return;
  state.tasks = state.tasks.filter(x => x.id !== _editingId);
  saveLocal(); render(); ghPush();
  document.getElementById('taskSheet').classList.remove('open');
  document.getElementById('taskSheetBackdrop').classList.remove('open');
  showToast('deleted');
});

document.getElementById('taskSheetPin').addEventListener('click', function() {
  if (!_editingId) return;
  const t = state.tasks.find(x => x.id === _editingId);
  if (t) { t.pinnedToday = !t.pinnedToday; saveLocal(); render(); ghPush(); }
  document.getElementById('taskSheet').classList.remove('open');
  document.getElementById('taskSheetBackdrop').classList.remove('open');
});

document.getElementById('taskSheetBackdrop').addEventListener('click', function() {
  document.getElementById('taskSheet').classList.remove('open');
  document.getElementById('taskSheetBackdrop').classList.remove('open');
});

// ══════════════════════════════════════════════════════════════════
// FAB
// ══════════════════════════════════════════════════════════════════

document.getElementById('fab').addEventListener('click', function() {
  const view = currentViewName();
  if (view === 'notes') {
    import('./confnotes.js').then(function(m) { if (m.createNewNote) m.createNewNote('memo'); });
  } else {
    _editingId = null;
    openTaskSheet(null);
  }
});

// ══════════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════════

document.getElementById('searchTrigger').addEventListener('click', function() {
  const wrap   = document.getElementById('searchWrap');
  const isOpen = wrap.classList.toggle('open');
  if (isOpen) document.getElementById('searchInput').focus();
  else { document.getElementById('searchInput').value = ''; render(); }
});

document.getElementById('searchInput').addEventListener('input', render);

// ══════════════════════════════════════════════════════════════════
// FILTER CHIPS
// ══════════════════════════════════════════════════════════════════

document.getElementById('filterRow').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#filterRow .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.filter = chip.dataset.filter;
  render();
});

// ══════════════════════════════════════════════════════════════════
// BOTTOM TAB BAR
// ══════════════════════════════════════════════════════════════════

document.getElementById('tabTasks').addEventListener('click',   () => switchView('tasks'));
document.getElementById('tabNotes').addEventListener('click',   () => switchView('notes'));
document.getElementById('tabReflect').addEventListener('click', () => switchView('reflect'));

// Secret Bel (5 taps on wordmark)
(function() {
  let taps = 0, timer = null;
  document.getElementById('secretBelTrigger').addEventListener('click', function() {
    taps++;
    clearTimeout(timer);
    if (taps >= 5) { taps = 0; switchView('bel'); return; }
    timer = setTimeout(() => { taps = 0; }, 1200);
  });
})();

document.getElementById('belClose').addEventListener('click', () => switchView('tasks'));

// ══════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════

function applyTheme(name) {
  document.body.classList.remove('theme-light', 'theme-dark');
  if (name === 'dark')  document.body.classList.add('theme-dark');
  if (name === 'light') document.body.classList.add('theme-light');
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === (name || 'auto'));
  });
  try { localStorage.setItem(KEYS.theme, name || 'auto'); } catch (e) {}
}

function loadTheme() {
  let saved = 'auto';
  try { saved = localStorage.getItem(KEYS.theme) || 'auto'; } catch (e) {}
  if (['aurora','neon','ios-dark'].includes(saved))           saved = 'dark';
  if (['halcyon','newsprint','ios26','bel-bel'].includes(saved)) saved = 'light';
  applyTheme(saved);
}

document.getElementById('themeToggle').addEventListener('click', function(e) {
  const opt = e.target.closest('.theme-option');
  if (opt) applyTheme(opt.dataset.theme);
});

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════

function updateGhUI(ok) {
  const el  = document.getElementById('ghStatus');
  const txt = document.getElementById('ghStatusText');
  el.className   = 'settings-status' + (ok ? ' connected' : '');
  txt.textContent = ok ? 'connected: ' + state.settings.ghUser + '/' + state.settings.ghRepo : 'not connected';
}

function loadSettingsUI() {
  document.getElementById('ghUser').value  = state.settings.ghUser  || '';
  document.getElementById('ghRepo').value  = state.settings.ghRepo  || '';
  document.getElementById('ghToken').value = state.settings.ghToken || '';
  updateGhUI(!!state.settings.ghToken);
  loadCategoriesUI();
  loadHabitsUI();
  updatePinUI();
  let theme = 'auto';
  try { theme = localStorage.getItem(KEYS.theme) || 'auto'; } catch (e) {}
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}

document.getElementById('settingsBtn').addEventListener('click', function() {
  loadSettingsUI();
  document.getElementById('settingsSheet').classList.add('open');
});

// Two listeners on settingsClose — first saves, second closes (capture order)
document.getElementById('settingsClose').addEventListener('click', function() {
  _saveHabitsFromUI();
  _saveCatsFromUI();
}, true);
document.getElementById('settingsClose').addEventListener('click', function() {
  document.getElementById('settingsSheet').classList.remove('open');
});

document.getElementById('saveSettingsBtn').addEventListener('click', function() {
  const u = document.getElementById('ghUser').value.trim();
  const r = document.getElementById('ghRepo').value.trim();
  const t = document.getElementById('ghToken').value.trim();
  Object.assign(state.settings, { ghUser: u, ghRepo: r, ghToken: t });
  saveSettings();
  document.getElementById('saveSettingsBtn').textContent = 'testing…';
  testGhConnection().then(function(ok) {
    document.getElementById('saveSettingsBtn').textContent = 'save & test connection';
    if (ok) { updateGhUI(true); showToast('connected!'); state.sha = null; ghFetch(); }
    else    { updateGhUI(false); showToast('connection failed'); }
  });
});

document.getElementById('clearDataBtn').addEventListener('click', function() {
  if (!confirm('Clear all local data? Cannot be undone.')) return;
  localStorage.clear(); state.tasks = []; setBelState({});
  render();
  document.getElementById('settingsSheet').classList.remove('open');
  showToast('cleared');
});

document.getElementById('exportDataBtn').addEventListener('click', function() {
  const blob = new Blob([JSON.stringify(buildSyncPayload(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tasks-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
});

document.getElementById('importDataRow').addEventListener('click', () => document.getElementById('importFileInput').click());
document.getElementById('importFileInput').addEventListener('change', function(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try { applySyncPayload(JSON.parse(ev.target.result)); saveLocal(); render(); showToast('imported'); }
    catch { showToast('import failed'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Categories ──
function loadCategoriesUI() {
  const c = document.getElementById('catSettingsList'); if (!c) return;
  c.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(function(key) {
    const row = document.createElement('div');
    row.className = 'habit-manage-row';
    row.innerHTML = '<span style="font-size:14px;color:var(--text-primary);font-family:var(--font-mono);">' + esc(key) + '</span>' +
      '<span class="habit-manage-delete" data-key="' + esc(key) + '">remove</span>';
    c.appendChild(row);
  });
}

document.getElementById('addCatBtn').addEventListener('click', function() {
  const inp = document.getElementById('newCatInput');
  const key = inp.value.trim().toLowerCase().replace(/\s+/g,'_');
  if (!key) return;
  CAT_LABEL[key] = key;
  updateCategories(Object.assign({}, CAT_LABEL));
  loadCategoriesUI(); rebuildCategoryUI(); inp.value = '';
  showToast('category added');
});

document.getElementById('catSettingsList').addEventListener('click', function(e) {
  const del = e.target.closest('.habit-manage-delete');
  if (!del) return;
  delete CAT_LABEL[del.dataset.key];
  updateCategories(Object.assign({}, CAT_LABEL));
  loadCategoriesUI(); rebuildCategoryUI(); render();
});

function _saveCatsFromUI() { /* categories are saved immediately on add/remove */ }

// ── Habits ──
const DAY_LABELS = ['M','T','W','T','F','S','S'];

function loadHabitsUI() {
  const c = document.getElementById('habitSettingsList'); if (!c) return;
  c.innerHTML = '';
  getHabits().forEach(h => c.appendChild(makeHabitRow(h)));
}

function makeHabitRow(h) {
  const row = document.createElement('div');
  row.style.cssText = 'padding:10px 0;border-bottom:0.5px solid var(--border);';
  const top = document.createElement('div');
  top.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

  const idInp = document.createElement('input');
  idInp.value = h.id || ''; idInp.placeholder = 'id'; idInp.autocapitalize = 'none';
  idInp.style.cssText = 'width:70px;font-family:var(--font-mono);font-size:12px;border:none;border-bottom:0.5px solid var(--border);padding:3px 0;background:transparent;color:var(--text-primary);';

  const labInp = document.createElement('input');
  labInp.value = h.label || ''; labInp.placeholder = 'Label';
  labInp.style.cssText = 'flex:1;font-size:14px;border:none;border-bottom:0.5px solid var(--border);padding:3px 0;background:transparent;color:var(--text-primary);';

  const del = document.createElement('span');
  del.textContent = 'remove'; del.className = 'habit-manage-delete';
  del.addEventListener('click', () => row.remove());

  top.appendChild(idInp); top.appendChild(labInp); top.appendChild(del);

  const days = document.createElement('div');
  days.style.cssText = 'display:flex;gap:4px;';
  const active = h.days || [0,1,2,3,4,5,6];
  DAY_LABELS.forEach(function(label, i) {
    const btn = document.createElement('div');
    btn.dataset.day = i; btn.dataset.on = active.includes(i) ? '1' : '0';
    btn.textContent = label;
    btn.style.cssText = 'width:26px;height:24px;border-radius:4px;border:0.5px solid var(--border-strong);font-family:var(--font-mono);font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.1s;';
    const refresh = () => {
      btn.style.background   = btn.dataset.on === '1' ? 'var(--text-primary)' : 'transparent';
      btn.style.color        = btn.dataset.on === '1' ? 'var(--bg)' : 'var(--text-tertiary)';
      btn.style.borderColor  = btn.dataset.on === '1' ? 'var(--text-primary)' : 'var(--border-strong)';
    };
    refresh();
    btn.addEventListener('click', () => { btn.dataset.on = btn.dataset.on === '1' ? '0' : '1'; refresh(); });
    days.appendChild(btn);
  });

  row.appendChild(top); row.appendChild(days);
  return row;
}

document.getElementById('addHabitBtn').addEventListener('click', function() {
  const inp = document.getElementById('newHabitInput');
  const label = inp.value.trim(); if (!label) return;
  document.getElementById('habitSettingsList').appendChild(
    makeHabitRow({ id: label.toLowerCase().replace(/\s+/g,'_'), label, bad: false, days: [0,1,2,3,4,5,6] })
  );
  inp.value = '';
});

function _saveHabitsFromUI() {
  const rows = document.querySelectorAll('#habitSettingsList > div');
  const habits = [];
  rows.forEach(function(row) {
    const inputs = row.querySelectorAll('input');
    if (inputs.length < 2) return;
    const id    = inputs[0].value.trim().toLowerCase().replace(/\s+/g,'_');
    const label = inputs[1].value.trim();
    if (!id || !label) return;
    const days = [];
    row.querySelectorAll('[data-day]').forEach(btn => { if (btn.dataset.on === '1') days.push(+btn.dataset.day); });
    habits.push({ id, label, bad: false, days });
  });
  if (habits.length) updateHabits(habits);
}

// ── PIN ──
function updatePinUI() {
  const has = !!localStorage.getItem('kw_notes_pin_hash');
  const saveBtn  = document.getElementById('savePinBtn');
  const clearBtn = document.getElementById('clearPinBtn');
  if (saveBtn)  saveBtn.textContent  = has ? 'update pin' : 'save pin';
  if (clearBtn) clearBtn.style.display = has ? '' : 'none';
}

document.getElementById('savePinBtn').addEventListener('click', function() {
  const pin = ['pinD0','pinD1','pinD2','pinD3'].map(id => document.getElementById(id).value).join('');
  if (!/^\d{4}$/.test(pin)) { showToast('enter a 4-digit pin'); return; }
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin)).then(function(hash) {
    localStorage.setItem('kw_notes_pin_hash', Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join(''));
    updatePinUI(); showToast('pin saved');
  });
});

document.getElementById('clearPinBtn').addEventListener('click', function() {
  localStorage.removeItem('kw_notes_pin_hash');
  ['pinD0','pinD1','pinD2','pinD3'].forEach(id => { document.getElementById(id).value = ''; });
  updatePinUI(); showToast('pin cleared');
});

// ══════════════════════════════════════════════════════════════════
// ROUTER + SYNC EVENTS
// ══════════════════════════════════════════════════════════════════

register('tasks',   { onEnter: render });
register('notes',   { onEnter: renderCNList });
register('reflect', { onEnter: onReflectEnter, onExit: onReflectExit });
register('bel',     { onEnter: renderBel });

on('data-pulled', function() {
  const v = currentViewName();
  if (v === 'reflect') renderReflectToday();
  else if (v === 'notes') renderCNList();
  else if (v === 'bel') renderBel();
  else render();
  rebuildCategoryUI();
});

// ══════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════

loadLocal();
loadTheme();
initDashboard();
initTimeline();
initBel();
rebuildCategoryUI();
render();
if (state.settings.ghToken) ghFetch();
