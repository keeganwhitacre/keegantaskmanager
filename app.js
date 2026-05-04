// ══════════════════════════════════════════════════════════════════
// APP.JS — main module
// Handles: task rendering, swipe, task sheet, settings, theme,
//          search, filter, tab wiring, bel trigger, FAB
// ══════════════════════════════════════════════════════════════════

import {
  KEYS, CAT_LABEL, state, uid, esc, fmtShort, showToast,
  on, emit, loadLocal, saveLocal, saveSettings, savePending,
  updateCategories, getHabits, updateHabits,
  buildSyncPayload, applySyncPayload,
  setBelState, setCnNotes,
} from './state.js';

import { ghFetch, ghPush, testGhConnection } from './sync.js';
import { register, switchView, currentViewName } from './router.js';
import { initDashboard, renderReflectToday, onReflectEnter, onReflectExit, getReflectMode } from './dashboard.js';
import { initTimeline, renderTimeline, onTimelineEnter } from './timeline.js';
import { initBel, renderBel } from './bel.js';
import { renderCNList } from './confnotes.js';

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
// CATEGORY SYSTEM
// ══════════════════════════════════════════════════════════════════

function rebuildCategoryUI() {
  // Rebuild filter chips from current CAT_LABEL
  const filterRow = document.getElementById('filterRow');
  if (!filterRow) return;
  const active = filterRow.querySelector('.chip.active')?.dataset.filter || 'all';
  filterRow.innerHTML = '';
  const fixed = ['all', 'today', 'blocked', 'archive'];
  const fixedLabels = { all: 'all', today: 'today', blocked: 'blocked', archive: 'archive' };
  fixed.forEach(function(k) {
    const c = document.createElement('div');
    c.className = 'chip' + (k === active ? ' active' : '');
    c.dataset.filter = k;
    c.textContent = fixedLabels[k];
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

  const filter   = state.filter || 'all';
  const search   = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const today    = new Date(); today.setHours(0, 0, 0, 0);

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

  // Group by category when showing all; flat list otherwise
  let html = '';

  if (filter === 'all' && !search) {
    // Pinned today first
    const pinned = tasks.filter(t => t.pinnedToday);
    const rest   = tasks.filter(t => !t.pinnedToday);

    if (pinned.length) {
      html += '<div class="section-label">today</div>';
      pinned.forEach(function(t) { html += renderTaskRow(t); });
    }

    // Group rest by first category
    const grouped = {};
    const ungrouped = [];
    rest.forEach(function(t) {
      const cat = (t.categories || [])[0];
      if (cat) {
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(t);
      } else {
        ungrouped.push(t);
      }
    });

    // Render in CAT_LABEL order
    Object.keys(CAT_LABEL).forEach(function(cat) {
      if (!grouped[cat] || grouped[cat].length === 0) return;
      html += '<div class="section-label">' + esc(cat) + '</div>';
      grouped[cat].forEach(function(t) { html += renderTaskRow(t); });
    });

    // Uncategorised
    if (ungrouped.length) {
      html += '<div class="section-label">other</div>';
      ungrouped.forEach(function(t) { html += renderTaskRow(t); });
    }
  } else {
    tasks.forEach(function(t) { html += renderTaskRow(t); });
  }

  list.innerHTML = html;
  attachTaskListeners(list);
}

function renderTaskRow(t) {
  const catArray = t.categories || [];
  const catHtml  = catArray.map(function(c) {
    return '<span class="cat">' + esc(c) + '</span>';
  }).join('');

  const statusMap = { waiting: 'waiting', blocked: 'blocked', review: 'review' };
  const statusHtml = (t.status && t.status !== 'active')
    ? '<span class="status ' + t.status + '">' + esc(statusMap[t.status] || t.status) + '</span>'
    : '';

  const dc      = dueClass(t.due);
  const dueHtml = t.due
    ? '<span class="task-due ' + dc + '">' + esc(fmtDue(t.due)) + '</span>'
    : '';

  const hasNote = t.note && t.note.trim();
  const noteDot = hasNote ? '<span class="note-dot"></span>' : '';

  const metaHtml = (catHtml || statusHtml || noteDot)
    ? '<div class="task-meta-row">' + catHtml + statusHtml + noteDot + '</div>'
    : '';

  const doneCls   = t.done ? ' done' : '';
  const dimmedCls = (!t.done && (t.status === 'blocked' || t.status === 'waiting')) ? ' dimmed' : '';
  const priCls    = ' ' + (t.priority || 'md');

  return (
    '<div class="task' + priCls + doneCls + dimmedCls + '" data-id="' + esc(t.id) + '">' +
      '<div class="task-dot"></div>' +
      '<div class="task-body">' +
        '<div class="task-title">' + esc(t.title || '') + '</div>' +
        metaHtml +
      '</div>' +
      dueHtml +
      '<div class="swipe-action-left">delete</div>' +
      '<div class="swipe-action-right">defer</div>' +
    '</div>'
  );
}

function attachTaskListeners(list) {
  list.querySelectorAll('.task').forEach(function(el) {
    const id = el.dataset.id;

    // Tap → open sheet
    el.addEventListener('click', function(e) {
      if (el.dataset.swiped === '1') { el.dataset.swiped = '0'; return; }
      openTaskSheet(id);
    });

    // Swipe
    attachSwipe(el, id);
  });
}

// ── SWIPE (delete left, defer right) ──
function attachSwipe(el, id) {
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false;
  const THRESHOLD = 72;

  el.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0; dragging = false; decided = false;
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    const cx = e.touches[0].clientX;
    const cy = e.touches[0].clientY;
    if (!decided) {
      const adx = Math.abs(cx - startX);
      const ady = Math.abs(cy - startY);
      if (ady > adx + 6) { dragging = false; decided = true; return; }
      if (adx > 6) { dragging = true; decided = true; }
      else return;
    }
    if (!dragging) return;
    e.preventDefault();
    dx = cx - startX;
    const clamped = Math.max(-110, Math.min(110, dx));
    el.style.transform = 'translate3d(' + clamped + 'px,0,0)';
    el.style.transition = 'none';

    const leftAction  = el.querySelector('.swipe-action-left');
    const rightAction = el.querySelector('.swipe-action-right');
    if (leftAction)  leftAction.style.opacity  = dx < -20 ? Math.min(1, (-dx - 20) / 40) : '0';
    if (rightAction) rightAction.style.opacity = dx >  20 ? Math.min(1, (dx  - 20) / 40) : '0';
  }, { passive: false });

  el.addEventListener('touchend', function() {
    if (!dragging) return;
    el.style.transition = '';
    el.style.transform  = '';
    const leftAction  = el.querySelector('.swipe-action-left');
    const rightAction = el.querySelector('.swipe-action-right');
    if (leftAction)  leftAction.style.opacity  = '0';
    if (rightAction) rightAction.style.opacity = '0';

    if (dx < -THRESHOLD) {
      el.dataset.swiped = '1';
      deleteTaskWithUndo(id);
    } else if (dx > THRESHOLD) {
      el.dataset.swiped = '1';
      deferTask(id);
    }
    dx = 0; dragging = false;
  }, { passive: true });
}

