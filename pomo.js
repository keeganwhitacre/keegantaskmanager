// ══════════════════════════════════════════════════════════════════
// POMO MODULE — Pomodoro timer
// ══════════════════════════════════════════════════════════════════

import { state, pomo, saveLocal } from './state.js';
import { ghPush } from './sync.js';

// showToast is defined in app.js — passed in via init()
let _showToast = () => {};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
}

function updatePomoUI() {
  document.getElementById('pomoDisplay').textContent = formatTime(pomo.timeLeft);
  let statusTxt = 'Work Session';
  if (pomo.mode === 'shortBreak') statusTxt = 'Short Break (5m)';
  if (pomo.mode === 'longBreak') statusTxt = 'Long Break (15m)';
  document.getElementById('pomoStatus').textContent = statusTxt + ' • ' + pomo.cycles + ' completed';
  document.getElementById('pomoStartBtn').textContent = pomo.running ? 'Pause' : 'Start';

  const isDeepFocus = pomo.running && pomo.mode === 'work';
  document.body.classList.toggle('deep-focus-mode', isDeepFocus);
  document.documentElement.classList.toggle('deep-focus-mode', isDeepFocus);
}

function tickPomo() {
  pomo.timeLeft--;
  if (pomo.timeLeft <= 0) {
    clearInterval(pomo.timer); pomo.running = false;
    if (pomo.mode === 'work') {
      pomo.cycles++;
      if (state.focus) {
        const t = state.tasks.find(x => x.id === state.focus);
        if (t) { t.pomodoros = (t.pomodoros || 0) + 1; saveLocal(); ghPush(); }
      }
      pomo.mode = (pomo.cycles % 4 === 0) ? 'longBreak' : 'shortBreak';
      pomo.timeLeft = (pomo.mode === 'longBreak') ? 15 * 60 : 5 * 60;
      _showToast('Session complete! Take a break.');
    } else {
      pomo.mode = 'work'; pomo.timeLeft = 25 * 60;
      _showToast('Break over! Ready to focus?');
    }
  }
  updatePomoUI();
}

/**
 * Wire up DOM events. Call once after DOM is ready.
 * @param {Function} showToast - toast function from app.js
 */
function initPomo(showToast) {
  _showToast = showToast;

  document.getElementById('pomoStartBtn').addEventListener('click', function() {
    if (pomo.running) { clearInterval(pomo.timer); pomo.running = false; }
    else { pomo.running = true; pomo.timer = setInterval(tickPomo, 1000); }
    updatePomoUI();
  });

  document.getElementById('pomoSkipBtn').addEventListener('click', function() {
    clearInterval(pomo.timer); pomo.running = false;
    if (pomo.mode === 'work') { pomo.mode = 'shortBreak'; pomo.timeLeft = 5 * 60; _showToast('Session skipped.'); }
    else { pomo.mode = 'work'; pomo.timeLeft = 25 * 60; _showToast('Break skipped.'); }
    updatePomoUI();
  });
}

export { initPomo, updatePomoUI };
