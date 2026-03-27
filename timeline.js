// ══════════════════════════════════════════════════════════════════
// TIMELINE MODULE — Weekly retrospective view
// Reads from existing state (affect, habits, tasks, reflections)
// to build a unified timeline of each day and week.
// ══════════════════════════════════════════════════════════════════

import { state, esc, getDState, getHabits } from './state.js';
import { switchView } from './router.js';

// ── Constants ──

const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const GRID_SIZE = 5;
const LOAD_INCREMENT = 4;

const CTX_COLORS = {
  work: '#ff9500', writing: '#af52de', social: '#ff2d55',
  rest: '#5ac8fa', exercise: '#30d158', lab: '#007aff',
};

const CAT_COLORS = {
  manuscript: '#af52de', lab: '#007aff', phd: '#ff9500',
  conf: '#ff2d55', bel: '#ff6b9d', personal: '#30d158', hobby: '#5ac8fa',
};

// ── Week data cache ──
// Key: ISO week string (e.g. "2025-W12"), Value: computed week data object.
// Past weeks are immutable once computed — only the current week gets recomputed.
const _weekCache = new Map();

function _currentISOWeek() {
  return getISOWeek(new Date());
}

function _getWeekData(weekStart) {
  var isoWeek = getISOWeek(weekStart);
  var currentWeek = _currentISOWeek();

  // Always recompute the current week (data is still accumulating)
  if (isoWeek === currentWeek) {
    var data = buildWeekData(weekStart);
    _weekCache.set(isoWeek, data);
    return data;
  }

  // Past weeks: return cached if available
  if (_weekCache.has(isoWeek)) {
    return _weekCache.get(isoWeek);
  }

  // Compute and cache
  var data = buildWeekData(weekStart);
  _weekCache.set(isoWeek, data);
  return data;
}

// Invalidate cache (called on data-pulled from sync to pick up remote changes)
function invalidateCache() {
  _weekCache.clear();
}

// ── Time helpers ──

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function weekDayToDate(isoWeek, dayIdx) {
  const parts = isoWeek.split('-W');
  const year = parseInt(parts[0]);
  const week = parseInt(parts[1]);
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayIdx);
  return dateStr(d);
}

// ── Affect color (same algorithm as dashboard.js) ──

function affectToColor(v, a) {
  const vn = v / (GRID_SIZE - 1);
  const an = a / (GRID_SIZE - 1);
  const tl = [255, 149, 0], tr = [255, 59, 48], bl = [90, 130, 200], br = [48, 209, 88];
  const r = Math.round(tl[0]*(1-vn)*an + tr[0]*vn*an + bl[0]*(1-vn)*(1-an) + br[0]*vn*(1-an));
  const g = Math.round(tl[1]*(1-vn)*an + tr[1]*vn*an + bl[1]*(1-vn)*(1-an) + br[1]*vn*(1-an));
  const b = Math.round(tl[2]*(1-vn)*an + tr[2]*vn*an + bl[2]*(1-vn)*(1-an) + br[2]*vn*(1-an));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ── Data assembly ──

function buildWeekData(weekStart) {
  const ds = getDState();
  const today = new Date(); today.setHours(0,0,0,0);
  const isoWeek = getISOWeek(weekStart);
  const days = [];

  for (let d = 0; d < 7; d++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + d);
    if (date > today) continue;

    const dStr = dateStr(date);

    // Affect — keep both latest entry and total count
    let affect = null;
    let affectCount = 0;
    if (ds.affect && ds.affect[dStr]) {
      const entries = Array.isArray(ds.affect[dStr]) ? ds.affect[dStr] : [ds.affect[dStr]];
      affectCount = entries.length;
      if (entries.length > 0) affect = entries[entries.length - 1]; // latest
    }

    // Tasks completed this day
    const tasksCompleted = state.tasks.filter(function(t) {
      if (!t.done || !t.completedAt) return false;
      const cd = new Date(t.completedAt);
      return cd.toDateString() === date.toDateString();
    });

    // Habits
    const habits = {};
    getHabits().forEach(function(h) {
      const checks = ds.habits && ds.habits[isoWeek] && ds.habits[isoWeek][h.id];
      habits[h.id] = !!(checks && checks[d]);
    });

    // Reflection
    let reflection = '';
    if (ds.reflections && ds.reflections[dStr]) {
      reflection = ds.reflections[dStr];
    }

    // Pomodoro total from completed tasks
    const pomoTotal = tasksCompleted.reduce(function(sum, t) { return sum + (t.pomodoros || 0); }, 0);

    days.push({
      date: dStr,
      dateObj: date,
      dow: d,
      affect: affect,
      affectCount: affectCount,
      tasks: tasksCompleted,
      habits: habits,
      reflection: reflection,
      pomodoroTotal: pomoTotal,
    });
  }

  return {
    label: isoWeek,
    start: new Date(weekStart),
    days: days,
  };
}

