// ══════════════════════════════════════════════════════════════════
// APP.JS — Main application module
// ══════════════════════════════════════════════════════════════════

import {
  KEYS, CAT_DEFAULTS, CAT_LABEL,
  state, cnNotes,
  uid, esc, fmtShort, showToast,
  on, emit,
  loadLocal, saveLocal, saveCN,
  saveSettings, savePending, saveCollapsed, updateCategories,
  getHabits, updateHabits,
  setCnNotes, setBelState,
  getCnNotes,
} from './state.js';

import { ghFetch, ghPush, testGhConnection, showSync } from './sync.js';
import { register, switchView, currentViewName } from './router.js';
import { initBel, renderBel } from './bel.js';
import { initDashboard, renderReflect, onReflectEnter, onReflectExit } from './dashboard.js';
import { renderCNList, createNewNote, rebuildCNChips, NOTE_TYPES, noteTypeOf } from './confnotes.js';
import { initDesktopShell, buildCategoryNav as dsBuildCategoryNav } from './desktop-sidebar.js';


// Bulletproof keyboard dismissal reset
document.addEventListener('focusout', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.body.scrollTop = 0;
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.body.scrollTop = 0;
    }, 100);
  }
});


// ══════════════════════════════════════════════════════════════════
// TIME / DATE HELPERS
// ══════════════════════════════════════════════════════════════════

function isActuallyDueToday(t) {
  if (t.done) return false;
  if (t.pinnedToday) return true;
  if (!t.due) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(t.due + 'T00:00:00');
  if (isNaN(d)) return false;
  return Math.round((d - today) / 86400000) === 0;
}

function dueClass(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return '';
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3)  return 'soon';
  return '';
}

function fmtDue(due) {
  if (!due) return '';
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return due;
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return Math.abs(diff) + 'd ago';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

// ══════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════

function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name || 'light');
  try { localStorage.setItem(KEYS.theme || 'kw_theme_v3', name || 'light'); } catch(e) {}
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === (name || 'light'));
  });
}

function loadTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem(KEYS.theme || 'kw_theme_v3') || 'light'; } catch(e) {}
  if (saved === 'halcyon' || saved === 'newsprint' || saved === 'ios26' || saved === 'bel-bel') saved = 'light';
  if (saved === 'aurora' || saved === 'neon' || saved === 'ios-dark') saved = 'dark';
  applyTheme(saved);
}

document.getElementById('settingsSheet').addEventListener('click', function(e) {
  const sw = e.target.closest('.theme-swatch');
  if (!sw) return;
  applyTheme(sw.dataset.theme);
  render();
});

// ══════════════════════════════════════════════════════════════════
// CATEGORY COLORS — dynamic style injection for custom cats
// FIX: Was injecting `.cat-X { background; color }` but dots use
// `.cat-X::before { background }`. Now injects the ::before rule.
// ══════════════════════════════════════════════════════════════════

const BUILTIN_CAT_CLS = {
  manuscript: 'cat-manuscript', lab: 'cat-lab', phd: 'cat-phd',
  conf: 'cat-conf', bel: 'cat-bel', personal: 'cat-personal', hobby: 'cat-hobby',
};
const _catColorMap = {};
let styleEl = null;

function _assignCatColor(cat) {
  if (_catColorMap[cat]) return;
  const palette = [
    [0,122,255],[52,199,89],[255,149,0],[255,59,48],[175,82,222],[90,200,250],[255,45,85],[100,210,160],
  ];
  const idx = Object.keys(_catColorMap).length % palette.length;
  _catColorMap[cat] = palette[idx];
}

function refreshDynamicCatColors() {
  if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
  let css = '';
  Object.keys(CAT_LABEL).forEach(cat => {
    if (BUILTIN_CAT_CLS[cat]) return;
    _assignCatColor(cat);
    const rgb = _catColorMap[cat];
    const cls = 'cat-' + cat.replace(/[^a-z0-9_-]/g, '_');
    
    // REPLACE the old css += line with this updated one:
    css += '.' + cls + '::before, .ds-cat-dot.' + cls + ' { background: rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + '); box-shadow: 0 0 6px rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + '); }\n';
  });
  styleEl.textContent = css;
}

function catCls(cat) {
  if (BUILTIN_CAT_CLS[cat]) return BUILTIN_CAT_CLS[cat];
  _assignCatColor(cat);
  return 'cat-' + cat.replace(/[^a-z0-9_-]/g, '_');
}

