// ══════════════════════════════════════════════════════════════════
// DESKTOP SHELL MODULE (v2)
// Manages the labeled sidebar AND the right-hand dashboard pane on
// desktop (≥900px). Mobile is untouched.
//
// LAYOUT ON DESKTOP (tasks view):
//   [ 240 sidebar ] [ tasks list ] [ dashboard pane ]
//
// LAYOUT ON DESKTOP (notes view): sidebar + notes-split (existing)
// LAYOUT ON DESKTOP (reflect view): sidebar + reflect content
//
// All sidebar clicks route through existing app.js handlers — no
// duplicated state logic. Dashboard rebuilds on every render().
// ══════════════════════════════════════════════════════════════════

import { state, CAT_LABEL, on, esc } from './state.js';
import { switchView, currentViewName } from './router.js';

const VIEW_NAV = [
  { key: 'tasks',   label: 'Tasks',
    svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>' },
  { key: 'reflect', label: 'Reflect',
    svg: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>' },
  { key: 'notes',   label: 'Notes',
    svg: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
];

// Default filters per user request: All / Today / Archive
const STATIC_FILTERS = [
  { key: 'all',     label: 'All tasks',
    svg: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>' },
  { key: 'today',   label: 'Today',
    svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  { key: 'archive', label: 'Archive',
    svg: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>' },
];

let _sidebarEl = null;
let _dashboardEl = null;
let _initialized = false;

// ── INIT ──────────────────────────────────────────────────────────
function initDesktopShell() {
  if (_initialized) return;
  _initialized = true;

  mountSidebar();
  mountDashboard();
  wireGlobalEvents();
  refreshAll();

  refreshCounts();
  refreshActiveStates();
}

function mountSidebar() {
  _sidebarEl = document.createElement('aside');
  _sidebarEl.className = 'desktop-sidebar';
  _sidebarEl.id = 'desktopSidebar';
  _sidebarEl.innerHTML = `
    <div class="ds-brand">Tasks</div>

    <button class="ds-quick-add" id="dsQuickAdd">
      <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>New task</span>
    </button>

    <div class="ds-section-label">Views</div>
    <div id="dsViewNav"></div>

    <div class="ds-section-label">Filters</div>
    <div id="dsFilterNav"></div>

    <div class="ds-section-label">Categories</div>
    <div id="dsCatNav"></div>

    <div class="ds-spacer"></div>

    <div class="ds-bottom">
      <button class="ds-icon-row" id="dsSyncBtn" title="Sync with Gist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        <span>Sync</span>
        <span class="ds-sync-dot" id="dsSyncDot"></span>
      </button>
      <button class="ds-icon-row" id="dsSettingsBtn" title="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>Settings</span>
      </button>
    </div>
  `;
  document.body.insertBefore(_sidebarEl, document.body.firstChild);

  document.getElementById('dsQuickAdd').addEventListener('click', () => {
    if (currentViewName() !== 'tasks') switchView('tasks');
    const trig = document.getElementById('quickAddFullBtn');
    if (trig) trig.click();
  });
  document.getElementById('dsSettingsBtn').addEventListener('click', () => {
    const btn = document.getElementById('settingsBtn') || document.getElementById('dockSettingsBtn');
    if (btn) btn.click();
  });
  document.getElementById('dsSyncBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.click();
  });

  buildViewNav();
  buildFilterNav();
  buildCategoryNav();
  observeSyncStatus();
}

function mountDashboard() {
  _dashboardEl = document.createElement('section');
  _dashboardEl.className = 'desktop-dashboard';
  _dashboardEl.id = 'desktopDashboard';
  _dashboardEl.innerHTML = `<div class="dd-inner" id="ddInner"></div>`;
  document.body.appendChild(_dashboardEl);
}

function wireGlobalEvents() {
  on('view-changed', () => { refreshActiveStates(); renderDashboard(); });
  on('task-changed', () => { refreshCounts(); renderDashboard();});
  on('data-pulled',  () => { buildCategoryNav(); refreshCounts(); renderDashboard(); });

  // Observe taskList rebuilds so the dashboard stays in sync with the
  // main list (filter changes, deletions, etc.)
  const setupObs = () => {
    const list = document.getElementById('taskList');
    if (!list) return;
    new MutationObserver(() => {
      refreshActiveStates();
      renderDashboard();
    }).observe(list, { childList: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObs);
  } else {
    setupObs();
  }
}

// ── BUILDERS ──────────────────────────────────────────────────────
function buildViewNav() {
  const wrap = document.getElementById('dsViewNav');
  if (!wrap) return;
  wrap.innerHTML = '';
  VIEW_NAV.forEach(item => {
    wrap.appendChild(makeNavButton({
      label: item.label, svg: item.svg,
      onClick: () => switchView(item.key),
      dataKey: item.key, kind: 'view',
    }));
  });
}

function buildFilterNav() {
  const wrap = document.getElementById('dsFilterNav');
  if (!wrap) return;
  wrap.innerHTML = '';
  STATIC_FILTERS.forEach(item => {
    wrap.appendChild(makeNavButton({
      label: item.label, svg: item.svg,
      onClick: () => applyFilter(item.key),
      dataKey: item.key, kind: 'filter',
    }));
  });
}

function buildCategoryNav() {
  const wrap = document.getElementById('dsCatNav');
  if (!wrap) return;
  wrap.innerHTML = '';
  Object.keys(CAT_LABEL).forEach(key => {
    wrap.appendChild(makeNavButton({
      label: CAT_LABEL[key],
      dot: 'cat-' + key.replace(/[^a-z0-9_-]/g, '_'),
      onClick: () => applyFilter(key),
      dataKey: key, kind: 'category',
    }));
  });
  refreshCounts();
}

function makeNavButton({ label, svg, dot, onClick, dataKey, kind }) {
  const btn = document.createElement('button');
  btn.className = 'ds-nav-btn';
  btn.dataset.dsKey = dataKey;
  btn.dataset.dsKind = kind;
  const iconHtml = dot
    ? `<span class="ds-cat-dot ${dot}"></span>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
  btn.innerHTML = `${iconHtml}<span class="ds-nav-label">${esc(label)}</span><span class="ds-count" data-count-for="${dataKey}"></span>`;
  btn.addEventListener('click', onClick);
  return btn;
}

// ── FILTER ROUTING ────────────────────────────────────────────────
// For existing chip filters, synthesize a click on the hidden chip so
// the existing "click twice to exclude" logic in app.js fires unchanged.
// For 'today' (no existing chip), set state directly and do a DOM-level
// filter pass after render.
function applyFilter(key) {
  if (currentViewName() !== 'tasks') switchView('tasks');

  if (key === 'today') {
    state.filter = 'today';
    state.filterExclude = false;
    document.querySelectorAll('#filterRow .chip').forEach(c =>
      c.classList.remove('active', 'exclude-active')
    );
    if (typeof window.render === 'function') window.render();
    refreshActiveStates();
    renderDashboard();
    return;
  }

  const chip = document.querySelector(`.filter-scroll [data-filter="${key}"]`);
  if (chip) {
    chip.click(); // preserves double-click-exclude behavior
  } else {
    state.filter = key;
    if (typeof window.render === 'function') window.render();
  }
  refreshActiveStates();
  renderDashboard();
}

// ── COUNTS ────────────────────────────────────────────────────────
function refreshCounts() {
  if (!_sidebarEl) return;
  const tasks = state.tasks || [];
  const open = tasks.filter(t => !t.done);

  const counts = {
    all: open.length,
    today: open.filter(isToday).length,
    archive: tasks.filter(t => t.done).length,
  };
  Object.keys(CAT_LABEL).forEach(cat => {
    counts[cat] = open.filter(t => (t.categories || []).includes(cat)).length;
  });

  _sidebarEl.querySelectorAll('[data-count-for]').forEach(el => {
    const key = el.dataset.countFor;
    const n = counts[key];
    if (n == null) { el.textContent = ''; return; }
    // Always show count for "all"; hide zeros elsewhere
    if (key === 'all') el.textContent = String(n);
    else if (n === 0) el.textContent = '';
    else el.textContent = String(n);
  });
}

function isToday(t) {
  if (t.done) return false;
  if (t.pinnedToday) return true;
  if (!t.due) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(t.due + 'T00:00:00');
  if (isNaN(d)) return false;
  return Math.round((d - today) / 86400000) === 0;
}

function isOverdue(t) {
  if (t.done || !t.due) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(t.due + 'T00:00:00');
  if (isNaN(d)) return false;
  return Math.round((d - today) / 86400000) < 0;
}

// ── ACTIVE STATES ─────────────────────────────────────────────────
function refreshActiveStates() {
  if (!_sidebarEl) return;
  const view = currentViewName();
  const filter = state.filter || 'all';
  const excluded = !!state.filterExclude;

  _sidebarEl.querySelectorAll('.ds-nav-btn').forEach(btn => {
    btn.classList.remove('active', 'exclude-active');
  });

  const viewBtn = _sidebarEl.querySelector(`.ds-nav-btn[data-ds-kind="view"][data-ds-key="${view}"]`);
  if (viewBtn) viewBtn.classList.add('active');

  if (view === 'tasks') {
    const filterBtn = _sidebarEl.querySelector(`.ds-nav-btn[data-ds-key="${filter}"]:not([data-ds-kind="view"])`);
    if (filterBtn) {
      filterBtn.classList.add('active');
      if (excluded) filterBtn.classList.add('exclude-active');
    }
  }
}

// ── TODAY DOM-FILTER PASS ─────────────────────────────────────────
// app.js's filterTask doesn't know about 'today'. After it renders,
// we hide rows that aren't today-tasks.

// ── DASHBOARD PANE ────────────────────────────────────────────────
function renderDashboard() {
  if (!_dashboardEl) return;
  const inner = document.getElementById('ddInner');
  if (!inner) return;
  if (currentViewName() !== 'tasks') return; // hidden via CSS in other views

  const tasks = state.tasks || [];
  const open = tasks.filter(t => !t.done);
  const today = open.filter(isToday);
  const overdue = open.filter(isOverdue);

  const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const upcoming = open.filter(t => {
    if (!t.due || isToday(t) || isOverdue(t)) return false;
    const d = new Date(t.due + 'T00:00:00');
    if (isNaN(d)) return false;
    const diff = (d - todayMs) / 86400000;
    return diff > 0 && diff <= 7;
  }).sort((a, b) => a.due.localeCompare(b.due));

  const recent = tasks.filter(t => t.done && t.completedAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, 5);

  const byCat = {};
  Object.keys(CAT_LABEL).forEach(k => { byCat[k] = 0; });
  open.forEach(t => (t.categories || []).forEach(c => {
    if (byCat[c] != null) byCat[c]++;
  }));
  const byCatSorted = Object.entries(byCat)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...byCatSorted.map(([, n]) => n));

  inner.innerHTML = `
    <div class="dd-eyebrow">Overview</div>
    <div class="dd-title">${dashboardGreeting()}</div>
    <div class="dd-sub">${open.length} open · ${today.length} for today${overdue.length ? ` · <span style="color:var(--danger)">${overdue.length} overdue</span>` : ''}</div>

    <div class="dd-stats">
      <div class="dd-stat" data-stat-jump="today">
        <div class="dd-stat-val">${today.length}</div>
        <div class="dd-stat-lbl">Today</div>
      </div>
      <div class="dd-stat ${overdue.length ? 'is-danger' : ''}">
        <div class="dd-stat-val">${overdue.length}</div>
        <div class="dd-stat-lbl">Overdue</div>
      </div>
      <div class="dd-stat">
        <div class="dd-stat-val">${upcoming.length}</div>
        <div class="dd-stat-lbl">Next 7d</div>
      </div>
      <div class="dd-stat" data-stat-jump="all">
        <div class="dd-stat-val">${open.length}</div>
        <div class="dd-stat-lbl">All open</div>
      </div>
    </div>

    ${today.length ? `
      <div class="dd-block-label">Today's focus</div>
      <div class="dd-card-list">
        ${today.slice(0, 4).map(t => taskMini(t)).join('')}
      </div>
    ` : ''}

    ${upcoming.length ? `
      <div class="dd-block-label">Next 7 days</div>
      <div class="dd-card-list">
        ${upcoming.slice(0, 5).map(t => taskMini(t)).join('')}
      </div>
    ` : ''}

    ${byCatSorted.length ? `
      <div class="dd-block-label">By category</div>
      <div class="dd-bars">
        ${byCatSorted.map(([cat, n]) => `
          <button class="dd-bar-row" data-bar-cat="${cat}">
            <span class="ds-cat-dot cat-${cat.replace(/[^a-z0-9_-]/g, '_')}" style="width:8px;height:8px;margin:0 6px 0 0;"></span>
            <span class="dd-bar-label">${esc(CAT_LABEL[cat] || cat)}</span>
            <span class="dd-bar-track"><span class="dd-bar-fill" style="width:${(n / maxCat * 100).toFixed(0)}%"></span></span>
            <span class="dd-bar-num">${n}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}

    ${recent.length ? `
      <div class="dd-block-label">Recently completed</div>
      <div class="dd-recent">
        ${recent.map(t => `
          <div class="dd-recent-row">
            <div class="dd-recent-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="dd-recent-body">
              <div class="dd-recent-title">${esc(t.title)}</div>
              <div class="dd-recent-meta">${fmtAgo(t.completedAt)}${(t.categories||[]).length ? ' · ' + esc(CAT_LABEL[t.categories[0]] || t.categories[0]) : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${!today.length && !upcoming.length && !overdue.length ? `
      <div class="dd-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        <div class="dd-empty-title">Clear runway</div>
        <div class="dd-empty-sub">Nothing pending in the next week. Good time to plan.</div>
      </div>
    ` : ''}
  `;

  inner.querySelectorAll('[data-bar-cat]').forEach(el => {
    el.addEventListener('click', () => applyFilter(el.dataset.barCat));
  });
  inner.querySelectorAll('[data-stat-jump]').forEach(el => {
    el.addEventListener('click', () => applyFilter(el.dataset.statJump));
  });
  inner.querySelectorAll('[data-mini-task]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.miniTask;
      const row = document.querySelector(`.task[data-id="${id}"]`);
      if (row) row.click();
      else if (typeof window.openEdit === 'function') window.openEdit(id);
    });
  });
}

function taskMini(t) {
  const cats = (t.categories || []).slice(0, 3);
  const catDots = cats.map(c =>
    `<span class="ds-cat-dot cat-${c.replace(/[^a-z0-9_-]/g, '_')}" style="width:6px;height:6px;margin:0 2px 0 0;box-shadow:none;"></span>`
  ).join('');
  const dueLbl = isOverdue(t)
    ? fmtDueShort(t.due)
    : (t.due ? fmtDueShort(t.due) : (t.pinnedToday ? 'pinned' : ''));
  const overdueCls = isOverdue(t) ? ' is-overdue' : '';
  return `
    <button class="dd-task-mini${overdueCls}" data-mini-task="${t.id}">
      <span class="dd-task-mini-cb"></span>
      <span class="dd-task-mini-body">
        <span class="dd-task-mini-title">${esc(t.title)}</span>
        <span class="dd-task-mini-meta">${catDots}${dueLbl ? `<span class="dd-task-mini-due">${esc(dueLbl)}</span>` : ''}</span>
      </span>
    </button>
  `;
}

function fmtDueShort(due) {
  if (!due) return '';
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return Math.abs(diff) + 'd ago';
  if (diff <= 7) return diff + 'd';
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return m[d.getMonth()] + ' ' + d.getDate();
}

function fmtAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return Math.floor(days / 7) + 'w ago';
}

function dashboardGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Tonight';
}

// ── SYNC STATUS MIRROR ────────────────────────────────────────────
function observeSyncStatus() {
  const syncBar = document.getElementById('syncBar');
  const dot = document.getElementById('dsSyncDot');
  if (!syncBar || !dot) return;
  const update = () => {
    const inner = syncBar.querySelector('.sync-dot');
    const cls = inner ? inner.className : '';
    dot.className = 'ds-sync-dot ' + (cls.includes('syncing') ? 'syncing' : cls.includes('ok') ? 'ok' : cls.includes('err') ? 'err' : '');
  };
  new MutationObserver(update).observe(syncBar, { attributes: true, childList: true, subtree: true });
  update();
}

function refreshAll() {
  refreshCounts();
  refreshActiveStates();
  renderDashboard();
}


// Export buildCategoryNav so app.js can call it after category save
export { initDesktopShell, buildCategoryNav, refreshAll, refreshCounts };