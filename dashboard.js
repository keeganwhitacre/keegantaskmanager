// ══════════════════════════════════════════════════════════════════
// DASHBOARD.JS — Reflect view: affect grid, habits, insights
// Stripped of: intention, daily reflection, snapshot, weekly review,
//              prompt card, research prompts, sliding pills.
// Preserved:   affect grid (5×5 continuous), habit tracking,
//              context chips, history strip, full insights suite.
// ══════════════════════════════════════════════════════════════════

import { state, esc, saveDash, getHabits, getDState, on } from './state.js';
import { ghPush } from './sync.js';
import { switchView } from './router.js';

// ── CONSTANTS ──

const GRID_SIZE = 5; // 0-4 on each axis

const CTX_LABELS = [
  { key: 'work',     label: 'work'     },
  { key: 'writing',  label: 'writing'  },
  { key: 'social',   label: 'social'   },
  { key: 'rest',     label: 'rest'     },
  { key: 'exercise', label: 'exercise' },
  { key: 'lab',      label: 'lab'      },
];

// ── TIME HELPERS ──

function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day  = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getDayOfWeek() {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1; // 0=Mon … 6=Sun
}

// ── AFFECT COLOR (bilinear across quadrants) ──

function affectToColor(v, a) {
  const vn = v / (GRID_SIZE - 1);
  const an = a / (GRID_SIZE - 1);
  const tl = [255, 149, 0], tr = [255, 59, 48], bl = [90, 130, 200], br = [48, 209, 88];
  const r = Math.round(tl[0]*(1-vn)*an + tr[0]*vn*an + bl[0]*(1-vn)*(1-an) + br[0]*vn*(1-an));
  const g = Math.round(tl[1]*(1-vn)*an + tr[1]*vn*an + bl[1]*(1-vn)*(1-an) + br[1]*vn*(1-an));
  const b = Math.round(tl[2]*(1-vn)*an + tr[2]*vn*an + bl[2]*(1-vn)*(1-an) + br[2]*vn*(1-an));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ── AFFECT DATA HELPERS ──

function getLatestAffect(dateStr) {
  const ds = getDState();
  if (!ds.affect || !ds.affect[dateStr]) return null;
  const arr = ds.affect[dateStr];
  if (!Array.isArray(arr)) return arr;
  return arr.length > 0 ? arr[arr.length - 1] : null;
}

function getAffectEntries(dateStr) {
  const ds = getDState();
  if (!ds.affect || !ds.affect[dateStr]) return [];
  const arr = ds.affect[dateStr];
  return Array.isArray(arr) ? arr : [arr];
}

// ══════════════════════════════════════════════════════════════════
// AFFECT GRID
// ══════════════════════════════════════════════════════════════════

function renderAffect() {
  const ds      = getDState();
  if (!ds.affect) ds.affect = {};
  const today   = getTodayStr();
  const entry   = getLatestAffect(today);
  const entries = getAffectEntries(today);

  // Position dot
  const dot = document.getElementById('dAffectDot');
  if (dot) {
    if (entry) {
      const PAD = 6;
      dot.style.left       = PAD + (entry.v / (GRID_SIZE - 1)) * (100 - 2 * PAD) + '%';
      dot.style.top        = PAD + (1 - entry.a / (GRID_SIZE - 1)) * (100 - 2 * PAD) + '%';
      dot.style.background = affectToColor(entry.v, entry.a);
      dot.classList.add('placed');
    } else {
      dot.classList.remove('placed');
    }
  }

  // Status text
  const statusEl = document.getElementById('dAffectStatus');
  if (statusEl) {
    if (entry) {
      const vLabels = ['rough', 'low', 'neutral', 'okay', 'good'];
      const aLabels = ['drained', 'low-energy', 'moderate', 'alert', 'wired'];
      const logNote = entries.length > 1 ? ' · ' + entries.length + ' logs' : '';
      statusEl.textContent = vLabels[entry.v] + ' · ' + aLabels[entry.a] + logNote;
    } else {
      statusEl.textContent = 'tap to log';
    }
  }

  // Context chips
  const ctxRow = document.getElementById('dAffectContextRow');
  if (ctxRow) {
    ctxRow.innerHTML = '';
    CTX_LABELS.forEach(function(ctx) {
      const chip = document.createElement('div');
      chip.className = 'chip' + (entry && entry.ctx === ctx.key ? ' active' : '');
      chip.dataset.ctx = ctx.key;
      chip.textContent = ctx.label;
      ctxRow.appendChild(chip);
    });
  }

  // History strip (last 14 days)
  const histEl = document.getElementById('dAffectHistory');
  if (histEl) {
    histEl.innerHTML = '';
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      const ae          = getLatestAffect(dStr);
      const dayEntries  = getAffectEntries(dStr);
      const dot         = document.createElement('div');
      dot.className     = 'affect-mini-dot' + (dStr === today ? ' today-entry' : '');
      dot.style.background = ae ? affectToColor(ae.v, ae.a) : 'var(--border)';
      if (ae && dayEntries.length > 1) dot.style.outline = '1px solid var(--text-tertiary)';
      dot.title = dStr + (ae ? ' · v:' + ae.v + ' a:' + ae.a : '');
      histEl.appendChild(dot);
    }
  }
}