function deleteTaskWithUndo(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const backup = Object.assign({}, t);
  state.tasks = state.tasks.filter(x => x.id !== id);
  saveLocal(); render(); ghPush();

  const msg   = document.getElementById('toastUndoMsg');
  const toast = document.getElementById('toastUndo');
  if (msg)   msg.textContent = '"' + (backup.title || 'Task') + '" deleted';
  if (toast) { toast.classList.add('show'); clearTimeout(toast._timer); toast._timer = setTimeout(function() { toast.classList.remove('show'); }, 3500); }

  document.getElementById('toastUndoBtn').onclick = function() {
    state.tasks.push(backup);
    saveLocal(); render(); ghPush();
    toast.classList.remove('show');
    showToast('Restored');
  };
}

function deferTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.due) {
    const d = new Date(t.due + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    t.due = d.toISOString().split('T')[0];
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    t.due = tomorrow.toISOString().split('T')[0];
  }
  t.pinnedToday = false;
  saveLocal(); render(); ghPush();
  showToast('Deferred to ' + fmtDue(t.due));
}

// ══════════════════════════════════════════════════════════════════
// TASK SHEET
// ══════════════════════════════════════════════════════════════════

let _editingTaskId = null;

function openTaskSheet(id) {
  const t = id ? state.tasks.find(x => x.id === id) : null;
  _editingTaskId = id || null;

  // Populate fields
  document.getElementById('taskSheetTitle').value = t ? (t.title || '') : '';
  document.getElementById('taskSheetNote').value  = t ? (t.note  || '') : '';
  document.getElementById('taskSheetDue').value   = t ? (t.due   || '') : '';

  // Priority
  document.querySelectorAll('#taskSheetPriority .seg-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.val === (t ? t.priority || 'md' : 'md'));
  });

  // Status
  document.querySelectorAll('#taskSheetStatus .seg-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.val === (t ? t.status || 'active' : 'active'));
  });

  // Categories
  const catGrid = document.getElementById('taskSheetCats');
  catGrid.innerHTML = '';
  const activeCats = t ? (t.categories || []) : [];
  Object.keys(CAT_LABEL).forEach(function(key) {
    const tog = document.createElement('div');
    tog.className = 'cat-toggle' + (activeCats.includes(key) ? ' active' : '');
    tog.dataset.cat = key;
    tog.textContent = key;
    catGrid.appendChild(tog);
  });

  // Pin button label
  const pinBtn = document.getElementById('taskSheetPin');
  if (pinBtn) pinBtn.textContent = (t && t.pinnedToday) ? 'unpin today' : 'pin today';

  // Delete button visibility
  const delBtn = document.getElementById('taskSheetDelete');
  if (delBtn) delBtn.style.display = t ? '' : 'none';

  openSheet('taskSheet');
}

