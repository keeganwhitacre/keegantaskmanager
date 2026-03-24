// ══════════════════════════════════════════════════════════════════
// WEEKLY REVIEW MODULE — guided 7-step weekly walkthrough
// Reads affect, habits, tasks, reflections from existing state.
// Appears Sat–Mon as an optional prompt card in Today mode.
// Lives in Review segmented-control pane when active.
// ══════════════════════════════════════════════════════════════════

import { state, esc, getDState, getHabits, saveDash, saveLocal, showToast, uid } from './state.js';
import { ghPush } from './sync.js';
import { setReflectMode } from './dashboard.js';
import { updateReflectPill } from './router.js';
import { getIdeasForReview, noteTypeOf } from './confnotes.js';

// ── Constants ──

const STEPS = [
  { id: 'intention', label: 'Intention',   icon: '🎯' },
  { id: 'affect',    label: 'Affect',      icon: '🔮' },
  { id: 'tasks',     label: 'Tasks',       icon: '✓' },
  { id: 'habits',    label: 'Habits',      icon: '📊' },
  { id: 'carryover', label: 'Carry Over',  icon: '→' },
  { id: 'reflect',   label: 'Reflect',     icon: '✎' },
  { id: 'plan',      label: 'Next Week',   icon: '⟶' },
];