function handleAffectGridInput(e, grid) {
  const rect    = grid.getBoundingClientRect();
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

  const x = Math.max(0, Math.min(1, (clientX - rect.left)  / rect.width));
  const y = Math.max(0, Math.min(1, (clientY - rect.top)   / rect.height));

  const v = Math.round(x * (GRID_SIZE - 1));
  const a = Math.round((1 - y) * (GRID_SIZE - 1));

  const ds    = getDState();
  if (!ds.affect) ds.affect = {};
  const today = getTodayStr();
  const now   = new Date().toISOString();

  if (!ds.affect[today]) ds.affect[today] = [];
  if (!Array.isArray(ds.affect[today])) ds.affect[today] = [ds.affect[today]];

  const entries = ds.affect[today];
  const latest  = entries.length > 0 ? entries[entries.length - 1] : null;

  // Overwrite if within 2 hours, else append
  const shouldAppend = !latest || !latest.t ||
    (Date.now() - new Date(latest.t).getTime()) >= 2 * 60 * 60 * 1000;

  if (shouldAppend) {
    entries.push({ v, a, ctx: null, t: now });
  } else {
    entries[entries.length - 1].v = v;
    entries[entries.length - 1].a = a;
    entries[entries.length - 1].t = now;
  }

  // Backward compat
  if (!ds.moods) ds.moods = {};
  ds.moods[today] = v + 1;

  saveDash(true);
  renderAffect();
  renderInsights();
}

// ══════════════════════════════════════════════════════════════════
// HABITS
// ══════════════════════════════════════════════════════════════════