function saveTaskFromSheet() {
  const title = document.getElementById('taskSheetTitle').value.trim();
  if (!title) { showToast('Add a title'); return; }

  const priority = document.querySelector('#taskSheetPriority .seg-btn.active')?.dataset.val || 'md';
  const status   = document.querySelector('#taskSheetStatus .seg-btn.active')?.dataset.val || 'active';
  const due      = document.getElementById('taskSheetDue').value || '';
  const note     = document.getElementById('taskSheetNote').value.trim();
  const cats     = Array.from(document.querySelectorAll('#taskSheetCats .cat-toggle.active')).map(function(el) { return el.dataset.cat; });

  if (_editingTaskId) {
    const t = state.tasks.find(x => x.id === _editingTaskId);
    if (t) {
      t.title = title; t.priority = priority; t.status = status;
      t.due = due; t.note = note; t.categories = cats;
    }
  } else {
    state.tasks.push({
      id: uid(), title, priority, status, due, note,
      categories: cats, done: false, pinnedToday: false, pomodoros: 0,
    });
  }

  saveLocal(); render(); ghPush();
  closeSheet('taskSheet');
}

// ── Sheet open/close ──
function openSheet(id) {
  const sheet    = document.getElementById(id);
  const backdrop = document.getElementById(id + 'Backdrop') || document.getElementById('taskSheetBackdrop');
  if (sheet)    { sheet.classList.add('open');    }
  if (backdrop) { backdrop.classList.add('open'); }
}

