// ══════════════════════════════════════════════════════════════════
// APP.JS — Main application (ES module)
// Imports state, sync, and router; keeps all domain logic.
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
import { register, switchView, currentViewName, updateReflectPill } from './router.js';
import { initPomo, updatePomoUI } from './pomo.js';
import { initShopping, renderShop } from './shopping.js';
import { initBel, renderBel } from './bel.js';
import { initDashboard, renderReflectToday, onReflectEnter, onReflectExit, getReflectMode, setReflectMode } from './dashboard.js';
import { initTimeline, renderTimeline, onTimelineEnter, invalidateCache } from './timeline.js';
import { renderCNList, createNewNote, rebuildCNChips, getIdeasForReview, NOTE_TYPES, noteTypeOf } from './confnotes.js';
import { initWeeklyReview, renderPromptCard, isReviewActive, closeReview } from './weekly-review.js';

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

// ── DYNAMIC CATEGORY COLORS ──
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
const _catColorCache = {};

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
    if (BUILTIN_CAT_CLS[key]) return;
    const idx = _assignCatColor(key);
    const rgb = CAT_PALETTE[idx];
    const cls = 'cat-' + key.replace(/[^a-z0-9_-]/g, '_');
    css += '.' + cls + ' { background: rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.08); color: rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + '); border: 1px solid rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.18); }\n';
  });
  styleEl.textContent = css;
}

export function catCls(cat) {
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
    '<div class="cb"></div>' +
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
      if (t.due) {
        const d = new Date(t.due + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        t.due = d.toISOString().split('T')[0];
      } else {
        t.due = tStr;
      }
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
      if (state.tasks[i].done) {
        state.tasks[i].completedAt = new Date().toISOString();
        if (state.tasks[i].projectId) {
          const p = state.projects.find(x => x.id === state.tasks[i].projectId);
          if (p) addProjectHistory(p, 'task', '✓ ' + state.tasks[i].title);
        }
      } else { delete state.tasks[i].completedAt; }
      break;
    }
  }
  saveLocal();
  if (document.body.classList.contains('projects-detail-mode')) {
    renderProjectTasks(); renderPdCompleted(); renderPdProgress(); renderPdNextUp(); renderPdActivity();
  } else { render(); }
  ghPush();
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
  populateTaskMilestoneSelect(t.projectId || '');
  const msInp = document.getElementById('taskMilestoneInput'); if (msInp) msInp.value = t.milestoneId || '';

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
  const msInp = document.getElementById('taskMilestoneInput'); const milestoneId = (msInp && projectId) ? msInp.value : '';
  const noteIsMono = document.getElementById('taskNoteInput').style.fontFamily.indexOf('Mono') !== -1;

  if (state.editingId) {
    for (let i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === state.editingId) {
        const currentPomo = state.tasks[i].pomodoros || 0;
        Object.assign(state.tasks[i], { title, categories, status, priority, pinnedToday, note, due, projectId, milestoneId, noteIsMono, pomodoros: currentPomo }); break;
      }
    }
    showToast('Task updated');
  } else {
    state.tasks.push({ id: uid(), title, categories, status, priority, pinnedToday, note, due, projectId, milestoneId, noteIsMono, done: false, pomodoros: 0 });
    showToast('Task added');
  }
  closeSheets(); saveLocal();
  if (document.body.classList.contains('projects-detail-mode')) {
    renderProjectTasks(); renderPdCompleted(); renderPdProgress(); renderPdNextUp();
  } else { render(); }
  ghPush();
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
  const tmWrap = document.getElementById('taskMilestoneWrap'); if (tmWrap) tmWrap.style.display = 'none';
  const tmInput = document.getElementById('taskMilestoneInput'); if (tmInput) tmInput.value = '';
  const pomoEl = document.getElementById('pomoCountDisplay'); if (pomoEl) pomoEl.style.display = 'none';
  document.querySelectorAll('#catRow .s-chip').forEach(c => { c.classList.remove('active'); });
  setChip('statusRow', 'active'); setChip('priRow', 'md');
  const pinChip = document.getElementById('pinTodayChip'); if (pinChip) pinChip.classList.remove('active');
  const pTitle = document.getElementById('projectSheetTitle'); if (pTitle) pTitle.textContent = 'New Project';
  const savePBtn = document.getElementById('saveProjBtn'); if (savePBtn) savePBtn.textContent = 'Save Project';
  const delPBtn = document.getElementById('deleteProjBtn'); if (delPBtn) delPBtn.style.display = 'none';
  const ptInput = document.getElementById('projTitleInput'); if (ptInput) ptInput.value = '';
  const pdescInput = document.getElementById('projDescInput'); if (pdescInput) pdescInput.value = '';
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

function projProgress(p) {
  const milestones = p.milestones || [];
  const pTasks = state.tasks.filter(t => t.projectId === p.id);
  const total = milestones.length + pTasks.length;
  if (total === 0) return { done: 0, total: 0, pct: 0 };
  const done = milestones.filter(m => m.done).length + pTasks.filter(t => t.done).length;
  return { done, total, pct: Math.round((done / total) * 100) };
}

function addProjectHistory(p, type, label) {
  if (!p.history) p.history = [];
  p.history.push({ type: type, label: label, date: new Date().toISOString() });
  if (p.history.length > 50) p.history = p.history.slice(-50);
}

