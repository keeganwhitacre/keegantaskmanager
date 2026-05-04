// ══════════════════════════════════════════════════════════════════
// ROUTER MODULE — declarative view switching
// ══════════════════════════════════════════════════════════════════

import { emit } from './state.js';

const views = {
  tasks:            { bodyClasses: [],                                   onEnter: null, onExit: null },
  reflect:          { bodyClasses: ['reflect-mode'],                     onEnter: null, onExit: null },
  projects:         { bodyClasses: ['projects-mode'],                    onEnter: null, onExit: null },
  'projects-detail': { bodyClasses: ['projects-mode', 'projects-detail-mode'], onEnter: null, onExit: null },
  notes:            { bodyClasses: ['notes-mode'],                       onEnter: null, onExit: null },
  bel:              { bodyClasses: ['bel-mode'],                         onEnter: null, onExit: null },
};

const ALL_CLASSES = ['reflect-mode', 'projects-mode', 'projects-detail-mode', 'notes-mode', 'bel-mode'];

let currentView = 'tasks';

function register(viewName, { onEnter, onExit } = {}) {
  if (!views[viewName]) { console.warn('[router] Unknown view:', viewName); return; }
  if (onEnter) views[viewName].onEnter = onEnter;
  if (onExit)  views[viewName].onExit  = onExit;
}

function switchView(viewName) {
  if (!views[viewName]) { console.warn('[router] Unknown view:', viewName); return; }

  const prev = currentView;
  if (prev === viewName) return;

  if (views[prev] && views[prev].onExit) views[prev].onExit();

  ALL_CLASSES.forEach(cls => document.body.classList.remove(cls));
  const view = views[viewName];
  view.bodyClasses.forEach(cls => document.body.classList.add(cls));
  currentView = viewName;

  // Update tab bar
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabMap = { tasks: 'tabTasks', projects: 'tabProjects', 'projects-detail': 'tabProjects', reflect: 'tabReflect', notes: 'tabNotes' };
  const tabId = tabMap[viewName];
  if (tabId) { const btn = document.getElementById(tabId); if (btn) btn.classList.add('active'); }

  // Slide tab pill indicator (Aurora / Halcyon only)
  _updatePill('.tab-bar', '.tab-btn.active');

  if (view.onEnter) view.onEnter();

  emit('view-changed', { from: prev, to: viewName });
}

function currentViewName() { return currentView; }

// ── Sliding pill indicator (REVERTED TO ORIGINAL) ──
function _updatePill(containerSel, activeSel) {
  var container = document.querySelector(containerSel);
  if (!container || !container.classList.contains('has-sliding-pill')) return;
  var active = container.querySelector(activeSel);
  if (!active) return;

  var pill = container.querySelector('.sliding-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'sliding-pill';
    container.insertBefore(pill, container.firstChild);
  }

  // Measure relative to container padding box
  var cRect = container.getBoundingClientRect();
  var aRect = active.getBoundingClientRect();
  pill.style.transform = 'translateX(' + (aRect.left - cRect.left) + 'px)';
  pill.style.width = aRect.width + 'px';
}

function updateReflectPill() {
  _updatePill('.reflect-seg', '.reflect-seg-btn.active');
}

window.addEventListener('resize', function() {
  _updatePill('.tab-bar', '.tab-btn.active');
  _updatePill('.reflect-seg', '.reflect-seg-btn.active');
});

export { register, switchView, currentViewName, updateReflectPill };
