// ══════════════════════════════════════════════════════════════════
// DASHBOARD MODULE — affect grid, habits, insights
// Stripped: intention, weekly review, snapshot, daily log, timeline
// ══════════════════════════════════════════════════════════════════

import { state, esc, saveDash, getDState, getHabits, showToast, on } from './state.js';

let _isActuallyDueToday = () => false;
let _dueClass = () => '';
let _fmtDue = () => '';

let reflectTimer = null;

// ── DATE HELPERS ──

function getTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function getISOWeek(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return date.getUTCFullYear() + '-W' + String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2,'0');
}

function getDayOfWeek() {
  var d = new Date().getDay(); return d === 0 ? 6 : d - 1;
}

// ── AFFECT GRID ──

const GRID_SIZE = 5;

function getLatestAffect(dateStr) {
  var ds = getDState();
  if (!ds.affect || !ds.affect[dateStr]) return null;
  var arr = ds.affect[dateStr];
  if (Array.isArray(arr)) return arr.length > 0 ? arr[arr.length - 1] : null;
  return arr;
}

function getAffectEntries(dateStr) {
  var ds = getDState();
  if (!ds.affect || !ds.affect[dateStr]) return [];
  var arr = ds.affect[dateStr];
  return Array.isArray(arr) ? arr : [arr];
}