// ══════════════════════════════════════════════════════════════════
// TASK RENDERING
// ══════════════════════════════════════════════════════════════════

function makeTaskWrap(t, delay) {
  const wrap = document.createElement('div');
  wrap.className = 'task-wrap entering';
  wrap.dataset.id = t.id;
  wrap.style.animationDelay = (delay || 0) + 'ms';
  wrap.addEventListener('animationend', function() { wrap.classList.remove('entering'); }, { once: true });

  const bgDefer = document.createElement('div');
  bgDefer.className = 'swipe-bg-defer';
  bgDefer.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/><polyline points="15 18 21 12 15 6"/></svg><span>defer</span>';
  wrap.appendChild(bgDefer);

  const bg = document.createElement('div');
  bg.className = 'swipe-bg';
  bg.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  wrap.appendChild(bg);

  const el = document.createElement('div');
  el.className = 'task ' + (t.priority || 'md') + (t.done ? ' done' : '') + (((t.status === 'blocked' || t.status === 'waiting') && !t.done) ? ' dimmed' : '');
  el.dataset.id = t.id;

  const catArray = t.categories || [];
  const catHtml = catArray.map(c => '<span class="cat ' + catCls(c) + '">' + esc(CAT_LABEL[c] || c) + '</span>').join('');
  const statusMap = { waiting: 'waiting on', blocked: 'blocked', review: 'in review' };
  const statusHtml = (t.status && t.status !== 'active') ? '<span class="status ' + t.status + '">' + esc(statusMap[t.status] || t.status) + '</span>' : '';
  const dc = dueClass(t.due);
  const dueHtml = t.due ? '<span class="due ' + dc + '">' + esc(fmtDue(t.due)) + '</span>' : '';
  const noteHtml = t.note
    ? '<div class="' + (t.noteIsMono ? 'note-mono' : 'note') + '">' + esc(t.note) + '</div>'
    : '';

  el.innerHTML =
    '<div class="task-cb"></div>' +
    '<div class="task-body">' +
      '<div class="task-title">' + esc(t.title) + '</div>' +
      noteHtml +
      '<div class="task-meta">' + catHtml + statusHtml + dueHtml + '</div>' +
    '</div>';

  el.querySelector('.task-cb').addEventListener('click', function(e) {
    e.stopPropagation();
    toggleDone(t.id);
  });

  el.addEventListener('click', function() { openEdit(t.id); });

  attachSwipe(wrap, el, bg, t.id);
  wrap.appendChild(el);
  return wrap;
}

function toggleDone(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done) { t.completedAt = new Date().toISOString(); t.pinnedToday = false; }
  else { delete t.completedAt; }
  saveLocal(); render(); ghPush();
  if (t.done) showToast('Done ✓');
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(x => x.id !== id);
  saveLocal(); render(); ghPush(); showToast('Task deleted');
}

function deferTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.due) {
    const d = new Date(t.due + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    t.due = d.toISOString().split('T')[0];
  } else {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    t.due = tomorrow.toISOString().split('T')[0];
  }
  t.pinnedToday = false;
  saveLocal(); render(); ghPush(); showToast('Deferred to tomorrow');
}

function attachSwipe(wrap, el, bg, id) {
  const bgDefer = wrap.querySelector('.swipe-bg-defer');
  let startX = 0, startY = 0, currentX = 0, dragging = false, maybeSwipe = false;
  const THRESHOLD = 80;

  el.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dragging = false; maybeSwipe = true; currentX = 0;
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    if (!maybeSwipe) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!dragging && Math.abs(dy) > Math.abs(dx) + 5) { maybeSwipe = false; return; }
    dragging = true; currentX = dx;
    const clamped = Math.max(-120, Math.min(120, dx));
    el.style.transform = 'translate3d(' + clamped + 'px,0,0)';
    const pct = Math.min(Math.abs(dx) / THRESHOLD, 1);
    if (dx < 0) { bg.style.opacity = pct; if (bgDefer) bgDefer.style.opacity = 0; }
    else { if (bgDefer) bgDefer.style.opacity = pct; bg.style.opacity = 0; }
    e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchend', function() {
    if (!dragging) { maybeSwipe = false; return; }
    maybeSwipe = false; dragging = false;
    if (currentX <= -THRESHOLD) {
      wrap.classList.add('removing');
      setTimeout(function() { deleteTask(id); }, 200);
    } else if (currentX >= THRESHOLD) {
      el.style.transition = 'transform 0.25s cubic-bezier(0.2,0.9,0.3,1)';
      el.style.transform = 'translate3d(0,0,0)';
      if (bgDefer) bgDefer.style.opacity = 0;
      setTimeout(function() { el.style.transition = ''; el.style.transform = ''; deferTask(id); }, 180);
    } else {
      el.style.transition = 'transform 0.25s cubic-bezier(0.2,0.9,0.3,1)';
      el.style.transform = 'translate3d(0,0,0)';
      bg.style.opacity = 0; if (bgDefer) bgDefer.style.opacity = 0;
      setTimeout(function() { el.style.transition = ''; el.style.transform = ''; }, 260);
    }
  }, { passive: true });
}