function buildWeeks(count) {
  const today = new Date();
  const thisMonday = getMonday(today);
  const weeks = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(thisMonday);
    start.setDate(thisMonday.getDate() - i * 7);
    weeks.push(_getWeekData(start));
  }
  return weeks;
}

// ── Rendering ──

let _weeks = [];
let _activeWeekIdx = 0;
let _expandedDay = null;
let _weekCount = 4;

function renderTimeline(navOnly) {
  _weeks = buildWeeks(_weekCount);

  // Always render nav (but preserve scroll position)
  renderTimelineNav();

  if (!navOnly) {
    renderTimelineBody();
  }
}

function renderTimelineNav() {
  const nav = document.getElementById('timelineNav');
  if (!nav) return;

  // Save scroll position before re-render
  var existingScroller = nav.querySelector('.tl-week-nav');
  var savedScroll = existingScroller ? existingScroller.scrollLeft : 0;

  let html = '<div class="tl-week-nav">';
  _weeks.forEach(function(w, i) {
    const wStart = w.start;
    const label = i === 0 ? 'This week' : i === 1 ? 'Last week' : MONTHS[wStart.getMonth()] + ' ' + wStart.getDate();
    const isActive = i === _activeWeekIdx;
    html += '<button class="tl-week-chip' + (isActive ? ' active' : '') + '" data-week="' + i + '">';
    html += '<div class="tl-week-chip-label">' + esc(label) + '</div>';
    html += '<div class="tl-week-chip-dots">';
    w.days.forEach(function(d) {
      const color = d.affect ? affectToColor(d.affect.v, d.affect.a) : 'var(--border-divider)';
      html += '<div class="tl-mini-dot" style="background:' + color + '"></div>';
    });
    html += '</div></button>';
  });
  html += '</div>';

  // Always show Load more — no cap
  html += '<div style="text-align:center; margin-bottom:12px;">';
  html += '<button class="tl-load-more" id="tlLoadMore">Load more weeks</button>';
  html += '</div>';

  nav.innerHTML = html;

  // Restore scroll position
  var newScroller = nav.querySelector('.tl-week-nav');
  if (newScroller && savedScroll > 0) {
    newScroller.scrollLeft = savedScroll;
  }

  // If active week is off-screen, scroll it into view
  var activeChip = nav.querySelector('.tl-week-chip.active');
  if (activeChip && newScroller) {
    var navRect = newScroller.getBoundingClientRect();
    var chipRect = activeChip.getBoundingClientRect();
    if (chipRect.left < navRect.left || chipRect.right > navRect.right) {
      activeChip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  // Wire up nav interactions
  nav.querySelectorAll('.tl-week-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      _activeWeekIdx = parseInt(this.dataset.week);
      _expandedDay = null;
      renderTimelineNav(); // re-render nav to update active state (preserves scroll)
      renderTimelineBody(); // re-render body for new week
    });
  });

  var loadMore = document.getElementById('tlLoadMore');
  if (loadMore) {
    loadMore.addEventListener('click', function(e) {
      e.stopPropagation();
      _weekCount += LOAD_INCREMENT;
      renderTimeline();
    });
  }
}

