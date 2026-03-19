// ══════════════════════════════════════════════════════════════════
// APP.JS — Main application (ES module)
// Imports state, sync, and router; keeps all domain logic.
// ══════════════════════════════════════════════════════════════════

import {
  KEYS, CAT_DEFAULTS, CAT_LABEL,
  state, cnNotes,
  uid, esc,
  on, emit,
  loadLocal, saveLocal, saveCN,
  saveSettings, savePending, saveCollapsed, updateCategories,
  setCnNotes, setBelState,
  getCnNotes,
} from './state.js';

import { ghFetch, ghPush, testGhConnection, showSync } from './sync.js';
import { register, switchView, currentViewName } from './router.js';
import { initPomo, updatePomoUI } from './pomo.js';
import { initShopping, renderShop } from './shopping.js';
import { initBel, renderBel } from './bel.js';
import { initDashboard, renderDashFull, onDashEnter, onDashExit } from './dashboard.js';

// ── Expose globals needed by confnotes.js (loaded as classic script) ──
// confnotes.js reaches into: ghPush, uid, esc, catCls, CAT_LABEL,
// state.projects, showToast, fmtShort, switchView, toggleQuickAdd, openAddSheet, cnNotes
window._app = {
  get state() { return state; },
  get CAT_LABEL() { return CAT_LABEL; },
  get cnNotes() { return getCnNotes(); },
  set cnNotes(v) { setCnNotes(v); },
  uid, esc,
  ghPush,
  catCls,
  showToast,
  fmtShort,
  switchView,
  saveCN,
  get toggleQuickAdd() { return toggleQuickAdd; },
  get openAddSheet() { return openAddSheet; },
};

// Also keep window._cnLoadFromGH hook for sync (used from sync → state → applySyncPayload)
// confnotes.js will overwrite this if loaded.
window._cnLoadFromGH = function(data) {
  if (data) {
    setCnNotes(data);
    try { localStorage.setItem(KEYS.confnotes, JSON.stringify(data)); } catch(e) {}
    if (document.body.classList.contains('confnotes-mode') && typeof window.renderCNList === 'function') {
      window.renderCNList();
    }
  }
};

// ══════════════════════════════════════════════════════════════════
// RENDER & TIME LOGIC
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

function formatDate() {
  const d = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dateDisplay').textContent = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();

  const overdueCount = state.tasks.filter(t => !t.done && t.due && dueClass(t.due) === 'overdue' && !t.pinnedToday).length;
  const todayCount   = state.tasks.filter(t => !t.done && isActuallyDueToday(t)).length;
  const doneToday    = state.tasks.filter(t => t.done && t.completedAt && (new Date(t.completedAt).toDateString() === new Date().toDateString())).length;
  const blockedCount = state.tasks.filter(t => !t.done && (t.status === 'blocked' || t.status === 'waiting')).length;

  const parts = [];
  if (overdueCount > 0) parts.push('<span class="sub-overdue">' + overdueCount + ' overdue</span>');
  if (todayCount > 0)   parts.push(todayCount + ' today');
  if (blockedCount > 0) parts.push('<span class="sub-blocked">' + blockedCount + ' blocked</span>');
  if (doneToday > 0)    parts.push('<span class="sub-done">' + doneToday + ' done</span>');
  const sub = parts.length ? parts.join(' · ') : 'All clear ✓';
  document.getElementById('dateSub').innerHTML = sub;
  document.title = overdueCount > 0 ? '(' + overdueCount + ') Tasks' : 'Tasks';
}

function fmtDue(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return due;
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'Overdue (' + fmtShort(d) + ')';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff <= 6)  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return fmtShort(d);
}

function fmtShort(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

// ── DYNAMIC CATEGORY COLORS ──
// Built-in categories have CSS classes in styles.css.
// Custom categories get auto-assigned from a palette and injected as CSS rules.
const BUILTIN_CAT_CLS = { manuscript:'cat-manuscript', lab:'cat-lab', phd:'cat-phd', conf:'cat-conf', bel:'cat-bel', personal:'cat-personal', hobby:'cat-hobby' };

const CAT_PALETTE = [
  [255, 140,  60],  // warm orange
  [ 90, 200, 170],  // teal
  [230, 115, 200],  // pink-magenta
  [130, 170, 255],  // soft blue
  [240, 200,  80],  // gold
  [120, 220, 120],  // green
  [200, 140, 100],  // warm brown
  [180, 130, 240],  // violet
  [100, 210, 230],  // cyan
  [255, 130, 130],  // coral
];

let _catStyleEl = null;
const _catColorCache = {};  // key → palette index

function _ensureCatStyleEl() {
  if (!_catStyleEl) {
    _catStyleEl = document.createElement('style');
    _catStyleEl.id = 'dynamic-cat-colors';
    document.head.appendChild(_catStyleEl);
  }
  return _catStyleEl;
}

function _assignCatColor(key) {
  if (_catColorCache[key] !== undefined) return _catColorCache[key];
  // Assign the next unused palette index
  const usedIndices = Object.values(_catColorCache);
  let idx = 0;
  while (usedIndices.indexOf(idx) !== -1 && idx < CAT_PALETTE.length) idx++;
  if (idx >= CAT_PALETTE.length) idx = Object.keys(_catColorCache).length % CAT_PALETTE.length;
  _catColorCache[key] = idx;
  return idx;
}

function refreshDynamicCatColors() {
  const styleEl = _ensureCatStyleEl();
  let css = '';
  Object.keys(CAT_LABEL).forEach(key => {
    if (BUILTIN_CAT_CLS[key]) return; // handled by styles.css
    const idx = _assignCatColor(key);
    const rgb = CAT_PALETTE[idx];
    const cls = 'cat-' + key.replace(/[^a-z0-9_-]/g, '_');
    css += '.' + cls + ' { background: rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.08); color: rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + '); border: 1px solid rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.18); }\n';
  });
  styleEl.textContent = css;
}

function catCls(cat) {
  if (BUILTIN_CAT_CLS[cat]) return BUILTIN_CAT_CLS[cat];
  // Dynamic category — ensure it has a color assigned
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

  const statusMap = { waiting:'waiting on', blocked:'blocked', review:'in review' };
  const statusHtml = (t.status && t.status !== 'active') ? '<span class="status ' + t.status + '">' + esc(statusMap[t.status] || t.status) + '</span>' : '';
  const dc = dueClass(t.due);
  const dueHtml = t.due ? '<span class="due ' + dc + '">' + esc(fmtDue(t.due)) + '</span>' : '';
  const noteHtml = t.note ? '<div class="note' + (t.noteIsMono ? ' note-mono' : '') + '">' + esc(t.note) + '</div>' : '';

  let projHtml = '';
  if (t.projectId) {
    const p = (state.projects || []).find(x => x.id === t.projectId);
    if (p) projHtml = '<span class="proj-link-label">⛌ ' + esc(p.title) + '</span>';
  }

  el.innerHTML =
    '<div class="cb">' + (t.done ? '' : '') + '</div>' +
    '<div class="task-body">' +
    '<div class="task-title">' + esc(t.title) + '</div>' +
    '<div class="task-row">' + catHtml + statusHtml + projHtml + dueHtml + '</div>' +
    noteHtml +
    '</div>';

  el.querySelector('.cb').addEventListener('click', function(e) { e.stopPropagation(); animateCheck(t.id, el); });
  el.addEventListener('click', function() { openEdit(t.id); });

  wrap.appendChild(el);
  attachSwipe(wrap, el, bg, t.id);
  addDragHandles(wrap, t.id);

  return wrap;
}