function affectToColor(v, a) {
  var vn = v / (GRID_SIZE - 1);
  var an = a / (GRID_SIZE - 1);
  var tl = [255, 149, 0], tr = [255, 59, 48], bl = [90, 130, 200], br = [48, 209, 88];
  var r = Math.round(tl[0]*(1-vn)*an + tr[0]*vn*an + bl[0]*(1-vn)*(1-an) + br[0]*vn*(1-an));
  var g = Math.round(tl[1]*(1-vn)*an + tr[1]*vn*an + bl[1]*(1-vn)*(1-an) + br[1]*vn*(1-an));
  var b = Math.round(tl[2]*(1-vn)*an + tr[2]*vn*an + bl[2]*(1-vn)*(1-an) + br[2]*vn*(1-an));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function handleAffectGridInput(e, grid) {
  var rect = grid.getBoundingClientRect();
  var x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  var y = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
  var v = Math.round(x * (GRID_SIZE - 1));
  var a = Math.round((1 - y) * (GRID_SIZE - 1));

  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  var today = getTodayStr();
  if (!ds.affect[today]) ds.affect[today] = [];
  if (!Array.isArray(ds.affect[today])) ds.affect[today] = [ds.affect[today]];

  var entries = ds.affect[today];
  var now = new Date().toISOString();
  var latest = entries.length > 0 ? entries[entries.length - 1] : null;
  var shouldAppend = true;

  if (latest && latest.t) {
    var elapsed = Date.now() - new Date(latest.t).getTime();
    if (elapsed < 2 * 60 * 60 * 1000) shouldAppend = false;
  }

  if (shouldAppend && entries.length > 0) {
    entries.push({ v, a, ctx: null, t: now });
  } else if (entries.length > 0) {
    entries[entries.length - 1].v = v;
    entries[entries.length - 1].a = a;
    entries[entries.length - 1].t = now;
  } else {
    entries.push({ v, a, ctx: null, t: now });
  }

  if (!ds.moods) ds.moods = {};
  ds.moods[today] = v + 1;

  saveDash(true);

  var dot = document.getElementById('dAffectDot');
  if (dot) { dot.classList.add('placing'); setTimeout(function() { dot.classList.remove('placing'); }, 200); }

  renderAffect();
  renderInsights();
}

function renderAffect() {
  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  var today = getTodayStr();
  var entry = getLatestAffect(today);
  var entries = getAffectEntries(today);

  var dot = document.getElementById('dAffectDot');
  if (!dot) return;

  if (entry) {
    dot.style.display = 'block';
    var PAD = 6;
    dot.style.left = PAD + (entry.v / (GRID_SIZE - 1)) * (100 - 2 * PAD) + '%';
    dot.style.top  = PAD + (1 - entry.a / (GRID_SIZE - 1)) * (100 - 2 * PAD) + '%';
    dot.style.background = affectToColor(entry.v, entry.a);
  } else {
    dot.style.display = 'none';
  }

  document.querySelectorAll('.affect-ctx-chip').forEach(function(chip) {
    chip.classList.toggle('active', !!(entry && entry.ctx === chip.dataset.ctx));
  });

  var statusEl = document.getElementById('dAffectStatus');
  if (statusEl) {
    if (entry) {
      var vLabels = ['rough','low','neutral','okay','good'];
      var aLabels = ['drained','low-energy','moderate','alert','wired'];
      statusEl.textContent = vLabels[entry.v] + ' · ' + aLabels[entry.a];
    } else {
      statusEl.textContent = 'tap to log';
    }
  }

  var logCountEl = document.getElementById('dAffectLogCount');
  if (logCountEl) {
    logCountEl.style.display = entries.length > 1 ? 'block' : 'none';
    if (entries.length > 1) logCountEl.textContent = entries.length + ' logs today';
  }

  // Mini history dots (last 7 days)
  var histEl = document.getElementById('dAffectHistory');
  if (!histEl) return;
  histEl.innerHTML = '';
  for (var i = 6; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var ae = getLatestAffect(dStr);
    var miniDot = document.createElement('div');
    miniDot.className = 'affect-mini-dot' + (dStr === today ? ' today' : '');
    miniDot.style.background = ae ? affectToColor(ae.v, ae.a) : 'var(--border)';
    miniDot.title = dStr + (ae ? ': ' + ae.v + '/' + ae.a : '');
    histEl.appendChild(miniDot);
  }
}

// ── HABITS ──

function renderHabits() {
  var ds = getDState();
  var now = new Date();
  var week = getISOWeek(now);
  var todayDow = getDayOfWeek();
  var dayLabels = ['M','T','W','T','F','S','S'];

  if (!ds.habits[week]) ds.habits[week] = {};
  var habitsDirty = false;
  getHabits().forEach(function(h) {
    if (!ds.habits[week][h.id]) {
      ds.habits[week][h.id] = [false,false,false,false,false,false,false];
      habitsDirty = true;
    }
  });
  if (habitsDirty) saveDash(false);

  var labelRow = document.getElementById('dHabitDayLabels');
  if (labelRow) {
    labelRow.innerHTML = '';
    dayLabels.forEach(function(l, i) {
      var el = document.createElement('div');
      el.className = 'd-day-label' + (i === todayDow ? ' today-col' : '');
      el.textContent = l;
      labelRow.appendChild(el);
    });
  }

  var rowsEl = document.getElementById('dHabitRows');
  if (!rowsEl) return;
  rowsEl.innerHTML = '';

  getHabits().forEach(function(h) {
    var checks = ds.habits[week][h.id] || [false,false,false,false,false,false,false];
    var scheduleDays = h.days || [0,1,2,3,4,5,6];

    var row = document.createElement('div');
    row.className = 'habit-row';

    var label = document.createElement('div');
    label.className = 'habit-label';
    label.textContent = h.label;
    row.appendChild(label);

    var checksEl = document.createElement('div');
    checksEl.className = 'habit-checks';

    checks.forEach(function(checked, i) {
      var isBad = h.bad;
      var isOffDay = scheduleDays.indexOf(i) === -1;
      var cb = document.createElement('div');
      cb.className = 'habit-cb'
        + (isOffDay ? ' off' : '')
        + (checked && !isOffDay ? (isBad ? ' checked-bad' : ' checked') : '')
        + (i === todayDow ? ' today-col' : '')
        + (i > todayDow ? ' future' : '');
      cb.dataset.habit = h.id;
      cb.dataset.day = i;
      cb.textContent = dayLabels[i];

      if (!isOffDay) {
        cb.addEventListener('click', function() {
          if (!ds.habits[week][h.id]) ds.habits[week][h.id] = [false,false,false,false,false,false,false];
          ds.habits[week][h.id][i] = !ds.habits[week][h.id][i];
          var isNowChecked = ds.habits[week][h.id][i];
          saveDash(true);
          if (isBad) {
            cb.classList.toggle('checked-bad', isNowChecked);
            cb.classList.remove('checked');
          } else {
            cb.classList.toggle('checked', isNowChecked);
            cb.classList.remove('checked-bad');
          }
        });
      }
      checksEl.appendChild(cb);
    });

    row.appendChild(checksEl);
    rowsEl.appendChild(row);
  });
}

// ── INSIGHTS ──

function buildDailyData() {
  var ds = getDState();
  var daily = {};

  var weeks = Object.keys(ds.habits || {}).sort();
  weeks.forEach(function(wk) {
    for (var d = 0; d < 7; d++) {
      var dateStr = weekDayToDate(wk, d);
      if (!daily[dateStr]) daily[dateStr] = { habits: {}, affect: null };
      getHabits().forEach(function(h) {
        var checks = (ds.habits[wk] && ds.habits[wk][h.id]) || [];
        if (checks[d]) daily[dateStr].habits[h.id] = true;
      });
    }
  });

  var affect = ds.affect || {};
  Object.keys(affect).forEach(function(dateStr) {
    if (!daily[dateStr]) daily[dateStr] = { habits: {}, affect: null };
    var arr = affect[dateStr];
    if (Array.isArray(arr) && arr.length > 0) {
      daily[dateStr].affect = arr[arr.length - 1];
    } else if (arr && !Array.isArray(arr)) {
      daily[dateStr].affect = arr;
    }
  });

  return daily;
}

function weekDayToDate(isoWeek, dayIdx) {
  var parts = isoWeek.split('-W');
  var year = parseInt(parts[0]);
  var week = parseInt(parts[1]);
  var jan4 = new Date(year, 0, 4);
  var dow = jan4.getDay() || 7;
  var weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  var d = new Date(weekStart);
  d.setDate(d.getDate() + dayIdx);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function renderInsights() {
  var container = document.getElementById('dInsightsContent');
  if (!container) return;

  var daily = buildDailyData();
  var dates = Object.keys(daily).sort();
  var today = getTodayStr();
  var affectDates = dates.filter(function(d) { return d <= today && daily[d] && daily[d].affect; });

  if (affectDates.length < 5) {
    container.innerHTML = '<div class="ins-empty">Log your affect for ' + (5 - affectDates.length) + ' more days to see insights here.</div>';
    return;
  }

  var html = '';

  html += '<div class="ins-section"><div class="ins-label">Affect Calendar <span class="ins-sub">(last 90 days)</span></div>' + renderAffectCalendar(daily) + '</div>';
  html += '<div class="ins-section"><div class="ins-label">Affect Space <span class="ins-sub">(last 90 days)</span></div>' + renderAffectScatter(daily, affectDates) + '</div>';

  if (affectDates.length >= 7) {
    html += '<div class="ins-section"><div class="ins-label">Valence & Arousal Trend <span class="ins-sub">(7-day rolling avg)</span></div>' + renderDualTrend(daily, dates) + '</div>';
  }
  if (affectDates.length >= 14) {
    html += '<div class="ins-section"><div class="ins-label">Affect Variability <span class="ins-sub">(14-day window)</span></div>' + renderVariability(daily, affectDates) + '</div>';
  }

  var ctxDates = affectDates.filter(function(d) { return daily[d].affect.ctx; });
  if (ctxDates.length >= 5) {
    html += '<div class="ins-section"><div class="ins-label">Affect × Context <span class="ins-sub">(avg by activity)</span></div>' + renderContextProfiles(daily, ctxDates) + '</div>';
  }
  if (affectDates.length >= 14) {
    html += '<div class="ins-section"><div class="ins-label">Affect × Habits <span class="ins-sub">(co-occurrence, not causal)</span></div>' + renderHabitAffect(daily, affectDates) + '</div>';
    html += '<div class="ins-section"><div class="ins-label">Day-of-Week Patterns</div>' + renderTemporalDynamics(daily, affectDates) + '</div>';
  }

  html += '<div class="ins-section"><div class="ins-label">Habit Completion</div>' + renderHabitRates(daily, dates) + '</div>';

  container.innerHTML = html;
}

function renderAffectCalendar(daily) {
  var today = new Date();
  var startDate = new Date(today); startDate.setDate(startDate.getDate() - 89);
  var todayStr = getTodayStr();
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var html = '<div class="ins-cal-wrap"><div class="ins-cal-day-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="ins-cal-grid">';

  var cursor = new Date(startDate);
  var dow = cursor.getDay() || 7;
  cursor.setDate(cursor.getDate() - (dow - 1));

  var endDate = new Date(today); endDate.setDate(endDate.getDate() + 1);
  var currentMonth = -1;

  while (cursor <= endDate) {
    if (cursor.getMonth() !== currentMonth) {
      currentMonth = cursor.getMonth();
      html += '<div class="ins-cal-month">' + monthNames[currentMonth] + '</div>';
    }
    html += '<div class="ins-cal-row">';
    for (var i = 0; i < 7; i++) {
      var dStr = cursor.getFullYear() + '-' + String(cursor.getMonth()+1).padStart(2,'0') + '-' + String(cursor.getDate()).padStart(2,'0');
      var ae = daily[dStr] ? daily[dStr].affect : null;
      var isToday = dStr === todayStr;
      var isFuture = cursor > today;
      var cls = 'ins-cal-cell' + (isToday ? ' today' : '') + (isFuture ? ' future' : '');
      var title = dStr + (ae ? ' — v:' + ae.v + ' a:' + ae.a : '');
      html += '<div class="' + cls + '" style="background:' + (isFuture ? 'transparent' : (ae ? affectToColor(ae.v, ae.a) : 'var(--border)')) + '" title="' + title + '"></div>';
      cursor.setDate(cursor.getDate() + 1);
    }
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function renderAffectScatter(daily, affectDates) {
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  var cutStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');
  var recent = affectDates.filter(function(d) { return d >= cutStr; });

  var html = '<div class="ins-scatter-wrap">';
  html += '<div class="ins-scatter-axis-h"></div><div class="ins-scatter-axis-v"></div>';
  recent.forEach(function(dStr) {
    var ae = daily[dStr].affect;
    var x = (ae.v / (GRID_SIZE - 1)) * 100;
    var y = (1 - ae.a / (GRID_SIZE - 1)) * 100;
    html += '<div class="ins-scatter-point" style="left:' + x + '%;top:' + y + '%;background:' + affectToColor(ae.v, ae.a) + '"></div>';
  });
  html += '</div>';
  return html;
}

function renderDualTrend(daily, dates) {
  var today = getTodayStr();
  var relevant = dates.filter(function(d) { return d <= today && daily[d].affect; });
  if (relevant.length < 3) return '';
  var last = relevant.slice(-14);

  var points = last.map(function(d) {
    var ae = daily[d].affect;
    return { v: ae.v / (GRID_SIZE-1), a: ae.a / (GRID_SIZE-1) };
  });

  var w = 300, h = 60;
  var xStep = w / Math.max(points.length - 1, 1);

  function makePath(key, color) {
    var d = points.map(function(p, i) {
      return (i === 0 ? 'M' : 'L') + (i * xStep).toFixed(1) + ',' + ((1 - p[key]) * h).toFixed(1);
    }).join(' ');
    return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>';
  }

  var html = '<div class="ins-trend-wrap"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
  html += makePath('v', '#30d158');
  html += makePath('a', '#ff9500');
  html += '</svg></div>';
  html += '<div style="display:flex;gap:12px;margin-top:4px;"><div style="font-size:10px;color:#30d158;">● valence</div><div style="font-size:10px;color:#ff9500;">● arousal</div></div>';
  return html;
}

function renderVariability(daily, affectDates) {
  var today = getTodayStr();
  var window14 = affectDates.filter(function(d) { return d <= today; }).slice(-14);
  if (window14.length < 3) return '';
  var vs = window14.map(function(d) { return daily[d].affect.v; });
  var as_ = window14.map(function(d) { return daily[d].affect.a; });

  function std(arr) {
    var mean = arr.reduce(function(s, x) { return s + x; }, 0) / arr.length;
    var variance = arr.reduce(function(s, x) { return s + (x - mean) * (x - mean); }, 0) / arr.length;
    return Math.sqrt(variance);
  }

  var vSD = std(vs).toFixed(2), aSD = std(as_).toFixed(2);
  var html = '<div style="display:flex;gap:20px;">';
  html += '<div><div style="font-size:20px;font-weight:600;color:var(--text-1);">' + vSD + '</div><div style="font-size:11px;color:var(--text-3);">Valence SD</div></div>';
  html += '<div><div style="font-size:20px;font-weight:600;color:var(--text-1);">' + aSD + '</div><div style="font-size:11px;color:var(--text-3);">Arousal SD</div></div>';
  html += '</div><div style="font-size:11px;color:var(--text-3);margin-top:6px;font-style:italic;">Higher SD = more variability (emotional granularity proxy)</div>';
  return html;
}

function renderContextProfiles(daily, ctxDates) {
  var profiles = {};
  ctxDates.forEach(function(d) {
    var ae = daily[d].affect;
    var ctx = ae.ctx;
    if (!profiles[ctx]) profiles[ctx] = { vSum: 0, aSum: 0, count: 0 };
    profiles[ctx].vSum += ae.v; profiles[ctx].aSum += ae.a; profiles[ctx].count++;
  });

  var html = '<div style="display:flex;flex-direction:column;gap:6px;">';
  Object.keys(profiles).sort().forEach(function(ctx) {
    var p = profiles[ctx];
    var avgV = (p.vSum / p.count).toFixed(1);
    var avgA = (p.aSum / p.count).toFixed(1);
    var color = affectToColor(Math.round(p.vSum/p.count), Math.round(p.aSum/p.count));
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>';
    html += '<div style="font-size:13px;color:var(--text-1);flex:1;">' + esc(ctx) + '</div>';
    html += '<div style="font-family:ui-monospace,monospace;font-size:11px;color:var(--text-3);">v:' + avgV + ' a:' + avgA + ' (n=' + p.count + ')</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderHabitAffect(daily, affectDates) {
  var today = getTodayStr();
  var habits = getHabits();
  var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  habits.forEach(function(h) {
    var withHabit = [], withoutHabit = [];
    affectDates.filter(function(d) { return d <= today; }).forEach(function(d) {
      var ae = daily[d].affect;
      var did = daily[d].habits[h.id];
      if (did) withHabit.push(ae.v); else withoutHabit.push(ae.v);
    });
    if (withHabit.length < 2 || withoutHabit.length < 2) return;
    var avgWith    = (withHabit.reduce(function(s,x){return s+x;},0) / withHabit.length).toFixed(1);
    var avgWithout = (withoutHabit.reduce(function(s,x){return s+x;},0) / withoutHabit.length).toFixed(1);
    html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<div style="font-size:13px;color:var(--text-1);flex:1;">' + esc(h.label) + '</div>';
    html += '<div style="font-family:ui-monospace,monospace;font-size:11px;color:var(--text-3);">✓ ' + avgWith + '  ✗ ' + avgWithout + '</div>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="font-size:11px;color:var(--text-3);margin-top:6px;font-style:italic;">Avg valence on days with vs. without habit. Correlation ≠ causation.</div>';
  return html;
}

function renderTemporalDynamics(daily, affectDates) {
  var dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var buckets = []; for (var i = 0; i < 7; i++) buckets.push({ vSum: 0, aSum: 0, count: 0 });
  affectDates.forEach(function(dateStr) {
    var d = new Date(dateStr + 'T12:00:00');
    var dow = d.getDay(), idx = dow === 0 ? 6 : dow - 1;
    var ae = daily[dateStr].affect;
    buckets[idx].vSum += ae.v; buckets[idx].aSum += ae.a; buckets[idx].count++;
  });

  var html = '<div style="display:flex;flex-direction:column;gap:4px;">';
  buckets.forEach(function(b, i) {
    if (b.count < 1) {
      html += '<div style="display:flex;align-items:center;gap:8px;"><div style="width:32px;font-size:11px;color:var(--text-3);">' + dayNames[i] + '</div><div style="font-size:11px;color:var(--text-4);font-style:italic;">—</div></div>';
      return;
    }
    var avgV = b.vSum/b.count, avgA = b.aSum/b.count;
    var vPct = (avgV/(GRID_SIZE-1)*100).toFixed(0);
    var aPct = (avgA/(GRID_SIZE-1)*100).toFixed(0);
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<div style="width:32px;font-size:11px;color:var(--text-3);">' + dayNames[i] + '</div>';
    html += '<div style="flex:1;display:flex;flex-direction:column;gap:2px;">';
    html += '<div style="height:3px;border-radius:2px;background:var(--border);overflow:hidden;"><div style="height:100%;width:' + vPct + '%;background:#30d158;opacity:0.8;border-radius:2px;"></div></div>';
    html += '<div style="height:3px;border-radius:2px;background:var(--border);overflow:hidden;"><div style="height:100%;width:' + aPct + '%;background:#ff9500;opacity:0.6;border-radius:2px;"></div></div>';
    html += '</div>';
    html += '<div style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-3);width:48px;text-align:right;">' + avgV.toFixed(1) + ' / ' + avgA.toFixed(1) + '</div>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="display:flex;gap:12px;margin-top:6px;"><span style="font-size:10px;color:#30d158;">● valence</span><span style="font-size:10px;color:#ff9500;">● arousal</span></div>';
  return html;
}

function renderHabitRates(daily, dates) {
  var today = getTodayStr();
  var relevant = dates.filter(function(d) { return d <= today; });
  if (relevant.length === 0) return '';

  var html = '<div class="ins-habit-rates">';
  getHabits().forEach(function(h) {
    var scheduleDays = h.days || [0,1,2,3,4,5,6];
    var total = 0, checked = 0, streakCurrent = 0, inStreak = true;
    for (var i = relevant.length - 1; i >= 0; i--) {
      var dateObj = new Date(relevant[i] + 'T12:00:00');
      var dow = dateObj.getDay();
      var dowMon = dow === 0 ? 6 : dow - 1;
      if (scheduleDays.indexOf(dowMon) === -1) continue;
      var d = daily[relevant[i]], did = d && d.habits[h.id];
      total++; if (did) checked++;
      if (inStreak && did && !h.bad) streakCurrent++;
      else if (inStreak && !did && !h.bad) inStreak = false;
      if (h.bad && inStreak && !did) streakCurrent++;
      else if (h.bad && inStreak && did) inStreak = false;
    }
    var pct = total > 0 ? Math.round((checked / total) * 100) : 0;
    var barColor = h.bad ? (pct < 30 ? '#30d158' : pct < 60 ? '#ff9500' : '#ff3b30') : (pct >= 80 ? '#30d158' : pct >= 50 ? '#ff9500' : '#ff3b30');
    var streakLabel = '';
    if (!h.bad && streakCurrent > 1) streakLabel = ' · ' + streakCurrent + '-day streak';
    else if (h.bad && streakCurrent > 1) streakLabel = ' · ' + streakCurrent + ' days clean';

    html += '<div class="ins-habit-row">';
    html += '<div class="ins-habit-info"><span class="ins-habit-name">' + esc(h.label) + '</span><span class="ins-habit-pct">' + pct + '%' + streakLabel + '</span></div>';
    html += '<div class="ins-habit-bar"><div class="ins-habit-bar-fill" style="width:' + Math.min(100, pct) + '%;background:' + barColor + '"></div></div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ── RENDER ALL ──

function renderReflect() {
  renderAffect();
  renderHabits();
  renderInsights();
}

// ── INIT ──

function initDashboard(deps) {
  if (deps) {
    if (deps.isActuallyDueToday) _isActuallyDueToday = deps.isActuallyDueToday;
    if (deps.dueClass) _dueClass = deps.dueClass;
    if (deps.fmtDue) _fmtDue = deps.fmtDue;
  }

  // Affect grid pointer events
  var grid = document.getElementById('dAffectGrid');
  if (grid) {
    var isDrawing = false;
    grid.addEventListener('pointerdown', function(e) {
      isDrawing = true;
      grid.setPointerCapture(e.pointerId);
      handleAffectGridInput(e, grid);
    });
    grid.addEventListener('pointermove', function(e) {
      if (isDrawing) handleAffectGridInput(e, grid);
    });
    grid.addEventListener('pointerup', function() { isDrawing = false; });
    grid.addEventListener('pointercancel', function() { isDrawing = false; });
  }

  // Context chips
  var ctxRow = document.getElementById('dAffectContextRow');
  if (ctxRow) {
    ctxRow.addEventListener('click', function(e) {
      var chip = e.target.closest('.affect-ctx-chip');
      if (!chip) return;
      var ctx = chip.dataset.ctx;
      var ds = getDState();
      if (!ds.affect) ds.affect = {};
      var today = getTodayStr();
      var latest = getLatestAffect(today);
      if (!latest) return;
      latest.ctx = (latest.ctx === ctx) ? null : ctx;
      saveDash(true);
      renderAffect();
      renderInsights();
    });
  }
}

function onReflectEnter() {
  renderReflect();
}

function onReflectExit() { /* nothing to clean up */ }

export { initDashboard, renderReflect, onReflectEnter, onReflectExit };