// ══════════════════════════════════════════════════════════════════
// FILTERING & SEARCH
// ══════════════════════════════════════════════════════════════════

function filterTask(t) {
  const f = state.filter || 'all';
  if (f === 'archive') return t.done;
  if (t.done) return false;
  if (f === 'all') return true;
  if (f === 'today') return isActuallyDueToday(t); // Add this line!
  if (f === 'blocked') return t.status === 'blocked' || t.status === 'waiting';
  const cats = t.categories || [];
  if (state.filterExclude) return cats.indexOf(f) === -1;
  return cats.indexOf(f) !== -1;
}

function searchMatch(t, q) {
  if (!q) return true;
  const s = (t.title + ' ' + (t.note || '') + ' ' + (t.categories || []).join(' ')).toLowerCase();
  return s.includes(q.toLowerCase());
}

// ══════════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════════

function getUrgencyBucket(t) {
  if (!t.due && !t.pinnedToday) return 'later';
  if (t.pinnedToday) return 'today';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(t.due + 'T00:00:00');
  if (isNaN(d)) return 'later';
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7)  return 'this week';
  return 'later';
}

const URGENCY_ORDER = ['overdue', 'today', 'tomorrow', 'this week', 'later'];
const CAT_ORDER = ['manuscript', 'lab', 'phd', 'conf', 'bel', 'personal', 'hobby'];

function makeSection(key, tasks, labelText, delay) {
  const collapsed = state.collapsed && state.collapsed[key];
  const section = document.createElement('div');
  section.className = 'section' + (collapsed ? ' collapsed' : '');

  const hd = document.createElement('div');
  hd.className = 'sec-header';
  hd.innerHTML =
    '<span class="sec-title">' + esc(labelText) + '</span>' +
    '<span class="sec-count">' + tasks.length + '</span>' +
    '<span class="sec-toggle">▾</span>';
  hd.addEventListener('click', function() {
    section.classList.toggle('collapsed');
    if (!state.collapsed) state.collapsed = {};
    state.collapsed[key] = section.classList.contains('collapsed');
    saveCollapsed();
  });
  section.appendChild(hd);

  const container = document.createElement('div');
  tasks.sort((a, b) => {
    const pri = { hi: 0, md: 1, lo: 2 };
    return (pri[a.priority] || 1) - (pri[b.priority] || 1);
  });
  tasks.forEach(t => { container.appendChild(makeTaskWrap(t, delay)); delay += 30; });
  section.appendChild(container);
  return { el: section, delay };
}

function render() {
  const list = document.getElementById('taskList');
  if (!list) return;
  if (currentViewName() !== 'tasks') return;

  const q = (document.getElementById('searchInput') || {}).value || '';
  const f = state.filter || 'all';
  const visibleTasks = state.tasks.filter(t => filterTask(t) && searchMatch(t, q));

  list.innerHTML = '';
  let delay = 0;

  if (f === 'all') {
    const groups = {};
    URGENCY_ORDER.forEach(k => { groups[k] = []; });
    visibleTasks.forEach(t => {
      const bucket = getUrgencyBucket(t);
      groups[bucket].push(t);
    });
    URGENCY_ORDER.forEach(key => {
      if (groups[key].length === 0) return;
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      const result = makeSection(key, groups[key], label, delay);
      delay = result.delay;
      list.appendChild(result.el);
    });
  } else if (f === 'archive') {
    visibleTasks.sort((a, b) => (b.completedAt || '') > (a.completedAt || '') ? 1 : -1);
    visibleTasks.forEach(t => { list.appendChild(makeTaskWrap(t, delay)); delay += 30; });
  } else {
    const groups = {};
    URGENCY_ORDER.forEach(k => { groups[k] = []; });
    visibleTasks.forEach(t => { groups[getUrgencyBucket(t)].push(t); });
    let hasSections = false;
    URGENCY_ORDER.forEach(key => {
      if (groups[key].length === 0) return;
      hasSections = true;
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      const result = makeSection(key, groups[key], label, delay);
      delay = result.delay;
      list.appendChild(result.el);
    });
    if (!hasSections) {
      visibleTasks.sort((a, b) => ({ hi: 0, md: 1, lo: 2 }[a.priority] || 1) - ({ hi: 0, md: 1, lo: 2 }[b.priority] || 1));
      visibleTasks.forEach(t => { list.appendChild(makeTaskWrap(t, delay)); delay += 30; });
    }
  }
}