function projTimeAgo(iso) {
  if (!iso) return '';
  const now = new Date(), then = new Date(iso);
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay + 'd ago';
  return fmtShort(then);
}

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
    const pTasks = state.tasks.filter(t => t.projectId === p.id && !t.done);
    const prog = projProgress(p);

    let dStr = '';
    if (p.due) {
      const dc = dueClass(p.due);
      const cls = dc === 'overdue' ? ' due-warn' : dc === 'soon' || dc === 'today' ? ' due-soon' : '';
      dStr = '<span class="' + cls + '" style="font-family:var(--font-mono); margin-left:8px;">📅 ' + fmtDue(p.due) + '</span>';
    }

    let descHTML = '';
    if (p.description) {
      descHTML = '<div class="project-description">' + esc(p.description) + '</div>';
    }

    let progHTML = '';
    if (prog.total > 0) {
      progHTML = '<div class="pd-progress-wrap pd-card-progress"><div class="pd-progress-bar"><div class="pd-progress-fill' + (prog.pct >= 100 ? ' complete' : '') + '" style="width:' + prog.pct + '%;"></div></div><div class="pd-progress-label">' + prog.done + '/' + prog.total + '</div></div>';
    }

    const nextMs = (p.milestones || []).filter(m => !m.done).sort((a, b) => {
      if (!a.due && !b.due) return 0; if (!a.due) return 1; if (!b.due) return -1;
      return new Date(a.due) - new Date(b.due);
    })[0];
    let msHTML = '';
    if (nextMs) {
      const msDue = nextMs.due ? ' · ' + fmtDue(nextMs.due) : '';
      msHTML = '<div class="project-next-ms">⬦ ' + esc(nextMs.title) + msDue + '</div>';
    }

    let staleHTML = '';
    if (p.stage === 'Active' && p.history && p.history.length > 0) {
      const lastEvent = p.history[p.history.length - 1];
      if (lastEvent && lastEvent.date) {
        const daysSince = Math.floor((new Date() - new Date(lastEvent.date)) / 86400000);
        if (daysSince >= 7) {
          staleHTML = '<div class="project-stale">⏸ no activity in ' + daysSince + 'd</div>';
        }
      }
    }

    let tHTML = '';
    if (pTasks.length > 0) {
      tHTML += '<div class="project-tasks">';
      pTasks.slice(0, 3).forEach(pt => { tHTML += '<div class="project-task-item"><div class="project-task-dot"></div>' + esc(pt.title) + '</div>'; });
      if (pTasks.length > 3) tHTML += '<div class="project-task-item" style="opacity:0.5; font-style:italic;">+ ' + (pTasks.length - 3) + ' more</div>';
      tHTML += '</div>';
    }

    card.innerHTML = '<div class="project-header"><div class="project-title">' + esc(p.title) + '</div><div class="project-stage ' + esc(p.stage) + '">' + esc(p.stage) + '</div></div>' +
      descHTML +
      '<div class="project-meta">' + pTasks.length + ' active task' + (pTasks.length !== 1 ? 's' : '') + dStr + '</div>' +
      progHTML + msHTML + staleHTML + tHTML;

    card.addEventListener('click', function() { openProjectDetail(p.id); });
    list.appendChild(card);
    cards.push(card);
  });

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
    const desc = document.getElementById('projDescInput').value.trim();
    const stage = getChip('projStageRow') || 'Planning'; const due = document.getElementById('projDueInput').value; const note = document.getElementById('projNoteInput').value.trim();
    const p = { id: uid(), title, description: desc, stage, due, note, milestones: [], history: [] };
    addProjectHistory(p, 'created', 'Project created');
    state.projects.push(p); showToast('Project created');
    closeSheets(); saveLocal(); renderProjects(); ghPush();
  });
}

function openProjectDetail(id) {
  const p = state.projects.find(x => x.id === id); if (!p) return;
  state.activeProjectId = id;
  if (!p.milestones) p.milestones = [];
  if (!p.history) p.history = [];

  document.getElementById('pdTitleInput').value = p.title || '';
  document.getElementById('pdDescInput').value = p.description || '';
  document.getElementById('pdDueInput').value = p.due || '';
  document.getElementById('pdNotesInput').innerHTML = p.note || '';
  setChip('pdStageRow', p.stage || 'Planning');

  renderPdProgress();
  renderPdNextUp();
  renderPdMilestones();
  renderProjectTasks();
  renderPdCompleted();
  renderPdActivity();

  document.getElementById('pdMilestoneAddRow').style.display = 'none';
  switchView('projects-detail');
}

function saveProjectDetail() {
  if (!state.activeProjectId) return;
  const p = state.projects.find(x => x.id === state.activeProjectId);
  if (p) {
    const oldStage = p.stage;
    p.title = document.getElementById('pdTitleInput').value.trim() || 'Untitled Project';
    p.description = document.getElementById('pdDescInput').value.trim();
    p.stage = getChip('pdStageRow') || 'Planning';
    p.due = document.getElementById('pdDueInput').value;
    p.note = document.getElementById('pdNotesInput').innerHTML;
    if (p.stage !== oldStage) {
      addProjectHistory(p, 'stage', 'Stage → ' + p.stage);
    }
    saveLocal(); ghPush();
    renderPdProgress();
    renderPdNextUp();
  }
}

let pdTimer = null;
function queuePdSave() { if (pdTimer) clearTimeout(pdTimer); pdTimer = setTimeout(saveProjectDetail, 800); }
const pdTitle = document.getElementById('pdTitleInput'); if (pdTitle) pdTitle.addEventListener('input', queuePdSave);
const pdDesc = document.getElementById('pdDescInput'); if (pdDesc) pdDesc.addEventListener('input', queuePdSave);
const pdDue = document.getElementById('pdDueInput'); if (pdDue) pdDue.addEventListener('change', saveProjectDetail);
const pdNotes = document.getElementById('pdNotesInput'); if (pdNotes) pdNotes.addEventListener('input', queuePdSave);

const pdStageRow = document.getElementById('pdStageRow');
if (pdStageRow) { pdStageRow.addEventListener('click', function(e) { const chip = e.target.closest('.s-chip'); if (!chip) return; document.querySelectorAll('#pdStageRow .s-chip').forEach(c => { c.classList.remove('active'); }); chip.classList.add('active'); saveProjectDetail(); }); }

