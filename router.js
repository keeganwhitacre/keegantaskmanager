// ══════════════════════════════════════════════════════════════════
// ROUTER MODULE — declarative view switching
// Views: tasks, reflect, notes, bel
// ══════════════════════════════════════════════════════════════════

import { emit } from './state.js';

const views = {
  tasks:   { bodyClasses: [],                  onEnter: null, onExit: null },
  reflect: { bodyClasses: ['reflect-mode'],    onEnter: null, onExit: null },
  notes:   { bodyClasses: ['notes-mode'],      onEnter: null, onExit: null },
  bel:     { bodyClasses: ['bel-mode'],        onEnter: null, onExit: null },
};

const ALL_CLASSES = ['reflect-mode', 'notes-mode', 'bel-mode'];

let currentView = 'tasks';

function register(viewName, { onEnter, onExit } = {}) {
  if (!views[viewName]) { console.warn('[router] Unknown view:', viewName); return; }
  if (onEnter) views[viewName].onEnter = onEnter;
  if (onExit)  views[viewName].onExit  = onExit;
}

function switchView(viewName) {
  if (!views[viewName]) { console.warn('[router] Unknown view:', viewName); return; }
  const prev = currentView;
  if (prev === viewName && viewName !== 'tasks') return;

  if (views[prev] && views[prev].onExit) views[prev].onExit();

  ALL_CLASSES.forEach(cls => document.body.classList.remove(cls));
  const view = views[viewName];
  view.bodyClasses.forEach(cls => document.body.classList.add(cls));
  currentView = viewName;

  // Update tab bar
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabMap = { tasks: 'tabTasks', reflect: 'tabReflect', notes: 'tabNotes' };
  const tabId = tabMap[viewName];
  if (tabId) {
    const btn = document.getElementById(tabId);
    if (btn) btn.classList.add('active');
  }

  if (view.onEnter) view.onEnter();
  emit('view-changed', { from: prev, to: viewName });
}

function currentViewName() { return currentView; }

// FIX #1: View-switching keyboard shortcuts.
// Cmd+number (⌘1/2/3) conflicts with browser tab switching on Mac, so we use
// Ctrl+1/2/3 instead. These fire on keydown and are ignored when focus is in
// an input or textarea to avoid clobbering typed content.
document.addEventListener('keydown', function(e) {
  if (!e.ctrlKey) return;
  const tag = (document.activeElement || {}).tagName || '';
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' ||
    (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;

  if (e.key === '1') { e.preventDefault(); switchView('reflect'); }
  else if (e.key === '2') { e.preventDefault(); switchView('tasks'); }
  else if (e.key === '3') { e.preventDefault(); switchView('notes'); }
});

export { register, switchView, currentViewName };