window.render = render;  // ← add this line right after `function render() { ... }` block
window.openEdit = openEdit;  // ← add after the openEdit function definition

// ══════════════════════════════════════════════════════════════════
// SHEETS
// ══════════════════════════════════════════════════════════════════

function openSheet(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => {
    s.style.transform = ''; s.style.transition = '';
    s.classList.remove('open');
  });
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
  state.editingId = null;
  const ttl = document.getElementById('addSheetTitle'); if (ttl) ttl.textContent = 'New Task';
  const sv = document.getElementById('saveTaskBtn'); if (sv) sv.textContent = 'Add Task';
  const dv = document.getElementById('deleteTaskBtn'); if (dv) dv.style.display = 'none';
}

document.querySelectorAll('.sheet').forEach(sheet => {
  let startY = 0, dragging = false;
  sheet.addEventListener('touchstart', function(e) {
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY; dragging = true;
  }, { passive: true });
  sheet.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) { sheet.style.transform = 'translate3d(0,' + dy + 'px,0)'; sheet.style.transition = 'none'; }
  }, { passive: true });
  sheet.addEventListener('touchend', function(e) {
    if (!dragging) return; dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) { sheet.style.transition = ''; closeSheets(); }
    else { sheet.style.transition = 'transform 0.3s cubic-bezier(0.2,0.85,0.3,1)'; sheet.style.transform = ''; setTimeout(function() { sheet.style.transition = ''; }, 300); }
  }, { passive: true });
});

// ══════════════════════════════════════════════════════════════════
// ADD / EDIT TASK
// ══════════════════════════════════════════════════════════════════

function openAddSheet() {
  closeSheets();
  state.editingId = null;
  document.getElementById('taskTitleInput').value = '';
  document.getElementById('taskNoteInput').value = '';
  document.getElementById('taskDueInput').value = '';
  document.getElementById('taskNoteInput').style.fontFamily = 'inherit';
  document.getElementById('monoToggle').classList.remove('mono-active');
  document.querySelectorAll('#catRow .s-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('#statusRow .s-chip').forEach(c => c.classList.toggle('active', c.dataset.val === 'active'));
  document.querySelectorAll('#priRow .s-chip').forEach(c => c.classList.toggle('active', c.dataset.val === 'md'));
  document.getElementById('pinTodayChip').classList.remove('active');
  setTimeout(function() { openSheet('addSheet'); document.getElementById('taskTitleInput').focus(); }, 10);
}

function openEdit(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  state.editingId = id;
  document.getElementById('addSheetTitle').textContent = 'Edit Task';
  document.getElementById('saveTaskBtn').textContent = 'Save Changes';
  document.getElementById('deleteTaskBtn').style.display = 'block';
  document.getElementById('taskTitleInput').value = t.title || '';
  document.getElementById('taskNoteInput').value = t.note || '';
  document.getElementById('taskDueInput').value = t.due || '';

  const isMono = t.noteIsMono || false;
  document.getElementById('taskNoteInput').style.fontFamily = isMono ? 'ui-monospace, monospace' : 'inherit';
  const mt = document.getElementById('monoToggle');
  mt.classList.toggle('mono-active', isMono);

  document.querySelectorAll('#catRow .s-chip').forEach(c => c.classList.toggle('active', (t.categories || []).includes(c.dataset.val)));
  document.querySelectorAll('#statusRow .s-chip').forEach(c => c.classList.toggle('active', (t.status || 'active') === c.dataset.val));
  document.querySelectorAll('#priRow .s-chip').forEach(c => c.classList.toggle('active', (t.priority || 'md') === c.dataset.val));
  document.getElementById('pinTodayChip').classList.toggle('active', !!t.pinnedToday);

  openSheet('addSheet');
}

function saveTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title) { showToast('Task needs a title'); return; }

  const cats = Array.from(document.querySelectorAll('#catRow .s-chip.active')).map(c => c.dataset.val);
  const status = (document.querySelector('#statusRow .s-chip.active') || {}).dataset?.val || 'active';
  const priority = (document.querySelector('#priRow .s-chip.active') || {}).dataset?.val || 'md';
  const due = document.getElementById('taskDueInput').value || '';
  const note = document.getElementById('taskNoteInput').value.trim();
  const noteIsMono = document.getElementById('monoToggle').classList.contains('mono-active');
  const pinnedToday = document.getElementById('pinTodayChip').classList.contains('active');

  if (state.editingId) {
    const t = state.tasks.find(x => x.id === state.editingId);
    if (t) {
      t.title = title; t.categories = cats; t.status = status;
      t.priority = priority; t.due = due; t.note = note;
      t.noteIsMono = noteIsMono; t.pinnedToday = pinnedToday;
    }
    showToast('Task saved');
  } else {
    state.tasks.unshift({
      id: uid(), title, categories: cats, status, priority,
      due, note, noteIsMono, pinnedToday,
      done: false, pomodoros: 0,
    });
    showToast('Task added');
  }

  saveLocal(); ghPush(); closeSheets(); render();
}