function makeArchiveWrap(t, delay) {
  const wrap = document.createElement('div');
  wrap.className = 'task-wrap entering';
  wrap.style.animationDelay = (delay || 0) + 'ms';
  wrap.addEventListener('animationend', function() { wrap.classList.remove('entering'); }, { once: true });

  const el = document.createElement('div');
  el.className = 'task ' + (t.priority || 'md') + ' done archived';

  const catArray = t.categories || [];
  const catHtml = catArray.map(c => '<span class="cat ' + catCls(c) + '">' + esc(CAT_LABEL[c] || c) + '</span>').join('');

  let completedStr = '';
  if (t.completedAt) {
    const cd = new Date(t.completedAt);
    completedStr = 'Completed ' + fmtShort(cd);
  }
  const noteHtml = t.note ? '<div class="note' + (t.noteIsMono ? ' note-mono' : '') + '">' + esc(t.note) + '</div>' : '';

  el.innerHTML =
    '<div class="cb"></div>' +
    '<div class="task-body">' +
    '<div class="task-title">' + esc(t.title) + '</div>' +
    '<div class="task-row">' + catHtml + '</div>' +
    (completedStr ? '<div class="archive-meta">' + completedStr + '</div>' : '') +
    noteHtml +
    '<div style="margin-top:6px;display:flex;gap:12px;">' +
    '<span class="restore-btn" data-id="' + t.id + '">↺ Restore</span>' +
    '<span class="restore-btn" style="color:#ff7070;" data-del="' + t.id + '">🗑 Delete</span>' +
    '</div>' +
    '</div>';

  el.querySelector('[data-id]').addEventListener('click', function(e) { e.stopPropagation(); restoreTask(t.id); });
  el.querySelector('[data-del]').addEventListener('click', function(e) { e.stopPropagation(); if (confirm('Permanently delete "' + t.title + '"?')) deleteTask(t.id); });
  wrap.appendChild(el);
  return wrap;
}

function restoreTask(id) {
  for (let i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].id === id) {
      state.tasks[i].done = false;
      delete state.tasks[i].completedAt;
      break;
    }
  }
  saveLocal(); render(); ghPush(); showToast('Task restored');
}

function deferTask(id) {
  for (let i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].id === id) {
      const t = state.tasks[i];
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const tStr = tomorrow.toISOString().split('T')[0];
      if (t.due) { const d = new Date(t.due + 'T00:00:00'); d.setDate(d.getDate() + 1); t.due = d.toISOString().split('T')[0]; } else { t.due = tStr; }
      t.pinnedToday = false;
      break;
    }
  }
  saveLocal(); render(); ghPush(); showToast('Deferred to tomorrow');
}

function attachSwipe(wrap, el, bg, id) {
  const bgDefer = wrap.querySelector('.swipe-bg-defer');
  let startX = 0, startY = 0, currentX = 0, dragging = false, maybeSwipe = false;
  const THRESHOLD = 80;

  el.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = false; maybeSwipe = true; currentX = 0; }, { passive: true });
  el.addEventListener('touchmove', function(e) {
    if (!maybeSwipe) return;
    const dx = e.touches[0].clientX - startX; const dy = e.touches[0].clientY - startY;
    if (!dragging && Math.abs(dy) > Math.abs(dx) + 5) { maybeSwipe = false; return; }
    dragging = true; currentX = dx;
    const clamped = Math.max(-120, Math.min(120, dx)); el.style.transform = 'translate3d(' + clamped + 'px,0,0)';
    const pct = Math.min(Math.abs(dx) / THRESHOLD, 1);
    if (dx < 0) { bg.style.opacity = pct; if (bgDefer) bgDefer.style.opacity = 0; } else { if (bgDefer) bgDefer.style.opacity = pct; bg.style.opacity = 0; }
    e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchend', function() {
    if (!dragging) { maybeSwipe = false; return; }
    maybeSwipe = false; dragging = false;
    if (currentX <= -THRESHOLD) {
      wrap.classList.add('removing'); setTimeout(function() { deleteTask(id); }, 200);
    } else if (currentX >= THRESHOLD) {
      el.style.transition = 'transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)'; el.style.transform = 'translate3d(0,0,0)';
      if (bgDefer) bgDefer.style.opacity = 0; setTimeout(function() { el.style.transition = ''; el.style.transform = ''; deferTask(id); }, 180);
    } else {
      el.style.transition = 'transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)'; el.style.transform = 'translate3d(0,0,0)';
      bg.style.opacity = 0; if (bgDefer) bgDefer.style.opacity = 0; setTimeout(function() { el.style.transition = ''; el.style.transform = ''; }, 260);
    }
  }, { passive: true });
}

function animateCheck(id, el) {
  const cb = el.querySelector('.cb'); cb.classList.add('popping');
  setTimeout(function() { cb.classList.remove('popping'); }, 260); toggleDone(id);
}

function filterTask(t) {
  const f = state.filter;
  if (state.focusMode) return isActuallyDueToday(t) && !t.done;
  if (f === 'archive') return t.done;
  if (t.done) return false;
  if (f === 'all') return true;
  if (f === 'today') return isActuallyDueToday(t);
  if (f === 'blocked') return t.status === 'blocked' || t.status === 'waiting';
  const catArray = t.categories || []; return catArray.indexOf(f) !== -1;
}

function searchMatch(t, q) {
  if (!q) return true; const ql = q.toLowerCase(); return (t.title || '').toLowerCase().indexOf(ql) !== -1 || (t.note || '').toLowerCase().indexOf(ql) !== -1;
}

