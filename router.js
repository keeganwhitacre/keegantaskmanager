// ══════════════════════════════════════════════════════════════════
// ROUTER MODULE — declarative view switching
// Replaces the body-class + hide-in-* system with a single
// switchView() call. CSS rules in styles.css remain the same
// for now (we still toggle body classes), but the logic is
// centralized and each view's enter/exit behavior is declared.
// ══════════════════════════════════════════════════════════════════

import { emit } from './state.js';

// ── VIEW REGISTRY ──
// Each view declares:
//   bodyClasses: classes to add to <body>
//   onEnter:     called when switching TO this view (optional)
//   onExit:      called when switching AWAY from this view (optional)
//
// Callbacks are registered lazily by domain modules via router.register().

const views = {
  tasks:            { bodyClasses: [],                                   onEnter: null, onExit: null },
  dash:             { bodyClasses: ['dash-mode'],                        onEnter: null, onExit: null },
  projects:         { bodyClasses: ['projects-mode'],                    onEnter: null, onExit: null },
  'projects-detail': { bodyClasses: ['projects-mode', 'projects-detail-mode'], onEnter: null, onExit: null },
  bel:              { bodyClasses: ['bel-mode'],                         onEnter: null, onExit: null },
  confnotes:        { bodyClasses: ['confnotes-mode'],                   onEnter: null, onExit: null },
};

// All body classes the router manages (used for cleanup on switch)
const ALL_CLASSES = ['dash-mode', 'projects-mode', 'projects-detail-mode', 'bel-mode', 'confnotes-mode'];

let currentView = 'tasks';

// ── PUBLIC API ──

/**
 * Register onEnter / onExit callbacks for a view.
 * Called by domain modules during initialization.
 */
function register(viewName, { onEnter, onExit } = {}) {
  if (!views[viewName]) {
    console.warn('[router] Unknown view:', viewName);
    return;
  }
  if (onEnter) views[viewName].onEnter = onEnter;
  if (onExit)  views[viewName].onExit  = onExit;
}

/**
 * Switch to a named view. Handles class toggling, tab highlighting,
 * and calling enter/exit hooks.
 */
function switchView(viewName) {
  if (!views[viewName]) {
    console.warn('[router] Unknown view:', viewName);
    return;
  }

  const prev = currentView;
  if (prev === viewName) return; // already there

  // Exit previous view
  if (views[prev] && views[prev].onExit) {
    views[prev].onExit();
  }

  // Remove all managed classes
  ALL_CLASSES.forEach(cls => document.body.classList.remove(cls));

  // Apply new classes
  const view = views[viewName];
  view.bodyClasses.forEach(cls => document.body.classList.add(cls));

  currentView = viewName;

  // Update tab bar active state
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabMap = { tasks: 'tabTasks', dash: 'tabDash', projects: 'tabProjects', 'projects-detail': 'tabProjects' };
  const tabId = tabMap[viewName];
  if (tabId) {
    const btn = document.getElementById(tabId);
    if (btn) btn.classList.add('active');
  }

  // Enter new view
  if (view.onEnter) {
    view.onEnter();
  }

  // Notify the bus
  emit('view-changed', { from: prev, to: viewName });
}

/**
 * Get the current view name.
 */
function currentViewName() {
  return currentView;
}

export { register, switchView, currentViewName };