function submitQuickAdd() {
  const inp = document.getElementById('quickAddInput');
  const title = inp.value.trim();
  if (!title) return;
  state.tasks.unshift({
    id: uid(), title, categories: [], status: 'active',
    priority: 'md', due: '', note: '', noteIsMono: false,
    pinnedToday: true, done: false, pomodoros: 0,
  });
  inp.value = '';
  saveLocal(); ghPush(); render(); showToast('Task added');
}

const quickAddInput = document.getElementById('quickAddInput');
if (quickAddInput) {
  quickAddInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitQuickAdd();
  });

  // On mobile, hide the nav pill while typing so it doesn't overlap content
  quickAddInput.addEventListener('focus', function() {
    if (window.matchMedia('(min-width: 768px)').matches) return;
    const nav = document.querySelector('.glass-nav-wrap');
    if (nav) nav.style.display = 'none';
  });

  quickAddInput.addEventListener('blur', function() {
    if (window.matchMedia('(min-width: 768px)').matches) return;
    const nav = document.querySelector('.glass-nav-wrap');
    if (nav) nav.style.display = '';
  });
}

const quickAddFullBtn = document.getElementById('quickAddFullBtn');
if (quickAddFullBtn) {
  quickAddFullBtn.addEventListener('click', openAddSheet);
}

// ══════════════════════════════════════════════════════════════════
// DESKTOP UTILITIES
// ══════════════════════════════════════════════════════════════════

function isDesktop() { return window.matchMedia('(min-width: 768px)').matches; }

function updateGhUI(connected) {
  const dot = document.getElementById('ghStatusDot');
  const txt = document.getElementById('ghStatusText');
  if (connected) {
    if (dot) dot.className = 'status-dot ok';
    if (txt) txt.textContent = 'Connected (Gist: ' + state.settings.ghGistId.slice(0, 8) + '…)';
  } else {
    if (dot) dot.className = 'status-dot';
    if (txt) txt.textContent = 'Not connected';
  }
}

function loadCategoriesUI() {
  const container = document.getElementById('catSettingsList');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(key => {
    const row = document.createElement('div');
    row.className = 'cat-settings-row';
    row.innerHTML =
      '<input class="input cat-key-input" style="width:100px; font-family:ui-monospace,monospace; font-size:12px;" value="' + esc(key) + '" data-orig="' + esc(key) + '" placeholder="key" autocapitalize="none">' +
      '<input class="input cat-label-input" style="flex:1;" value="' + esc(CAT_LABEL[key]) + '" placeholder="label">' +
      '<div class="bel-del" data-key="' + esc(key) + '">×</div>';
    row.querySelector('.bel-del').addEventListener('click', function() { row.remove(); });
    container.appendChild(row);
  });
}

function saveCategoriesFromUI() {
  const container = document.getElementById('catSettingsList');
  if (!container) return;
  const newCats = {};
  container.querySelectorAll('.cat-settings-row').forEach(row => {
    const key = row.querySelector('.cat-key-input').value.trim().toLowerCase().replace(/\s+/g, '_');
    const label = row.querySelector('.cat-label-input').value.trim();
    if (key && label) newCats[key] = label;
  });
  updateCategories(newCats);
  rebuildCategoryUI();
  refreshDynamicCatColors();
  render();
}