function renderTimelineBody() {
  const body = document.getElementById('timelineBody');
  if (!body) return;

  const week = _weeks[_activeWeekIdx];
  if (!week) return;

  let html = '';

  // Week header
  const weekStartStr = MONTHS[week.start.getMonth()] + ' ' + week.start.getDate();
  html += '<div class="tl-week-header">';
  html += '<div class="tl-week-title">Week of ' + weekStartStr + '</div>';
  html += '<div class="tl-week-label">' + esc(week.label) + '</div>';
  html += '</div>';

  // Week summary
  html += renderWeekSummary(week);

  // Day cards
  week.days.forEach(function(day, i) {
    html += renderDayCard(day, i);
  });

  if (week.days.length === 0) {
    html += '<div class="tl-empty">No data for this week yet.</div>';
  }

  body.innerHTML = html;

  // Wire up day card interactions
  body.querySelectorAll('.tl-day-card').forEach(function(card) {
    card.addEventListener('click', function() {
      const d = this.dataset.date;
      _expandedDay = (_expandedDay === d) ? null : d;
      renderTimelineBody(); // only re-render body, nav stays put
    });
  });
}

function renderWeekSummary(week) {
  const days = week.days;
  if (days.length === 0) return '';

  const affectDays = days.filter(function(d) { return d.affect; });
  const avgV = affectDays.length > 0 ? affectDays.reduce(function(s, d) { return s + d.affect.v; }, 0) / affectDays.length : -1;
  const avgA = affectDays.length > 0 ? affectDays.reduce(function(s, d) { return s + d.affect.a; }, 0) / affectDays.length : -1;
  const totalTasks = days.reduce(function(s, d) { return s + d.tasks.length; }, 0);
  const totalPomos = days.reduce(function(s, d) { return s + d.pomodoroTotal; }, 0);

  // Category breakdown
  const catCounts = {};
  days.forEach(function(d) {
    d.tasks.forEach(function(t) {
      (t.categories || []).forEach(function(c) { catCounts[c] = (catCounts[c] || 0) + 1; });
    });
  });
  const topCats = Object.entries(catCounts).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 3);

  // Affect trajectory
  const firstHalf = affectDays.slice(0, Math.ceil(affectDays.length / 2));
  const secondHalf = affectDays.slice(Math.ceil(affectDays.length / 2));
  const firstAvg = firstHalf.length > 0 ? firstHalf.reduce(function(s, d) { return s + d.affect.v; }, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length > 0 ? secondHalf.reduce(function(s, d) { return s + d.affect.v; }, 0) / secondHalf.length : firstAvg;
  const trend = secondAvg - firstAvg;
  const trendLabel = trend > 0.5 ? '↗ up' : trend < -0.5 ? '↘ down' : '→ steady';

  // Habit rates
  const habitHtml = getHabits().filter(function(h) { return !h.bad; }).map(function(h) {
    const completed = days.filter(function(d) { return d.habits[h.id]; }).length;
    const pct = days.length > 0 ? Math.round((completed / days.length) * 100) : 0;
    const color = pct >= 70 ? 'var(--success)' : pct >= 40 ? '#ff9500' : 'var(--danger)';
    return '<div style="font-family:var(--font-mono);font-size:10px;color:' + color + ';">' + pct + '% ' + esc(h.label.toLowerCase()) + '</div>';
  }).join('');

  let html = '<div class="tl-summary">';

  // Affect ribbon
  html += '<div class="tl-affect-ribbon">';
  days.forEach(function(d) {
    const color = d.affect ? affectToColor(d.affect.v, d.affect.a) : 'var(--border-divider)';
    const title = DAY_NAMES[d.dow] + (d.affect ? ': ' + _affectLabel(d.affect.v, d.affect.a) : ': no log');
    html += '<div class="tl-ribbon-seg" style="background:' + color + '" title="' + title + '"></div>';
  });
  html += '</div>';

  // Stats row
  html += '<div class="tl-summary-stats">';

  // Affect stat
  html += '<div class="tl-stat">';
  html += '<div class="tl-stat-label">Avg Affect</div>';
  if (avgV >= 0) {
    html += '<div class="tl-stat-val"><div class="tl-orb-mini" style="background:' + affectToColor(Math.round(avgV), Math.round(avgA)) + '"></div>' + avgV.toFixed(1) + ' / ' + avgA.toFixed(1) + '</div>';
    html += '<div class="tl-stat-sub">' + trendLabel + '</div>';
  } else {
    html += '<div class="tl-stat-val">—</div>';
    html += '<div class="tl-stat-sub">no logs</div>';
  }
  html += '</div>';

  // Tasks stat
  html += '<div class="tl-stat">';
  html += '<div class="tl-stat-label">Tasks Done</div>';
  html += '<div class="tl-stat-val">' + totalTasks + (totalPomos > 0 ? ' <span style="color:#ff9500;font-weight:400;">· ' + totalPomos + '🍅</span>' : '') + '</div>';
  html += '<div class="tl-stat-sub">' + (topCats.length > 0 ? topCats.map(function(c) { return c[0]; }).join(', ') : '—') + '</div>';
  html += '</div>';

  // Habits stat
  html += '<div class="tl-stat">';
  html += '<div class="tl-stat-label">Habits</div>';
  html += habitHtml;
  html += '</div>';

  html += '</div>'; // stats
  html += '</div>'; // summary
  return html;
}

