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

  if (view.onEnter) view.onEnter();

  // Animate views that don't self-animate
  const viewElMap = { bel: 'belView' };
  const elId = viewElMap[viewName];
  if (elId) {
    const el = document.getElementById(elId);
    if (el) {
      el.classList.remove('view-enter'); el.style.opacity = '0';
      requestAnimationFrame(function() { requestAnimationFrame(function() {
        el.style.opacity = ''; el.classList.add('view-enter');
        el.addEventListener('animationend', function handler() { el.classList.remove('view-enter'); el.removeEventListener('animationend', handler); });
      }); });
    }
  }

  emit('view-changed', { from: prev, to: viewName });
}

function currentViewName() { return currentView; }

export { register, switchView, currentViewName };
