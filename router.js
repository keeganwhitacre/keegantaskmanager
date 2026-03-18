// ══════════════════════════════════════════════════════════════════
// ROUTER MODULE — declarative view switching
// All view entrance animations are driven from JS (either here via
// view-enter class, or in the view's own onEnter callback).
// CSS view-routing rules handle display toggling only — no animation
// declarations on the display:block rules, to avoid double-animation
// on Safari iOS PWA where display+animation in one rule can cause
// a two-pass style evaluation (visible as a vertical shake/stutter).
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

  // ── Animate the incoming view container ──
  // Only for views that don't self-animate in their onEnter.
  // dash: stagger cards in onDashEnter
  // confnotes: card stagger via CSS animationDelay
  // tasks: view-animate on #taskList in its onEnter
  const viewElMap = {
    bel: 'belView',
  };
  const elId = viewElMap[viewName];
  if (elId) {
    const el = document.getElementById(elId);
    if (el) {
      el.classList.remove('view-enter');
      el.style.opacity = '0';
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          el.style.opacity = '';
          el.classList.add('view-enter');
          el.addEventListener('animationend', function handler() {
            el.classList.remove('view-enter');
            el.removeEventListener('animationend', handler);
          });
        });
      });
    }
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
