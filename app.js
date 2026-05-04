// ══════════════════════════════════════════════════════════════════
// APP.JS — single orchestration module
// Wires the new index.html to existing state.js, sync.js,
// dashboard.js, timeline.js, bel.js
// Notes handled inline (no confnotes.js dependency)
// ══════════════════════════════════════════════════════════════════

import {
  KEYS, CAT_LABEL,
  state,
  uid, esc, fmtShort, showToast,
  on,
  loadLocal, saveLocal, saveDash, saveBel, saveCN, saveSettings,
  updateCategories, updateHabits, getHabits,
  buildSyncPayload, applySyncPayload,
  getBelState, setBelState,
  getDState, getCnNotes, setCnNotes,
} from './state.js';

import { ghFetch, ghPush, testGhConnection } from './sync.js';
// dashboard.js not needed — reflect handled inline in app.js
function onReflectEnter() { renderAffectUI(); renderHabitsUI(); }
function onReflectExit() {}
import { initTimeline, onTimelineEnter } from './timeline.js';
import { initBel, renderBel } from './bel.js';

// ══════════════════════════════════════════════════════════════════
// CATEGORY COLORS (matches CSS vars)
// ══════════════════════════════════════════════════════════════════
const CAT_COLORS = {
  manuscript: 'var(--color-manuscript)', lab: 'var(--color-lab)',
  phd: 'var(--color-phd)', conf: 'var(--color-conf)',
  bel: 'var(--color-bel)', personal: 'var(--color-personal)', hobby: 'var(--color-hobby)',
};

export function catCls() { return ''; } // stub for any old imports

// ══════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════

function fmtDue(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return due;
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'overdue (' + fmtShort(d) + ')';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 6)  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return fmtShort(d);
}

function dueClass(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return '';
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff <= 2) return 'soon';
  return '';
}

function categorizeDue(due, pinned) {
  if (pinned) return { label: 'Today', order: 0 };
  if (!due) return { label: 'Someday', order: 4 };
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due + 'T00:00:00');
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return { label: 'Overdue', order: 0 };
  if (diff === 0) return { label: 'Today', order: 0 };
  if (diff <= 7)  return { label: 'This Week', order: 1 };
  if (diff <= 30) return { label: 'This Month', order: 2 };
  return { label: 'Later', order: 3 };
}

// ══════════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ══════════════════════════════════════════════════════════════════

let _currentView = 'tasks';

function switchView(name) {
  if (_currentView === name) return;

  // Exit hooks
  if (_currentView === 'reflect') onReflectExit();

  _currentView = name;
  document.body.className = name + '-mode';

  // Theme class re-apply (body.className wipe removes it)
  try {
    const t = localStorage.getItem(KEYS.theme) || 'auto';
    if (t === 'dark') document.body.classList.add('theme-dark');
    else if (t === 'light') document.body.classList.add('theme-light');
  } catch(e) {}

  document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
  const tabMap = { tasks: 'tabTasks', notes: 'tabNotes', reflect: 'tabReflect' };
  if (tabMap[name]) document.getElementById(tabMap[name])?.classList.add('active');

  const searchTrigger = document.getElementById('searchTrigger');
  if (searchTrigger) searchTrigger.style.display = name === 'tasks' ? '' : 'none';

  if (name === 'tasks')   { render(); }
  if (name === 'notes')   { renderCNList(); }
  if (name === 'reflect') { onReflectEnter(); }
  if (name === 'bel')     { renderBel(); }
}

// Tabs
document.getElementById('tabTasks').addEventListener('click',   () => switchView('tasks'));
document.getElementById('tabNotes').addEventListener('click',   () => switchView('notes'));
document.getElementById('tabReflect').addEventListener('click', () => switchView('reflect'));

// Bel 5-tap
(function() {
  let taps = 0, t = null;
  document.getElementById('secretBelTrigger').addEventListener('click', () => {
    taps++; clearTimeout(t);
    if (taps >= 5) { taps = 0; switchView('bel'); }
    else t = setTimeout(() => taps = 0, 1200);
  });
})();
document.getElementById('belClose').addEventListener('click', () => switchView('tasks'));

// ══════════════════════════════════════════════════════════════════
// TASK RENDERING
// ══════════════════════════════════════════════════════════════════