function loadHabitsUI() {
  const container = document.getElementById('habitSettingsList');
  if (!container) return;
  container.innerHTML = '';
  getHabits().forEach(h => {
    const row = document.createElement('div');
    row.className = 'habit-settings-row';
    const dayLabels = ['M','T','W','T','F','S','S'];
    const daysHtml = dayLabels.map((l, i) =>
      '<div class="habit-day-toggle' + ((h.days || [0,1,2,3,4,5,6]).includes(i) ? ' active' : '') + '" data-day="' + i + '">' + l + '</div>'
    ).join('');
    row.innerHTML =
      '<div class="habit-settings-top">' +
        '<input class="input" value="' + esc(h.label) + '" placeholder="Habit name" style="flex:1; margin-bottom:0;">' +
        '<div class="habit-bad-toggle' + (h.bad ? ' active' : '') + '">bad habit</div>' +
        '<div class="habit-del-btn">×</div>' +
      '</div>' +
      '<div class="habit-day-toggles">' + daysHtml + '</div>';
    row.querySelector('.habit-bad-toggle').addEventListener('click', function() { this.classList.toggle('active'); });
    row.querySelector('.habit-del-btn').addEventListener('click', function() { row.remove(); });
    row.querySelectorAll('.habit-day-toggle').forEach(btn => {
      btn.addEventListener('click', function() { this.classList.toggle('active'); });
    });
    container.appendChild(row);
  });
}

function saveHabitsFromUI() {
  const container = document.getElementById('habitSettingsList');
  if (!container) return;
  const newHabits = [];
  container.querySelectorAll('.habit-settings-row').forEach(row => {
    const label = row.querySelector('input').value.trim();
    const bad = row.querySelector('.habit-bad-toggle').classList.contains('active');
    const days = [];
    row.querySelectorAll('.habit-day-toggle.active').forEach(b => days.push(parseInt(b.dataset.day)));
    if (label) newHabits.push({ id: uid(), label, bad, days });
  });
  updateHabits(newHabits);
  showToast('Habits saved');
}

function hasPinSet() {
  try { return !!localStorage.getItem('kw_pin_v1'); } catch(e) { return false; }
}
function updatePinUI() {
  const hasPin = hasPinSet();
  const clearBtn = document.getElementById('clearPinBtn');
  if (clearBtn) clearBtn.style.display = hasPin ? 'block' : 'none';
}

function loadSettingsUI() {
  document.getElementById('ghGistId').value = state.settings.ghGistId || '';
  document.getElementById('ghToken').value = state.settings.ghToken || '';
  updateGhUI(!!state.settings.ghToken);
  loadCategoriesUI();
  loadHabitsUI();
  updatePinUI();
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === theme);
  });
}

// ══════════════════════════════════════════════════════════════════
// CATEGORY CHIPS UI
// ══════════════════════════════════════════════════════════════════

function rebuildCategoryUI() {
  const filterRow = document.getElementById('filterRow');
  if (filterRow) {
    const fixed = ['all', 'blocked', 'archive'];
    Array.from(filterRow.querySelectorAll('.chip')).forEach(c => {
      if (!fixed.includes(c.dataset.filter) && !Object.keys(CAT_LABEL).includes(c.dataset.filter)) {
        c.remove();
      }
    });
    Object.keys(CAT_LABEL).forEach(key => {
      if (!filterRow.querySelector('[data-filter="' + key + '"]')) {
        const c = document.createElement('div');
        c.className = 'chip'; c.dataset.filter = key;
        c.textContent = CAT_LABEL[key];
        filterRow.insertBefore(c, filterRow.querySelector('[data-filter="blocked"]'));
      }
    });
  }

  const catRow = document.getElementById('catRow');
  if (catRow) {
    catRow.innerHTML = '';
    Object.keys(CAT_LABEL).forEach(key => {
      const c = document.createElement('div');
      c.className = 's-chip'; c.dataset.val = key;
      c.textContent = CAT_LABEL[key];
      catRow.appendChild(c);
    });
  }

  rebuildCNChips();
}

// ══════════════════════════════════════════════════════════════════
// EVENT WIRING
// ══════════════════════════════════════════════════════════════════

document.getElementById('tabTasks').addEventListener('click', function() { switchView('tasks'); });
document.getElementById('tabReflect').addEventListener('click', function() { switchView('reflect'); });
document.getElementById('tabNotes').addEventListener('click', function() { switchView('notes'); });