function closeSheet(id) {
  const sheet    = document.getElementById(id);
  const backdrop = document.getElementById(id + 'Backdrop') || document.getElementById('taskSheetBackdrop');
  if (sheet)    sheet.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

// ── Seg-control tap ──
document.querySelectorAll('.seg-control').forEach(function(ctrl) {
  ctrl.addEventListener('click', function(e) {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    ctrl.querySelectorAll('.seg-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
});

// ── Cat-toggle tap in sheet ──
document.getElementById('taskSheetCats').addEventListener('click', function(e) {
  const tog = e.target.closest('.cat-toggle');
  if (tog) tog.classList.toggle('active');
});

// ── Sheet buttons ──
document.getElementById('taskSheetSave').addEventListener('click', saveTaskFromSheet);
document.getElementById('taskSheetDelete').addEventListener('click', function() {
  if (!_editingTaskId) return;
  state.tasks = state.tasks.filter(x => x.id !== _editingTaskId);
  saveLocal(); render(); ghPush(); closeSheet('taskSheet');
  showToast('Deleted');
});
document.getElementById('taskSheetPin').addEventListener('click', function() {
  if (!_editingTaskId) return;
  const t = state.tasks.find(x => x.id === _editingTaskId);
  if (t) { t.pinnedToday = !t.pinnedToday; saveLocal(); render(); ghPush(); }
  closeSheet('taskSheet');
});
document.getElementById('taskSheetBackdrop').addEventListener('click', function() {
  closeSheet('taskSheet');
});

// ══════════════════════════════════════════════════════════════════
// FAB
// ══════════════════════════════════════════════════════════════════

document.getElementById('fab').addEventListener('click', function() {
  const view = currentViewName();
  if (view === 'notes') {
    // confnotes.js handles this via its own createNewNote export
    import('./confnotes.js').then(function(m) { m.createNewNote('memo'); });
  } else {
    _editingTaskId = null;
    openTaskSheet(null);
  }
});

// ══════════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════════

document.getElementById('searchTrigger').addEventListener('click', function() {
  const wrap = document.getElementById('searchWrap');
  const isOpen = wrap.classList.toggle('open');
  if (isOpen) { document.getElementById('searchInput').focus(); }
  else { document.getElementById('searchInput').value = ''; render(); }
});

document.getElementById('searchInput').addEventListener('input', render);

// ══════════════════════════════════════════════════════════════════
// FILTER CHIPS
// ══════════════════════════════════════════════════════════════════

document.getElementById('filterRow').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#filterRow .chip').forEach(function(c) { c.classList.remove('active'); });
  chip.classList.add('active');
  state.filter = chip.dataset.filter;
  render();
});

// ══════════════════════════════════════════════════════════════════
// TAB BAR
// ══════════════════════════════════════════════════════════════════

document.getElementById('tabTasks').addEventListener('click',   function() { switchView('tasks'); });
document.getElementById('tabNotes').addEventListener('click',   function() { switchView('notes'); });
document.getElementById('tabReflect').addEventListener('click', function() { switchView('reflect'); });

// ── Secret Bel trigger (5 taps on wordmark) ──
(function() {
  let taps = 0, timer = null;
  document.getElementById('secretBelTrigger').addEventListener('click', function() {
    taps++;
    if (timer) clearTimeout(timer);
    if (taps >= 5) { taps = 0; switchView('bel'); return; }
    timer = setTimeout(function() { taps = 0; }, 1200);
  });
})();

document.getElementById('belClose').addEventListener('click', function() { switchView('tasks'); });

// ══════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════

const THEMES = ['light', 'dark'];

function applyTheme(name) {
  document.body.classList.remove('theme-light', 'theme-dark');
  if (name === 'light') {
    document.body.classList.add('theme-light');
  } else if (name === 'dark') {
    document.body.classList.add('theme-dark');
  }
  // 'auto' = no class, prefers-color-scheme media query handles it
  document.querySelectorAll('.theme-option').forEach(function(el) {
    el.classList.toggle('active', el.dataset.theme === (name || 'auto'));
  });
  try { localStorage.setItem(KEYS.theme, name || 'auto'); } catch (e) {}
}

function loadTheme() {
  let saved = 'auto';
  try { saved = localStorage.getItem(KEYS.theme) || 'auto'; } catch (e) {}
  // Migrate old theme names
  if (saved === 'aurora' || saved === 'neon' || saved === 'ios-dark') saved = 'dark';
  if (saved === 'halcyon' || saved === 'newsprint' || saved === 'ios26') saved = 'light';
  applyTheme(saved);
}

document.getElementById('themeToggle').addEventListener('click', function(e) {
  const opt = e.target.closest('.theme-option');
  if (opt) applyTheme(opt.dataset.theme);
});

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════

function updateGhUI(connected) {
  const el  = document.getElementById('ghStatus');
  const txt = document.getElementById('ghStatusText');
  if (connected) {
    el.className   = 'settings-status connected';
    txt.textContent = 'connected: ' + state.settings.ghUser + '/' + state.settings.ghRepo;
  } else {
    el.className   = 'settings-status';
    txt.textContent = 'not connected';
  }
}

function loadSettingsUI() {
  document.getElementById('ghUser').value  = state.settings.ghUser  || '';
  document.getElementById('ghRepo').value  = state.settings.ghRepo  || '';
  document.getElementById('ghToken').value = state.settings.ghToken || '';
  updateGhUI(!!state.settings.ghToken);
  loadCategoriesUI();
  loadHabitsUI();
  updatePinUI();

  // Reflect current theme
  let currentTheme = 'auto';
  try { currentTheme = localStorage.getItem(KEYS.theme) || 'auto'; } catch (e) {}
  document.querySelectorAll('.theme-option').forEach(function(el) {
    el.classList.toggle('active', el.dataset.theme === currentTheme);
  });
}

// Settings open/close
document.getElementById('settingsBtn').addEventListener('click', function() {
  loadSettingsUI();
  document.getElementById('settingsSheet').classList.add('open');
});
document.getElementById('settingsClose').addEventListener('click', function() {
  document.getElementById('settingsSheet').classList.remove('open');
});

// GitHub save
document.getElementById('saveSettingsBtn').addEventListener('click', function() {
  const u = document.getElementById('ghUser').value.trim();
  const r = document.getElementById('ghRepo').value.trim();
  const t = document.getElementById('ghToken').value.trim();
  state.settings = Object.assign(state.settings, { ghUser: u, ghRepo: r, ghToken: t });
  saveSettings();
  document.getElementById('saveSettingsBtn').textContent = 'testing…';
  testGhConnection().then(function(ok) {
    document.getElementById('saveSettingsBtn').textContent = 'save & test connection';
    if (ok) { updateGhUI(true); showToast('connected!'); state.sha = null; ghFetch(); }
    else    { updateGhUI(false); showToast('connection failed — check token & repo'); }
  });
});

// Clear data
document.getElementById('clearDataBtn').addEventListener('click', function() {
  if (!confirm('Clear all local data? Cannot be undone.')) return;
  localStorage.clear();
  state.tasks = [];
  setBelState({});
  render();
  document.getElementById('settingsSheet').classList.remove('open');
  showToast('local data cleared');
});

// Export
document.getElementById('exportDataBtn').addEventListener('click', function() {
  const payload = buildSyncPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tasks-export-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
});

// Import
document.getElementById('importDataRow').addEventListener('click', function() {
  document.getElementById('importFileInput').click();
});
document.getElementById('importFileInput').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      applySyncPayload(data);
      saveLocal();
      render();
      showToast('imported');
    } catch (err) {
      showToast('import failed — invalid file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── CATEGORIES UI ──
function loadCategoriesUI() {
  const container = document.getElementById('catSettingsList');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(function(key) {
    const row = document.createElement('div');
    row.className = 'habit-manage-row';
    row.innerHTML =
      '<input style="flex:1;font-family:var(--font-mono);font-size:13px;border:none;border-bottom:0.5px solid var(--border);padding:4px 0;background:transparent;color:var(--text-primary);" value="' + esc(key) + '" data-orig="' + esc(key) + '" autocapitalize="none">' +
      '<span class="habit-manage-delete" data-key="' + esc(key) + '">remove</span>';
    container.appendChild(row);
  });
}

document.getElementById('addCatBtn').addEventListener('click', function() {
  const input = document.getElementById('newCatInput');
  const key   = input.value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!key) return;
  CAT_LABEL[key] = key;
  updateCategories(Object.assign({}, CAT_LABEL));
  loadCategoriesUI();
  rebuildCategoryUI();
  input.value = '';
  showToast('category added');
});

document.getElementById('catSettingsList').addEventListener('click', function(e) {
  const del = e.target.closest('.habit-manage-delete');
  if (del) {
    delete CAT_LABEL[del.dataset.key];
    updateCategories(Object.assign({}, CAT_LABEL));
    loadCategoriesUI();
    rebuildCategoryUI();
    render();
  }
});

// ── HABITS UI ──
const DAY_LABELS = ['M','T','W','T','F','S','S'];

function loadHabitsUI() {
  const container = document.getElementById('habitSettingsList');
  if (!container) return;
  container.innerHTML = '';
  getHabits().forEach(function(h) { container.appendChild(makeHabitRow(h)); });
}

function makeHabitRow(h) {
  const row = document.createElement('div');
  row.style.cssText = 'padding:10px 0; border-bottom:0.5px solid var(--border);';

  const top = document.createElement('div');
  top.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px;';

  const idInput = document.createElement('input');
  idInput.value       = h.id || '';
  idInput.placeholder = 'id';
  idInput.dataset.orig = h.id || '';
  idInput.autocapitalize = 'none';
  idInput.style.cssText = 'width:70px;font-family:var(--font-mono);font-size:12px;border:none;border-bottom:0.5px solid var(--border);padding:3px 0;background:transparent;color:var(--text-primary);';

  const labelInput = document.createElement('input');
  labelInput.value       = h.label || '';
  labelInput.placeholder = 'Label';
  labelInput.style.cssText = 'flex:1;font-size:14px;border:none;border-bottom:0.5px solid var(--border);padding:3px 0;background:transparent;color:var(--text-primary);';

  const delBtn = document.createElement('span');
  delBtn.textContent = 'remove';
  delBtn.className   = 'habit-manage-delete';
  delBtn.addEventListener('click', function() { row.remove(); });

  top.appendChild(idInput);
  top.appendChild(labelInput);
  top.appendChild(delBtn);

  const daysRow = document.createElement('div');
  daysRow.style.cssText = 'display:flex; gap:4px;';
  const days = h.days || [0,1,2,3,4,5,6];
  DAY_LABELS.forEach(function(label, i) {
    const btn = document.createElement('div');
    btn.style.cssText = 'width:26px;height:24px;border-radius:4px;border:0.5px solid var(--border-strong);background:transparent;color:var(--text-tertiary);font-family:var(--font-mono);font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    btn.textContent = label;
    btn.dataset.day = i;
    if (days.indexOf(i) !== -1) {
      btn.style.background = 'var(--text-primary)';
      btn.style.color      = 'var(--bg)';
      btn.style.borderColor = 'var(--text-primary)';
      btn.dataset.active   = '1';
    }
    btn.addEventListener('click', function() {
      const active = btn.dataset.active === '1';
      btn.dataset.active = active ? '0' : '1';
      btn.style.background  = active ? 'transparent' : 'var(--text-primary)';
      btn.style.color       = active ? 'var(--text-tertiary)' : 'var(--bg)';
      btn.style.borderColor = active ? 'var(--border-strong)' : 'var(--text-primary)';
    });
    daysRow.appendChild(btn);
  });

  row.appendChild(top);
  row.appendChild(daysRow);
  return row;
}

document.getElementById('addHabitBtn').addEventListener('click', function() {
  const input = document.getElementById('newHabitInput');
  const label = input.value.trim();
  if (!label) return;
  const id = label.toLowerCase().replace(/\s+/g, '_');
  const container = document.getElementById('habitSettingsList');
  container.appendChild(makeHabitRow({ id, label, bad: false, days: [0,1,2,3,4,5,6] }));
  input.value = '';
});

// Save habits on settings close
document.getElementById('settingsClose').addEventListener('click', function() {
  _saveHabitsFromUI();
  _saveCatsFromUI();
  document.getElementById('settingsSheet').classList.remove('open');
}, true); // capture so it runs before the basic close listener

function _saveHabitsFromUI() {
  const container = document.getElementById('habitSettingsList');
  if (!container) return;
  const habits = [];
  container.querySelectorAll('div[style*="border-bottom"]').forEach(function(row) {
    const inputs = row.querySelectorAll('input');
    if (inputs.length < 2) return;
    const id    = inputs[0].value.trim().toLowerCase().replace(/\s+/g, '_');
    const label = inputs[1].value.trim();
    if (!id || !label) return;
    const days = [];
    row.querySelectorAll('[data-day]').forEach(function(btn) {
      if (btn.dataset.active === '1') days.push(parseInt(btn.dataset.day));
    });
    habits.push({ id, label, bad: false, days });
  });
  if (habits.length) updateHabits(habits);
}

function _saveCatsFromUI() {
  const container = document.getElementById('catSettingsList');
  if (!container) return;
  const newCats = {};
  container.querySelectorAll('input').forEach(function(inp) {
    const key = inp.value.trim().toLowerCase().replace(/\s+/g, '_');
    if (key) newCats[key] = key;
  });
  if (Object.keys(newCats).length) {
    updateCategories(newCats);
    rebuildCategoryUI();
    render();
  }
}

// ── PIN ──
function _hashPin(pin) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
    .then(function(hash) {
      return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
}

function updatePinUI() {
  const hasPin = !!localStorage.getItem('kw_notes_pin_hash');
  const savePinBtn  = document.getElementById('savePinBtn');
  const clearPinBtn = document.getElementById('clearPinBtn');
  if (savePinBtn)  savePinBtn.textContent  = hasPin ? 'update pin' : 'save pin';
  if (clearPinBtn) clearPinBtn.style.display = hasPin ? '' : 'none';
}

document.getElementById('savePinBtn').addEventListener('click', function() {
  const digits = ['pinD0','pinD1','pinD2','pinD3'].map(function(id) {
    return document.getElementById(id).value;
  });
  const pin = digits.join('');
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('enter a 4-digit pin'); return; }
  _hashPin(pin).then(function(hash) {
    localStorage.setItem('kw_notes_pin_hash', hash);
    updatePinUI();
    showToast('pin saved');
  });
});

document.getElementById('clearPinBtn').addEventListener('click', function() {
  localStorage.removeItem('kw_notes_pin_hash');
  ['pinD0','pinD1','pinD2','pinD3'].forEach(function(id) { document.getElementById(id).value = ''; });
  updatePinUI();
  showToast('pin cleared');
});

// ══════════════════════════════════════════════════════════════════
// ROUTER REGISTRATION & INIT
// ══════════════════════════════════════════════════════════════════

register('tasks',   { onEnter: render });
register('notes',   { onEnter: renderCNList });
register('reflect', {
  onEnter: function() {
    onReflectEnter();
    if (getReflectMode() === 'review') onTimelineEnter();
  },
  onExit: onReflectExit,
});
register('bel', { onEnter: renderBel });

// ── SYNC EVENTS ──
on('data-pulled', function() {
  const view = currentViewName();
  if (view === 'reflect') {
    renderReflectToday();
  } else if (view === 'notes') {
    renderCNList();
  } else if (view === 'bel') {
    renderBel();
  } else {
    render();
  }
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
ghFetch();
