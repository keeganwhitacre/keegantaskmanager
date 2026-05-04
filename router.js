// ══════════════════════════════════════════════════════════════════
// ROUTER MODULE — declarative view switching
// ══════════════════════════════════════════════════════════════════

import { emit } from './state.js';

const views = {
  tasks:   { bodyClasses: [],               onEnter: null, onExit: null },
  notes:   { bodyClasses: ['notes-mode'],   onEnter: null, onExit: null },
  reflect: { bodyClasses: ['reflect-mode'], onEnter: null, onExit: null },
  bel:     { bodyClasses: ['bel-mode'],     onEnter: null, onExit: null },
};

const ALL_CLASSES = ['notes-mode', 'reflect-mode', 'bel-mode'];

let currentView = 'tasks';

function register(viewName, { onEnter, onExit } = {}) {
  if (!views[viewName]) { console.warn('[router] unknown view:', viewName); return; }
  if (onEnter) views[viewName].onEnter = onEnter;
  if (onExit)  views[viewName].onExit  = onExit;
}

function switchView(viewName) {
  if (!views[viewName]) { console.warn('[router] unknown view:', viewName); return; }

  const prev = currentView;
  if (prev === viewName) return;

  if (views[prev]?.onExit) views[prev].onExit();

  ALL_CLASSES.forEach(cls => document.body.classList.remove(cls));
  views[viewName].bodyClasses.forEach(cls => document.body.classList.add(cls));
  currentView = viewName;

  // Update tab bar active state
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabMap = { tasks: 'tabTasks', notes: 'tabNotes', reflect: 'tabReflect' };
  const tabId = tabMap[viewName];
  if (tabId) document.getElementById(tabId)?.classList.add('active');

  if (views[viewName].onEnter) views[viewName].onEnter();

  emit('view-changed', { from: prev, to: viewName });
}

function currentViewName() { return currentView; }

// Reflect segmented control pill — kept for the today/review sub-toggle
function updateReflectPill() {
  // No sliding pill in new design — seg buttons use border-bottom only.
  // Kept as a no-op so dashboard.js calls don't throw.
}

window.addEventListener('resize', function() {
  // No pills to reposition in new design.
});

export { register, switchView, currentViewName, updateReflectPill };