function renderHabits() {
  const ds       = getDState();
  const now      = new Date();
  const week     = getISOWeek(now);
  const todayDow = getDayOfWeek();

  if (!ds.habits)       ds.habits = {};
  if (!ds.habits[week]) ds.habits[week] = {};

  // Ensure all habits have an entry for this week
  let dirty = false;
  getHabits().forEach(function(h) {
    if (!ds.habits[week][h.id]) {
      ds.habits[week][h.id] = [false,false,false,false,false,false,false];
      dirty = true;
    }
  });
  if (dirty) saveDash(false);

  const container = document.getElementById('dHabits');
  if (!container) return;
  container.innerHTML = '';

  getHabits().forEach(function(h) {
    const checks      = ds.habits[week][h.id] || [false,false,false,false,false,false,false];
    const scheduleDays = h.days || [0,1,2,3,4,5,6];
    const isScheduled = scheduleDays.includes(todayDow);
    const isChecked   = checks[todayDow];

    const row = document.createElement('div');
    row.className = 'habit-row';

    const name = document.createElement('div');
    name.className = 'habit-name';
    name.textContent = h.label;

    // Streak calc
    let streak = 0;
    for (let i = todayDow - 1; i >= 0; i--) {
      if (!scheduleDays.includes(i)) continue;
      if (checks[i]) streak++;
      else break;
    }
    if (isChecked) streak++;

    const right = document.createElement('div');
    right.style.cssText = 'display:flex; align-items:center; gap:8px;';

    if (streak > 1 && !h.bad) {
      const streakEl = document.createElement('span');
      streakEl.className = 'habit-streak';
      streakEl.textContent = streak + 'd';
      right.appendChild(streakEl);
    }

    const check = document.createElement('div');
    check.className = 'habit-check' + (isChecked ? ' done' : '') + (!isScheduled ? ' off-day' : '');
    check.style.opacity = isScheduled ? '1' : '0.3';
    check.innerHTML = '<svg viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3"/></svg>';

    check.addEventListener('click', function() {
      if (!isScheduled) return;
      const ds2 = getDState();
      if (!ds2.habits[week][h.id]) ds2.habits[week][h.id] = [false,false,false,false,false,false,false];
      ds2.habits[week][h.id][todayDow] = !ds2.habits[week][h.id][todayDow];
      saveDash(true); ghPush();
      renderHabits();
      renderInsights();
    });

    right.appendChild(check);
    row.appendChild(name);
    row.appendChild(right);
    container.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════════════
// INSIGHTS (full suite preserved)
// ══════════════════════════════════════════════════════════════════

function buildDailyData() {
  const ds    = getDState();
  const daily = {};

  // Habits
  Object.keys(ds.habits || {}).forEach(function(week) {
    Object.keys(ds.habits[week]).forEach(function(habitId) {
      const checks = ds.habits[week][habitId];
      checks.forEach(function(checked, dow) {
        // Convert week+dow to date string
        const dStr = _weekDowToDate(week, dow);
        if (!dStr) return;
        if (!daily[dStr]) daily[dStr] = { habits: {}, affect: null };
        daily[dStr].habits[habitId] = checked;
      });
    });
  });

  // Affect
  Object.keys(ds.affect || {}).forEach(function(dateStr) {
    if (!daily[dateStr]) daily[dateStr] = { habits: {}, affect: null };
    const arr = ds.affect[dateStr];
    daily[dateStr].affect = Array.isArray(arr) && arr.length > 0
      ? arr[arr.length - 1]
      : (arr && !Array.isArray(arr) ? arr : null);
  });

  return daily;
}

function _weekDowToDate(isoWeek, dow) {
  try {
    const parts = isoWeek.split('-W');
    const year  = parseInt(parts[0]);
    const week  = parseInt(parts[1]);
    const jan4  = new Date(year, 0, 4);
    const day   = jan4.getDay() || 7;
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - day + 1 + (week - 1) * 7);
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dow);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  } catch (e) { return null; }
}

function renderInsights() {
  const container = document.getElementById('dInsightsContent');
  if (!container) return;

  const daily       = buildDailyData();
  const dates       = Object.keys(daily).sort();
  const today       = getTodayStr();
  const affectDates = dates.filter(function(d) { return d <= today && daily[d] && daily[d].affect; });

  if (affectDates.length < 5) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0;font-style:italic;">log affect for ' + (5 - affectDates.length) + ' more days to see insights.</div>';
    return;
  }

  let html = '';

  // 1. Affect calendar heatmap
  html += '<div class="ins-section">';
  html += '<div class="ins-label">affect calendar <span class="ins-sub">(90 days)</span></div>';
  html += renderAffectCalendar(daily);
  html += '</div>';

  // 2. Affect scatter
  html += '<div class="ins-section">';
  html += '<div class="ins-label">affect space <span class="ins-sub">(90 days)</span></div>';
  html += renderAffectScatter(daily, affectDates);
  html += '</div>';

  // 3. Dual trend (7-day rolling avg)
  if (affectDates.length >= 7) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">valence & arousal trend <span class="ins-sub">(7-day avg)</span></div>';
    html += renderDualTrend(daily, dates);
    html += '</div>';
  }

  // 4. Variability
  if (affectDates.length >= 14) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">affect variability <span class="ins-sub">(14-day window)</span></div>';
    html += renderVariability(daily, affectDates);
    html += '</div>';
  }

  // 5. Context profiles
  const ctxDates = affectDates.filter(function(d) { return daily[d].affect.ctx; });
  if (ctxDates.length >= 5) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">affect × context <span class="ins-sub">(avg by activity)</span></div>';
    html += renderContextProfiles(daily, ctxDates);
    html += '</div>';
  }

  // 6. Habit × affect co-occurrence
  if (affectDates.length >= 14) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">affect × habits <span class="ins-sub">(co-occurrence, not causal)</span></div>';
    html += renderHabitAffect(daily, affectDates);
    html += '</div>';
  }

  // 7. Day-of-week patterns
  if (affectDates.length >= 14) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">day-of-week patterns</div>';
    html += renderTemporalDynamics(daily, affectDates);
    html += '</div>';
  }

  // 8. Habit completion rates
  html += '<div class="ins-section">';
  html += '<div class="ins-label">habit completion</div>';
  html += renderHabitRates(daily, dates);
  html += '</div>';

  container.innerHTML = html;
}