let _belTaps = 0, _belTimer = null;
document.getElementById('secretBelTrigger').addEventListener('click', function() {
  _belTaps++;
  if (_belTimer) clearTimeout(_belTimer);
  if (_belTaps >= 5) { _belTaps = 0; switchView('bel'); }
  else { _belTimer = setTimeout(function() { _belTaps = 0; }, 1200); }
});
const closeBelBtn = document.getElementById('closeBelBtn');
if (closeBelBtn) closeBelBtn.addEventListener('click', function() { switchView('tasks'); });

const cnNewBtn = document.getElementById('cnNewBtn');
if (cnNewBtn) {
  cnNewBtn.addEventListener('click', function() {
    createNewNote('memo');
  });
}

document.getElementById('overlay').addEventListener('click', closeSheets);

document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
document.getElementById('deleteTaskBtn').addEventListener('click', function() {
  if (state.editingId) deleteTask(state.editingId);
  closeSheets();
});
document.getElementById('closeAddSheet').addEventListener('click', closeSheets);

const cnPropsTriggerBtn = document.getElementById('cnPropsTriggerBtn');
if (cnPropsTriggerBtn) {
  cnPropsTriggerBtn.addEventListener('click', function() { openSheet('notePropsSheet'); });
}
const closeNotePropsBtn = document.getElementById('closeNotePropsBtn');
if (closeNotePropsBtn) {
  closeNotePropsBtn.addEventListener('click', closeSheets);
}

document.getElementById('pinTodayChip').addEventListener('click', function() {
  this.classList.toggle('active');
});

document.getElementById('monoToggle').addEventListener('click', function() {
  const isMono = this.classList.toggle('mono-active');
  document.getElementById('taskNoteInput').style.fontFamily = isMono ? 'ui-monospace, monospace' : 'inherit';
});

document.getElementById('catRow').addEventListener('click', function(e) {
  const c = e.target.closest('.s-chip'); if (!c) return;
  c.classList.toggle('active');
});
document.getElementById('statusRow').addEventListener('click', function(e) {
  const c = e.target.closest('.s-chip'); if (!c) return;
  document.querySelectorAll('#statusRow .s-chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
});
document.getElementById('priRow').addEventListener('click', function(e) {
  const c = e.target.closest('.s-chip'); if (!c) return;
  document.querySelectorAll('#priRow .s-chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
});

document.getElementById('filterRow').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip'); if (!chip) return;
  const val = chip.dataset.filter || 'all';
  // If clicking the already-active non-all chip, toggle exclusion
  if (val === state.filter && val !== 'all' && val !== 'archive' && val !== 'blocked') {
    state.filterExclude = !state.filterExclude;
  } else {
    state.filterExclude = false;
  }
  document.querySelectorAll('#filterRow .chip').forEach(c => {
    c.classList.remove('active', 'exclude-active');
  });
  chip.classList.add('active');
  if (state.filterExclude) chip.classList.add('exclude-active');
  state.filter = val;
  render();
});

document.getElementById('searchBtn').addEventListener('click', function() {
  const wrap = document.getElementById('searchWrap');
  const isOpen = wrap.classList.toggle('open');
  if (isOpen) document.getElementById('searchInput').focus();
  else { document.getElementById('searchInput').value = ''; render(); }
});
document.getElementById('searchInput').addEventListener('input', render);

const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', function() {
    const btn = this;
    btn.style.opacity = '0.5'; // Visual feedback
    showToast('Syncing...');
    ghFetch();
    setTimeout(() => btn.style.opacity = '', 500);
  });
}

document.getElementById('settingsBtn').addEventListener('click', function() {
  loadSettingsUI(); openSheet('settingsSheet');
});
document.getElementById('closeSettingsSheet').addEventListener('click', closeSheets);

const dockSettingsBtn = document.getElementById('dockSettingsBtn');
if (dockSettingsBtn) {
  dockSettingsBtn.addEventListener('click', function() {
    loadSettingsUI(); openSheet('settingsSheet');
  });
}

document.getElementById('saveSettingsBtn').addEventListener('click', function() {
  const g = document.getElementById('ghGistId').value.trim();
  const t = document.getElementById('ghToken').value.trim();
  state.settings = Object.assign({}, state.settings, { ghGistId: g, ghToken: t });
  saveSettings();
  this.textContent = 'Testing…';
  saveCategoriesFromUI();
  testGhConnection().then(ok => {
    this.textContent = 'Save & Test Connection';
    if (ok) { updateGhUI(true); showToast('Connected!'); ghFetch(); }
    else { updateGhUI(false); showToast('Connection failed — check credentials'); }
  });
});