function renderDayCard(day, idx) {
  const todayStr = getTodayStr();
  const isToday = day.date === todayStr;
  const isExpanded = _expandedDay === day.date;
  const dayNum = day.dateObj.getDate();
  const dowLabel = DAY_NAMES[day.dow];
  const tasksDone = day.tasks.length;
  const goodHabits = getHabits().filter(function(h) { return !h.bad && day.habits[h.id]; }).length;
  const totalGood = getHabits().filter(function(h) { return !h.bad; }).length;
  const badHabits = getHabits().filter(function(h) { return h.bad && day.habits[h.id]; });

  // Density signals
  const hasReflection = !!day.reflection;
  const hasMultiAffect = day.affectCount > 1;
  const habitRatio = totalGood > 0 ? goodHabits / totalGood : 0;

  let html = '<div class="tl-day-card' + (isToday ? ' today' : '') + (isExpanded ? ' expanded' : '') + '" data-date="' + day.date + '" style="animation-delay:' + (idx * 40) + 'ms;">';

  // Collapsed row
  html += '<div class="tl-day-row">';

  // Date column
  html += '<div class="tl-day-date">';
  html += '<div class="tl-day-dow' + (isToday ? ' today' : '') + '">' + dowLabel + '</div>';
  html += '<div class="tl-day-num' + (isToday ? ' today' : '') + '">' + dayNum + '</div>';
  html += '</div>';

  // Affect orb — with multi-log ring
  if (day.affect) {
    const color = affectToColor(day.affect.v, day.affect.a);
    const ctxColor = day.affect.ctx ? CTX_COLORS[day.affect.ctx] || '' : '';
    var multiRing = hasMultiAffect ? 'box-shadow:0 0 12px ' + color + '44, inset 0 0 0 2px rgba(255,255,255,0.35);' : 'box-shadow:0 0 12px ' + color + '44;';
    html += '<div class="tl-orb" style="background:radial-gradient(circle at 35% 35%, ' + color + 'ee, ' + color + '88);' + multiRing + (ctxColor ? 'border-color:' + ctxColor + '88;' : '') + '">';
    if (hasMultiAffect) {
      html += '<span class="tl-orb-count">' + day.affectCount + '</span>';
    }
    html += '</div>';
  } else {
    html += '<div class="tl-orb empty"></div>';
  }

  // Summary
  html += '<div class="tl-day-summary">';
  if (day.affect) {
    html += '<div class="tl-day-affect-label">' + _affectLabel(day.affect.v, day.affect.a);
    if (day.affect.ctx) {
      html += ' <span class="tl-ctx-tag" style="background:' + (CTX_COLORS[day.affect.ctx] || '#888') + '15;color:' + (CTX_COLORS[day.affect.ctx] || '#888') + ';">' + esc(day.affect.ctx) + '</span>';
    }
    html += '</div>';
  } else {
    html += '<div class="tl-day-affect-label muted">no affect logged</div>';
  }

  // Meta line with density indicators
  html += '<div class="tl-day-meta">';
  html += (tasksDone > 0 ? tasksDone + ' done' : 'no tasks');
  html += ' · ' + goodHabits + '/' + totalGood + ' habits';
  if (day.pomodoroTotal > 0) html += ' · ' + day.pomodoroTotal + '🍅';
  if (badHabits.length > 0) {
    html += ' · <span class="tl-bad">' + badHabits.map(function(h) { return h.label.toLowerCase(); }).join(', ') + '</span>';
  }
  html += '</div>';

  // Density icons row
  var icons = [];
  if (hasReflection) icons.push('<span class="tl-density-icon" title="Has reflection">✎</span>');
  if (tasksDone >= 5) icons.push('<span class="tl-density-icon productive" title="' + tasksDone + ' tasks completed">▪▪▪</span>');
  else if (tasksDone >= 3) icons.push('<span class="tl-density-icon" title="' + tasksDone + ' tasks completed">▪▪</span>');
  if (habitRatio >= 1 && totalGood > 0) icons.push('<span class="tl-density-icon perfect" title="All habits hit">★</span>');

  if (icons.length > 0) {
    html += '<div class="tl-density-row">' + icons.join('') + '</div>';
  }

  html += '</div>'; // summary

  // Expand arrow
  html += '<div class="tl-expand-arr' + (isExpanded ? ' open' : '') + '">›</div>';

  html += '</div>'; // row

  // Expanded content
  if (isExpanded) {
    html += '<div class="tl-day-detail">';

    // Tasks
    if (day.tasks.length > 0) {
      html += '<div class="tl-detail-section">';
      html += '<div class="tl-detail-label">Completed</div>';
      day.tasks.forEach(function(t) {
        const cat = (t.categories || [])[0];
        const catColor = CAT_COLORS[cat] || '#8e8e93';
        html += '<div class="tl-task-row">';
        html += '<div class="tl-task-dot" style="background:' + catColor + '"></div>';
        html += '<span class="tl-task-title">' + esc(t.title) + '</span>';
        if (t.pomodoros > 0) {
          html += '<span class="tl-task-pomo">' + t.pomodoros + '🍅</span>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Habits
    html += '<div class="tl-detail-section">';
    html += '<div class="tl-detail-label">Habits</div>';
    html += '<div class="tl-habit-chips">';
    getHabits().forEach(function(h) {
      if (day.habits[h.id]) {
        html += '<span class="tl-habit-chip' + (h.bad ? ' bad' : '') + '">' + (h.bad ? '✗' : '✓') + ' ' + esc(h.label) + '</span>';
      }
    });
    const missed = getHabits().filter(function(h) { return !h.bad && !day.habits[h.id]; });
    if (missed.length > 0) {
      html += '<div class="tl-missed">missed: ' + missed.map(function(h) { return h.label.toLowerCase(); }).join(', ') + '</div>';
    }
    html += '</div>';
    html += '</div>';

    // Reflection
    if (day.reflection) {
      html += '<div class="tl-detail-section">';
      html += '<div class="tl-detail-label">Reflection</div>';
      html += '<div class="tl-reflection">' + esc(day.reflection) + '</div>';
      html += '</div>';
    }

    html += '</div>'; // detail
  }

  html += '</div>'; // card
  return html;
}

function _affectLabel(v, a) {
  const vLabels = ['rough', 'low', 'neutral', 'okay', 'good'];
  const aLabels = ['drained', 'low-energy', 'moderate', 'alert', 'wired'];
  return vLabels[v] + ', ' + aLabels[a];
}

// ── Public API ──

function initTimeline() {
  // No standalone wiring needed — timeline lives inside the Reflect tab.
  // renderTimeline() is called by the reflect view's Review mode.
}

function onTimelineEnter() {
  _activeWeekIdx = 0;
  _expandedDay = null;
  _weekCount = 4;
  // Invalidate current week so it's recomputed fresh on entry
  _weekCache.delete(_currentISOWeek());
  renderTimeline();
}

export { initTimeline, renderTimeline, onTimelineEnter, invalidateCache };