// ── CALENDAR HEATMAP ──
function renderAffectCalendar(daily) {
  const today     = new Date();
  const todayStr  = getTodayStr();
  const startDate = new Date(today); startDate.setDate(startDate.getDate() - 89);

  let cursor = new Date(startDate);
  const dow  = cursor.getDay() || 7;
  cursor.setDate(cursor.getDate() - (dow - 1));

  const endDate    = new Date(today); endDate.setDate(endDate.getDate() + 1);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let   currentMonth = -1;

  let html = '<div class="ins-cal-wrap">';
  html += '<div class="ins-cal-day-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>';
  html += '<div class="ins-cal-grid">';

  while (cursor <= endDate) {
    if (cursor.getMonth() !== currentMonth) {
      currentMonth = cursor.getMonth();
      html += '<div class="ins-cal-month">' + monthNames[currentMonth] + '</div>';
    }
    html += '<div class="ins-cal-row">';
    for (let i = 0; i < 7; i++) {
      const dStr  = cursor.getFullYear() + '-' + String(cursor.getMonth()+1).padStart(2,'0') + '-' + String(cursor.getDate()).padStart(2,'0');
      const ae    = daily[dStr] ? daily[dStr].affect : null;
      const isTod = dStr === todayStr;
      const isFut = cursor > today;
      const bg    = ae ? affectToColor(ae.v, ae.a) : 'var(--border)';
      html += '<div class="ins-cal-cell' + (isTod ? ' today' : '') + (isFut ? ' future' : '') + '" style="background:' + (isFut ? 'transparent' : bg) + '" title="' + dStr + (ae ? ' v:' + ae.v + ' a:' + ae.a : '') + '"></div>';
      cursor.setDate(cursor.getDate() + 1);
    }
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

// ── SCATTER ──
function renderAffectScatter(daily, affectDates) {
  const W = 220, H = 220, PAD = 20;
  const inner = W - PAD * 2;

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  const cutStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');
  const recent = affectDates.filter(function(d) { return d >= cutStr; });

  let dots = '';
  recent.forEach(function(d) {
    const ae = daily[d].affect;
    const x  = PAD + (ae.v / (GRID_SIZE - 1)) * inner;
    const y  = PAD + (1 - ae.a / (GRID_SIZE - 1)) * inner;
    dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="' + affectToColor(ae.v, ae.a) + '" opacity="0.7"/>';
  });

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px;">' +
    '<line x1="' + PAD + '" y1="' + (H/2) + '" x2="' + (W-PAD) + '" y2="' + (H/2) + '" stroke="var(--border)" stroke-width="0.5"/>' +
    '<line x1="' + (W/2) + '" y1="' + PAD + '" x2="' + (W/2) + '" y2="' + (H-PAD) + '" stroke="var(--border)" stroke-width="0.5"/>' +
    dots + '</svg>';
}

// ── DUAL TREND ──
function renderDualTrend(daily, dates) {
  const today = getTodayStr();
  const recent = dates.filter(function(d) { return d <= today && daily[d].affect; }).slice(-30);
  if (recent.length < 3) return '<div style="font-size:12px;color:var(--text-tertiary);">not enough data</div>';

  const W = 280, H = 80, PAD = 8;
  const pts = function(key) {
    return recent.map(function(d, i) {
      const x = PAD + (i / (recent.length - 1)) * (W - PAD * 2);
      const v = daily[d].affect[key] / (GRID_SIZE - 1);
      const y = PAD + (1 - v) * (H - PAD * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  };

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;">' +
    '<polyline points="' + pts('v') + '" fill="none" stroke="var(--text-primary)" stroke-width="1.5" opacity="0.7"/>' +
    '<polyline points="' + pts('a') + '" fill="none" stroke="var(--text-secondary)" stroke-width="1" opacity="0.5" stroke-dasharray="3,2"/>' +
    '</svg>' +
    '<div style="display:flex;gap:12px;margin-top:4px;">' +
    '<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-primary);">— valence</span>' +
    '<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);">- - arousal</span>' +
    '</div>';
}

// ── VARIABILITY ──
function renderVariability(daily, affectDates) {
  const today  = getTodayStr();
  const recent = affectDates.filter(function(d) { return d <= today; }).slice(-14);
  if (recent.length < 5) return '';

  function sd(arr) {
    const mean = arr.reduce(function(a,b){return a+b;},0) / arr.length;
    return Math.sqrt(arr.reduce(function(s,x){return s+(x-mean)*(x-mean);},0) / arr.length);
  }

  const vs = recent.map(function(d){ return daily[d].affect.v; });
  const as = recent.map(function(d){ return daily[d].affect.a; });
  const sdV = sd(vs).toFixed(2);
  const sdA = sd(as).toFixed(2);

  return '<div style="display:flex;gap:24px;">' +
    '<div><div style="font-family:var(--font-mono);font-size:18px;color:var(--text-primary);">' + sdV + '</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);">valence SD</div></div>' +
    '<div><div style="font-family:var(--font-mono);font-size:18px;color:var(--text-primary);">' + sdA + '</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);">arousal SD</div></div>' +
    '</div>';
}

// ── CONTEXT PROFILES ──
function renderContextProfiles(daily, ctxDates) {
  const profiles = {};
  ctxDates.forEach(function(d) {
    const ae = daily[d].affect;
    if (!ae.ctx) return;
    if (!profiles[ae.ctx]) profiles[ae.ctx] = { v: [], a: [] };
    profiles[ae.ctx].v.push(ae.v);
    profiles[ae.ctx].a.push(ae.a);
  });

  let html = '';
  Object.keys(profiles).forEach(function(ctx) {
    const p    = profiles[ctx];
    const avgV = (p.v.reduce(function(a,b){return a+b;},0) / p.v.length).toFixed(1);
    const avgA = (p.a.reduce(function(a,b){return a+b;},0) / p.a.length).toFixed(1);
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:0.5px solid var(--border);">' +
      '<span style="font-size:13px;color:var(--text-primary);">' + esc(ctx) + '</span>' +
      '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);">v:' + avgV + ' a:' + avgA + ' (n=' + p.v.length + ')</span>' +
      '</div>';
  });
  return html || '<div style="font-size:12px;color:var(--text-tertiary);">no context data</div>';
}

// ── HABIT × AFFECT ──
function renderHabitAffect(daily, affectDates) {
  const habits = getHabits().filter(function(h) { return !h.bad; });
  if (!habits.length) return '';

  let html = '';
  habits.forEach(function(h) {
    const withHabit    = affectDates.filter(function(d){ return daily[d].habits[h.id]; });
    const withoutHabit = affectDates.filter(function(d){ return !daily[d].habits[h.id]; });
    if (withHabit.length < 3) return;

    const avg = function(dates, key) {
      if (!dates.length) return 0;
      return (dates.reduce(function(s,d){ return s + daily[d].affect[key]; }, 0) / dates.length).toFixed(1);
    };

    html += '<div style="padding:6px 0;border-bottom:0.5px solid var(--border);">' +
      '<div style="font-size:13px;color:var(--text-primary);margin-bottom:3px;">' + esc(h.label) + '</div>' +
      '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);">' +
      'on: v' + avg(withHabit,'v') + ' a' + avg(withHabit,'a') +
      (withoutHabit.length >= 3 ? ' · off: v' + avg(withoutHabit,'v') + ' a' + avg(withoutHabit,'a') : '') +
      '</div></div>';
  });
  return html || '<div style="font-size:12px;color:var(--text-tertiary);">not enough data</div>';
}

// ── TEMPORAL DYNAMICS ──
function renderTemporalDynamics(daily, affectDates) {
  const byDow = [[],[],[],[],[],[],[]];
  affectDates.forEach(function(d) {
    const dow = new Date(d + 'T12:00:00').getDay();
    const idx = dow === 0 ? 6 : dow - 1;
    byDow[idx].push(daily[d].affect.v);
  });
  const labels = ['M','T','W','T','F','S','S'];
  const W = 280, H = 60, PAD = 8;
  const barW = (W - PAD * 2) / 7;
  let bars = '';
  byDow.forEach(function(vs, i) {
    if (!vs.length) return;
    const avg = vs.reduce(function(a,b){return a+b;},0) / vs.length;
    const h   = Math.max(4, (avg / (GRID_SIZE - 1)) * (H - PAD * 2));
    const x   = PAD + i * barW + barW * 0.15;
    const y   = H - PAD - h;
    bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (barW * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="var(--text-primary)" opacity="0.7" rx="2"/>';
    bars += '<text x="' + (x + barW * 0.35).toFixed(1) + '" y="' + (H - 1) + '" text-anchor="middle" font-size="8" fill="var(--text-tertiary)" font-family="monospace">' + labels[i] + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;">' + bars + '</svg>';
}

// ── HABIT RATES ──
function renderHabitRates(daily, dates) {
  const habits = getHabits();
  if (!habits.length) return '<div style="font-size:12px;color:var(--text-tertiary);">no habits configured</div>';

  const today  = getTodayStr();
  const recent = dates.filter(function(d) { return d <= today; }).slice(-28);

  let html = '';
  habits.forEach(function(h) {
    const scheduled = recent.filter(function(d) {
      const dow = new Date(d + 'T12:00:00').getDay();
      const idx = dow === 0 ? 6 : dow - 1;
      return (h.days || [0,1,2,3,4,5,6]).includes(idx);
    });
    const done = scheduled.filter(function(d){ return daily[d] && daily[d].habits[h.id]; });
    const pct  = scheduled.length ? Math.round((done.length / scheduled.length) * 100) : 0;

    html += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--border);">' +
      '<div style="flex:1;font-size:13px;color:var(--text-primary);">' + esc(h.label) + '</div>' +
      '<div style="width:80px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">' +
      '<div style="width:' + pct + '%;height:100%;background:var(--text-primary);opacity:' + (h.bad ? '0.4' : '0.8') + ';"></div></div>' +
      '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);width:30px;text-align:right;">' + pct + '%</div>' +
      '</div>';
  });
  return html;
}

// ══════════════════════════════════════════════════════════════════
// TODAY / REVIEW MODE
// ══════════════════════════════════════════════════════════════════

let _reflectMode = 'today';

function getReflectMode() { return _reflectMode; }

function setReflectMode(mode) {
  _reflectMode = mode;
  const todayEl  = document.getElementById('reflectToday');
  const reviewEl = document.getElementById('reflectReview');
  const segToday = document.getElementById('reflectSegToday');
  const segRev   = document.getElementById('reflectSegReview');

  if (!todayEl || !reviewEl) return;

  if (mode === 'today') {
    todayEl.style.display  = '';
    reviewEl.style.display = 'none';
    segToday?.classList.add('active');
    segRev?.classList.remove('active');
    renderReflectToday();
  } else {
    todayEl.style.display  = 'none';
    reviewEl.style.display = '';
    segToday?.classList.remove('active');
    segRev?.classList.add('active');
  }
}

function renderReflectToday() {
  renderAffect();
  renderHabits();
  renderInsights();
}

// ── ENTER / EXIT ──

function onReflectEnter() {
  setReflectMode(_reflectMode);
}

function onReflectExit() { /* nothing to tear down */ }

// ══════════════════════════════════════════════════════════════════
// INIT — wire up grid interaction, seg control, ctx chips
// ══════════════════════════════════════════════════════════════════

function initDashboard() {
  migrateOldMoods();

  // Affect grid interaction
  const grid = document.getElementById('dAffectGrid');
  if (grid) {
    let drawing = false;
    grid.addEventListener('pointerdown', function(e) {
      drawing = true;
      grid.setPointerCapture(e.pointerId);
      handleAffectGridInput(e, grid);
    });
    grid.addEventListener('pointermove', function(e) {
      if (drawing) handleAffectGridInput(e, grid);
    });
    grid.addEventListener('pointerup',     function() { drawing = false; });
    grid.addEventListener('pointercancel', function() { drawing = false; });
  }

  // Context chip taps
  const ctxRow = document.getElementById('dAffectContextRow');
  if (ctxRow) {
    ctxRow.addEventListener('click', function(e) {
      const chip = e.target.closest('[data-ctx]');
      if (!chip) return;
      const ctx   = chip.dataset.ctx;
      const today = getTodayStr();
      const entry = getLatestAffect(today);
      if (!entry) return;
      entry.ctx = (entry.ctx === ctx) ? null : ctx;
      saveDash(true);
      renderAffect();
    });
  }

  // Insights toggle — render on first open
  const insDetails = document.getElementById('dInsightsDetails');
  if (insDetails) {
    insDetails.addEventListener('toggle', function() {
      if (insDetails.open) renderInsights();
    });
  }

  // Seg control
  document.getElementById('reflectSegToday')?.addEventListener('click', function() { setReflectMode('today'); });
  document.getElementById('reflectSegReview')?.addEventListener('click', function() { setReflectMode('review'); });
}

// ── DATA MIGRATION ──
function migrateOldMoods() {
  const ds = getDState();
  if (!ds.affect) ds.affect = {};
  if (ds.moods && Object.keys(ds.moods).length > 0) {
    Object.keys(ds.moods).forEach(function(dateStr) {
      if (!ds.affect[dateStr]) {
        const old = ds.moods[dateStr];
        ds.affect[dateStr] = [{ v: old - 1, a: 2, ctx: null, t: dateStr + 'T12:00:00' }];
      }
    });
    saveDash(false);
  }
  // Normalize single-object entries to arrays
  Object.keys(ds.affect).forEach(function(dateStr) {
    const entry = ds.affect[dateStr];
    if (entry && !Array.isArray(entry)) {
      ds.affect[dateStr] = [{ v: entry.v, a: entry.a, ctx: entry.ctx || null, t: entry.t || dateStr + 'T12:00:00' }];
    }
  });
}

export { initDashboard, renderReflectToday, onReflectEnter, onReflectExit, getReflectMode, setReflectMode };
