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

  // Animate incoming view content smoothly using transform/opacity
  const viewElMap = {
    tasks: 'taskList',
    reflect: 'reflectView',
    projects: 'projectsView',
    'projects-detail': 'projectDetailView',
    notes: 'confNotesView',
    bel: 'belView',
  };
  const elId = viewElMap[viewName];
  if (elId) {
    const el = document.getElementById(elId);
    if (el) {
      el.classList.remove('view-enter'); 
      // Force reflow to restart animation reliably
      void el.offsetWidth;
      el.classList.add('view-enter');
      el.addEventListener('animationend', function handler() { 
          el.classList.remove('view-enter'); 
          el.removeEventListener('animationend', handler); 
      });
    }
  }

  emit('view-changed', { from: prev, to: viewName });
}

function currentViewName() { return currentView; }

// ── Sliding pill indicator ──
// Measures the active button and positions a pseudo-element pill behind it.
function _updatePill(containerSel, activeSel) {
  var container = document.querySelector(containerSel);
  if (!container || !container.classList.contains('has-sliding-pill')) return;
  var active = container.querySelector(activeSel);
  if (!active) return;

  var pill = container.querySelector('.sliding-pill');
  var isNew = false;
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'sliding-pill';
    container.insertBefore(pill, container.firstChild);
    isNew = true;
  }

  // Measure relative to container padding box
  var cRect = container.getBoundingClientRect();
  var aRect = active.getBoundingClientRect();
  var left = aRect.left - cRect.left;
  var width = aRect.width;

  if (isNew) {
    // Snap to position without transition to avoid fly-in bug
    pill.style.transition = 'none';
    pill.style.transform = 'translateX(' + left + 'px)';
    pill.style.width = width + 'px';
    void pill.offsetWidth; // Force reflow
    
    // Clear inline transition so the CSS stylesheet handles the smooth easing
    pill.style.transition = '';
  } else {
    // Clear any inline transition and apply standard transform
    pill.style.transition = '';
    pill.style.transform = 'translateX(' + left + 'px)';
    pill.style.width = width + 'px';
  }
}

function updateReflectPill() {
  _updatePill('.reflect-seg', '.reflect-seg-btn.active');
}

function updateAllPills() {
  _updatePill('.tab-bar', '.tab-btn.active');
  _updatePill('.reflect-seg', '.reflect-seg-btn.active');
}

// Use ResizeObserver for perfect pill sizing on font-loads and orientation changes
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    document.querySelectorAll('.sliding-pill').forEach(p => p.style.transition = 'none');
    updateAllPills();
    requestAnimationFrame(() => {
      document.querySelectorAll('.sliding-pill').forEach(p => p.style.transition = '');
    });
  });
  
  // Delay observation slightly to ensure elements exist
  setTimeout(() => {
    const tb = document.querySelector('.tab-bar');
    const rs = document.querySelector('.reflect-seg');
    if (tb) ro.observe(tb);
    if (rs) ro.observe(rs);
  }, 0);
} else {
  // Fallback for older browsers
  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    document.querySelectorAll('.sliding-pill').forEach(p => p.style.transition = 'none');
    _resizeTimer = setTimeout(updateAllPills, 60);
  });
}

export { register, switchView, currentViewName, updateReflectPill, updateAllPills };