function render() {
  const list = document.getElementById('taskList');
  if (!list) return;

  const filter = state.filter || 'all';
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

  let tasks = state.tasks.filter(t => {
    if (filter === 'archive') return t.done;
    if (t.done) return false;
    if (filter === 'blocked') return t.status === 'blocked' || t.status === 'waiting';
    if (filter !== 'all') return (t.categories || []).includes(filter);
    return true;
  });

  if (search) tasks = tasks.filter(t =>
    (t.title||'').toLowerCase().includes(search) || (t.note||'').toLowerCase().includes(search)
  );

  // Sort
  tasks.sort((a, b) => {
    const ao = categorizeDue(a.due, a.pinnedToday).order;
    const bo = categorizeDue(b.due, b.pinnedToday).order;
    if (ao !== bo) return ao - bo;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    return 0;
  });

  list.innerHTML = '';

  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state">nothing here.</div>';
    return;
  }

  let lastSection = null;
  tasks.forEach(t => {
    const sec = categorizeDue(t.due, t.pinnedToday);
    if (filter === 'all' && !search && sec.label !== lastSection) {
      lastSection = sec.label;
      const hdr = document.createElement('div');
      hdr.className = 'section-label';
      hdr.textContent = sec.label;
      list.appendChild(hdr);
    }

    const primaryCat = (t.categories || [])[0];
    const cColor = primaryCat ? (CAT_COLORS[primaryCat] || 'var(--text-tertiary)') : 'var(--border-strong)';
    const dotBg = t.priority === 'hi' ? cColor : 'transparent';

    const cats = (t.categories || []).map(c =>
      `<span class="cat" style="color:${CAT_COLORS[c]||'var(--text-tertiary)'}; background:${CAT_COLORS[c]||'var(--text-tertiary)'}18;">${esc(CAT_LABEL[c]||c)}</span>`
    ).join('');

    const statusHtml = (t.status && t.status !== 'active')
      ? `<span class="status ${t.status}">${t.status}</span>` : '';

    const dueHtml = t.due
      ? `<span class="task-due ${dueClass(t.due)}">${esc(fmtDue(t.due))}</span>` : '';

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="task${t.done?' done':''}${(!t.done&&(t.status==='blocked'||t.status==='waiting'))?' dimmed':''}" data-id="${esc(t.id)}">
        <div class="swipe-action-left">delete</div>
        <div class="swipe-action-right">defer</div>
        <div class="task-content">
          <div class="task-dot" style="border-color:${cColor}; background:${dotBg};"></div>
          <div class="task-body">
            <div class="task-title">${esc(t.title||'')}</div>
            ${(cats||statusHtml) ? `<div class="task-meta-row">${cats}${statusHtml}</div>` : ''}
          </div>
          ${dueHtml}
        </div>
      </div>`;
    const el = wrapper.firstElementChild;
    list.appendChild(el);
    attachSwipe(el, t);

    // Dot = toggle done
    el.querySelector('.task-dot').addEventListener('click', e => {
      e.stopPropagation();
      t.done = !t.done;
      if (t.done) t.completedAt = new Date().toISOString();
      else delete t.completedAt;
      saveLocal(); ghPush(); render();
    });
    // Row = open sheet
    el.querySelector('.task-content').addEventListener('click', e => {
      if (el.dataset.swiped === '1') { el.dataset.swiped = '0'; return; }
      if (e.target.classList.contains('task-dot')) return;
      openTaskSheet(t.id);
    });
  });
}

function attachSwipe(el, t) {
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false;
  const content = el.querySelector('.task-content');
  const lbl = el.querySelector('.swipe-action-left');
  const rbl = el.querySelector('.swipe-action-right');
  const THRESHOLD = 70;

  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dragging = false; decided = false;
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    if (!decided) {
      if (Math.abs(cy - startY) > Math.abs(cx - startX) + 5) { decided = true; return; }
      if (Math.abs(cx - startX) > 5) { dragging = true; decided = true; }
      else return;
    }
    if (!dragging) return;
    e.preventDefault();
    dx = cx - startX;
    const clamped = Math.max(-110, Math.min(110, dx));
    content.style.transform = `translate3d(${clamped}px,0,0)`;
    content.style.transition = 'none';
    lbl.style.opacity = dx < -20 ? Math.min(1, (-dx-20)/40) : 0;
    rbl.style.opacity = dx >  20 ? Math.min(1, (dx-20)/40) : 0;
  }, { passive: false });

  el.addEventListener('touchend', () => {
    if (!dragging) return;
    content.style.transition = '';
    content.style.transform = '';
    lbl.style.opacity = 0; rbl.style.opacity = 0;

    if (dx < -THRESHOLD) {
      el.dataset.swiped = '1';
      deleteWithUndo(t.id);
    } else if (dx > THRESHOLD) {
      el.dataset.swiped = '1';
      const d = new Date(); d.setDate(d.getDate()+1);
      t.due = d.toISOString().split('T')[0];
      t.pinnedToday = false;
      saveLocal(); ghPush();
      showToast('deferred to tomorrow');
      render();
    }
    dx = 0; dragging = false;
  }, { passive: true });
}

function deleteWithUndo(id) {
  const backup = state.tasks.find(x => x.id === id);
  if (!backup) return;
  const saved = Object.assign({}, backup);
  state.tasks = state.tasks.filter(x => x.id !== id);
  saveLocal(); ghPush(); render();

  const toast = document.getElementById('toastUndo');
  document.getElementById('toastUndoMsg').textContent = `"${saved.title||'Task'}" deleted`;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 3500);
  document.getElementById('toastUndoBtn').onclick = () => {
    state.tasks.push(saved); saveLocal(); ghPush(); render();
    toast.classList.remove('show'); showToast('restored');
  };
}

// ══════════════════════════════════════════════════════════════════
// FILTER CHIPS
// ══════════════════════════════════════════════════════════════════

function rebuildFilterChips() {
  const row = document.getElementById('filterRow');
  if (!row) return;
  const active = state.filter || 'all';
  row.innerHTML = '';
  ['all', 'archive', 'blocked'].concat(Object.keys(CAT_LABEL)).forEach(k => {
    const c = document.createElement('div');
    c.className = 'chip' + (k === active ? ' active' : '');
    c.dataset.filter = k;
    c.textContent = CAT_LABEL[k] || k;
    row.appendChild(c);
  });
}

document.getElementById('filterRow').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#filterRow .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.filter = chip.dataset.filter;
  render();
});

// ══════════════════════════════════════════════════════════════════
// TASK SHEET
// ══════════════════════════════════════════════════════════════════

let _editId = null;

function openTaskSheet(id) {
  _editId = id || null;
  const t = id ? state.tasks.find(x => x.id === id) : null;

  document.getElementById('taskSheetTitle').value = t?.title || '';
  document.getElementById('taskSheetDue').value   = t?.due   || '';
  document.getElementById('taskSheetNote').value  = t?.note  || '';

  document.querySelectorAll('#taskSheetPriority .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === (t?.priority || 'md')));
  document.querySelectorAll('#taskSheetStatus .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === (t?.status || 'active')));
  document.querySelectorAll('#taskSheetPin .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === (t?.pinnedToday ? '1' : '0')));

  const catGrid = document.getElementById('taskSheetCats');
  catGrid.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(k => {
    const tog = document.createElement('div');
    tog.className = 'cat-toggle' + ((t?.categories||[]).includes(k) ? ' active' : '');
    tog.dataset.cat = k;
    tog.textContent = CAT_LABEL[k];
    tog.addEventListener('click', () => tog.classList.toggle('active'));
    catGrid.appendChild(tog);
  });

  document.getElementById('taskSheetDelete').style.display = t ? '' : 'none';
  document.getElementById('taskSheet').classList.add('open');
  document.getElementById('taskSheetBackdrop').classList.add('open');
}

document.querySelectorAll('.seg-control').forEach(ctrl => {
  ctrl.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    ctrl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('taskSheetSave').addEventListener('click', () => {
  const title = document.getElementById('taskSheetTitle').value.trim();
  if (!title) { showToast('add a title'); return; }
  const priority   = document.querySelector('#taskSheetPriority .seg-btn.active')?.dataset.val || 'md';
  const status     = document.querySelector('#taskSheetStatus .seg-btn.active')?.dataset.val || 'active';
  const pinnedToday = document.querySelector('#taskSheetPin .seg-btn.active')?.dataset.val === '1';
  const due        = document.getElementById('taskSheetDue').value || '';
  const note       = document.getElementById('taskSheetNote').value.trim();
  const categories = Array.from(document.querySelectorAll('#taskSheetCats .cat-toggle.active')).map(e => e.dataset.cat);

  if (_editId) {
    const t = state.tasks.find(x => x.id === _editId);
    if (t) Object.assign(t, { title, priority, status, pinnedToday, due, note, categories });
  } else {
    state.tasks.push({ id: uid(), title, priority, status, pinnedToday, due, note, categories, done: false, pomodoros: 0 });
  }
  saveLocal(); ghPush(); render();
  closeTaskSheet();
});

document.getElementById('taskSheetDelete').addEventListener('click', () => {
  if (!_editId) return;
  state.tasks = state.tasks.filter(x => x.id !== _editId);
  saveLocal(); ghPush(); render();
  closeTaskSheet();
  showToast('deleted');
});

document.getElementById('taskSheetBackdrop').addEventListener('click', closeTaskSheet);

function closeTaskSheet() {
  document.getElementById('taskSheet').classList.remove('open');
  document.getElementById('taskSheetBackdrop').classList.remove('open');
}

// ══════════════════════════════════════════════════════════════════
// FAB
// ══════════════════════════════════════════════════════════════════

document.getElementById('fab').addEventListener('click', () => {
  if (_currentView === 'notes') {
    createNewNote('memo');
  } else {
    _editId = null;
    openTaskSheet(null);
  }
});

// ══════════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════════

document.getElementById('searchTrigger').addEventListener('click', () => {
  const wrap = document.getElementById('searchWrap');
  const open = wrap.classList.toggle('open');
  if (open) document.getElementById('searchInput').focus();
  else { document.getElementById('searchInput').value = ''; render(); }
});
document.getElementById('searchInput').addEventListener('input', render);

// ══════════════════════════════════════════════════════════════════
// NOTES (full feature set, inline)
// ══════════════════════════════════════════════════════════════════

let _noteId = null;      // active note id
let _noteMdOn = false;   // markdown preview
let _noteMonoOn = false; // mono mode
let _cnFilter = 'all';
let _cnTypeFilter = 'all';
let _cnSaveTimer = null;

const PAPER_TEMPLATE = '**Summary:**\n\n\n**What I\'d challenge:**\n\n\n**What I\'d steal:**\n\n';
const NOTE_TYPES = { memo: 'note', paper: 'paper', idea: 'idea' };

// Filter chips for notes
function buildCNFilterRow() {
  const row = document.getElementById('cnFilterRow');
  if (!row) return;
  row.innerHTML = '';
  [
    { key: 'all', label: 'all' },
    { key: '_memo', label: 'notes' },
    { key: '_paper', label: 'papers' },
    { key: '_idea', label: 'ideas' },
    { key: '_pinned', label: 'pinned' },
  ].forEach(({ key, label }) => {
    const c = document.createElement('div');
    c.className = 'chip' + (key === 'all' && _cnFilter === 'all' && _cnTypeFilter === 'all' ? ' active' : '');
    c.dataset.cnkey = key;
    c.textContent = label;
    row.appendChild(c);
  });
}

document.getElementById('cnFilterRow').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#cnFilterRow .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  const k = chip.dataset.cnkey;
  if (k === 'all') { _cnFilter = 'all'; _cnTypeFilter = 'all'; }
  else if (k === '_memo')   { _cnTypeFilter = 'memo';   _cnFilter = 'all'; }
  else if (k === '_paper')  { _cnTypeFilter = 'paper';  _cnFilter = 'all'; }
  else if (k === '_idea')   { _cnTypeFilter = 'idea';   _cnFilter = 'all'; }
  else if (k === '_pinned') { _cnFilter = '_pinned'; _cnTypeFilter = 'all'; }
  renderCNList();
});

function renderCNList() {
  buildCNFilterRow();
  const list = document.getElementById('cnNotesList');
  if (!list) return;
  let notes = getCnNotes();

  // Filter
  if (_cnTypeFilter !== 'all') notes = notes.filter(n => (n.type||'memo') === _cnTypeFilter);
  if (_cnFilter === '_pinned') notes = notes.filter(n => n.pinned);

  // Sort: pinned first, then by updatedAt
  notes = notes.slice().sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.updatedAt||b.createdAt||'') > (a.updatedAt||a.createdAt||'') ? 1 : -1;
  });

  list.innerHTML = '';
  if (notes.length === 0) {
    list.innerHTML = '<div class="empty-state">no notes yet.</div>';
    return;
  }

  notes.forEach((n, i) => {
    const type = n.type || 'memo';
    const card = document.createElement('div');
    card.className = 'cn-note-card';
    card.style.animationDelay = (i * 20) + 'ms';

    const daysSince = n.updatedAt ? Math.floor((Date.now() - new Date(n.updatedAt).getTime()) / 86400000) : null;
    const stale = type === 'idea' && daysSince !== null && daysSince > 14 && n.ideaStatus !== 'ready to pitch';
    const statusText = type === 'idea' ? (n.ideaStatus || 'raw') : '';
    const isReady = n.ideaStatus === 'ready to pitch';

    card.innerHTML = `
      <div class="cn-card-header">
        <div class="cn-card-title">${n.pinned ? '· ' : ''}${esc(n.title||'Untitled')}</div>
        <div class="cn-type-badge">${stale ? '⚠ ' : ''}${NOTE_TYPES[type]||type}</div>
      </div>
      <div class="cn-card-preview">${esc((n.body||'').replace(/\n/g,' ').slice(0,120))}</div>
      <div class="cn-card-footer">
        <span class="cn-card-date">${daysSince !== null ? (daysSince === 0 ? 'today' : daysSince + 'd ago') : ''}</span>
        ${statusText ? `<span class="cn-card-status${isReady?' ready':''}">${statusText}</span>` : ''}
      </div>`;
    card.addEventListener('click', () => openNote(n.id));
    list.appendChild(card);
  });
}

function createNewNote(type) {
  const n = {
    id: uid(), title: '', body: type === 'paper' ? PAPER_TEMPLATE : '',
    type: type || 'memo', ideaStatus: type === 'idea' ? 'raw' : '',
    speaker: '', url: '', tags: [], pinned: false, locked: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const notes = getCnNotes();
  notes.unshift(n);
  setCnNotes(notes);
  saveCN(false);
  openNote(n.id);
}

function openNote(id) {
  const notes = getCnNotes();
  const n = notes.find(x => x.id === id);
  if (!n) return;

  // PIN check
  if (n.locked && localStorage.getItem('kw_notes_pin_hash')) {
    showPinOverlay('unlock note', (correct) => {
      if (correct) _doOpenNote(n);
    });
    return;
  }
  _doOpenNote(n);
}

function _doOpenNote(n) {
  _noteId = n.id;
  _noteMdOn = false;
  _noteMonoOn = n.bodyIsMono || false;

  document.getElementById('cnTitleInput').value   = n.title || '';
  document.getElementById('cnSpeakerInput').value = n.speaker || '';
  document.getElementById('cnUrlInput').value     = n.url || '';
  document.getElementById('cnBodyInput').value    = n.body || '';
  document.getElementById('cnBodyInput').className = 'cn-detail-body' + (_noteMonoOn ? ' mono' : '');
  document.getElementById('cnMdPreview').style.display = 'none';
  document.getElementById('cnBodyInput').style.display = '';
  document.getElementById('cnMdToggle').textContent = 'preview';
  document.getElementById('cnMonoToggle').textContent = _noteMonoOn ? 'mono on' : 'mono off';
  document.getElementById('cnPinToggle').textContent = n.pinned ? 'pinned' : 'pin';
  document.getElementById('cnLockToggle').style.display = localStorage.getItem('kw_notes_pin_hash') ? '' : 'none';
  document.getElementById('cnLockToggle').textContent = n.locked ? 'locked' : 'lock';

  // Type chips
  document.querySelectorAll('#cnTypeRow .cn-type-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.type === (n.type||'memo')));

  // Status row
  const statusRow = document.getElementById('cnStatusRow');
  statusRow.style.display = n.type === 'idea' ? 'flex' : 'none';
  document.querySelectorAll('#cnStatusRow .cn-status-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.status === (n.ideaStatus||'raw')));

  // URL row
  const urlRow = document.getElementById('cnUrlRow');
  urlRow.classList.toggle('visible', n.type === 'paper');
  const urlOpen = document.getElementById('cnUrlOpen');
  if (n.url) { urlOpen.href = n.url.startsWith('http') ? n.url : 'https://doi.org/' + n.url; urlOpen.style.display = ''; }
  else urlOpen.style.display = 'none';

  // Backlinks
  renderBacklinks(n.title || '');

  // Show detail
  document.getElementById('cnListView').style.display = 'none';
  document.getElementById('cnDetailView').style.display = 'flex';
  document.getElementById('cnDetailView').style.flexDirection = 'column';
}

function saveCurrentNote() {
  if (!_noteId) return;
  const notes = getCnNotes();
  const n = notes.find(x => x.id === _noteId);
  if (!n) return;
  n.title    = document.getElementById('cnTitleInput').value.trim();
  n.speaker  = document.getElementById('cnSpeakerInput').value.trim();
  n.url      = document.getElementById('cnUrlInput').value.trim();
  n.body     = document.getElementById('cnBodyInput').value;
  n.bodyIsMono = _noteMonoOn;
  n.type     = document.querySelector('#cnTypeRow .cn-type-chip.active')?.dataset.type || 'memo';
  n.ideaStatus = document.querySelector('#cnStatusRow .cn-status-chip.active')?.dataset.status || '';
  n.updatedAt = new Date().toISOString();
  saveCN(true);
}

function queueNoteSave() {
  clearTimeout(_cnSaveTimer);
  _cnSaveTimer = setTimeout(saveCurrentNote, 800);
}

function closeNote() {
  saveCurrentNote();
  _noteId = null;
  document.getElementById('cnDetailView').style.display = 'none';
  document.getElementById('cnListView').style.display = 'flex';
  renderCNList();
}

function parseWikiLinks(text) {
  const notes = getCnNotes();
  return text.replace(/\[\[(.*?)\]\]/g, (match, title) => {
    const target = notes.find(n => (n.title||'').toLowerCase() === title.toLowerCase());
    if (target) return `<a href="#" onclick="event.preventDefault(); window._openNoteById('${target.id}');" class="wiki-link">[[${title}]]</a>`;
    return `<span class="wiki-link-broken" title="Note doesn't exist yet">[[${title}]]</span>`;
  });
}
window._openNoteById = (id) => { saveCurrentNote(); openNote(id); };

function renderBacklinks(title) {
  const blSection = document.getElementById('cnBacklinks');
  const blList    = document.getElementById('cnBacklinksList');
  const blCount   = document.getElementById('cnBacklinksCount');
  if (!blSection || !blList) return;
  if (!title) { blSection.style.display = 'none'; return; }

  const pat = new RegExp('\\[\\[' + title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\]\\]','i');
  const links = getCnNotes().filter(n => n.id !== _noteId && pat.test(n.body||''));

  blSection.style.display = links.length > 0 ? '' : 'none';
  blCount.textContent = links.length > 0 ? `(${links.length})` : '';
  blList.innerHTML = '';
  blList.style.display = 'none';
  document.getElementById('cnBacklinksToggle').textContent = `backlinks ▸ ${blCount.textContent}`;

  links.forEach(n => {
    const item = document.createElement('div');
    item.className = 'cn-backlink-item';
    item.textContent = n.title || 'Untitled';
    item.addEventListener('click', () => { saveCurrentNote(); openNote(n.id); });
    blList.appendChild(item);
  });
}

// Note detail wiring
document.getElementById('cnBackBtn').addEventListener('click', closeNote);

['cnTitleInput','cnSpeakerInput','cnBodyInput','cnUrlInput'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', queueNoteSave);
});

document.getElementById('cnMdToggle').addEventListener('click', () => {
  _noteMdOn = !_noteMdOn;
  const body = document.getElementById('cnBodyInput');
  const prev = document.getElementById('cnMdPreview');
  document.getElementById('cnMdToggle').textContent = _noteMdOn ? 'edit' : 'preview';
  if (_noteMdOn) {
    const raw = body.value || '';
    const linked = parseWikiLinks(raw);
    prev.innerHTML = typeof marked !== 'undefined' ? marked.parse(linked, {breaks:true,gfm:true}) : `<pre>${esc(raw)}</pre>`;
    body.style.display = 'none'; prev.style.display = 'block';
  } else {
    prev.style.display = 'none'; body.style.display = '';
  }
});

document.getElementById('cnMonoToggle').addEventListener('click', () => {
  _noteMonoOn = !_noteMonoOn;
  document.getElementById('cnBodyInput').classList.toggle('mono', _noteMonoOn);
  document.getElementById('cnMonoToggle').textContent = _noteMonoOn ? 'mono on' : 'mono off';
  queueNoteSave();
});

document.getElementById('cnPinToggle').addEventListener('click', () => {
  const notes = getCnNotes();
  const n = notes.find(x => x.id === _noteId); if (!n) return;
  n.pinned = !n.pinned;
  document.getElementById('cnPinToggle').textContent = n.pinned ? 'pinned' : 'pin';
  saveCN(true); showToast(n.pinned ? 'pinned' : 'unpinned');
});

document.getElementById('cnLockToggle').addEventListener('click', () => {
  const notes = getCnNotes();
  const n = notes.find(x => x.id === _noteId); if (!n) return;
  if (!n.locked) {
    showPinOverlay('set pin to lock', correct => {
      if (correct) { n.locked = true; saveCN(true); document.getElementById('cnLockToggle').textContent = 'locked'; showToast('locked'); }
    });
  } else {
    showPinOverlay('unlock to remove lock', correct => {
      if (correct) { n.locked = false; saveCN(true); document.getElementById('cnLockToggle').textContent = 'lock'; showToast('unlocked'); }
    });
  }
});

document.getElementById('cnDeleteBtn').addEventListener('click', () => {
  if (!_noteId) return;
  if (!confirm('Delete this note?')) return;
  const notes = getCnNotes();
  setCnNotes(notes.filter(x => x.id !== _noteId));
  saveCN(true);
  closeNote();
  showToast('deleted');
});

document.getElementById('cnTypeRow').addEventListener('click', e => {
  const chip = e.target.closest('.cn-type-chip'); if (!chip) return;
  document.querySelectorAll('#cnTypeRow .cn-type-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  const type = chip.dataset.type;
  document.getElementById('cnStatusRow').style.display = type === 'idea' ? 'flex' : 'none';
  document.getElementById('cnUrlRow').classList.toggle('visible', type === 'paper');
  if (type === 'paper' && !document.getElementById('cnBodyInput').value.trim()) {
    document.getElementById('cnBodyInput').value = PAPER_TEMPLATE;
  }
  queueNoteSave();
});

document.getElementById('cnStatusRow').addEventListener('click', e => {
  const chip = e.target.closest('.cn-status-chip'); if (!chip) return;
  document.querySelectorAll('#cnStatusRow .cn-status-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  queueNoteSave();
});

document.getElementById('cnUrlInput').addEventListener('input', function() {
  const open = document.getElementById('cnUrlOpen');
  if (this.value.trim()) {
    const href = this.value.startsWith('http') ? this.value : 'https://doi.org/' + this.value;
    open.href = href; open.style.display = '';
  } else { open.style.display = 'none'; }
  queueNoteSave();
});

document.getElementById('cnBacklinksToggle').addEventListener('click', () => {
  const list = document.getElementById('cnBacklinksList');
  const open = list.style.display === 'none';
  list.style.display = open ? 'block' : 'none';
  document.getElementById('cnBacklinksToggle').textContent =
    (open ? 'backlinks ▾ ' : 'backlinks ▸ ') + document.getElementById('cnBacklinksCount').textContent;
});

// ══════════════════════════════════════════════════════════════════
// PIN OVERLAY
// ══════════════════════════════════════════════════════════════════

let _pinCallback = null;
let _pinBuffer = '';

function showPinOverlay(label, callback) {
  _pinCallback = callback;
  _pinBuffer = '';
  document.getElementById('pinOverlayLabel').textContent = label;
  document.querySelectorAll('#pinDots .pin-dot').forEach(d => d.classList.remove('filled'));
  document.getElementById('pinOverlay').classList.add('open');
}

document.getElementById('pinOverlay').addEventListener('click', e => {
  const key = e.target.closest('.pin-key')?.dataset.k;
  if (!key) return;
  if (key === 'cancel') { document.getElementById('pinOverlay').classList.remove('open'); _pinCallback && _pinCallback(false); return; }
  if (key === 'del') { _pinBuffer = _pinBuffer.slice(0,-1); }
  else if (_pinBuffer.length < 4) { _pinBuffer += key; }

  document.querySelectorAll('#pinDots .pin-dot').forEach((d,i) => d.classList.toggle('filled', i < _pinBuffer.length));

  if (_pinBuffer.length === 4) {
    const stored = localStorage.getItem('kw_notes_pin_hash');
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(_pinBuffer)).then(hash => {
      const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
      document.getElementById('pinOverlay').classList.remove('open');
      if (!stored || hex === stored) { _pinCallback && _pinCallback(true); }
      else { showToast('incorrect pin'); _pinCallback && _pinCallback(false); }
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// REFLECT — affect grid, habits, review
// ══════════════════════════════════════════════════════════════════

// Re-export what dashboard.js needs
function affectToColor(v, a) {
  const vn = v/4, an = a/4;
  const tl=[255,149,0],tr=[255,59,48],bl=[90,130,200],br=[48,209,88];
  const r=Math.round(tl[0]*(1-vn)*an+tr[0]*vn*an+bl[0]*(1-vn)*(1-an)+br[0]*vn*(1-an));
  const g=Math.round(tl[1]*(1-vn)*an+tr[1]*vn*an+bl[1]*(1-vn)*(1-an)+br[1]*vn*(1-an));
  const b=Math.round(tl[2]*(1-vn)*an+tr[2]*vn*an+bl[2]*(1-vn)*(1-an)+br[2]*vn*(1-an));
  return `rgb(${r},${g},${b})`;
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function getISOWeek(d) {
  const date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=date.getUTCDay()||7; date.setUTCDate(date.getUTCDate()+4-day);
  const yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1));
  return date.getUTCFullYear()+'-W'+String(Math.ceil((((date-yearStart)/86400000)+1)/7)).padStart(2,'0');
}
function getDayOfWeek() { const d=new Date().getDay(); return d===0?6:d-1; }

// Affect grid
(function() {
  const grid = document.getElementById('dAffectGrid');
  let drawing = false;
  grid.addEventListener('pointerdown', e => { drawing=true; grid.setPointerCapture(e.pointerId); handleAffect(e); });
  grid.addEventListener('pointermove', e => { if(drawing) handleAffect(e); });
  grid.addEventListener('pointerup',   () => drawing=false);
  grid.addEventListener('pointercancel',()=> drawing=false);

  function handleAffect(e) {
    const rect = grid.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX-rect.left)/rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY-rect.top)/rect.height));
    const v = Math.round(x*4), a = Math.round((1-y)*4);
    const ds = getDState();
    if (!ds.affect) ds.affect = {};
    const today = getTodayStr(), now = new Date().toISOString();
    if (!ds.affect[today]) ds.affect[today] = [];
    if (!Array.isArray(ds.affect[today])) ds.affect[today]=[ds.affect[today]];
    const entries = ds.affect[today];
    const latest = entries[entries.length-1];
    const shouldAppend = !latest || !latest.t || (Date.now()-new Date(latest.t).getTime())>=2*3600*1000;
    if (shouldAppend) entries.push({v,a,ctx:null,t:now});
    else { entries[entries.length-1].v=v; entries[entries.length-1].a=a; entries[entries.length-1].t=now; }
    saveDash(true);
    renderAffectUI();
  }
})();

function renderAffectUI() {
  const ds = getDState();
  if (!ds.affect) ds.affect = {};
  const today = getTodayStr();
  const entries = Array.isArray(ds.affect[today]) ? ds.affect[today] : (ds.affect[today]?[ds.affect[today]]:[]);
  const latest = entries[entries.length-1] || null;

  const dot = document.getElementById('dAffectDot');
  if (latest) {
    dot.style.left = (6+(latest.v/4)*88)+'%';
    dot.style.top  = (6+((1-latest.a/4))*88)+'%';
    dot.style.background = affectToColor(latest.v, latest.a);
    dot.classList.add('placed');
    const vL=['rough','low','neutral','okay','good'], aL=['drained','low','moderate','alert','wired'];
    document.getElementById('dAffectStatus').textContent = vL[latest.v]+' · '+aL[latest.a]+(entries.length>1?' · '+entries.length+' logs':'');
  } else {
    dot.classList.remove('placed');
    document.getElementById('dAffectStatus').textContent = 'tap to log';
  }

  // History strip (14 days)
  const hist = document.getElementById('dAffectHistory');
  hist.innerHTML = '';
  for (let i=13; i>=0; i--) {
    const d=new Date(); d.setDate(d.getDate()-i);
    const dStr=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const arr=Array.isArray(ds.affect[dStr])?ds.affect[dStr]:(ds.affect[dStr]?[ds.affect[dStr]]:[]);
    const ae=arr[arr.length-1]||null;
    const dot=document.createElement('div');
    dot.className='affect-mini-dot'+(dStr===today?' today':'');
    dot.style.background = ae ? affectToColor(ae.v,ae.a) : 'var(--border-strong)';
    dot.style.outline = dStr===today ? '1.5px solid var(--text-tertiary)' : 'none';
    dot.style.outlineOffset = '1px';
    hist.appendChild(dot);
  }
}

function renderHabitsUI() {
  const ds = getDState();
  const week = getISOWeek(new Date());
  const todayDow = getDayOfWeek();
  if (!ds.habits) ds.habits = {};
  if (!ds.habits[week]) ds.habits[week] = {};

  const habits = getHabits();
  habits.forEach(h => { if (!ds.habits[week][h.id]) ds.habits[week][h.id] = [false,false,false,false,false,false,false]; });

  const container = document.getElementById('dHabits');
  container.innerHTML = '';
  habits.forEach(h => {
    const checks = ds.habits[week][h.id] || [];
    const scheduleDays = h.days || [0,1,2,3,4,5,6];
    const isScheduled = scheduleDays.includes(todayDow);
    const isDone = checks[todayDow];

    // streak
    let streak = 0;
    for (let i=todayDow-1; i>=0; i--) {
      if (!scheduleDays.includes(i)) continue;
      if (checks[i]) streak++; else break;
    }
    if (isDone) streak++;

    const row = document.createElement('div');
    row.className = 'habit-row';
    row.innerHTML = `
      <span class="habit-name">${esc(h.label)}</span>
      <div style="display:flex; align-items:center; gap:6px;">
        ${streak>1&&!h.bad?`<span class="habit-streak">${streak}d</span>`:''}
        <div class="habit-check${isDone?' done':''}" style="opacity:${isScheduled?1:0.3};">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>`;
    if (isScheduled) {
      row.querySelector('.habit-check').addEventListener('click', () => {
        const ds2 = getDState();
        if (!ds2.habits[week][h.id]) ds2.habits[week][h.id]=[false,false,false,false,false,false,false];
        ds2.habits[week][h.id][todayDow] = !ds2.habits[week][h.id][todayDow];
        saveDash(true); ghPush(); renderHabitsUI();
      });
    }
    container.appendChild(row);
  });
}

// Reflect seg control
document.getElementById('reflectSegToday').addEventListener('click', () => {
  document.getElementById('reflectTodayPane').style.display = '';
  document.getElementById('reflectReviewPane').style.display = 'none';
  document.getElementById('reflectSegToday').classList.add('active');
  document.getElementById('reflectSegReview').classList.remove('active');
});
document.getElementById('reflectSegReview').addEventListener('click', () => {
  document.getElementById('reflectTodayPane').style.display = 'none';
  document.getElementById('reflectReviewPane').style.display = '';
  document.getElementById('reflectSegToday').classList.remove('active');
  document.getElementById('reflectSegReview').classList.add('active');
  onTimelineEnter();
});

// ══════════════════════════════════════════════════════════════════
// BEL — anniversary date inline
// ══════════════════════════════════════════════════════════════════

document.getElementById('belAnnivInput').addEventListener('change', function() {
  const bs = getBelState();
  bs.annivDate = this.value;
  saveBel(true);
  updateBelTime();
});

function updateBelTime() {
  const bs = getBelState();
  const countEl = document.getElementById('belTimeCount');
  const annivEl = document.getElementById('belNextAnniv');
  if (!bs || !bs.annivDate) { if(countEl) countEl.textContent='--'; if(annivEl) annivEl.textContent=''; return; }
  const start = new Date(bs.annivDate+'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  let yrs=now.getFullYear()-start.getFullYear(), mos=now.getMonth()-start.getMonth(), days=now.getDate()-start.getDate();
  if(days<0){mos--;const pm=new Date(now.getFullYear(),now.getMonth(),0);days+=pm.getDate();}
  if(mos<0){yrs--;mos+=12;}
  const str=[];
  if(yrs>0)str.push(yrs+'y');
  if(mos>0)str.push(mos+'m');
  str.push(days+'d');
  if(countEl) countEl.textContent=str.join(' ');
  const next=new Date(start); next.setFullYear(now.getFullYear());
  if(next<now) next.setFullYear(now.getFullYear()+1);
  const diff=Math.round((next-now)/86400000);
  if(annivEl) annivEl.textContent = diff===0?'happy anniversary ❤️':diff+' days until next anniversary';
  // Sync input
  const inp = document.getElementById('belAnnivInput');
  if (inp && !inp.value) inp.value = bs.annivDate;
}

// ══════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════

function applyTheme(name) {
  document.body.classList.remove('theme-light','theme-dark');
  if (name==='dark') document.body.classList.add('theme-dark');
  else if (name==='light') document.body.classList.add('theme-light');
  document.querySelectorAll('.theme-option').forEach(el => el.classList.toggle('active', el.dataset.theme===name));
  try { localStorage.setItem(KEYS.theme, name); } catch(e) {}
  // Re-apply view class that className wipe removed
  document.body.classList.add(_currentView+'-mode');
}

function loadTheme() {
  let t='auto'; try { t=localStorage.getItem(KEYS.theme)||'auto'; } catch(e){}
  if(['aurora','neon','ios-dark'].includes(t)) t='dark';
  else if(['halcyon','newsprint','ios26','bel-bel'].includes(t)) t='light';
  applyTheme(t);
}

document.getElementById('themeToggle').addEventListener('click', e => {
  const opt = e.target.closest('.theme-option'); if(!opt) return;
  applyTheme(opt.dataset.theme);
});

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════

function loadSettingsUI() {
  document.getElementById('ghUser').value  = state.settings.ghUser  || '';
  document.getElementById('ghRepo').value  = state.settings.ghRepo  || '';
  document.getElementById('ghToken').value = state.settings.ghToken || '';
  const connected = !!state.settings.ghToken && !!state.settings.ghUser;
  const statusEl = document.getElementById('ghStatus');
  statusEl.textContent = connected ? `connected: ${state.settings.ghUser}/${state.settings.ghRepo}` : 'not connected';
  statusEl.className = 'settings-status' + (connected ? ' connected' : '');
  loadHabitsUI();
  updatePinUI();
  try {
    const t = localStorage.getItem(KEYS.theme)||'auto';
    document.querySelectorAll('.theme-option').forEach(el=>el.classList.toggle('active',el.dataset.theme===t));
  } catch(e){}
}

document.getElementById('settingsBtn').addEventListener('click', () => {
  loadSettingsUI();
  document.getElementById('settingsSheet').classList.add('open');
});
document.getElementById('settingsClose').addEventListener('click', () => {
  _saveHabitsFromUI();
  document.getElementById('settingsSheet').classList.remove('open');
});

document.getElementById('saveGhBtn').addEventListener('click', () => {
  const u=document.getElementById('ghUser').value.trim();
  const r=document.getElementById('ghRepo').value.trim();
  const t=document.getElementById('ghToken').value.trim();
  Object.assign(state.settings, {ghUser:u,ghRepo:r,ghToken:t});
  saveSettings();
  document.getElementById('saveGhBtn').textContent='testing…';
  testGhConnection().then(ok => {
    document.getElementById('saveGhBtn').textContent='save & test connection';
    if(ok){loadSettingsUI();showToast('connected!');state.sha=null;ghFetch();}
    else{showToast('connection failed');}
  });
});

document.getElementById('clearDataBtn').addEventListener('click', () => {
  if(!confirm('Clear all local data?')) return;
  localStorage.clear(); location.reload();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob=new Blob([JSON.stringify(buildSyncPayload(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='tasks-'+getTodayStr()+'.json'; a.click();
});

// Habits settings
function loadHabitsUI() {
  const c = document.getElementById('habitSettingsList'); if(!c) return;
  c.innerHTML='';
  getHabits().forEach(h => {
    const row=document.createElement('div'); row.className='habit-settings-row';
    row.innerHTML=`<span style="flex:1;font-size:14px;">${esc(h.label)}</span><span class="habit-del" data-id="${esc(h.id)}">remove</span>`;
    row.querySelector('.habit-del').addEventListener('click',()=>{
      const habits=getHabits().filter(x=>x.id!==h.id); updateHabits(habits); loadHabitsUI(); renderHabitsUI();
    });
    c.appendChild(row);
  });
}

document.getElementById('addHabitBtn').addEventListener('click', () => {
  const inp=document.getElementById('newHabitInput');
  const label=inp.value.trim(); if(!label) return;
  const id=label.toLowerCase().replace(/\s+/g,'_');
  const habits=getHabits(); habits.push({id,label,bad:false,days:[0,1,2,3,4,5,6]});
  updateHabits(habits); loadHabitsUI(); renderHabitsUI(); inp.value='';
});

function _saveHabitsFromUI() { /* habits saved immediately */ }

// PIN settings
function updatePinUI() {
  const has=!!localStorage.getItem('kw_notes_pin_hash');
  const saveBtn=document.getElementById('savePinBtn');
  const clearBtn=document.getElementById('clearPinBtn');
  if(saveBtn) saveBtn.textContent=has?'update pin':'save pin';
  if(clearBtn) clearBtn.style.display=has?'':'none';
}

document.getElementById('savePinBtn').addEventListener('click', () => {
  const pin=['pinD0','pinD1','pinD2','pinD3'].map(id=>document.getElementById(id).value).join('');
  if(!/^\d{4}$/.test(pin)){showToast('enter 4 digits');return;}
  crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin)).then(hash=>{
    localStorage.setItem('kw_notes_pin_hash',Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join(''));
    updatePinUI(); showToast('pin saved');
  });
});

document.getElementById('clearPinBtn').addEventListener('click', () => {
  localStorage.removeItem('kw_notes_pin_hash');
  ['pinD0','pinD1','pinD2','pinD3'].forEach(id=>{document.getElementById(id).value='';});
  updatePinUI(); showToast('pin cleared');
});

// ══════════════════════════════════════════════════════════════════
// SYNC — data-pulled event
// ══════════════════════════════════════════════════════════════════

on('data-pulled', () => {
  rebuildFilterChips();
  if (_currentView==='tasks')   render();
  if (_currentView==='notes')   renderCNList();
  if (_currentView==='reflect') { renderAffectUI(); renderHabitsUI(); }
  if (_currentView==='bel')     renderBel();
  updateBelTime();
});

on('request-sync', () => ghPush());

// ══════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════

loadLocal();
loadTheme();
initTimeline();
initBel();
rebuildFilterChips();
buildCNFilterRow();
updateBelTime();
renderAffectUI();
renderHabitsUI();
switchView('tasks');
if (state.settings.ghToken) ghFetch();