function render() {
  formatDate();
  const searchQ = document.getElementById('searchInput').value.trim();

  let ft = null;
  if (state.focus) { for (let i = 0; i < state.tasks.length; i++) { if (state.tasks[i].id === state.focus && !state.tasks[i].done) { ft = state.tasks[i]; break; } } }
  const focusStrip = document.getElementById('focusStrip');

  if (ft) {
    document.getElementById('focusTitle').textContent = ft.title;
    document.getElementById('pomoTaskLabel').textContent = ft.title;
    const parts = [];
    if (ft.categories && ft.categories.length) parts.push(CAT_LABEL[ft.categories[0]] || ft.categories[0]);
    if (ft.due) parts.push(ft.due);
    document.getElementById('focusSub').textContent = parts.join(' · ') || 'Pinned';
    if (focusStrip) focusStrip.style.display = 'flex';
  } else {
    state.focus = null;
    document.getElementById('focusTitle').textContent = 'No task pinned';
    document.getElementById('pomoTaskLabel').textContent = 'No task pinned';
    document.getElementById('focusSub').textContent = 'Open a task and tap Set as Focus';
    if (focusStrip) focusStrip.style.display = 'none';
  }

  const focusEyeEl = document.querySelector('.focus-eye'); if (focusEyeEl) focusEyeEl.textContent = 'Current Focus';

  const list = document.getElementById('taskList'); list.innerHTML = '';
  const isArchive = state.filter === 'archive';
  let delayBase = 0;

  if (isArchive) {
    const archived = state.tasks.filter(t => t.done && searchMatch(t, searchQ));
    archived.sort((a, b) => (b.completedAt || '') > (a.completedAt || '') ? 1 : -1);
    if (archived.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><div>Nothing archived yet</div></div>';
    } else {
      const section = document.createElement('div'); section.className = 'section';
      const header = document.createElement('div'); header.className = 'sec-header';
      header.innerHTML = '<div class="sec-title">Completed</div><div class="sec-count">' + archived.length + '</div>';
      section.appendChild(header);
      archived.forEach((t, i) => { section.appendChild(makeArchiveWrap(t, Math.min(i * 20, 400))); });
      list.appendChild(section);
    }
  } else {
    const timeGroups = { overdue: [], today: [], tomorrow: [], week: [], later: [] };

    state.tasks.forEach(t => {
      if (t.done || !searchMatch(t, searchQ)) return;
      if (!filterTask(t)) return;
      if (isActuallyDueToday(t)) { timeGroups.today.push(t); }
      else if (!t.due) { timeGroups.later.push(t); }
      else {
        const today = new Date(); today.setHours(0,0,0,0);
        const d = new Date(t.due + 'T00:00:00');
        const diff = Math.round((d - today) / 86400000);
        if (diff < 0) timeGroups.overdue.push(t);
        else if (diff === 1) timeGroups.tomorrow.push(t);
        else if (diff <= 7) timeGroups.week.push(t);
        else timeGroups.later.push(t);
      }
    });

    let groupOrder = [
      { id: 'overdue', label: 'Overdue', color: '#ff3a30' },
      { id: 'today', label: 'Today', color: '' },
      { id: 'tomorrow', label: 'Tomorrow', color: '' },
      { id: 'week', label: 'This Week', color: '' },
      { id: 'later', label: 'Later', color: '' },
    ];

    if (state.focusMode) groupOrder = [{ id: 'today', label: 'Today', color: '' }];
    let anyVisible = false;

    groupOrder.forEach(g => {
      const tasks = timeGroups[g.id];
      if (tasks.length === 0) return;
      anyVisible = true;
      tasks.sort((a, b) => {
        const po = { hi:0, md:1, lo:2 }; const pa = po[a.priority || 'md'] || 1, pb = po[b.priority || 'md'] || 1;
        if (pa !== pb) return pa - pb;
        const da = a.due ? new Date(a.due + 'T00:00:00').getTime() : Infinity; const db = b.due ? new Date(b.due + 'T00:00:00').getTime() : Infinity;
        return da - db;
      });

      const isCollapsed = state.collapsed['grp_' + g.id];
      const section = document.createElement('div');
      section.className = 'section' + (isCollapsed ? ' collapsed' : '');
      section.dataset.sec = g.id;

      const header = document.createElement('div');
      header.className = 'sec-header'; header.style.cursor = 'pointer';
      const titleColor = g.color ? 'color:' + g.color + ';' : '';
      header.innerHTML = '<div style="display:flex;align-items:center;gap:7px;"><div class="sec-title" style="' + titleColor + '">' + g.label + '</div><div class="sec-count">' + tasks.length + '</div></div><div class="sec-toggle">⌄</div>';

      header.addEventListener('click', function() {
        state.collapsed['grp_' + g.id] = !state.collapsed['grp_' + g.id];
        saveCollapsed();
        section.classList.toggle('collapsed', state.collapsed['grp_' + g.id]);
      });
      section.appendChild(header);

      const tasksWrap = document.createElement('div'); tasksWrap.className = 'sec-tasks';
      tasks.forEach((t, i) => { tasksWrap.appendChild(makeTaskWrap(t, isCollapsed ? 0 : Math.min(delayBase + i * 25, 400))); });
      section.appendChild(tasksWrap); delayBase += Math.min(tasks.length * 25, 300) + 30; list.appendChild(section);
    });

    if (!anyVisible) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">✓</div><div>' + (state.focusMode ? 'Nothing due today' : 'No tasks match this filter') + '</div></div>'; }
  }

  document.getElementById('focusBanner').style.display = state.focusMode ? 'flex' : 'none';
  document.getElementById('focusBtnLabel').textContent = state.focusMode ? 'Exit Focus' : 'Focus';
  const focusDoneBtn = document.getElementById('focusDoneBtn'); if (focusDoneBtn) focusDoneBtn.style.display = (ft && !state.focusMode) ? 'block' : 'none';
}

// ══════════════════════════════════════════════════════════════════
// TASK CRUD
// ══════════════════════════════════════════════════════════════════

function toggleDone(id) {
  for (let i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].id === id) {
      state.tasks[i].done = !state.tasks[i].done;
      if (state.tasks[i].done) { state.tasks[i].completedAt = new Date().toISOString(); } else { delete state.tasks[i].completedAt; }
      break;
    }
  }
  saveLocal(); if (document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush();
}

let undoBuffer = null; let undoTimer = null; const UNDO_MS = 4000;
function deleteTask(id) {
  let t = null; for (let i = 0; i < state.tasks.length; i++) { if (state.tasks[i].id === id) { t = state.tasks[i]; break; } }
  if (!t) return;
  if (undoTimer) clearTimeout(undoTimer);
  undoBuffer = { task: JSON.parse(JSON.stringify(t)), focusWas: state.focus === id };
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (state.focus === id) state.focus = null;
  saveLocal(); formatDate();
  if (state.focus === null) {
    document.getElementById('focusTitle').textContent = 'No task pinned'; document.getElementById('pomoTaskLabel').textContent = 'No task pinned'; document.getElementById('focusSub').textContent = 'Open a task and tap Set as Focus';
  }
  showUndoToast(t.title);
  if (document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render();
}
function showUndoToast(title) {
  const el = document.getElementById('toastUndo'); const msg = document.getElementById('toastUndoMsg');
  const display = title.length > 28 ? title.slice(0, 26) + '…' : title;
  msg.textContent = '"' + display + '" deleted'; el.classList.add('show');
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(function() { el.classList.remove('show'); undoBuffer = null; ghPush(); }, UNDO_MS);
}
function commitUndo() {
  if (!undoBuffer) return;
  clearTimeout(undoTimer); undoTimer = null; state.tasks.push(undoBuffer.task);
  if (undoBuffer.focusWas) state.focus = undoBuffer.task.id;
  undoBuffer = null; document.getElementById('toastUndo').classList.remove('show');
  saveLocal(); if (document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush(); showToast('Restored');
}
document.getElementById('toastUndoBtn').addEventListener('click', commitUndo);

function populateTaskProjectSelect() {
  const sel = document.getElementById('taskProjectInput'); if (!sel) return;
  sel.innerHTML = '<option value="">None</option>';
  (state.projects || []).forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.title; sel.appendChild(opt); });
}