function renderPdProgress() {
  const p = state.projects.find(x => x.id === state.activeProjectId); if (!p) return;
  const prog = projProgress(p);
  const fill = document.getElementById('pdProgressFill');
  const label = document.getElementById('pdProgressLabel');
  const wrap = document.getElementById('pdProgressWrap');
  if (prog.total === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  fill.style.width = prog.pct + '%';
  fill.classList.toggle('complete', prog.pct >= 100);
  label.textContent = prog.done + ' / ' + prog.total + ' done (' + prog.pct + '%)';
}

function renderPdNextUp() {
  const p = state.projects.find(x => x.id === state.activeProjectId); if (!p) return;
  const card = document.getElementById('pdNextCard');
  const content = document.getElementById('pdNextContent');
  if (!card || !content) return;

  const items = [];
  const pTasks = state.tasks.filter(t => t.projectId === p.id && !t.done);
  const prioOrder = { hi: 0, md: 1, lo: 2 };
  const sorted = pTasks.slice().sort((a, b) => {
    const pa = prioOrder[a.priority || 'md'] || 1;
    const pb = prioOrder[b.priority || 'md'] || 1;
    if (pa !== pb) return pa - pb;
    const da = a.due ? new Date(a.due + 'T00:00:00').getTime() : Infinity;
    const db = b.due ? new Date(b.due + 'T00:00:00').getTime() : Infinity;
    return da - db;
  });
  if (sorted.length > 0) {
    const t = sorted[0];
    const dueStr = t.due ? fmtDue(t.due) : '';
    items.push({ icon: '◉', text: t.title, due: dueStr, dueClass: t.due ? dueClass(t.due) : '' });
  }

  const nextMs = (p.milestones || []).filter(m => !m.done).sort((a, b) => {
    if (!a.due && !b.due) return 0; if (!a.due) return 1; if (!b.due) return -1;
    return new Date(a.due) - new Date(b.due);
  })[0];
  if (nextMs) {
    const msDue = nextMs.due ? fmtDue(nextMs.due) : '';
    items.push({ icon: '⬦', text: nextMs.title, due: msDue, dueClass: nextMs.due ? dueClass(nextMs.due) : '' });
  }

  if (items.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  content.innerHTML = items.map(function(item) {
    return '<div class="pd-next-row"><span class="pd-next-icon">' + item.icon + '</span><span class="pd-next-text">' + esc(item.text) + '</span>' +
      (item.due ? '<span class="pd-next-due ' + item.dueClass + '">' + esc(item.due) + '</span>' : '') + '</div>';
  }).join('');
}

function renderPdMilestones() {
  const p = state.projects.find(x => x.id === state.activeProjectId); if (!p) return;
  const list = document.getElementById('pdMilestonesList'); if (!list) return;
  list.innerHTML = '';
  const milestones = p.milestones || [];
  const active = milestones.filter(m => !m.done);
  const done = milestones.filter(m => m.done);

  if (milestones.length === 0) {
    list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); font-style:italic; padding:6px 0;">No milestones yet. Add one to track progress.</div>';
    return;
  }

  active.concat(done).forEach(function(m) {
    const row = document.createElement('div');
    row.className = 'pd-ms-row' + (m.done ? ' done' : '');
    row.dataset.id = m.id;

    const cb = document.createElement('div');
    cb.className = 'pd-ms-cb' + (m.done ? ' checked' : '');
    cb.innerHTML = m.done ? '✓' : '⬦';

    const body = document.createElement('div');
    body.className = 'pd-ms-body';
    let bodyHtml = '<div class="pd-ms-title">' + esc(m.title) + '</div>';
    if (m.due) {
      const dc = dueClass(m.due);
      bodyHtml += '<span class="due ' + dc + '" style="font-size:10px;">' + esc(fmtDue(m.due)) + '</span>';
    }
    if (m.done && m.completedAt) {
      bodyHtml += '<span style="font-size:10px; color:var(--text-muted); margin-left:6px;">done ' + projTimeAgo(m.completedAt) + '</span>';
    }
    const msTasksDone = state.tasks.filter(t => t.projectId === p.id && t.milestoneId === m.id && t.done).length;
    const msTasksTotal = state.tasks.filter(t => t.projectId === p.id && t.milestoneId === m.id).length;
    if (msTasksTotal > 0) {
      bodyHtml += '<span style="font-size:10px; color:var(--text-muted); margin-left:6px;">' + msTasksDone + '/' + msTasksTotal + ' tasks</span>';
    }
    body.innerHTML = bodyHtml;

    const del = document.createElement('div');
    del.className = 'pd-ms-del';
    del.textContent = '✕';
    del.addEventListener('click', function(e) {
      e.stopPropagation();
      p.milestones = p.milestones.filter(x => x.id !== m.id);
      state.tasks.forEach(t => { if (t.milestoneId === m.id) delete t.milestoneId; });
      addProjectHistory(p, 'milestone-del', 'Removed: ' + m.title);
      saveLocal(); ghPush(); renderPdMilestones(); renderPdProgress(); renderPdNextUp(); renderPdActivity();
    });

    cb.addEventListener('click', function(e) {
      e.stopPropagation();
      m.done = !m.done;
      if (m.done) {
        m.completedAt = new Date().toISOString();
        addProjectHistory(p, 'milestone', '✓ ' + m.title);
        showToast('Milestone completed!');
      } else {
        delete m.completedAt;
      }
      saveLocal(); ghPush(); renderPdMilestones(); renderPdProgress(); renderPdNextUp(); renderPdActivity(); renderPdCompleted();
    });

    row.appendChild(cb);
    row.appendChild(body);
    row.appendChild(del);
    list.appendChild(row);
  });
}

const pdAddMsBtn = document.getElementById('pdAddMilestoneBtn');
if (pdAddMsBtn) {
  pdAddMsBtn.addEventListener('click', function() {
    const row = document.getElementById('pdMilestoneAddRow');
    row.style.display = row.style.display === 'flex' ? 'none' : 'flex';
    if (row.style.display === 'flex') document.getElementById('pdMilestoneInput').focus();
  });
}

const pdMsSaveBtn = document.getElementById('pdMilestoneSaveBtn');
if (pdMsSaveBtn) {
  pdMsSaveBtn.addEventListener('click', function() {
    const p = state.projects.find(x => x.id === state.activeProjectId); if (!p) return;
    const title = document.getElementById('pdMilestoneInput').value.trim();
    if (!title) { showToast('Enter milestone title'); return; }
    const due = document.getElementById('pdMilestoneDueInput').value;
    if (!p.milestones) p.milestones = [];
    p.milestones.push({ id: uid(), title: title, due: due || '', done: false });
    addProjectHistory(p, 'milestone-add', 'Added: ' + title);
    document.getElementById('pdMilestoneInput').value = '';
    document.getElementById('pdMilestoneDueInput').value = '';
    saveLocal(); ghPush(); renderPdMilestones(); renderPdProgress(); renderPdNextUp(); renderPdActivity();
    showToast('Milestone added');
  });
}

const pdMsInput = document.getElementById('pdMilestoneInput');
if (pdMsInput) {
  pdMsInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('pdMilestoneSaveBtn').click();
  });
}

function renderProjectTasks() {
  const list = document.getElementById('pdTasksList'); if (!list) return; list.innerHTML = '';
  const p = state.projects.find(x => x.id === state.activeProjectId);
  const pTasks = state.tasks.filter(t => t.projectId === state.activeProjectId && !t.done);
  if (pTasks.length === 0) { list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); font-style:italic; padding: 12px 0;">No active tasks linked.</div>'; return; }

  const milestones = (p && p.milestones) ? p.milestones.filter(m => !m.done) : [];
  const msIds = milestones.map(m => m.id);
  const grouped = {};
  const ungrouped = [];

  pTasks.forEach(t => {
    if (t.milestoneId && msIds.indexOf(t.milestoneId) !== -1) {
      if (!grouped[t.milestoneId]) grouped[t.milestoneId] = [];
      grouped[t.milestoneId].push(t);
    } else {
      ungrouped.push(t);
    }
  });

  milestones.forEach(ms => {
    const tasks = grouped[ms.id];
    if (!tasks || tasks.length === 0) return;
    const msLabel = document.createElement('div');
    msLabel.className = 'pd-task-ms-label';
    msLabel.textContent = '⬦ ' + ms.title;
    list.appendChild(msLabel);
    tasks.forEach(t => list.appendChild(makeProjectTaskEl(t)));
  });

  ungrouped.forEach(t => list.appendChild(makeProjectTaskEl(t)));

  renderPdProgress();
  renderPdNextUp();
}