const VLABELS = ['rough', 'low', 'neutral', 'okay', 'good'];
const ALABELS = ['drained', 'low-energy', 'moderate', 'alert', 'wired'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GRID_SIZE = 5;

const CTX_COLORS = {
  work: '#ff9500', writing: '#af52de', social: '#ff2d55',
  rest: '#5ac8fa', exercise: '#30d158', lab: '#007aff',
};

const CAT_COLORS = {
  manuscript: '#af52de', lab: '#007aff', phd: '#ff9500',
  conf: '#ff2d55', bel: '#ff6b9d', personal: '#30d158', hobby: '#5ac8fa',
};

const REFLECT_PROMPTS = [
  "What concept best captures how this week felt?",
  "What would you do differently if you could replay the week?",
  "What surprised you about your affect pattern?",
  "What were you avoiding this week, and why?",
  "If you had to name this week, what would you call it?",
];

// ── Time helpers ──

function getISOWeek(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function getMonday(d) {
  var date = new Date(d);
  var day = date.getDay();
  var diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function affectToColor(v, a) {
  var vn = v / (GRID_SIZE - 1), an = a / (GRID_SIZE - 1);
  var tl = [255, 149, 0], tr = [255, 59, 48], bl = [90, 130, 200], br = [48, 209, 88];
  var r = Math.round(tl[0] * (1 - vn) * an + tr[0] * vn * an + bl[0] * (1 - vn) * (1 - an) + br[0] * vn * (1 - an));
  var g = Math.round(tl[1] * (1 - vn) * an + tr[1] * vn * an + bl[1] * (1 - vn) * (1 - an) + br[1] * vn * (1 - an));
  var b = Math.round(tl[2] * (1 - vn) * an + tr[2] * vn * an + bl[2] * (1 - vn) * (1 - an) + br[2] * vn * (1 - an));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ── State ──

var _step = 0;
var _weekData = null;       // assembled week data
var _isoWeek = '';          // which week we're reviewing
var _carryActions = {};     // { taskId: 'keep' | 'defer' | 'drop' }
var _intentionRating = -1;  // 0-3 index
var _reflectionText = '';
var _nextIntention = '';
var _active = false;        // whether review is open
var _animating = false;

// Callbacks injected from app.js
var _onFinish = null;

// ── Data assembly ──
// Builds a week-summary object from dState and state.tasks for the given ISO week.

function assembleWeekData(isoWeek) {
  var ds = getDState();
  var monday = _isoWeekToMonday(isoWeek);
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var days = [];
  for (var d = 0; d < 7; d++) {
    var date = new Date(monday);
    date.setDate(monday.getDate() + d);
    if (date > today) continue;

    var dStr = dateStr(date);

    // Affect
    var affect = null;
    var affectCount = 0;
    if (ds.affect && ds.affect[dStr]) {
      var entries = Array.isArray(ds.affect[dStr]) ? ds.affect[dStr] : [ds.affect[dStr]];
      affectCount = entries.length;
      if (entries.length > 0) affect = entries[entries.length - 1];
    }

    // Tasks completed this day
    var tasksCompleted = state.tasks.filter(function(t) {
      if (!t.done || !t.completedAt) return false;
      return new Date(t.completedAt).toDateString() === date.toDateString();
    });

    // Habits
    var habits = {};
    getHabits().forEach(function(h) {
      var checks = ds.habits && ds.habits[isoWeek] && ds.habits[isoWeek][h.id];
      habits[h.id] = !!(checks && checks[d]);
    });

    // Reflection
    var reflection = '';
    if (ds.reflections && ds.reflections[dStr]) reflection = ds.reflections[dStr];

    days.push({
      date: dStr, dateObj: date, dow: d,
      affect: affect, affectCount: affectCount,
      tasks: tasksCompleted, habits: habits, reflection: reflection,
    });
  }

  // Carry-over: incomplete tasks that are overdue or were due this week
  var weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() + 6);
  var carryOver = state.tasks.filter(function(t) {
    if (t.done) return false;
    if (!t.due) return false;
    var d = new Date(t.due + 'T00:00:00');
    return d <= today;
  });

  // Category breakdown of completed tasks
  var allCompleted = [];
  days.forEach(function(day) { allCompleted = allCompleted.concat(day.tasks); });
  var catCounts = {};
  allCompleted.forEach(function(t) {
    (t.categories || []).forEach(function(c) { catCounts[c] = (catCounts[c] || 0) + 1; });
  });

  // Affect averages
  var affectDays = days.filter(function(d) { return d.affect; });
  var avgV = affectDays.length > 0 ? affectDays.reduce(function(s, d) { return s + d.affect.v; }, 0) / affectDays.length : -1;
  var avgA = affectDays.length > 0 ? affectDays.reduce(function(s, d) { return s + d.affect.a; }, 0) / affectDays.length : -1;

  // Best / worst day
  var bestDay = null, worstDay = null;
  affectDays.forEach(function(d) {
    if (!bestDay || d.affect.v > bestDay.affect.v) bestDay = d;
    if (!worstDay || d.affect.v < worstDay.affect.v) worstDay = d;
  });

  return {
    isoWeek: isoWeek,
    monday: monday,
    days: days,
    allCompleted: allCompleted,
    carryOver: carryOver,
    catCounts: catCounts,
    avgV: avgV, avgA: avgA,
    bestDay: bestDay, worstDay: worstDay,
    intention: ds.intentionWeek === isoWeek ? (ds.intention || '') : '',
    weeklyReflection: ds.weeklyReflections ? (ds.weeklyReflections[isoWeek] || '') : '',
    dailyReflections: days.filter(function(d) { return d.reflection; }),
  };
}

function _isoWeekToMonday(isoWeek) {
  var parts = isoWeek.split('-W');
  var year = parseInt(parts[0]);
  var week = parseInt(parts[1]);
  var jan4 = new Date(year, 0, 4);
  var dow = jan4.getDay() || 7;
  var monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// ── Should the prompt card show? ──

function shouldShowPromptCard() {
  var dow = new Date().getDay(); // 0=Sun
  // Sat=6, Sun=0, Mon=1
  if (dow !== 0 && dow !== 1 && dow !== 6) return false;

  var ds = getDState();
  var isoWeek = _getReviewWeek();
  if (!ds.weeklyReviews) return true;
  return !ds.weeklyReviews[isoWeek];
}

// Which week to review: on Saturday, review the current week.
// On Sunday/Monday, review the previous week (since a new ISO week has started).
function _getReviewWeek() {
  var now = new Date();
  var dow = now.getDay(); // 0=Sun
  if (dow === 6) {
    // Saturday — review *this* week
    return getISOWeek(now);
  }
  // Sunday or Monday — the ISO week has rolled over, so review last week
  var lastWeek = new Date(now);
  lastWeek.setDate(now.getDate() - 7);
  return getISOWeek(lastWeek);
}

// ── Prompt card (injected at top of Today mode) ──

function renderPromptCard() {
  var container = document.getElementById('wrPromptCard');
  if (!container) return;

  if (!shouldShowPromptCard()) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  var isoWeek = _getReviewWeek();
  var monday = _isoWeekToMonday(isoWeek);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var weekLabel = 'Week of ' + months[monday.getMonth()] + ' ' + monday.getDate();

  container.innerHTML =
    '<div class="wr-prompt-inner">' +
      '<div class="wr-prompt-icon">✎</div>' +
      '<div class="wr-prompt-content">' +
        '<div class="wr-prompt-title">Weekly Review</div>' +
        '<div class="wr-prompt-sub">' + esc(weekLabel) + ' · ' + esc(isoWeek) + '</div>' +
      '</div>' +
      '<div class="wr-prompt-action">Start →</div>' +
    '</div>';

  container.onclick = function() {
    startReview(isoWeek);
  };
}

// ── Start / close the review ──

function startReview(isoWeek) {
  _isoWeek = isoWeek;
  _step = 0;
  _carryActions = {};
  _intentionRating = -1;
  _reflectionText = '';
  _nextIntention = '';
  _active = true;
  _animating = false;
  _weekData = assembleWeekData(isoWeek);

  // Pre-fill reflection with existing weekly reflection
  _reflectionText = _weekData.weeklyReflection || '';

  // Switch to Review mode
  setReflectMode('review');
  updateReflectPill();

  // Hide timeline, show review walkthrough
  var timeline = document.getElementById('timelineNav');
  var timelineBody = document.getElementById('timelineBody');
  if (timeline) timeline.style.display = 'none';
  if (timelineBody) timelineBody.style.display = 'none';

  var wrContainer = document.getElementById('wrContainer');
  if (wrContainer) wrContainer.style.display = 'block';

  renderStep();
}

function closeReview() {
  _active = false;
  var wrContainer = document.getElementById('wrContainer');
  if (wrContainer) wrContainer.style.display = 'none';

  var timeline = document.getElementById('timelineNav');
  var timelineBody = document.getElementById('timelineBody');
  if (timeline) timeline.style.display = '';
  if (timelineBody) timelineBody.style.display = '';
}

// ── Step navigation ──

function goToStep(idx) {
  if (idx === _step || idx < 0 || idx >= STEPS.length || _animating) return;
  _animating = true;
  var content = document.getElementById('wrStepContent');
  if (content) {
    content.classList.add('wr-step-exit');
  }
  setTimeout(function() {
    _step = idx;
    renderStep();
    _animating = false;
    if (content) {
      content.classList.remove('wr-step-exit');
      content.classList.add('wr-step-enter');
      setTimeout(function() { content.classList.remove('wr-step-enter'); }, 200);
    }
  }, 160);
}

// ── Main render ──

function renderStep() {
  var container = document.getElementById('wrContainer');
  if (!container) return;

  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var weekLabel = months[_weekData.monday.getMonth()] + ' ' + _weekData.monday.getDate();

  var html = '';

  // Header
  html += '<div class="wr-header">';
  html += '<div class="wr-header-top">';
  html += '<div class="wr-header-label">Weekly Review</div>';
  html += '<div class="wr-header-meta">' + esc('Week of ' + weekLabel + ' · ' + _weekData.isoWeek) + '</div>';
  html += '</div>';
  html += '<div class="wr-header-title">';
  html += '<span class="wr-step-icon">' + STEPS[_step].icon + '</span> ';
  html += esc(STEPS[_step].label);
  html += '</div>';
  html += '</div>';

  // Progress bar
  html += '<div class="wr-progress">';
  for (var i = 0; i < STEPS.length; i++) {
    html += '<div class="wr-progress-seg' + (i <= _step ? ' filled' : '') + '" data-step="' + i + '"></div>';
  }
  html += '</div>';

  // Step content
  html += '<div class="wr-step-content" id="wrStepContent">';
  switch (STEPS[_step].id) {
    case 'intention': html += renderIntentionStep(); break;
    case 'affect':    html += renderAffectStep(); break;
    case 'tasks':     html += renderTasksStep(); break;
    case 'habits':    html += renderHabitsStep(); break;
    case 'carryover': html += renderCarryOverStep(); break;
    case 'reflect':   html += renderReflectStep(); break;
    case 'plan':      html += renderPlanStep(); break;
  }
  html += '</div>';

  // Navigation
  html += '<div class="wr-nav">';
  if (_step > 0) {
    html += '<button class="wr-btn wr-btn-back" id="wrBack">Back</button>';
  }
  if (_step < STEPS.length - 1) {
    html += '<button class="wr-btn wr-btn-next" id="wrNext">Continue</button>';
  } else {
    html += '<button class="wr-btn wr-btn-finish" id="wrFinish">Finish Review</button>';
  }
  html += '</div>';

  container.innerHTML = html;

  // Wire interactions
  _wireStepInteractions();
}

function _wireStepInteractions() {
  // Progress bar segments
  document.querySelectorAll('.wr-progress-seg').forEach(function(seg) {
    seg.addEventListener('click', function() {
      goToStep(parseInt(this.dataset.step));
    });
  });

  // Nav buttons
  var back = document.getElementById('wrBack');
  var next = document.getElementById('wrNext');
  var finish = document.getElementById('wrFinish');
  if (back) back.addEventListener('click', function() { goToStep(_step - 1); });
  if (next) next.addEventListener('click', function() { goToStep(_step + 1); });
  if (finish) finish.addEventListener('click', function() { finishReview(); });

  // Intention rating chips
  document.querySelectorAll('.wr-rating-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      _intentionRating = parseInt(this.dataset.idx);
      document.querySelectorAll('.wr-rating-chip').forEach(function(c) { c.classList.remove('active'); });
      this.classList.add('active');
    });
  });

  // Carry-over action buttons
  document.querySelectorAll('.wr-carry-action').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var taskId = this.dataset.task;
      var action = this.dataset.action;
      _carryActions[taskId] = action;
      // Update UI
      var row = this.closest('.wr-carry-row');
      row.querySelectorAll('.wr-carry-action').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
    });
  });

  // Reflection textarea
  var reflectTA = document.getElementById('wrReflectTA');
  if (reflectTA) {
    reflectTA.value = _reflectionText;
    reflectTA.addEventListener('input', function() { _reflectionText = this.value; });
  }

  // Next intention textarea
  var planTA = document.getElementById('wrPlanTA');
  if (planTA) {
    planTA.value = _nextIntention;
    planTA.addEventListener('input', function() { _nextIntention = this.value; });
  }
}