function openEdit(id) {
  let t = null; for (let i = 0; i < state.tasks.length; i++) { if (state.tasks[i].id === id) { t = state.tasks[i]; break; } }
  if (!t) return;
  state.editingId = id; populateTaskProjectSelect();
  document.getElementById('addSheetTitle').textContent = 'Edit Task';
  document.getElementById('saveTaskBtn').textContent = 'Save Changes';
  document.getElementById('deleteTaskBtn').style.display = 'block';
  document.getElementById('focusPinBtn').style.display = 'block';
  document.getElementById('focusPinBtn').textContent = state.focus === id ? 'Unpin Focus' : 'Set as Focus';
  document.getElementById('taskTitleInput').value = t.title || '';
  const projInp = document.getElementById('taskProjectInput'); if (projInp) projInp.value = t.projectId || '';

  const pomoEl = document.getElementById('pomoCountDisplay');
  if (pomoEl) { if (t.pomodoros && t.pomodoros > 0) { pomoEl.style.display = 'block'; pomoEl.textContent = '🍅 ' + t.pomodoros + ' focus session' + (t.pomodoros > 1 ? 's' : '') + ' completed'; } else { pomoEl.style.display = 'none'; } }

  const noteEl = document.getElementById('taskNoteInput'); noteEl.value = t.note || ''; noteEl.style.fontFamily = t.noteIsMono ? "'DM Mono',monospace" : "'DM Sans',sans-serif";
  document.getElementById('monoToggle').textContent = t.noteIsMono ? 'mono on' : 'mono off';
  document.getElementById('taskDueInput').value = t.due || '';

  const catArray = t.categories || [];
  document.querySelectorAll('#catRow .s-chip').forEach(c => { c.classList.toggle('active', catArray.indexOf(c.dataset.val) !== -1); });
  setChip('statusRow', t.status || 'active'); setChip('priRow', t.priority || 'md');
  const pinChip = document.getElementById('pinTodayChip'); if (pinChip) pinChip.classList.toggle('active', !!(t.pinnedToday));
  openSheet('addSheet');
}

function saveTask() {
  const title = document.getElementById('taskTitleInput').value.trim(); if (!title) { showToast('Enter a task title'); return; }
  const categories = []; document.querySelectorAll('#catRow .s-chip.active').forEach(c => { categories.push(c.dataset.val); });
  const status = getChip('statusRow') || 'active'; const priority = getChip('priRow') || 'md';
  const pinnedToday = !!(document.getElementById('pinTodayChip') && document.getElementById('pinTodayChip').classList.contains('active'));
  const note = document.getElementById('taskNoteInput').value.trim(); const due = document.getElementById('taskDueInput').value;
  const projInp = document.getElementById('taskProjectInput'); const projectId = projInp ? projInp.value : '';
  const noteIsMono = document.getElementById('taskNoteInput').style.fontFamily.indexOf('Mono') !== -1;

  if (state.editingId) {
    for (let i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === state.editingId) {
        const currentPomo = state.tasks[i].pomodoros || 0;
        Object.assign(state.tasks[i], { title, categories, status, priority, pinnedToday, note, due, projectId, noteIsMono, pomodoros: currentPomo }); break;
      }
    }
    showToast('Task updated');
  } else {
    state.tasks.push({ id: uid(), title, categories, status, priority, pinnedToday, note, due, projectId, noteIsMono, done: false, pomodoros: 0 });
    showToast('Task added');
  }
  closeSheets(); saveLocal(); if (document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush();
}

document.getElementById('focusPinBtn').addEventListener('click', function() {
  if (!state.editingId) return;
  state.focus = (state.focus === state.editingId) ? null : state.editingId;
  document.getElementById('focusPinBtn').textContent = state.focus === state.editingId ? 'Unpin Focus' : 'Set as Focus';
  saveLocal(); showToast(state.focus ? 'Focus set' : 'Focus cleared'); closeSheets(); render();
});
document.getElementById('focusArr').addEventListener('click', function() { if (state.focus) { openEdit(state.focus); } else { showToast('Long-press a task to pin it as focus'); } });
document.getElementById('focusDoneBtn').addEventListener('click', function(e) { e.stopPropagation(); if (state.focus) { const id = state.focus; state.focus = null; animateCheck(id, document.querySelector('[data-id="' + id + '"] .task') || document.createElement('div')); saveLocal(); render(); ghPush(); showToast('Focus completed ✓'); } });
document.getElementById('focusModeBtn').addEventListener('click', function() { state.focusMode = !state.focusMode; document.body.classList.toggle('focus-mode', state.focusMode); render(); showToast(state.focusMode ? 'Focus mode on — Timer ready' : 'Showing all tasks'); });

// ══════════════════════════════════════════════════════════════════
// SHEETS & SCROLL LOCK
// ══════════════════════════════════════════════════════════════════

function openSheet(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => {
    s.style.bottom = ''; s.style.maxHeight = ''; s.style.height = ''; s.classList.remove('open');
    s.style.webkitTransform = ''; s.style.transform = ''; s.style.webkitTransition = ''; s.style.transition = '';
  });
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
  state.editingId = null;
  const tTitle = document.getElementById('addSheetTitle'); if (tTitle) tTitle.textContent = 'New Task';
  const saveTBtn = document.getElementById('saveTaskBtn'); if (saveTBtn) saveTBtn.textContent = 'Add Task';
  const delTBtn = document.getElementById('deleteTaskBtn'); if (delTBtn) delTBtn.style.display = 'none';
  const focPBtn = document.getElementById('focusPinBtn'); if (focPBtn) focPBtn.style.display = 'none';
  const tInput = document.getElementById('taskTitleInput'); if (tInput) tInput.value = '';
  const tnInput = document.getElementById('taskNoteInput'); if (tnInput) { tnInput.value = ''; tnInput.style.fontFamily = "'DM Sans',sans-serif"; }
  const mtog = document.getElementById('monoToggle'); if (mtog) mtog.textContent = 'mono off';
  const tdInput = document.getElementById('taskDueInput'); if (tdInput) tdInput.value = '';
  const tpInput = document.getElementById('taskProjectInput'); if (tpInput) tpInput.value = '';
  const pomoEl = document.getElementById('pomoCountDisplay'); if (pomoEl) pomoEl.style.display = 'none';
  document.querySelectorAll('#catRow .s-chip').forEach(c => { c.classList.remove('active'); });
  setChip('statusRow', 'active'); setChip('priRow', 'md');
  const pinChip = document.getElementById('pinTodayChip'); if (pinChip) pinChip.classList.remove('active');
  const pTitle = document.getElementById('projectSheetTitle'); if (pTitle) pTitle.textContent = 'New Project';
  const savePBtn = document.getElementById('saveProjBtn'); if (savePBtn) savePBtn.textContent = 'Save Project';
  const delPBtn = document.getElementById('deleteProjBtn'); if (delPBtn) delPBtn.style.display = 'none';
  const ptInput = document.getElementById('projTitleInput'); if (ptInput) ptInput.value = '';
  const pdInput = document.getElementById('projDueInput'); if (pdInput) pdInput.value = '';
  const pnInput = document.getElementById('projNoteInput'); if (pnInput) pnInput.value = '';
  setChip('projStageRow', 'Planning');
}