function makeProjectTaskEl(t) {
  const el = document.createElement('div'); el.className = 'task ' + (t.priority || 'md');
  const catHtml = (t.categories || []).map(c => '<span class="cat ' + catCls(c) + '">' + esc(CAT_LABEL[c] || c) + '</span>').join('');
  const dc = dueClass(t.due); const dueHtml = t.due ? '<span class="due ' + dc + '">' + esc(fmtDue(t.due)) + '</span>' : '';
  el.innerHTML = '<div class="cb"></div><div class="task-body"><div class="task-title">' + esc(t.title) + '</div><div class="task-row">' + catHtml + dueHtml + '</div></div>';
  el.querySelector('.cb').addEventListener('click', function(e) { e.stopPropagation(); toggleDone(t.id); });
  el.addEventListener('click', function() { openEdit(t.id); });
  return el;
}

function renderPdCompleted() {
  const section = document.getElementById('pdCompletedSection'); if (!section) return;
  const list = document.getElementById('pdCompletedList'); if (!list) return;
  const countEl = document.getElementById('pdCompletedCount');
  const completed = state.tasks.filter(t => t.projectId === state.activeProjectId && t.done);
  if (completed.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  countEl.textContent = completed.length;
  list.innerHTML = '';

  completed.sort((a, b) => (b.completedAt || '') > (a.completedAt || '') ? 1 : -1);
  completed.forEach(function(t) {
    const el = document.createElement('div');
    el.className = 'pd-completed-task';
    let completedStr = '';
    if (t.completedAt) completedStr = projTimeAgo(t.completedAt);
    el.innerHTML = '<div class="pd-completed-cb">✓</div><div class="pd-completed-body"><div class="pd-completed-title">' + esc(t.title) + '</div>' +
      (completedStr ? '<div class="pd-completed-meta">' + completedStr + '</div>' : '') + '</div>';
    list.appendChild(el);
  });
}

function renderPdActivity() {
  const p = state.projects.find(x => x.id === state.activeProjectId); if (!p) return;
  const card = document.getElementById('pdActivityCard');
  const list = document.getElementById('pdActivityList');
  if (!card || !list) return;
  const history = (p.history || []).slice().reverse();
  if (history.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  list.innerHTML = '';
  history.slice(0, 20).forEach(function(h) {
    const row = document.createElement('div');
    row.className = 'pd-activity-row';
    const icons = { created:'◉', stage:'↻', milestone:'✓', 'milestone-add':'⬦', 'milestone-del':'✕', task:'✓' };
    const icon = icons[h.type] || '·';
    row.innerHTML = '<span class="pd-activity-icon ' + (h.type || '') + '">' + icon + '</span><span class="pd-activity-label">' + esc(h.label) + '</span><span class="pd-activity-time">' + projTimeAgo(h.date) + '</span>';
    list.appendChild(row);
  });
}

const pdAdd = document.getElementById('pdAddTaskBtn'); if (pdAdd) { pdAdd.addEventListener('click', function() { openAddSheet(); }); }

const pdDel = document.getElementById('delProjectDetailBtn');
if (pdDel) {
  pdDel.addEventListener('click', function() {
    if (!state.activeProjectId) return;
    if (confirm('Delete this project? Tasks inside will NOT be deleted, just unlinked.')) {
      state.projects = state.projects.filter(p => p.id !== state.activeProjectId);
      state.tasks.forEach(t => { if (t.projectId === state.activeProjectId) { delete t.projectId; delete t.milestoneId; } });
      saveLocal(); ghPush(); switchView('projects'); showToast('Project deleted');
    }
  });
}

function populateTaskMilestoneSelect(projectId) {
  const wrap = document.getElementById('taskMilestoneWrap');
  const sel = document.getElementById('taskMilestoneInput');
  if (!wrap || !sel) return;
  if (!projectId) { wrap.style.display = 'none'; return; }
  const p = state.projects.find(x => x.id === projectId);
  if (!p || !p.milestones || p.milestones.filter(m => !m.done).length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  sel.innerHTML = '<option value="">None</option>';
  p.milestones.filter(m => !m.done).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = '⬦ ' + m.title;
    sel.appendChild(opt);
  });
}

const taskProjInput = document.getElementById('taskProjectInput');
if (taskProjInput) {
  taskProjInput.addEventListener('change', function() {
    populateTaskMilestoneSelect(this.value);
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
  rebuildCNChips();
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
  loadHabitsUI();
  updatePinUI();
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
  const hdel = e.target.closest('.habit-del-btn');
  if (hdel) { const row = hdel.closest('.habit-settings-row'); if (row) row.remove(); }
});

const DAY_LABELS = ['M','T','W','T','F','S','S'];

function loadHabitsUI() {
  const container = document.getElementById('habitSettingsRows');
  if (!container) return;
  container.innerHTML = '';
  getHabits().forEach(function(h) {
    container.appendChild(makeHabitRow(h));
  });
}

function makeHabitRow(h) {
  const row = document.createElement('div');
  row.className = 'habit-settings-row';

  const top = document.createElement('div');
  top.className = 'habit-settings-top';

  const idInput = document.createElement('input');
  idInput.className = 'input';
  idInput.style.cssText = 'width:80px;margin-bottom:0;font-family:var(--font-mono);font-size:12px;';
  idInput.value = h.id || '';
  idInput.placeholder = 'id';
  idInput.dataset.orig = h.id || '';
  idInput.autocapitalize = 'none';

  const labelInput = document.createElement('input');
  labelInput.className = 'input';
  labelInput.style.cssText = 'flex:1;margin-bottom:0;';
  labelInput.value = h.label || '';
  labelInput.placeholder = 'Label';

  const badBtn = document.createElement('div');
  badBtn.className = 'habit-bad-toggle' + (h.bad ? ' active' : '');
  badBtn.textContent = 'bad';
  badBtn.title = 'Mark as bad habit (tracked to avoid)';
  badBtn.addEventListener('click', function() { badBtn.classList.toggle('active'); });

  const delBtn = document.createElement('div');
  delBtn.className = 'habit-del-btn';
  delBtn.style.cssText = 'cursor:pointer;padding:0 8px;font-size:18px;color:#ff3a30;line-height:1;flex-shrink:0;';
  delBtn.textContent = '×';

  top.appendChild(idInput);
  top.appendChild(labelInput);
  top.appendChild(badBtn);
  top.appendChild(delBtn);

  const daysRow = document.createElement('div');
  daysRow.className = 'habit-day-toggles';
  var days = h.days || [0,1,2,3,4,5,6];
  DAY_LABELS.forEach(function(label, i) {
    var btn = document.createElement('div');
    btn.className = 'habit-day-toggle' + (days.indexOf(i) !== -1 ? ' active' : '');
    btn.textContent = label;
    btn.dataset.day = i;
    btn.addEventListener('click', function() { btn.classList.toggle('active'); });
    daysRow.appendChild(btn);
  });

  row.appendChild(top);
  row.appendChild(daysRow);
  return row;
}

function saveHabitsFromUI() {
  const container = document.getElementById('habitSettingsRows');
  if (!container) return;
  var habits = [];
  container.querySelectorAll('.habit-settings-row').forEach(function(row) {
    var top = row.querySelector('.habit-settings-top');
    var inputs = top.querySelectorAll('input');
    var id = inputs[0].value.trim().toLowerCase().replace(/\s+/g, '_');
    var label = inputs[1].value.trim();
    if (!id || !label) return;
    var bad = !!top.querySelector('.habit-bad-toggle.active');
    var days = [];
    row.querySelectorAll('.habit-day-toggle.active').forEach(function(btn) {
      days.push(parseInt(btn.dataset.day));
    });
    habits.push({ id: id, label: label, bad: bad, days: days });
  });
  updateHabits(habits);
  showToast('Habits saved');
}

const saveHabitsBtn = document.getElementById('saveHabitsBtn');
if (saveHabitsBtn) saveHabitsBtn.addEventListener('click', saveHabitsFromUI);

const addHabitBtn = document.getElementById('addHabitBtn');
if (addHabitBtn) addHabitBtn.addEventListener('click', function() {
  const container = document.getElementById('habitSettingsRows');
  if (!container) return;
  var row = makeHabitRow({ id: '', label: '', bad: false, days: [0,1,2,3,4,5,6] });
  container.appendChild(row);
  row.querySelector('input').focus();
});

function _hashPinSync(pin) {
  var encoded = new TextEncoder().encode(pin);
  return crypto.subtle.digest('SHA-256', encoded).then(function(hash) {
    return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}

function updatePinUI() {
  var hasPin = !!localStorage.getItem('kw_notes_pin_hash');
  var statusEl = document.getElementById('pinStatus');
  var setBtn = document.getElementById('setPinBtn');
  var clearBtn = document.getElementById('clearPinBtn');
  if (statusEl) statusEl.textContent = hasPin ? '🔒 PIN is set' : 'No PIN set';
  if (setBtn) setBtn.textContent = hasPin ? 'Change PIN' : 'Set PIN';
  if (clearBtn) clearBtn.style.display = hasPin ? '' : 'none';
}

document.getElementById('setPinBtn').addEventListener('click', function() {
  var existingHash = localStorage.getItem('kw_notes_pin_hash');
  if (existingHash) {
    var overlay = document.getElementById('pinModalOverlay');
    var input = document.getElementById('pinModalInput');
    var error = document.getElementById('pinModalError');
    var titleEl = document.getElementById('pinModalTitle');
    titleEl.textContent = 'Current PIN';
    input.value = ''; error.textContent = '';
    overlay.style.display = 'flex';
    setTimeout(function() { input.focus(); }, 100);

    var confirmBtn = document.getElementById('pinModalConfirm');
    var cancelBtn = document.getElementById('pinModalCancel');
    var newConfirm = confirmBtn.cloneNode(true);
    var newCancel = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newCancel.addEventListener('click', function() { overlay.style.display = 'none'; });
    newConfirm.addEventListener('click', function() {
      _hashPinSync(input.value).then(function(h) {
        if (h !== existingHash) { error.textContent = 'Wrong PIN'; return; }
        overlay.style.display = 'none';
        promptNewPin();
      });
    });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') newConfirm.click(); if (e.key === 'Escape') { overlay.style.display = 'none'; } });
  } else {
    promptNewPin();
  }
});

function promptNewPin() {
  var overlay = document.getElementById('pinModalOverlay');
  var input = document.getElementById('pinModalInput');
  var error = document.getElementById('pinModalError');
  var titleEl = document.getElementById('pinModalTitle');
  titleEl.textContent = 'Set new PIN';
  input.value = ''; error.textContent = '';
  overlay.style.display = 'flex';
  setTimeout(function() { input.focus(); }, 100);

  var confirmBtn = document.getElementById('pinModalConfirm');
  var cancelBtn = document.getElementById('pinModalCancel');
  var newConfirm = confirmBtn.cloneNode(true);
  var newCancel = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  newCancel.addEventListener('click', function() { overlay.style.display = 'none'; });
  newConfirm.addEventListener('click', function() {
    var pin = input.value;
    if (pin.length < 4) { error.textContent = 'At least 4 characters'; return; }
    _hashPinSync(pin).then(function(h) {
      localStorage.setItem('kw_notes_pin_hash', h);
      overlay.style.display = 'none';
      updatePinUI();
      showToast('PIN set');
    });
  });
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') newConfirm.click(); if (e.key === 'Escape') { overlay.style.display = 'none'; } });
}

document.getElementById('clearPinBtn').addEventListener('click', function() {
  var overlay = document.getElementById('pinModalOverlay');
  var input = document.getElementById('pinModalInput');
  var error = document.getElementById('pinModalError');
  var titleEl = document.getElementById('pinModalTitle');
  titleEl.textContent = 'Enter PIN to remove';
  input.value = ''; error.textContent = '';
  overlay.style.display = 'flex';
  setTimeout(function() { input.focus(); }, 100);

  var confirmBtn = document.getElementById('pinModalConfirm');
  var cancelBtn = document.getElementById('pinModalCancel');
  var newConfirm = confirmBtn.cloneNode(true);
  var newCancel = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  newCancel.addEventListener('click', function() { overlay.style.display = 'none'; });
  newConfirm.addEventListener('click', function() {
    _hashPinSync(input.value).then(function(h) {
      if (h !== localStorage.getItem('kw_notes_pin_hash')) { error.textContent = 'Wrong PIN'; return; }
      var cnNotes = getCnNotes();
      cnNotes.forEach(function(n) { n.locked = false; });
      saveCN(true);
      localStorage.removeItem('kw_notes_pin_hash');
      overlay.style.display = 'none';
      updatePinUI();
      showToast('PIN removed, all notes unlocked');
    });
  });
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') newConfirm.click(); if (e.key === 'Escape') { overlay.style.display = 'none'; } });
});

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
  sheet.addEventListener('touchend', function(e) { if (!dragging) return; dragging = false; const dy = e.changedTouches[0].clientY - startY; if (dy > 80) { sheet.style.transition = ''; closeSheets(); } else { sheet.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.85, 0.3, 1)'; sheet.style.transform = ''; setTimeout(function() { sheet.style.transition = ''; }, 350); } }, { passive: true });
});

function toggleQuickAdd() { const wrap = document.getElementById('quickAddWrap'); const inp = document.getElementById('quickAddInput'); wrap.classList.toggle('open'); if (wrap.classList.contains('open')) { inp.focus(); } else { inp.value = ''; } }
function submitQuickAdd() { const inp = document.getElementById('quickAddInput'); const title = inp.value.trim(); if (!title) return; const newTask = { id: Date.now().toString(), title, categories: ['personal'], status: 'active', priority: 'md', note: '', due: new Date().toISOString().split('T')[0], noteIsMono: false, pinnedToday: true, done: false, pomodoros: 0 }; state.tasks.push(newTask); saveLocal(); if (document.body.classList.contains('projects-mode')) renderProjects(); else render(); ghPush(); showToast('Pinned to Today'); inp.value = ''; document.getElementById('quickAddWrap').classList.remove('open'); }
document.getElementById('quickAddInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); } if (e.key === 'Escape') { toggleQuickAdd(); } });
document.getElementById('quickAddSend').addEventListener('click', submitQuickAdd);

// ══════════════════════════════════════════════════════════════════
// CONTEXT AWARE FAB
// ══════════════════════════════════════════════════════════════════

const FAB_ICONS = {
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
  notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
};

const animStyle = document.createElement('style');
animStyle.textContent = `
  #fab {
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out !important;
    display: flex; align-items: center; justify-content: center;
    z-index: 999;
  }
  #fab svg { width: 24px; height: 24px; pointer-events: none; }
  #fab:active { transform: scale(0.9) !important; }
  body.projects-mode #fab { display: flex !important; }
`;
document.head.appendChild(animStyle);

const fabEl = document.getElementById('fab');
if (fabEl) {
  fabEl.innerHTML = FAB_ICONS.tasks; 
  fabEl.dataset.currentIcon = 'tasks';

  on('view-changed', function(data) {
    let baseView = data.to.split('-')[0];
    let targetIcon = FAB_ICONS[baseView] || FAB_ICONS.tasks;
    if (fabEl.dataset.currentIcon === baseView) return;
    
    fabEl.style.transform = 'scale(0.5) rotate(-15deg)';
    fabEl.style.opacity = '0';

    setTimeout(function() {
      fabEl.innerHTML = targetIcon;
      fabEl.dataset.currentIcon = baseView;
      fabEl.style.transform = 'scale(1) rotate(0deg)';
      fabEl.style.opacity = '1';
    }, 150);
  });

  // Long press vs Tap logic for Tasks view
  let longPressTriggered = false;
  let fabTimer;
  
  const startFabTimer = () => {
    longPressTriggered = false;
    fabTimer = setTimeout(() => {
      const view = currentViewName();
      if (view === 'tasks') {
        longPressTriggered = true;
        openAddSheet();
      } else if (view === 'notes') {
        longPressTriggered = true;
        // Show the type picker menu on long press
        var menu = document.getElementById('cnNewMenu');
        if (menu) {
          menu.style.display = 'block';
          setTimeout(function() {
            function closeMenu(ev) {
              if (!menu.contains(ev.target) && ev.target !== fabEl && !fabEl.contains(ev.target)) {
                menu.style.display = 'none';
                document.removeEventListener('click', closeMenu, true);
              }
            }
            document.addEventListener('click', closeMenu, true);
          }, 10);
        }
      }
    }, 550); // Standard long-press duration
  };

  const clearFabTimer = () => {
    clearTimeout(fabTimer);
  };

  fabEl.addEventListener('touchstart', startFabTimer, { passive: true });
  fabEl.addEventListener('touchend', clearFabTimer, { passive: true });
  fabEl.addEventListener('mousedown', startFabTimer);
  fabEl.addEventListener('mouseup', clearFabTimer);
  fabEl.addEventListener('contextmenu', e => e.preventDefault());

  fabEl.addEventListener('click', function(e) {
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    const view = currentViewName();
    if (view === 'notes') {
      // Tap = instant memo note
      createNewNote('memo');
    } else if (view.startsWith('projects')) {
      state.editingProjId = null;
      closeSheets();
      setTimeout(function() { openSheet('projectSheet'); }, 10);
    } else {
      toggleQuickAdd();
    }
  });
}

// Wire the new note type menu items
var cnNewMenuEl = document.getElementById('cnNewMenu');
if (cnNewMenuEl) {
  cnNewMenuEl.addEventListener('click', function(e) {
    var item = e.target.closest('.cn-new-menu-item');
    if (!item) return;
    var type = item.dataset.newtype || 'memo';
    cnNewMenuEl.style.display = 'none';
    createNewNote(type);
  });
}

// ── Desktop keyboard shortcut: N in tasks view opens full add-task sheet ──
document.addEventListener('keydown', function(e) {
  if (document.body.classList.contains('notes-mode')) return; // handled by confnotes.js
  var view = typeof currentViewName === 'function' ? currentViewName() : '';
  if (view !== 'tasks' && view !== 'projects-detail') return;
  var tag = (document.activeElement || {}).tagName || '';
  var inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    e.stopPropagation();
    openAddSheet();
  }
});

// ══════════════════════════════════════════════════════════════════
// ROUTER REGISTRATION
// ══════════════════════════════════════════════════════════════════

register('tasks', { onEnter: render });
register('reflect', {
  onEnter: function() {
    onReflectEnter();
    renderPromptCard();
    if (getReflectMode() === 'review' && !isReviewActive()) onTimelineEnter();
  },
  onExit: function() {
    onReflectExit();
    if (isReviewActive()) closeReview();
  },
});
register('projects', { onEnter: renderProjects });
register('projects-detail', { onEnter: renderProjectTasks });
register('notes', { onEnter: renderCNList });
register('bel', { onEnter: renderBel });

document.getElementById('tabTasks').addEventListener('click', function() { switchView('tasks'); });
document.getElementById('tabReflect').addEventListener('click', function() { switchView('reflect'); });
const tpBtn = document.getElementById('tabProjects'); if (tpBtn) tpBtn.addEventListener('click', function() { switchView('projects'); });
document.getElementById('tabNotes').addEventListener('click', function() { switchView('notes'); });

const sbt = document.getElementById('secretBelTrigger');
if (sbt) {
  let _belTaps = 0;
  let _belTapTimer = null;
  sbt.addEventListener('click', function() {
    _belTaps++;
    if (_belTapTimer) clearTimeout(_belTapTimer);
    if (_belTaps >= 5) {
      _belTaps = 0;
      switchView('bel');
    } else {
      _belTapTimer = setTimeout(function() { _belTaps = 0; }, 1200);
    }
  });
}
const cbb = document.getElementById('closeBelBtn'); if (cbb) cbb.addEventListener('click', function() { switchView('tasks'); });
const cpd = document.getElementById('closeProjectDetailBtn'); if (cpd) cpd.addEventListener('click', function() { switchView('projects'); });

// ══════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ══════════════════════════════════════════════════════════════════

const THEMES = ['aurora', 'halcyon'];

function applyTheme(name) {
  THEMES.forEach(t => { document.body.classList.remove('theme-' + t); });
  if (name) document.body.classList.add('theme-' + name);
  const htmlBg = { aurora:'#111418', halcyon:'#dce8f4' };
  document.documentElement.style.background = htmlBg[name] || '#dce8f4';
  document.querySelectorAll('.theme-swatch').forEach(sw => { sw.classList.toggle('active', sw.dataset.theme === (name || 'halcyon')); });
  try { localStorage.setItem(KEYS.theme, name || 'halcyon'); } catch (e) {}
}

function loadTheme() { let saved = 'halcyon'; try { saved = localStorage.getItem(KEYS.theme) || 'halcyon'; } catch (e) {} if (saved === 'newsprint' || saved === 'ios26' || saved === 'bel-bel') saved = 'halcyon'; if (saved === 'neon' || saved === 'ios-dark') saved = 'aurora'; applyTheme(saved); }
document.getElementById('settingsSheet').addEventListener('click', function(e) { const sw = e.target.closest('.theme-swatch'); if (!sw) return; applyTheme(sw.dataset.theme); updateAccentUI(); render(); });

const ACCENT_KEY = 'kw_accent_v1';
const ACCENT_THEMES = ['halcyon', 'aurora'];
const ACCENT_DEFAULTS = { halcyon: { r: 16, g: 96, b: 160 }, aurora: { r: 74, g: 188, b: 224 } };

const ACCENT_PRESETS = [
  { hex: '#1060a0', label: 'Ocean' },
  { hex: '#4ABCE0', label: 'Teal' },
  { hex: '#7C5CFC', label: 'Violet' },
  { hex: '#E85D8A', label: 'Rose' },
  { hex: '#E8743A', label: 'Ember' },
  { hex: '#2BAA6E', label: 'Forest' },
  { hex: '#D4A64A', label: 'Amber' },
  { hex: '#3B82F6', label: 'Blue' },
];

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(function(v) { return v.toString(16).padStart(2, '0'); }).join('');
}

function isLightColor(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
}

function getCurrentThemeName() {
  for (var i = 0; i < THEMES.length; i++) {
    if (document.body.classList.contains('theme-' + THEMES[i])) return THEMES[i];
  }
  return 'halcyon';
}

function applyAccentColor(hex) {
  var rgb = hexToRgb(hex);
  var root = document.body;
  root.style.setProperty('--accent-r', rgb.r);
  root.style.setProperty('--accent-g', rgb.g);
  root.style.setProperty('--accent-b', rgb.b);

  root.style.setProperty('--accent', 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  root.style.setProperty('--accent-faded', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.12)');
  root.style.setProperty('--task-md', 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  root.style.setProperty('--task-cb-border', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.30)');
  root.style.setProperty('--bg-input', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.10)');
  root.style.setProperty('--bg-tab-active', 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  root.style.setProperty('--tab-active-border', 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  root.style.setProperty('--fab-bg', 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  root.style.setProperty('--fab-shadow', '0 4px 12px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.3), 0 8px 30px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.15)');
  root.style.setProperty('--shadow-toast', '0 4px 20px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.12), 0 0 0 1px rgba(140, 180, 220, 0.10)');

  var theme = getCurrentThemeName();
  if (theme === 'aurora') {
    root.style.setProperty('--accent-text', isLightColor(rgb.r, rgb.g, rgb.b) ? '#111418' : '#ffffff');
    root.style.setProperty('--fab-color', isLightColor(rgb.r, rgb.g, rgb.b) ? '#111418' : '#ffffff');
  } else {
    root.style.setProperty('--accent-text', isLightColor(rgb.r, rgb.g, rgb.b) ? '#081e36' : '#ffffff');
    root.style.setProperty('--fab-color', isLightColor(rgb.r, rgb.g, rgb.b) ? '#081e36' : '#ffffff');
  }
}

function clearAccentColor() {
  var props = ['--accent-r', '--accent-g', '--accent-b', '--accent', '--accent-faded',
    '--accent-text', '--fab-color', '--fab-bg', '--fab-shadow', '--shadow-toast',
    '--task-md', '--task-cb-border', '--bg-input', '--bg-tab-active', '--tab-active-border'];
  props.forEach(function(p) { document.body.style.removeProperty(p); });
}

function saveAccent(hex) {
  var theme = getCurrentThemeName();
  try {
    var stored = JSON.parse(localStorage.getItem(ACCENT_KEY) || '{}');
    stored[theme] = hex;
    localStorage.setItem(ACCENT_KEY, JSON.stringify(stored));
  } catch (e) {}
}

function loadAccent() {
  var theme = getCurrentThemeName();
  if (ACCENT_THEMES.indexOf(theme) === -1) { clearAccentColor(); return; }
  try {
    var stored = JSON.parse(localStorage.getItem(ACCENT_KEY) || '{}');
    if (stored[theme]) {
      applyAccentColor(stored[theme]);
    } else {
      clearAccentColor();
    }
  } catch (e) { clearAccentColor(); }
}

function getSavedAccent() {
  var theme = getCurrentThemeName();
  try {
    var stored = JSON.parse(localStorage.getItem(ACCENT_KEY) || '{}');
    return stored[theme] || null;
  } catch (e) { return null; }
}

function removeSavedAccent() {
  var theme = getCurrentThemeName();
  try {
    var stored = JSON.parse(localStorage.getItem(ACCENT_KEY) || '{}');
    delete stored[theme];
    localStorage.setItem(ACCENT_KEY, JSON.stringify(stored));
  } catch (e) {}
}

function buildAccentPresets() {
  var container = document.getElementById('accentPresets');
  if (!container) return;
  container.innerHTML = '';
  var saved = getSavedAccent();
  ACCENT_PRESETS.forEach(function(p) {
    var el = document.createElement('div');
    el.style.cssText = 'width:32px;height:32px;border-radius:8px;cursor:pointer;border:2px solid transparent;transition:all 0.12s;';
    el.style.background = p.hex;
    el.title = p.label;
    if (saved && saved.toLowerCase() === p.hex.toLowerCase()) {
      el.style.borderColor = 'var(--text-main)';
      el.style.outline = '2px solid var(--text-main)';
      el.style.outlineOffset = '2px';
    }
    el.addEventListener('click', function() {
      applyAccentColor(p.hex);
      saveAccent(p.hex);
      document.getElementById('accentHexInput').value = p.hex;
      document.getElementById('accentPreview').style.background = p.hex;
      buildAccentPresets();
      render();
    });
    container.appendChild(el);
  });
}

function updateAccentUI() {
  var theme = getCurrentThemeName();
  var section = document.getElementById('accentPickerSection');
  if (!section) return;
  var show = ACCENT_THEMES.indexOf(theme) !== -1;
  section.style.display = show ? 'block' : 'none';
  if (!show) return;

  loadAccent();
  var saved = getSavedAccent();
  var def = ACCENT_DEFAULTS[theme];
  var currentHex = saved || rgbToHex(def.r, def.g, def.b);
  document.getElementById('accentHexInput').value = currentHex;
  document.getElementById('accentPreview').style.background = currentHex;
  buildAccentPresets();
}

document.getElementById('accentApplyBtn').addEventListener('click', function() {
  var val = document.getElementById('accentHexInput').value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(val) && !/^#[0-9a-fA-F]{3}$/.test(val)) {
    showToast('Invalid hex — use format #RRGGBB');
    return;
  }
  applyAccentColor(val);
  saveAccent(val);
  document.getElementById('accentPreview').style.background = val;
  buildAccentPresets();
  render();
  showToast('Accent color updated');
});

document.getElementById('accentHexInput').addEventListener('input', function() {
  var val = this.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
    document.getElementById('accentPreview').style.background = val;
  }
});

document.getElementById('accentResetBtn').addEventListener('click', function() {
  removeSavedAccent();
  clearAccentColor();
  var theme = getCurrentThemeName();
  var def = ACCENT_DEFAULTS[theme];
  var hex = rgbToHex(def.r, def.g, def.b);
  document.getElementById('accentHexInput').value = hex;
  document.getElementById('accentPreview').style.background = hex;
  buildAccentPresets();
  render();
  showToast('Accent reset to default');
});

var _origApplyTheme = applyTheme;
applyTheme = function(name) {
  _origApplyTheme(name);
  setTimeout(function() { loadAccent(); _initSlidingPills(); }, 0);
};

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
  if (dragState) return; 
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

on('data-pulled', () => {
  invalidateCache();
  rebuildCategoryUI();
  refreshDynamicCatColors();
  const view = currentViewName();
  if (view === 'reflect') {
    if (getReflectMode() === 'today') { renderReflectToday(); renderPromptCard(); }
    else renderTimeline();
  }
  else if (view === 'projects') renderProjects();
  else if (view === 'projects-detail') { renderPdProgress(); renderPdNextUp(); renderPdMilestones(); renderProjectTasks(); renderPdCompleted(); renderPdActivity(); }
  else if (view === 'bel') renderBel();
  else if (view === 'notes') renderCNList();
  else render();
});

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

function _initSlidingPills() {
  var theme = document.body.className;
  var enabled = theme.indexOf('theme-aurora') !== -1 || theme.indexOf('theme-halcyon') !== -1;
  var tabBar = document.querySelector('.tab-bar');
  var reflectSeg = document.querySelector('.reflect-seg');
  if (tabBar) tabBar.classList.toggle('has-sliding-pill', enabled);
  if (reflectSeg) reflectSeg.classList.toggle('has-sliding-pill', enabled);

  if (enabled) {
    import('./router.js').then(({ updateReflectPill }) => {
        updateReflectPill();
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab) {
          const container = document.querySelector('.tab-bar');
          const pill = container.querySelector('.sliding-pill') || document.createElement('div');
          if (!pill.parentNode) { pill.className = 'sliding-pill'; container.insertBefore(pill, container.firstChild); }
          const cRect = container.getBoundingClientRect();
          const aRect = activeTab.getBoundingClientRect();
          pill.style.transform = 'translateX(' + (aRect.left - cRect.left) + 'px)';
          pill.style.width = aRect.width + 'px';
        }
    });
  }
}

// Global UI Listeners
document.getElementById('overlay').addEventListener('click', closeSheets);
document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
document.getElementById('deleteTaskBtn').addEventListener('click', function() { if (state.editingId) deleteTask(state.editingId); closeSheets(); });
document.getElementById('settingsBtn').addEventListener('click', function() { loadSettingsUI(); openSheet('settingsSheet'); });

loadTheme();
loadLocal();
rebuildCategoryUI();
refreshDynamicCatColors();
initPomo();
initShopping(openSheet);
initBel();
initTimeline();
initDashboard({ isActuallyDueToday, dueClass, fmtDue });
initWeeklyReview({ onFinish: function() { renderPromptCard(); render(); if (getReflectMode() === 'today') renderReflectToday(); } });

var _segReview = document.getElementById('reflectSegReview');
if (_segReview) _segReview.addEventListener('click', function() { if (isReviewActive()) closeReview(); onTimelineEnter(); updateReflectPill(); });
var _segToday = document.getElementById('reflectSegToday');
if (_segToday) _segToday.addEventListener('click', function() { updateReflectPill(); });

render();
loadSettingsUI();
updateAccentUI();

requestAnimationFrame(function() {
  requestAnimationFrame(function() {
    _initSlidingPills();
  });
});

setTimeout(function() { if (state.settings.ghToken) ghFetch(); }, 400);