document.getElementById('addCatBtn').addEventListener('click', function() {
  const container = document.getElementById('catSettingsList');
  const row = document.createElement('div');
  row.className = 'cat-settings-row';
  row.innerHTML =
    '<input class="input cat-key-input" style="width:100px; font-family:ui-monospace,monospace; font-size:12px;" placeholder="key" autocapitalize="none">' +
    '<input class="input cat-label-input" style="flex:1;" placeholder="label">' +
    '<div class="bel-del">×</div>';
  row.querySelector('.bel-del').addEventListener('click', function() { row.remove(); });
  container.appendChild(row);
});

document.getElementById('saveCatsBtn').addEventListener('click', function() {
  saveCategoriesFromUI();
  if (typeof dsBuildCategoryNav === 'function') dsBuildCategoryNav();  // ← add this
  showToast('Categories saved');
  closeSheets();
});

document.getElementById('saveHabitsBtn').addEventListener('click', function() {
  saveHabitsFromUI();
  saveCategoriesFromUI();
  closeSheets();
});

document.getElementById('addHabitBtn').addEventListener('click', function() {
  const container = document.getElementById('habitSettingsList');
  const row = document.createElement('div');
  row.className = 'habit-settings-row';
  const dayLabels = ['M','T','W','T','F','S','S'];
  const daysHtml = dayLabels.map((l, i) =>
    '<div class="habit-day-toggle active" data-day="' + i + '">' + l + '</div>'
  ).join('');
  row.innerHTML =
    '<div class="habit-settings-top">' +
      '<input class="input" placeholder="Habit name" style="flex:1; margin-bottom:0;">' +
      '<div class="habit-bad-toggle">bad habit</div>' +
      '<div class="habit-del-btn">×</div>' +
    '</div>' +
    '<div class="habit-day-toggles">' + daysHtml + '</div>';
  row.querySelector('.habit-bad-toggle').addEventListener('click', function() { this.classList.toggle('active'); });
  row.querySelector('.habit-del-btn').addEventListener('click', function() { row.remove(); });
  row.querySelectorAll('.habit-day-toggle').forEach(btn => {
    btn.addEventListener('click', function() { this.classList.toggle('active'); });
  });
  container.appendChild(row);
});

document.getElementById('setPinBtn').addEventListener('click', function() {
  const val = document.getElementById('pinInput').value.trim();
  if (!val) return;
  try { localStorage.setItem('kw_pin_v1', val); } catch(e) {}
  document.getElementById('pinInput').value = '';
  updatePinUI();
  showToast('PIN set');
});
document.getElementById('clearPinBtn').addEventListener('click', function() {
  try { localStorage.removeItem('kw_pin_v1'); } catch(e) {}
  updatePinUI();
  showToast('PIN cleared');
});

document.addEventListener('keydown', function(e) {
  const view = currentViewName();
  const tag = (document.activeElement || {}).tagName || '';
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;
  
  if (view === 'tasks') {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddSheet(); }
  }
});

const focusToggleBtn = document.getElementById('cnFocusToggle');
if (focusToggleBtn) {
  focusToggleBtn.addEventListener('click', function() {
    const split = document.querySelector('.notes-split');
    if (split) {
      const isFocus = split.classList.toggle('focus-mode');
      this.innerHTML = isFocus 
        ? '<svg viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// DATA EVENTS
// ══════════════════════════════════════════════════════════════════

on('data-pulled', function() {
  rebuildCategoryUI();
  refreshDynamicCatColors();
  const view = currentViewName();
  if (view === 'reflect') renderReflect();
  else if (view === 'notes') renderCNList();
  else if (view === 'bel') renderBel();
  else render();
});

// ══════════════════════════════════════════════════════════════════
// ROUTER REGISTRATION
// ══════════════════════════════════════════════════════════════════

register('tasks',   { onEnter: render });
register('reflect', { onEnter: onReflectEnter, onExit: onReflectExit });
register('notes',   { onEnter: renderCNList });
register('bel',     { onEnter: renderBel });

switchView('tasks');

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

loadTheme();
loadLocal();
rebuildCategoryUI();
refreshDynamicCatColors();
initBel();
initDashboard({ isActuallyDueToday, dueClass, fmtDue });
loadSettingsUI();
initDesktopShell();
if (typeof dsBuildCategoryNav === 'function') {
    dsBuildCategoryNav();
}


render();

// FIX: Removed desktop "New Task" button injection — quick add pill already does this.



setTimeout(function() { if (state.settings.ghToken) ghFetch(); }, 400);