document.getElementById('overlay').addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });

function openAddSheet() {
  state.editingId = null; closeSheets(); populateTaskProjectSelect();
  const qw = document.getElementById('quickAddWrap'); if (qw) { qw.classList.remove('open'); document.getElementById('quickAddInput').value = ''; }
  if (document.body.classList.contains('projects-detail-mode') && state.activeProjectId) { const pInp = document.getElementById('taskProjectInput'); if (pInp) pInp.value = state.activeProjectId; }
  setTimeout(function() { openSheet('addSheet'); }, 10);
}

function getChip(rowId) { const a = document.querySelector('#' + rowId + ' .s-chip.active'); return a ? a.dataset.val : null; }
function setChip(rowId, val) { document.querySelectorAll('#' + rowId + ' .s-chip').forEach(c => { c.classList.toggle('active', c.dataset.val === val); }); }

document.getElementById('addSheet').addEventListener('click', function(e) { const pin = e.target.closest('#pinTodayChip'); if (pin) pin.classList.toggle('active'); });
document.getElementById('catRow').addEventListener('click', function(e) { const chip = e.target.closest('.s-chip'); if (!chip) return; chip.classList.toggle('active'); });

['statusRow', 'priRow', 'projStageRow'].forEach(rowId => {
  const el = document.getElementById(rowId);
  if (el) { el.addEventListener('click', function(e) { const chip = e.target.closest('.s-chip'); if (!chip) return; document.querySelectorAll('#' + rowId + ' .s-chip').forEach(c => { c.classList.remove('active'); }); chip.classList.add('active'); }); }
});

// ══════════════════════════════════════════════════════════════════
// PROJECTS LOGIC
// ══════════════════════════════════════════════════════════════════

function renderProjects() {
  const list = document.getElementById('projectsList'); if (!list) return; list.innerHTML = '';
  if (!state.projects || state.projects.length === 0) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><div>No active projects yet</div></div>'; return; }

  const sorted = state.projects.slice().sort((a, b) => {
    const stageOrder = { 'Active':1, 'Planning':2, 'Review':3, 'Waiting':4, 'Done':5 };
    const sa = stageOrder[a.stage] || 9; const sb = stageOrder[b.stage] || 9;
    if (sa !== sb) return sa - sb;
    const da = a.due ? new Date(a.due).getTime() : Infinity; const db = b.due ? new Date(b.due).getTime() : Infinity;
    return da - db;
  });

  var cards = [];
  sorted.forEach(function(p, idx) {
    const card = document.createElement('div'); card.className = 'project-card stagger-ready'; card.dataset.id = p.id;
    card.style.setProperty('--si', idx);
    const dStr = p.due ? '<span style="font-family:var(--font-mono); margin-left:8px;">📅 ' + fmtDue(p.due) + '</span>' : '';
    let tHTML = ''; const pTasks = state.tasks.filter(t => t.projectId === p.id && !t.done);
    if (pTasks.length > 0) {
      tHTML += '<div class="project-tasks">';
      pTasks.slice(0, 3).forEach(pt => { tHTML += '<div class="project-task-item"><div class="project-task-dot"></div>' + esc(pt.title) + '</div>'; });
      if (pTasks.length > 3) tHTML += '<div class="project-task-item" style="opacity:0.5; font-style:italic;">+ ' + (pTasks.length - 3) + ' more</div>';
      tHTML += '</div>';
    }
    card.innerHTML = '<div class="project-header"><div class="project-title">' + esc(p.title) + '</div><div class="project-stage ' + esc(p.stage) + '">' + esc(p.stage) + '</div></div><div class="project-meta" style="margin-bottom:0;">' + pTasks.length + ' active task' + (pTasks.length !== 1 ? 's' : '') + dStr + '</div>' + tHTML;
    card.addEventListener('click', function() { openProjectDetail(p.id); });
    list.appendChild(card);
    cards.push(card);
  });

  // Defer stagger animation until Safari has committed display:block
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      cards.forEach(function(c) { c.classList.add('stagger-child'); });
    });
  });
}

const newProjBtn = document.getElementById('newProjectBtn');
if (newProjBtn) { newProjBtn.addEventListener('click', function() { state.editingProjId = null; closeSheets(); setTimeout(function() { openSheet('projectSheet'); }, 10); }); }

const saveProjBtn = document.getElementById('saveProjBtn');
if (saveProjBtn) {
  saveProjBtn.addEventListener('click', function() {
    const title = document.getElementById('projTitleInput').value.trim(); if (!title) { showToast('Enter project title'); return; }
    const stage = getChip('projStageRow') || 'Planning'; const due = document.getElementById('projDueInput').value; const note = document.getElementById('projNoteInput').value.trim();
    state.projects.push({ id: uid(), title, stage, due, note }); showToast('Project created');
    closeSheets(); saveLocal(); renderProjects(); ghPush();
  });
}

function openProjectDetail(id) {
  const p = state.projects.find(x => x.id === id); if (!p) return;
  state.activeProjectId = id;
  document.getElementById('pdTitleInput').value = p.title || ''; document.getElementById('pdDueInput').value = p.due || ''; document.getElementById('pdNotesInput').innerHTML = p.note || ''; setChip('pdStageRow', p.stage || 'Planning');
  switchView('projects-detail');
}

function saveProjectDetail() {
  if (!state.activeProjectId) return;
  const p = state.projects.find(x => x.id === state.activeProjectId);
  if (p) {
    p.title = document.getElementById('pdTitleInput').value.trim() || 'Untitled Project'; p.stage = getChip('pdStageRow') || 'Planning'; p.due = document.getElementById('pdDueInput').value; p.note = document.getElementById('pdNotesInput').innerHTML;
    saveLocal(); ghPush();
  }
}