// ══════════════════════════════════════════════════════════════════
// STEP RENDERERS
// ══════════════════════════════════════════════════════════════════

function renderIntentionStep() {
  var html = '';
  html += '<div class="wr-question">How did your intention play out?</div>';

  if (_weekData.intention) {
    html += '<div class="wr-intention-card">';
    html += '<div class="wr-label-mono">This week\'s intention</div>';
    html += '<div class="wr-intention-text">' + esc(_weekData.intention) + '</div>';
    html += '</div>';
  } else {
    html += '<div class="wr-intention-card wr-empty">';
    html += '<div class="wr-label-mono">No intention was set this week</div>';
    html += '</div>';
  }

  html += '<div style="margin-top:16px;">';
  html += '<div class="wr-label-mono">Did you follow through?</div>';
  html += '<div class="wr-chips">';
  var ratings = ['Fully', 'Mostly', 'Partially', 'Not really'];
  ratings.forEach(function(r, i) {
    html += '<button class="wr-rating-chip' + (i === _intentionRating ? ' active' : '') + '" data-idx="' + i + '">' + esc(r) + '</button>';
  });
  html += '</div>';
  html += '</div>';

  return html;
}

function renderAffectStep() {
  var days = _weekData.days;
  var html = '';
  html += '<div class="wr-question">Here\'s how your week felt.</div>';

  // Affect ribbon
  html += '<div class="wr-affect-ribbon">';
  days.forEach(function(d) {
    var color = d.affect ? affectToColor(d.affect.v, d.affect.a) : 'var(--border-divider)';
    var ctxColor = d.affect && d.affect.ctx ? (CTX_COLORS[d.affect.ctx] || '#888') : '';
    html += '<div class="wr-ribbon-day">';
    html += '<div class="wr-ribbon-bar" style="background:' + color + ';">';
    if (ctxColor) {
      html += '<div class="wr-ribbon-ctx-dot" style="background:' + ctxColor + ';"></div>';
    }
    html += '</div>';
    html += '<div class="wr-day-label">' + DAY_NAMES[d.dow] + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // Stats
  html += '<div class="wr-stat-row">';
  html += '<div class="wr-stat">';
  html += '<div class="wr-label-mono">Avg Valence</div>';
  if (_weekData.avgV >= 0) {
    html += '<div class="wr-stat-val"><span class="wr-mini-orb" style="background:' + affectToColor(Math.round(_weekData.avgV), Math.round(_weekData.avgA)) + '"></span>' + _weekData.avgV.toFixed(1) + ' — ' + VLABELS[Math.round(_weekData.avgV)] + '</div>';
  } else {
    html += '<div class="wr-stat-val wr-muted">no logs</div>';
  }
  html += '</div>';
  html += '<div class="wr-stat">';
  html += '<div class="wr-label-mono">Avg Arousal</div>';
  if (_weekData.avgA >= 0) {
    html += '<div class="wr-stat-val">' + _weekData.avgA.toFixed(1) + ' — ' + ALABELS[Math.round(_weekData.avgA)] + '</div>';
  } else {
    html += '<div class="wr-stat-val wr-muted">no logs</div>';
  }
  html += '</div>';
  html += '</div>';

  // Factual summary
  var signals = [];
  if (_weekData.bestDay && _weekData.worstDay && _weekData.bestDay.date !== _weekData.worstDay.date) {
    signals.push('Best: ' + DAY_NAMES[_weekData.bestDay.dow] + ' (' + VLABELS[_weekData.bestDay.affect.v] + (_weekData.bestDay.affect.ctx ? ', ' + _weekData.bestDay.affect.ctx : '') + ')');
    signals.push('Lowest: ' + DAY_NAMES[_weekData.worstDay.dow] + ' (' + VLABELS[_weekData.worstDay.affect.v] + (_weekData.worstDay.affect.ctx ? ', ' + _weekData.worstDay.affect.ctx : '') + ')');
  }
  // Valence trend
  var affectDays = days.filter(function(d) { return d.affect; });
  if (affectDays.length >= 4) {
    var firstHalf = affectDays.slice(0, Math.ceil(affectDays.length / 2));
    var secondHalf = affectDays.slice(Math.ceil(affectDays.length / 2));
    var fAvg = firstHalf.reduce(function(s, d) { return s + d.affect.v; }, 0) / firstHalf.length;
    var sAvg = secondHalf.reduce(function(s, d) { return s + d.affect.v; }, 0) / secondHalf.length;
    var diff = sAvg - fAvg;
    if (diff > 0.5) signals.push('Valence trended up over the week');
    else if (diff < -0.5) signals.push('Valence trended down over the week');
    else signals.push('Valence was relatively steady');
  }

  if (signals.length > 0) {
    html += '<div class="wr-insight">';
    html += signals.map(function(s) { return esc(s); }).join(' · ');
    html += '</div>';
  }

  return html;
}

function renderTasksStep() {
  var tasks = _weekData.allCompleted;
  var catCounts = _weekData.catCounts;
  var sorted = Object.entries(catCounts).sort(function(a, b) { return b[1] - a[1]; });
  var html = '';

  html += '<div class="wr-question">' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + ' completed this week.</div>';

  // Category chips
  if (sorted.length > 0) {
    html += '<div class="wr-cat-chips">';
    sorted.forEach(function(pair) {
      var cat = pair[0], count = pair[1];
      var color = CAT_COLORS[cat] || '#888';
      html += '<div class="wr-cat-chip" style="background:' + color + '18;color:' + color + ';border-color:' + color + '30;">' + esc(cat) + ' × ' + count + '</div>';
    });
    html += '</div>';
  }

  // Task list
  if (tasks.length > 0) {
    html += '<div class="wr-task-list">';
    tasks.forEach(function(t, i) {
      var catColor = CAT_COLORS[(t.categories || [])[0]] || '#888';
      html += '<div class="wr-task-row' + (i < tasks.length - 1 ? ' bordered' : '') + '">';
      html += '<div class="wr-task-dot" style="background:' + catColor + '"></div>';
      html += '<span class="wr-task-title">' + esc(t.title) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="wr-empty-note">No tasks completed this week.</div>';
  }

  return html;
}

function renderHabitsStep() {
  var days = _weekData.days;
  var html = '';
  html += '<div class="wr-question">Habit consistency this week.</div>';

  html += '<div class="wr-habits-list">';
  getHabits().forEach(function(h) {
    var isBad = h.bad;
    var scheduleDays = h.days || [0, 1, 2, 3, 4, 5, 6];
    var completed = 0, total = 0;
    days.forEach(function(d) {
      if (scheduleDays.indexOf(d.dow) === -1) return;
      total++;
      if (d.habits[h.id]) completed++;
    });
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    var color = isBad ? 'var(--danger)' : (pct >= 70 ? 'var(--success)' : pct >= 40 ? '#ff9500' : 'var(--danger)');

    html += '<div class="wr-habit-item">';
    html += '<div class="wr-habit-header">';
    html += '<span class="wr-habit-name">' + esc(h.label) + '</span>';
    html += '<span class="wr-habit-pct" style="color:' + color + '">' + pct + '%</span>';
    html += '</div>';

    // Day checks
    html += '<div class="wr-habit-checks">';
    days.forEach(function(d) {
      var isOff = scheduleDays.indexOf(d.dow) === -1;
      var checked = d.habits[h.id];
      var cls = 'wr-habit-cb';
      if (isOff) cls += ' off';
      else if (checked && isBad) cls += ' checked-bad';
      else if (checked) cls += ' checked';

      html += '<div class="' + cls + '">';
      if (isOff) html += '';
      else if (checked) html += (isBad ? '✗' : '✓');
      else html += '·';
      html += '</div>';
    });
    html += '<div class="wr-habit-days-label">';
    days.forEach(function(d) {
      html += '<span>' + DAY_NAMES[d.dow].charAt(0) + '</span>';
    });
    html += '</div>';
    html += '</div>';

    html += '</div>';
  });
  html += '</div>';

  // Factual insight
  var insights = [];
  getHabits().forEach(function(h) {
    if (h.bad) {
      var badDays = [];
      days.forEach(function(d) {
        if (d.habits[h.id]) badDays.push(DAY_NAMES[d.dow]);
      });
      if (badDays.length > 0) {
        insights.push(esc(h.label) + ' on ' + badDays.join(', '));
      }
    }
  });
  if (insights.length > 0) {
    html += '<div class="wr-insight">' + insights.join('. ') + '.</div>';
  }

  return html;
}

function renderCarryOverStep() {
  var tasks = _weekData.carryOver;
  var html = '';

  html += '<div class="wr-question">' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + ' didn\'t get done. What happens to them?</div>';
  html += '<div class="wr-carry-desc">Decide now: carry forward, defer, or drop.</div>';

  if (tasks.length === 0) {
    html += '<div class="wr-empty-note">All clear — nothing carried over.</div>';
    return html;
  }

  html += '<div class="wr-carry-list">';
  tasks.forEach(function(t) {
    var catColor = CAT_COLORS[(t.categories || [])[0]] || '#888';
    var dueLabel = '';
    if (t.due) {
      var d = new Date(t.due + 'T00:00:00');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var diff = Math.round((d - today) / 86400000);
      if (diff < 0) dueLabel = 'overdue';
      else if (diff <= 3) dueLabel = 'soon';
    }
    var currentAction = _carryActions[t.id] || '';

    html += '<div class="wr-carry-row">';
    html += '<div class="wr-carry-info">';
    html += '<div class="wr-task-dot" style="background:' + catColor + '"></div>';
    html += '<span class="wr-task-title">' + esc(t.title) + '</span>';
    if (dueLabel) {
      html += '<span class="wr-carry-due ' + esc(dueLabel) + '">' + esc(dueLabel) + '</span>';
    }
    html += '</div>';

    html += '<div class="wr-carry-actions">';
    ['keep', 'defer', 'drop'].forEach(function(action) {
      html += '<button class="wr-carry-action ' + action + (currentAction === action ? ' active' : '') + '" data-task="' + esc(t.id) + '" data-action="' + action + '">' + action.charAt(0).toUpperCase() + action.slice(1) + '</button>';
    });
    html += '</div>';
    html += '</div>';
  });
  html += '</div>';

  return html;
}

function renderReflectStep() {
  var html = '';
  html += '<div class="wr-question">Take a moment to reflect.</div>';

  // Rotating prompt
  var doy = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  var prompt = REFLECT_PROMPTS[doy % REFLECT_PROMPTS.length];
  html += '<div class="wr-reflect-prompt">' + esc(prompt) + '</div>';

  // Daily reflections
  var refs = _weekData.dailyReflections;
  if (refs.length > 0) {
    html += '<div class="wr-label-mono" style="margin-bottom:8px;">Your daily reflections this week</div>';
    refs.forEach(function(d) {
      html += '<div class="wr-daily-ref">';
      html += '<span class="wr-daily-ref-day">' + DAY_NAMES[d.dow] + ': </span>';
      html += esc(d.reflection);
      html += '</div>';
    });
  }

  html += '<textarea class="wr-textarea" id="wrReflectTA" rows="4" placeholder="Write your weekly reflection...">' + esc(_reflectionText) + '</textarea>';

  return html;
}

function renderPlanStep() {
  var html = '';
  html += '<div class="wr-question">Set next week\'s intention.</div>';
  html += '<div class="wr-carry-desc">Based on what happened this week, what\'s the one thing you want to commit to?</div>';

  // Signals summary
  var signals = [];
  if (_weekData.worstDay && _weekData.worstDay.affect) {
    signals.push('Lowest valence: ' + DAY_NAMES[_weekData.worstDay.dow] + ' (' + _weekData.worstDay.affect.v.toFixed(1) + (_weekData.worstDay.affect.ctx ? ', ' + _weekData.worstDay.affect.ctx : '') + ')');
  }
  if (_weekData.carryOver.length > 0) {
    signals.push(_weekData.carryOver.length + ' task' + (_weekData.carryOver.length !== 1 ? 's' : '') + ' carried over');
  }
  // Check for habits below 50%
  var weakHabits = [];
  getHabits().forEach(function(h) {
    if (h.bad) return;
    var scheduleDays = h.days || [0, 1, 2, 3, 4, 5, 6];
    var completed = 0, total = 0;
    _weekData.days.forEach(function(d) {
      if (scheduleDays.indexOf(d.dow) === -1) return;
      total++;
      if (d.habits[h.id]) completed++;
    });
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (pct < 50) weakHabits.push(h.label.toLowerCase() + ' (' + pct + '%)');
  });
  if (weakHabits.length > 0) {
    signals.push('Low consistency: ' + weakHabits.join(', '));
  }

  if (signals.length > 0) {
    html += '<div class="wr-signals-box">';
    html += '<div class="wr-label-mono" style="color:var(--accent);margin-bottom:8px;">Signals from this week</div>';
    html += '<div class="wr-signals-text">' + signals.map(function(s) { return esc(s); }).join('. ') + '.</div>';
    html += '</div>';
  }

  // ── Research idea incubator ──
  var ideas = [];
  try { ideas = getIdeasForReview(); } catch(e) { /* confnotes not loaded yet */ }
  if (ideas.length > 0) {
    html += '<div class="wr-ideas-box">';
    html += '<div class="wr-label-mono" style="color:#ff9500;margin-bottom:8px;">💡 Incubating Ideas (' + ideas.length + ')</div>';
    html += '<div class="wr-carry-desc" style="margin-bottom:10px;">Any of these worth developing or promoting to a project?</div>';

    // Sort: stale first (most neglected), then by date
    ideas.sort(function(a, b) {
      var aDays = Math.floor((Date.now() - new Date(a.updatedAt || a.createdAt).getTime()) / 86400000);
      var bDays = Math.floor((Date.now() - new Date(b.updatedAt || b.createdAt).getTime()) / 86400000);
      return bDays - aDays;
    });

    // Show up to 5
    ideas.slice(0, 5).forEach(function(idea) {
      var staleDays = Math.floor((Date.now() - new Date(idea.updatedAt || idea.createdAt).getTime()) / 86400000);
      var staleClass = staleDays >= 30 ? 'wr-idea-dormant' : staleDays >= 14 ? 'wr-idea-cooling' : '';
      var statusLabel = idea.ideaStatus || 'raw';
      html += '<div class="wr-idea-row ' + staleClass + '">';
      html += '<div class="wr-idea-title">' + esc(idea.title || 'Untitled idea') + '</div>';
      html += '<div class="wr-idea-meta">';
      html += '<span class="wr-idea-status">' + esc(statusLabel) + '</span>';
      if (staleDays > 0) html += '<span class="wr-idea-age">' + staleDays + 'd ago</span>';
      html += '</div>';
      html += '</div>';
    });
    if (ideas.length > 5) {
      html += '<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:6px;">+ ' + (ideas.length - 5) + ' more in Notes → Ideas</div>';
    }
    html += '</div>';
  }

  html += '<textarea class="wr-textarea wr-textarea-intention" id="wrPlanTA" rows="3" placeholder="Next week I will...">' + esc(_nextIntention) + '</textarea>';

  // Completion summary (always visible on last step)
  html += '<div class="wr-finish-summary">';
  html += '<div class="wr-finish-title">Week reviewed ✓</div>';
  html += '<div class="wr-finish-sub">';
  var parts = [];
  parts.push(_weekData.allCompleted.length + ' tasks done');
  if (_weekData.carryOver.length > 0) parts.push(_weekData.carryOver.length + ' carried over');
  if (_weekData.avgV >= 0) parts.push('avg valence ' + _weekData.avgV.toFixed(1));
  html += esc(parts.join(' · '));
  html += '</div>';
  html += '</div>';

  return html;
}

// ══════════════════════════════════════════════════════════════════
// FINISH — apply carry-over mutations and mark reviewed
// ══════════════════════════════════════════════════════════════════

function finishReview() {
  var ds = getDState();

  // 1. Apply carry-over decisions
  Object.keys(_carryActions).forEach(function(taskId) {
    var action = _carryActions[taskId];
    var task = null;
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === taskId) { task = state.tasks[i]; break; }
    }
    if (!task) return;

    if (action === 'keep') {
      // Re-pin to today
      task.pinnedToday = true;
    } else if (action === 'defer') {
      // Push due date to tomorrow
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      var tStr = tomorrow.toISOString().split('T')[0];
      if (task.due) {
        var d = new Date(task.due + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        task.due = d.toISOString().split('T')[0];
      } else {
        task.due = tStr;
      }
      task.pinnedToday = false;
    } else if (action === 'drop') {
      // Delete the task
      state.tasks = state.tasks.filter(function(t) { return t.id !== taskId; });
    }
  });

  // 2. Save weekly reflection
  if (_reflectionText) {
    if (!ds.weeklyReflections) ds.weeklyReflections = {};
    ds.weeklyReflections[_isoWeek] = _reflectionText;
  }

  // 3. Set next week's intention
  if (_nextIntention) {
    var nextWeekMonday = new Date(_weekData.monday);
    nextWeekMonday.setDate(nextWeekMonday.getDate() + 7);
    var nextIsoWeek = getISOWeek(nextWeekMonday);
    ds.intention = _nextIntention;
    ds.intentionWeek = nextIsoWeek;
  }

  // 4. Mark week as reviewed
  if (!ds.weeklyReviews) ds.weeklyReviews = {};
  ds.weeklyReviews[_isoWeek] = {
    reviewed: true,
    reviewedAt: new Date().toISOString(),
    intentionRating: _intentionRating,
    carryActions: Object.assign({}, _carryActions),
  };

  // 5. Persist
  saveDash(true);
  saveLocal();
  ghPush();

  // 6. Close and notify
  closeReview();
  showToast('Week reviewed ✓');

  // Notify app.js to re-render
  if (_onFinish) _onFinish();
}

// ── Public API ──

function initWeeklyReview(opts) {
  if (opts && opts.onFinish) _onFinish = opts.onFinish;
}

function isReviewActive() {
  return _active;
}

export { initWeeklyReview, renderPromptCard, startReview, closeReview, isReviewActive, shouldShowPromptCard };