let pdTimer = null;
function queuePdSave() { if (pdTimer) clearTimeout(pdTimer); pdTimer = setTimeout(saveProjectDetail, 800); }
const pdTitle = document.getElementById('pdTitleInput'); if (pdTitle) pdTitle.addEventListener('input', queuePdSave);
const pdDue = document.getElementById('pdDueInput'); if (pdDue) pdDue.addEventListener('change', saveProjectDetail);
const pdNotes = document.getElementById('pdNotesInput'); if (pdNotes) pdNotes.addEventListener('input', queuePdSave);

const pdStageRow = document.getElementById('pdStageRow');
if (pdStageRow) { pdStageRow.addEventListener('click', function(e) { const chip = e.target.closest('.s-chip'); if (!chip) return; document.querySelectorAll('#pdStageRow .s-chip').forEach(c => { c.classList.remove('active'); }); chip.classList.add('active'); saveProjectDetail(); }); }

function renderProjectTasks() {
  const list = document.getElementById('pdTasksList'); if (!list) return; list.innerHTML = '';
  const pTasks = state.tasks.filter(t => t.projectId === state.activeProjectId && !t.done);
  if (pTasks.length === 0) { list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); font-style:italic; padding: 12px 0;">No active tasks linked.</div>'; return; }

  pTasks.forEach(t => {
    const el = document.createElement('div'); el.className = 'task ' + (t.priority || 'md');
    const catHtml = (t.categories || []).map(c => '<span class="cat ' + catCls(c) + '">' + esc(CAT_LABEL[c] || c) + '</span>').join('');
    const dc = dueClass(t.due); const dueHtml = t.due ? '<span class="due ' + dc + '">' + esc(fmtDue(t.due)) + '</span>' : '';
    el.innerHTML = '<div class="cb"></div><div class="task-body"><div class="task-title">' + esc(t.title) + '</div><div class="task-row">' + catHtml + dueHtml + '</div></div>';
    el.querySelector('.cb').addEventListener('click', function(e) { e.stopPropagation(); toggleDone(t.id); });
    el.addEventListener('click', function() { openEdit(t.id); });
    list.appendChild(el);
  });
}

const pdAdd = document.getElementById('pdAddTaskBtn'); if (pdAdd) { pdAdd.addEventListener('click', function() { openAddSheet(); }); }

const pdDel = document.getElementById('delProjectDetailBtn');
if (pdDel) {
  pdDel.addEventListener('click', function() {
    if (!state.activeProjectId) return;
    if (confirm('Delete this project? Tasks inside will NOT be deleted, just unlinked.')) {
      state.projects = state.projects.filter(p => p.id !== state.activeProjectId);
      state.tasks.forEach(t => { if (t.projectId === state.activeProjectId) delete t.projectId; });
      saveLocal(); ghPush(); switchView('projects'); showToast('Project deleted');
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════

function rebuildCategoryUI() {
  const filterRow = document.getElementById('filterRow');
  if (filterRow) {
    const fixed = ['all', 'today', 'blocked', 'archive'];
    filterRow.querySelectorAll('.chip').forEach(c => { if (fixed.indexOf(c.dataset.filter) === -1) c.remove(); });
    const blockedChip = filterRow.querySelector('[data-filter="blocked"]');
    Object.keys(CAT_LABEL).forEach(key => {
      const c = document.createElement('div');
      c.className = 'chip'; c.dataset.filter = key;
      c.textContent = CAT_LABEL[key];
      filterRow.insertBefore(c, blockedChip);
    });
  }
  const catRow = document.getElementById('catRow');
  if (catRow) {
    const activeVals = [];
    catRow.querySelectorAll('.s-chip.active').forEach(c => { activeVals.push(c.dataset.val); });
    catRow.innerHTML = '';
    Object.keys(CAT_LABEL).forEach(key => {
      const c = document.createElement('div');
      c.className = 's-chip' + (activeVals.indexOf(key) !== -1 ? ' active' : '');
      c.dataset.val = key;
      c.textContent = CAT_LABEL[key];
      catRow.appendChild(c);
    });
  }
}

function loadCategoriesUI() {
  const container = document.getElementById('catSettingsRows');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(key => {
    const row = document.createElement('div');
    row.className = 'cat-settings-row';
    row.innerHTML =
      '<input class="input cat-key-input" style="width:110px;margin-bottom:0;font-family:var(--font-mono);font-size:12px;" value="' + esc(key) + '" data-orig="' + esc(key) + '" placeholder="key" autocapitalize="none">' +
      '<input class="input cat-label-input" style="flex:1;margin-bottom:0;" value="' + esc(CAT_LABEL[key]) + '" placeholder="display label">' +
      '<div class="cat-del-btn" data-key="' + esc(key) + '" style="cursor:pointer;padding:0 8px;font-size:18px;color:#ff3a30;line-height:1;flex-shrink:0;">×</div>';
    container.appendChild(row);
  });
}

function saveCategoriesFromUI() {
  const container = document.getElementById('catSettingsRows');
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
  showToast('Categories saved');
}

function updateGhUI(connected) { const el = document.getElementById('ghStatus'), txt = document.getElementById('ghStatusText'); if (connected) { el.className = 'settings-status connected'; txt.textContent = 'Connected: ' + state.settings.ghUser + '/' + state.settings.ghRepo; } else { el.className = 'settings-status'; txt.textContent = 'Not connected to GitHub'; } }
function loadSettingsUI() {
  document.getElementById('ghUser').value = state.settings.ghUser || '';
  document.getElementById('ghRepo').value = state.settings.ghRepo || '';
  document.getElementById('ghToken').value = state.settings.ghToken || '';
  updateGhUI(!!state.settings.ghToken);
  loadCategoriesUI();
}
document.getElementById('saveSettingsBtn').addEventListener('click', function() {
  const u = document.getElementById('ghUser').value.trim(); const r = document.getElementById('ghRepo').value.trim(); const t = document.getElementById('ghToken').value.trim();
  state.settings = { ghUser: u, ghRepo: r, ghToken: t }; saveSettings(); document.getElementById('saveSettingsBtn').textContent = 'Testing…';
  testGhConnection().then(ok => { document.getElementById('saveSettingsBtn').textContent = 'Save & Test Connection'; if (ok) { updateGhUI(true); showToast('Connected! Fetching tasks…'); state.sha = null; ghFetch(); } else { updateGhUI(false); showToast('Connection failed — check token & repo'); } });
});
document.getElementById('clearDataBtn').addEventListener('click', function() { if (!confirm('Clear all local data? Cannot be undone.')) return; localStorage.clear(); state.tasks = []; state.focus = null; state.projects = []; setBelState({}); render(); closeSheets(); showToast('Local data cleared'); });

const saveCatBtn = document.getElementById('saveCatsBtn');
if (saveCatBtn) saveCatBtn.addEventListener('click', saveCategoriesFromUI);

const addCatBtn = document.getElementById('addCatBtn');
if (addCatBtn) addCatBtn.addEventListener('click', function() {
  const container = document.getElementById('catSettingsRows');
  if (!container) return;
  const row = document.createElement('div'); row.className = 'cat-settings-row';
  row.innerHTML = '<input class="input cat-key-input" style="width:110px;margin-bottom:0;font-family:var(--font-mono);font-size:12px;" placeholder="key e.g. writing" data-orig="" autocapitalize="none">' +
    '<input class="input cat-label-input" style="flex:1;margin-bottom:0;" placeholder="display label">' +
    '<div class="cat-del-btn" style="cursor:pointer;padding:0 8px;font-size:18px;color:#ff3a30;line-height:1;flex-shrink:0;">×</div>';
  container.appendChild(row);
  row.querySelector('.cat-key-input').focus();
});

document.getElementById('settingsSheet').addEventListener('click', function(e) {
  const del = e.target.closest('.cat-del-btn');
  if (del) { const row = del.closest('.cat-settings-row'); if (row) row.remove(); }
});

// ══════════════════════════════════════════════════════════════════
// SEARCH & FILTERS
// ══════════════════════════════════════════════════════════════════

document.getElementById('searchTrigger').addEventListener('click', function() { const wrap = document.getElementById('searchWrap'); wrap.classList.toggle('open'); if (wrap.classList.contains('open')) document.getElementById('searchInput').focus(); else { document.getElementById('searchInput').value = ''; render(); } });
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('filterRow').addEventListener('click', function(e) { const chip = e.target.closest('.chip'); if (!chip) return; document.querySelectorAll('#filterRow .chip').forEach(c => { c.classList.remove('active'); }); chip.classList.add('active'); state.filter = chip.dataset.filter; render(); });

document.getElementById('monoToggle').addEventListener('click', function() { const noteEl = document.getElementById('taskNoteInput'); let isMono = noteEl.style.fontFamily.indexOf('Mono') !== -1; isMono = !isMono; noteEl.style.fontFamily = isMono ? "'DM Mono',monospace" : "'DM Sans',sans-serif"; this.textContent = isMono ? 'mono on' : 'mono off'; });
document.getElementById('closeAddSheet').addEventListener('click', closeSheets);
const cps = document.getElementById('closeProjectSheet'); if (cps) cps.addEventListener('click', closeSheets);
document.getElementById('closeSettingsSheet').addEventListener('click', closeSheets);
document.getElementById('closeShopSheet').addEventListener('click', closeSheets);

document.querySelectorAll('.sheet').forEach(sheet => {
  let startY = 0, dragging = false;
  sheet.addEventListener('touchstart', function(e) { if (sheet.scrollTop > 0) return; startY = e.touches[0].clientY; dragging = true; }, { passive: true });
  sheet.addEventListener('touchmove', function(e) { if (!dragging) return; const dy = e.touches[0].clientY - startY; if (dy > 0) { sheet.style.transform = 'translate3d(0,' + dy + 'px,0)'; sheet.style.transition = 'none'; } }, { passive: true });
  sheet.addEventListener('touchend', function(e) { if (!dragging) return; dragging = false; const dy = e.changedTouches[0].clientY - startY; if (dy > 80) { sheet.style.transition = ''; closeSheets(); } else { sheet.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)'; sheet.style.transform = ''; setTimeout(function() { sheet.style.transition = ''; }, 300); } }, { passive: true });
});

// ══════════════════════════════════════════════════════════════════
// QUICK ADD
// ══════════════════════════════════════════════════════════════════

function toggleQuickAdd() { const wrap = document.getElementById('quickAddWrap'); const inp = document.getElementById('quickAddInput'); wrap.classList.toggle('open'); if (wrap.classList.contains('open')) { inp.focus(); } else { inp.value = ''; } }
function submitQuickAdd() { const inp = document.getElementById('quickAddInput'); const title = inp.value.trim(); if (!title) return; const newTask = { id: Date.now().toString(), title, categories: ['personal'], status: 'active', priority: 'md', note: '', due: new Date().toISOString().split('T')[0], noteIsMono: false, pinnedToday: true, done: false, pomodoros: 0 }; state.tasks.push(newTask); saveLocal(); if (document.body.classList.contains('projects-mode')) renderProjects(); else render(); ghPush(); showToast('Pinned to Today'); inp.value = ''; document.getElementById('quickAddWrap').classList.remove('open'); }
document.getElementById('quickAddInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); } if (e.key === 'Escape') { toggleQuickAdd(); } });
document.getElementById('quickAddSend').addEventListener('click', submitQuickAdd);

// FAB
document.getElementById('fab').addEventListener('click', function() {
  if (document.body.classList.contains('confnotes-mode')) {
    if (typeof window.createNewNote === 'function') window.createNewNote();
  } else {
    toggleQuickAdd();
  }
});
(function() { let pressTimer; document.getElementById('fab').addEventListener('touchstart', function(e) { pressTimer = setTimeout(function() { if (document.body.classList.contains('confnotes-mode')) { if (typeof window.createNewNote === 'function') window.createNewNote(); } else { toggleQuickAdd(); openAddSheet(); } }, 600); }, { passive: true }); document.getElementById('fab').addEventListener('touchend', function() { clearTimeout(pressTimer); }, { passive: true }); document.getElementById('fab').addEventListener('contextmenu', function(e) { e.preventDefault(); }); })();

document.getElementById('overlay').addEventListener('click', closeSheets);
document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
document.getElementById('deleteTaskBtn').addEventListener('click', function() { if (state.editingId) deleteTask(state.editingId); closeSheets(); });
document.getElementById('settingsBtn').addEventListener('click', function() { loadSettingsUI(); openSheet('settingsSheet'); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeSheets(); return; } const tag = (document.activeElement || {}).tagName || ''; const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable; if (inInput) return; if (document.body.classList.contains('confnotes-mode')) return; if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddSheet(); } if (e.key === '/') { e.preventDefault(); const wrap = document.getElementById('searchWrap'); wrap.classList.add('open'); document.getElementById('searchInput').focus(); } });

// ══════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════

let toastTimer; function showToast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2000); }

// ══════════════════════════════════════════════════════════════════
// ROUTER REGISTRATION
// ══════════════════════════════════════════════════════════════════

register('tasks', {
  onEnter: function() {
    render();
    var tl = document.getElementById('taskList');
    if (tl) {
      tl.classList.remove('view-animate');
      tl.style.opacity = '0';
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          tl.style.opacity = '';
          tl.classList.add('view-animate');
        });
      });
    }
  },
});
register('dash', {
  onEnter: onDashEnter,
  onExit:  onDashExit,
});
register('projects', {
  onEnter: renderProjects,
});
register('projects-detail', {
  onEnter: renderProjectTasks,
});
register('bel', {
  onEnter: renderBel,
});
register('confnotes', {
  onEnter: function() { if (typeof window.renderCNList === 'function') window.renderCNList(); },
});

// Tab buttons
document.getElementById('tabTasks').addEventListener('click', function() { switchView('tasks'); });
document.getElementById('tabDash').addEventListener('click', function() { switchView('dash'); });
const tpBtn = document.getElementById('tabProjects'); if (tpBtn) tpBtn.addEventListener('click', function() { switchView('projects'); });

// Secret routing buttons
const sbt = document.getElementById('secretBelTrigger'); if (sbt) sbt.addEventListener('click', function() { switchView('bel'); });
const cbb = document.getElementById('closeBelBtn'); if (cbb) cbb.addEventListener('click', function() { switchView('tasks'); });
const cpd = document.getElementById('closeProjectDetailBtn'); if (cpd) cpd.addEventListener('click', function() { switchView('projects'); });

// ══════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ══════════════════════════════════════════════════════════════════

const THEMES = ['neon', 'newsprint', 'ios26', 'bel-bel', 'ios-dark'];

function applyTheme(name) {
  THEMES.forEach(t => { document.body.classList.remove('theme-' + t); });
  if (name) document.body.classList.add('theme-' + name);
  const htmlBg = { neon:'#0d0810', newsprint:'#f8f6f0', ios26:'#e8eaf0', 'bel-bel':'#1E1E1E', 'ios-dark':'#000000' };
  document.documentElement.style.background = htmlBg[name] || '#e8eaf0';
  document.querySelectorAll('.theme-swatch').forEach(sw => { sw.classList.toggle('active', sw.dataset.theme === (name || 'ios26')); });
  try { localStorage.setItem(KEYS.theme, name || 'ios26'); } catch (e) {}
}

function loadTheme() { let saved = 'ios26'; try { saved = localStorage.getItem(KEYS.theme) || 'ios26'; } catch (e) {} applyTheme(saved); }
document.getElementById('settingsSheet').addEventListener('click', function(e) { const sw = e.target.closest('.theme-swatch'); if (!sw) return; applyTheme(sw.dataset.theme); render(); });

// ══════════════════════════════════════════════════════════════════
// DRAG TO REORDER
// ══════════════════════════════════════════════════════════════════

let dragState = null;
function addDragHandles(wrap, taskId) {
  const handle = wrap.querySelector('.task'); if (!handle) return;
  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    const longPressTimer = setTimeout(function() { startDrag(e, wrap, taskId); }, 350);
    function cancelLong(ev) { const dx = Math.abs(ev.clientX - e.clientX); const dy = Math.abs(ev.clientY - e.clientY); if (dx > 8 || dy > 8) { clearTimeout(longPressTimer); } }
    function cleanup() { clearTimeout(longPressTimer); handle.removeEventListener('pointermove', cancelLong); handle.removeEventListener('pointerup', cleanup); handle.removeEventListener('pointercancel', cleanup); }
    handle.addEventListener('pointermove', cancelLong); handle.addEventListener('pointerup', cleanup); handle.addEventListener('pointercancel', cleanup);
  }
  handle.addEventListener('pointerdown', onPointerDown, { passive: true });
}

function startDrag(e, wrap, taskId) {
  if (dragState) return; if (navigator.vibrate) navigator.vibrate(30);
  const list = wrap.parentNode; const rect = wrap.getBoundingClientRect(); const offsetY = e.clientY - rect.top;
  const ghost = wrap.cloneNode(true); ghost.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;opacity:0.9;pointer-events:none;z-index:9999;transition:none;will-change:transform;-webkit-transform:scale(1.03);transform:scale(1.03);box-shadow:0 8px 24px rgba(0,0,0,0.25);border-radius:14px;';
  document.body.appendChild(ghost); wrap.style.opacity = '0.3';
  dragState = { taskId, wrap, ghost, list, offsetY, initialTop: rect.top };
  document.addEventListener('pointermove', onDragMove, { passive: false }); document.addEventListener('pointerup', onDragEnd); document.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!dragState) return; e.preventDefault();
  const ghost = dragState.ghost;
  var dy = e.clientY - dragState.offsetY - dragState.initialTop;
  ghost.style.transform = 'translate3d(0,' + dy + 'px,0) scale(1.03)';
  ghost.style.webkitTransform = 'translate3d(0,' + dy + 'px,0) scale(1.03)';
  let overEl = null; const siblings = dragState.list.querySelectorAll('.task-wrap');
  siblings.forEach(sib => { if (sib === dragState.wrap) return; const r = sib.getBoundingClientRect(); if (e.clientY >= r.top && e.clientY <= r.bottom) overEl = sib; sib.classList.remove('drag-over'); });
  if (overEl) overEl.classList.add('drag-over');
}

function onDragEnd(e) {
  if (!dragState) return;
  document.removeEventListener('pointermove', onDragMove); document.removeEventListener('pointerup', onDragEnd); document.removeEventListener('pointercancel', onDragEnd);
  const overEl = dragState.list.querySelector('.task-wrap.drag-over');
  dragState.list.querySelectorAll('.task-wrap').forEach(s => { s.classList.remove('drag-over'); });
  dragState.ghost.remove(); dragState.wrap.style.opacity = '';
  if (overEl && overEl !== dragState.wrap) {
    const srcId = dragState.taskId; const dstId = overEl.dataset.id; const tasks = state.tasks;
    let srcIdx = -1, dstIdx = -1;
    for (let i = 0; i < tasks.length; i++) { if (tasks[i].id === srcId) srcIdx = i; if (tasks[i].id === dstId) dstIdx = i; }
    if (srcIdx !== -1 && dstIdx !== -1) {
      const moved = tasks.splice(srcIdx, 1)[0]; let newDst = 0;
      for (let k = 0; k < tasks.length; k++) { if (tasks[k].id === dstId) { newDst = k; break; } }
      tasks.splice(newDst, 0, moved); saveLocal();
      if (document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush();
    }
  }
  dragState = null;
}

// ══════════════════════════════════════════════════════════════════
// SYNC EVENT: re-render active view when data pulled from GitHub
// ══════════════════════════════════════════════════════════════════

on('data-pulled', () => {
  rebuildCategoryUI();
  refreshDynamicCatColors();
  const view = currentViewName();
  if (view === 'dash') renderDashFull();
  else if (view === 'projects') renderProjects();
  else if (view === 'projects-detail') renderProjectTasks();
  else if (view === 'bel') renderBel();
  else if (view === 'confnotes' && typeof window.renderCNList === 'function') window.renderCNList();
  else render();
});

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

loadTheme();
loadLocal();
rebuildCategoryUI();
refreshDynamicCatColors();
initPomo(showToast);
initShopping(openSheet);
initBel();
initDashboard({ isActuallyDueToday, dueClass, fmtDue });
render();
loadSettingsUI();
setTimeout(function() { if (state.settings.ghToken) ghFetch(); }, 400);
