// ══════════════════════════════════════════════════════════════════
// DASHBOARD MODULE — all dashboard widgets
// Clock, weather, intention, countdown, quotes, reflection,
// affect grid (valence × arousal), habits, book tracker,
// constructionist insights, weekly reflection
// ══════════════════════════════════════════════════════════════════

import { state, esc, saveDash, getDState } from './state.js';
import { switchView } from './router.js';

// ── Dependencies injected from app.js via init ──
let _isActuallyDueToday = () => false;
let _dueClass = () => '';
let _fmtDue = () => '';

// ── Dashboard-local state ──
let clockTimer = null;
let weatherLoaded = false;
let reflectTimer = null;
let weeklyReflectTimer = null;

// ── DATA ──

const QUOTES = [
  { text: "The cost of a thing is the amount of what I will call life which is required to be exchanged for it.", attr: "Thoreau" },
  { text: "Do not seek to have events happen as you want them to, but instead want them to happen as they do happen, and your life will go well.", attr: "Epictetus" },
  { text: "You have power over your mind, not outside events. Realize this, and you will find strength.", attr: "Marcus Aurelius" },
  { text: "Simplicity is the ultimate sophistication.", attr: "Leonardo da Vinci" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", attr: "Marcus Aurelius" },
  { text: "We suffer more in imagination than in reality.", attr: "Seneca" },
  { text: "Be curious, not judgmental.", attr: "Walt Whitman" },
  { text: "The unexamined life is not worth living.", attr: "Socrates" },
  { text: "To know what you know and what you do not know — that is true knowledge.", attr: "Confucius" },
  { text: "Between stimulus and response there is a space. In that space is our power to choose our response.", attr: "Viktor Frankl" },
  { text: "Hard choices, easy life. Easy choices, hard life.", attr: "Jerzy Gregorek" },
  { text: "Most of what we say and do is not essential. Ask yourself at every moment: Is this necessary?", attr: "Marcus Aurelius" },
  { text: "The mind that is not baffled is not employed. The impeded stream is the one that sings.", attr: "Wendell Berry" },
  { text: "Perfectionism is the enemy of the good.", attr: "Voltaire" },
  { text: "A year from now you will wish you had started today.", attr: "Karen Lamb" },
];

const PROMPTS = [
  "What's one thing you're avoiding that you already know the answer to?",
  "What's the one task that, if done today, would make everything else easier?",
  "What does the best version of today look like?",
  "What would finishing strong today actually require?",
  "What are you pretending not to know?",
  "What's the most important thing, and are you doing it first?",
  "What would you do if you had half the time you think you need?",
  "What's cluttering your mental space right now?",
  "If you could only accomplish three things today, what would they be?",
];

const WEEKLY_PROMPTS = [
  "Looking at this week's affect pattern, how would you describe the emotional theme?",
  "What concept or word best captures how this week felt overall?",
  "If this week's experience had a color and a texture, what would they be?",
  "What sensations showed up most often this week? How did you make sense of them?",
  "What category would you give the dominant feeling-tone of this week?",
];

const HABITS = [
  { id: 'sleep', label: 'Slept 7h+', bad: false },
  { id: 'read',  label: 'Read',      bad: false },
  { id: 'lift',  label: 'Lifted',    bad: false },
  { id: 'doom',  label: 'Doom scrolled', bad: true },
];

// Affect grid constants
const GRID_SIZE = 5; // 5x5 grid, values 0-4
const CTX_COLORS = {
  work: '#ff9500', writing: '#af52de', social: '#ff2d55',
  rest: '#5ac8fa', exercise: '#30d158', lab: '#007aff',
  none: 'var(--text-muted)'
};

// ── TIME HELPERS ──

function getISOWeek(d) { const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7); return date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0'); }
function getWeekStart(d) { const date = new Date(d); const day = date.getDay(); const diff = (day === 0 ? -6 : 1 - day); date.setDate(date.getDate() + diff); return date; }
function getTodayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function getDayOfWeek() { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; }

// ── CLOCK ──

function updateClock() {
  const d = new Date(); const h = d.getHours(); const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12;
  document.getElementById('dClock').childNodes[0].textContent = h12 + ':' + String(m).padStart(2, '0');
  document.getElementById('dAmpm').textContent = ampm;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dDateSmall').textContent = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

// ── WEATHER ──

function fetchWeatherAt(lat, lon, cityHint, regionHint) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1';
  fetch(url).then(r => r.json()).then(d => {
    weatherLoaded = true; const cur = d.current; const daily = d.daily;
    document.getElementById('dWeatherTemp').textContent = Math.round(cur.temperature_2m) + '°';
    document.getElementById('dWeatherDesc').textContent = weatherDesc(cur.weathercode);
    document.getElementById('dWeatherHigh').textContent = 'H: ' + Math.round(daily.temperature_2m_max[0]) + '°';
    document.getElementById('dWeatherLow').textContent = 'L: ' + Math.round(daily.temperature_2m_min[0]) + '°';
    if (cityHint) { document.getElementById('dWeatherLabel').textContent = cityHint + (regionHint ? ', ' + regionHint : ''); }
    else { fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lon).then(r => r.json()).then(geo => { const city = (geo.address && (geo.address.city || geo.address.town || geo.address.village)) || ''; const st = (geo.address && geo.address.state) || ''; if (city) document.getElementById('dWeatherLabel').textContent = city + (st ? ', ' + st : ''); }).catch(function() {}); }
  }).catch(function() { document.getElementById('dWeatherDesc').textContent = 'Unavailable'; });
}

function loadWeather() {
  if (weatherLoaded) return;
  if (!navigator.geolocation) { document.getElementById('dWeatherDesc').textContent = 'Location unavailable'; return; }
  navigator.geolocation.getCurrentPosition(
    pos => { fetchWeatherAt(pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4)); },
    function() {
      document.getElementById('dWeatherDesc').textContent = 'Locating…';
      fetch('https://ipapi.co/json/').then(r => r.json()).then(d => {
        if (d && d.latitude && d.longitude) { fetchWeatherAt(d.latitude.toFixed(4), d.longitude.toFixed(4), d.city, d.region); }
        else { document.getElementById('dWeatherDesc').textContent = 'Location unavailable'; }
      }).catch(function() { document.getElementById('dWeatherDesc').textContent = 'Unavailable'; });
    },
    { timeout: 8000 }
  );
}

function weatherDesc(code) {
  if (code === 0) return 'Clear sky'; if (code <= 2) return 'Partly cloudy'; if (code === 3) return 'Overcast';
  if (code <= 9) return 'Fog'; if (code <= 19) return 'Drizzle'; if (code <= 29) return 'Rain';
  if (code <= 39) return 'Snow'; if (code <= 49) return 'Fog'; if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain'; if (code <= 79) return 'Snow'; if (code <= 84) return 'Rain showers';
  if (code <= 94) return 'Snow showers'; return 'Thunderstorm';
}

// ── INTENTION ──

function renderIntention() {
  const ds = getDState();
  const now = new Date(); const week = getISOWeek(now); const ws = getWeekStart(now);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dWeekMeta').textContent = 'Week of ' + months[ws.getMonth()] + ' ' + ws.getDate() + '  ·  ' + week;
  if (ds.intentionWeek !== week) { ds.intention = ''; ds.intentionWeek = week; saveDash(true); }
  document.getElementById('dIntention').value = ds.intention || '';
}

// ── TODAY'S TASKS ──

function renderDashTasks() {
  const todayTasks = state.tasks.filter(t => !t.done && _isActuallyDueToday(t)).slice(0, 5);
  const list = document.getElementById('dTaskList'); list.innerHTML = '';
  if (todayTasks.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:#333;padding:4px 0;">Nothing due today</div>';
  } else {
    todayTasks.forEach(t => {
      const row = document.createElement('div'); row.className = 'd-task-row';
      const dc = _dueClass(t.due); const dueStr = t.due ? _fmtDue(t.due) : '';
      row.innerHTML = '<div class="d-task-dot ' + (t.priority || 'md') + '"></div><div class="d-task-name">' + esc(t.title) + '</div>' + (dueStr ? '<div class="d-task-due ' + dc + '">' + esc(dueStr) + '</div>' : '');
      list.appendChild(row);
    });
  }
  const open = state.tasks.filter(t => !t.done).length;
  const openText = document.getElementById('dOpenTasks');
  openText.textContent = open + ' open task' + (open !== 1 ? 's' : '') + '  switch to Tasks';
  openText.onclick = function() { switchView('tasks'); };
}

// ── COUNTDOWN ──

function renderCountdown() {
  const ds = getDState();
  const cd = ds.countdown;
  if (!cd || !cd.date) { document.getElementById('dCountdownNum').textContent = '—'; document.getElementById('dCountdownUnit').textContent = ''; document.getElementById('dCountdownEvent').textContent = 'No event set'; return; }
  const today = new Date(); today.setHours(0,0,0,0); const target = new Date(cd.date + 'T00:00:00'); const diff = Math.round((target - today) / 86400000);
  if (diff < 0) { document.getElementById('dCountdownNum').textContent = Math.abs(diff); document.getElementById('dCountdownUnit').textContent = 'days ago'; }
  else if (diff === 0) { document.getElementById('dCountdownNum').textContent = 'Today'; document.getElementById('dCountdownUnit').textContent = ''; }
  else { document.getElementById('dCountdownNum').textContent = diff; document.getElementById('dCountdownUnit').textContent = diff === 1 ? 'day away' : 'days away'; }
  document.getElementById('dCountdownEvent').textContent = cd.name || cd.date;
}

// ── QUOTES ──

function renderQuote() {
  const ds = getDState();
  const q = QUOTES[ds.quoteIdx % QUOTES.length];
  document.getElementById('dQuoteText').textContent = '"' + q.text + '"';
  document.getElementById('dQuoteAttr').textContent = '— ' + q.attr;
  document.getElementById('dQuoteIdx').textContent = (ds.quoteIdx % QUOTES.length + 1) + ' / ' + QUOTES.length;
}

// ── REFLECTION ──

function renderReflection() {
  const ds = getDState();
  const today = getTodayStr();
  if (ds.reflectionDate !== today) { ds.reflection = ''; ds.reflectionDate = today; saveDash(true); }
  const doy = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = PROMPTS[doy % PROMPTS.length];
  document.getElementById('dPrompt').textContent = prompt;
  document.getElementById('dReflect').value = ds.reflection || '';
}

// ══════════════════════════════════════════════════════════════════
// AFFECT GRID — 2D valence x arousal
// Data: ds.affect = { "YYYY-MM-DD": { v: 0-4, a: 0-4, ctx: "work"|null } }
// Backward compat: ds.moods = { "YYYY-MM-DD": 1-5 } migrated on init
// ══════════════════════════════════════════════════════════════════

function migrateOldMoods() {
  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  if (ds.moods && Object.keys(ds.moods).length > 0) {
    Object.keys(ds.moods).forEach(function(dateStr) {
      if (!ds.affect[dateStr]) {
        var oldVal = ds.moods[dateStr]; // 1-5
        ds.affect[dateStr] = { v: oldVal - 1, a: 2, ctx: null };
      }
    });
    saveDash(false);
  }
}

function affectToColor(v, a) {
  var vn = v / (GRID_SIZE - 1);
  var an = a / (GRID_SIZE - 1);
  // Corners: TL=orange(anxious) TR=red-pink(excited) BL=blue(depleted) BR=green(content)
  var tl = [255, 149, 0], tr = [255, 59, 48], bl = [90, 130, 200], br = [48, 209, 88];
  var r = Math.round(tl[0]*(1-vn)*an + tr[0]*vn*an + bl[0]*(1-vn)*(1-an) + br[0]*vn*(1-an));
  var g = Math.round(tl[1]*(1-vn)*an + tr[1]*vn*an + bl[1]*(1-vn)*(1-an) + br[1]*vn*(1-an));
  var b = Math.round(tl[2]*(1-vn)*an + tr[2]*vn*an + bl[2]*(1-vn)*(1-an) + br[2]*vn*(1-an));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function renderAffect() {
  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  var today = getTodayStr();
  var entry = ds.affect[today];

  var dot = document.getElementById('dAffectDot');
  if (entry) {
    dot.style.display = 'block';
    dot.style.left = (entry.v / (GRID_SIZE - 1)) * 100 + '%';
    dot.style.top = (1 - entry.a / (GRID_SIZE - 1)) * 100 + '%';
    dot.style.background = affectToColor(entry.v, entry.a);
  } else {
    dot.style.display = 'none';
  }

  document.querySelectorAll('.affect-ctx-chip').forEach(function(chip) {
    chip.classList.toggle('active', !!(entry && entry.ctx === chip.dataset.ctx));
  });

  var statusEl = document.getElementById('dAffectStatus');
  if (entry) {
    var vLabels = ['rough', 'low', 'neutral', 'okay', 'good'];
    var aLabels = ['drained', 'low-energy', 'moderate', 'alert', 'wired'];
    statusEl.textContent = vLabels[entry.v] + ' · ' + aLabels[entry.a];
  } else {
    statusEl.textContent = 'tap to log';
  }

  var histEl = document.getElementById('dAffectHistory');
  histEl.innerHTML = '';
  for (var i = 6; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var ae = ds.affect[dStr];
    var miniDot = document.createElement('div');
    miniDot.className = 'affect-mini-dot' + (dStr === today ? ' today' : '');
    miniDot.style.background = ae ? affectToColor(ae.v, ae.a) : 'var(--border-divider)';
    miniDot.title = dStr + (ae ? ' — v:' + ae.v + ' a:' + ae.a + (ae.ctx ? ' (' + ae.ctx + ')' : '') : '');
    histEl.appendChild(miniDot);
  }
}

function handleAffectGridInput(e, grid) {
  var rect = grid.getBoundingClientRect();
  var clientX = e.clientX, clientY = e.clientY;
  if (e.touches) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }

  var x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  var y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

  var v = Math.round(x * (GRID_SIZE - 1));
  var a = Math.round((1 - y) * (GRID_SIZE - 1));

  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  var today = getTodayStr();
  var existing = ds.affect[today];
  ds.affect[today] = { v: v, a: a, ctx: (existing && existing.ctx) || null };

  // Backward compat: also write to moods
  if (!ds.moods) ds.moods = {};
  ds.moods[today] = v + 1;

  saveDash(true);

  var dot = document.getElementById('dAffectDot');
  dot.classList.add('placing');
  setTimeout(function() { dot.classList.remove('placing'); }, 200);

  renderAffect();
  renderInsights();
}

// ── HABITS ──

function renderHabits() {
  const ds = getDState();
  const now = new Date(); const week = getISOWeek(now); const todayDow = getDayOfWeek();
  const dayLabels = ['M','T','W','T','F','S','S'];
  if (!ds.habits[week]) { ds.habits[week] = {}; }
  let habitsDirty = false;
  HABITS.forEach(h => { if (!ds.habits[week][h.id]) { ds.habits[week][h.id] = [false,false,false,false,false,false,false]; habitsDirty = true; } });
  if (habitsDirty) saveDash(false);

  const labelRow = document.getElementById('dHabitDayLabels'); labelRow.innerHTML = '';
  dayLabels.forEach((l, i) => { const el = document.createElement('div'); el.className = 'd-day-label' + (i === todayDow ? ' today-col' : ''); el.textContent = l; labelRow.appendChild(el); });

  const rowsEl = document.getElementById('dHabitRows'); rowsEl.innerHTML = '';
  HABITS.forEach(h => {
    const checks = ds.habits[week][h.id] || [false,false,false,false,false,false,false];
    const row = document.createElement('div'); row.className = 'd-habit-row';
    const label = document.createElement('div'); label.className = 'd-habit-label'; label.textContent = h.label;
    row.appendChild(label);
    const checksEl = document.createElement('div'); checksEl.className = 'd-habit-checks';
    checks.forEach((checked, i) => {
      const cb = document.createElement('div'); const isBad = h.bad;
      cb.className = 'd-habit-cb' + (checked ? (isBad ? ' checked-bad' : ' checked') : '') + (i === todayDow ? ' today-col' : '') + (i > todayDow ? ' future' : '');
      cb.dataset.habit = h.id; cb.dataset.day = i;
      cb.addEventListener('click', function() {
        if (!ds.habits[week][h.id]) ds.habits[week][h.id] = [false,false,false,false,false,false,false];
        ds.habits[week][h.id][i] = !ds.habits[week][h.id][i];
        const isNowChecked = ds.habits[week][h.id][i]; saveDash(true);
        if (h.bad) { cb.classList.toggle('checked-bad', isNowChecked); cb.classList.remove('checked'); }
        else { cb.classList.toggle('checked', isNowChecked); cb.classList.remove('checked-bad'); }
        cb.classList.remove('just-checked'); requestAnimationFrame(function() { requestAnimationFrame(function() { cb.classList.add('just-checked'); }); });
      });
      checksEl.appendChild(cb);
    });
    row.appendChild(checksEl); rowsEl.appendChild(row);
  });
}

// ── BOOK ──

function renderBook() {
  const ds = getDState();
  const b = ds.book; const content = document.getElementById('dBookContent'); const btn = document.getElementById('dBookSetBtn');
  if (!b || !b.title) { content.innerHTML = '<div class="d-book-empty">No book set — tap to add one</div>'; btn.textContent = '+ set book'; return; }
  btn.textContent = 'Update progress';
  const pct = (b.total && b.current) ? Math.round((b.current / b.total) * 100) : 0;
  const pctClamped = Math.min(100, Math.max(0, pct));
  const pagesLeft = (b.total && b.current) ? (b.total - b.current) : null;
  content.innerHTML = '<div class="d-book-title">' + esc(b.title) + '</div>' +
    (b.author ? '<div class="d-book-author">' + esc(b.author) + '</div>' : '') +
    (b.total ? '<div class="d-book-prog-wrap"><div class="d-book-prog-fill" style="width:' + pctClamped + '%"></div></div><div class="d-book-pct">' + pct + '% · ' + (pagesLeft !== null ? pagesLeft + ' pages left' : '') + '</div>' : '');
}

// ══════════════════════════════════════════════════════════════════
// INSIGHTS — constructionist affect analytics
// ══════════════════════════════════════════════════════════════════

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

function buildDailyData() {
  var ds = getDState();
  var daily = {};

  var weeks = Object.keys(ds.habits || {}).sort();
  weeks.forEach(function(wk) {
    for (var d = 0; d < 7; d++) {
      var dateStr = weekDayToDate(wk, d);
      if (!daily[dateStr]) daily[dateStr] = { habits: {}, affect: null };
      HABITS.forEach(function(h) {
        var checks = (ds.habits[wk] && ds.habits[wk][h.id]) || [];
        if (checks[d]) daily[dateStr].habits[h.id] = true;
      });
    }
  });

  var affect = ds.affect || {};
  Object.keys(affect).forEach(function(dateStr) {
    if (!daily[dateStr]) daily[dateStr] = { habits: {}, affect: null };
    daily[dateStr].affect = affect[dateStr];
  });

  return daily;
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
    renderWeeklyReflection();
    return;
  }

  var html = '';

  // 1. AFFECT SPACE SCATTERPLOT
  html += '<div class="ins-section">';
  html += '<div class="ins-label">Your Affect Space <span class="ins-sub">(last 90 days)</span></div>';
  html += renderAffectScatter(daily, affectDates);
  html += '</div>';

  // 2. DUAL TREND
  if (affectDates.length >= 7) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">Valence & Arousal Trend <span class="ins-sub">(7-day rolling avg)</span></div>';
    html += renderDualTrend(daily, dates);
    html += '</div>';
  }

  // 3. AFFECT VARIABILITY
  if (affectDates.length >= 14) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">Affect Variability <span class="ins-sub">(14-day window)</span></div>';
    html += renderVariability(daily, affectDates);
    html += '</div>';
  }

  // 4. CONTEXT PROFILES
  var ctxDates = affectDates.filter(function(d) { return daily[d].affect.ctx; });
  if (ctxDates.length >= 5) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">Affect × Context <span class="ins-sub">(avg valence & arousal by activity)</span></div>';
    html += renderContextProfiles(daily, ctxDates);
    html += '</div>';
  }

  // 5. HABIT CO-OCCURRENCE
  if (affectDates.length >= 14) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">Affect × Habits <span class="ins-sub">(co-occurrence, not causal)</span></div>';
    html += renderHabitAffect(daily, affectDates);
    html += '</div>';
  }

  // 6. TEMPORAL DYNAMICS
  if (affectDates.length >= 14) {
    html += '<div class="ins-section">';
    html += '<div class="ins-label">Day-of-Week Patterns</div>';
    html += renderTemporalDynamics(daily, affectDates);
    html += '</div>';
  }

  // 7. HABIT COMPLETION
  html += '<div class="ins-section">';
  html += '<div class="ins-label">Habit Completion</div>';
  html += renderHabitRates(daily, dates);
  html += '</div>';

  container.innerHTML = html;
  renderWeeklyReflection();
}

// ── SCATTER ──
function renderAffectScatter(daily, affectDates) {
  var w = 240, h = 240, pad = 24;
  var innerW = w - pad * 2, innerH = h - pad * 2;

  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  var cutStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');
  var recent = affectDates.filter(function(d) { return d >= cutStr; });

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="max-width:260px;margin:0 auto;display:block;">';
  svg += '<defs>';
  svg += '<radialGradient id="scBg1" cx="100%" cy="0%"><stop offset="0%" stop-color="#ff3b30" stop-opacity="0.06"/><stop offset="60%" stop-color="#ff3b30" stop-opacity="0"/></radialGradient>';
  svg += '<radialGradient id="scBg2" cx="0%" cy="0%"><stop offset="0%" stop-color="#ff9500" stop-opacity="0.06"/><stop offset="60%" stop-color="#ff9500" stop-opacity="0"/></radialGradient>';
  svg += '<radialGradient id="scBg3" cx="100%" cy="100%"><stop offset="0%" stop-color="#30d158" stop-opacity="0.06"/><stop offset="60%" stop-color="#30d158" stop-opacity="0"/></radialGradient>';
  svg += '<radialGradient id="scBg4" cx="0%" cy="100%"><stop offset="0%" stop-color="#5a82c8" stop-opacity="0.06"/><stop offset="60%" stop-color="#5a82c8" stop-opacity="0"/></radialGradient>';
  svg += '</defs>';
  svg += '<rect x="'+pad+'" y="'+pad+'" width="'+innerW+'" height="'+innerH+'" rx="8" fill="var(--border-divider)"/>';
  svg += '<rect x="'+pad+'" y="'+pad+'" width="'+innerW+'" height="'+innerH+'" rx="8" fill="url(#scBg1)"/>';
  svg += '<rect x="'+pad+'" y="'+pad+'" width="'+innerW+'" height="'+innerH+'" rx="8" fill="url(#scBg2)"/>';
  svg += '<rect x="'+pad+'" y="'+pad+'" width="'+innerW+'" height="'+innerH+'" rx="8" fill="url(#scBg3)"/>';
  svg += '<rect x="'+pad+'" y="'+pad+'" width="'+innerW+'" height="'+innerH+'" rx="8" fill="url(#scBg4)"/>';

  var cx = pad + innerW/2, cy = pad + innerH/2;
  svg += '<line x1="'+pad+'" y1="'+cy+'" x2="'+(pad+innerW)+'" y2="'+cy+'" stroke="var(--text-muted)" stroke-opacity="0.15" stroke-width="0.5"/>';
  svg += '<line x1="'+cx+'" y1="'+pad+'" x2="'+cx+'" y2="'+(pad+innerH)+'" stroke="var(--text-muted)" stroke-opacity="0.15" stroke-width="0.5"/>';

  svg += '<text x="'+cx+'" y="'+(pad-8)+'" text-anchor="middle" font-family="var(--font-mono)" font-size="8" fill="var(--text-muted)" opacity="0.6">wired</text>';
  svg += '<text x="'+cx+'" y="'+(pad+innerH+14)+'" text-anchor="middle" font-family="var(--font-mono)" font-size="8" fill="var(--text-muted)" opacity="0.6">drained</text>';
  svg += '<text x="'+(pad-4)+'" y="'+(cy+3)+'" text-anchor="end" font-family="var(--font-mono)" font-size="8" fill="var(--text-muted)" opacity="0.6">rough</text>';
  svg += '<text x="'+(pad+innerW+4)+'" y="'+(cy+3)+'" text-anchor="start" font-family="var(--font-mono)" font-size="8" fill="var(--text-muted)" opacity="0.6">good</text>';

  var usedCtx = {};
  recent.forEach(function(dateStr, i) {
    var ae = daily[dateStr].affect;
    var px = pad + (ae.v / (GRID_SIZE - 1)) * innerW;
    var py = pad + (1 - ae.a / (GRID_SIZE - 1)) * innerH;
    var color = ae.ctx ? (CTX_COLORS[ae.ctx] || CTX_COLORS.none) : CTX_COLORS.none;
    if (ae.ctx) usedCtx[ae.ctx] = color;
    var opacity = Math.max(0.2, 1 - ((recent.length - i) / recent.length) * 0.7);
    svg += '<circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="5" fill="'+color+'" opacity="'+opacity.toFixed(2)+'" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>';
  });
  svg += '</svg>';

  var ctxKeys = Object.keys(usedCtx);
  if (ctxKeys.length > 0) {
    svg += '<div class="ins-scatter-legend">';
    ctxKeys.forEach(function(k) { svg += '<div class="ins-scatter-legend-item"><div class="ins-scatter-legend-dot" style="background:'+usedCtx[k]+'"></div>'+k+'</div>'; });
    svg += '<div class="ins-scatter-legend-item"><div class="ins-scatter-legend-dot" style="background:var(--text-muted)"></div>unlabeled</div>';
    svg += '</div>';
  }

  svg += '<div class="ins-note" style="margin-top:8px;">'+recent.length+' days plotted. Each dot is one day in your affect space.</div>';
  return svg;
}

// ── DUAL TREND ──
function renderDualTrend(daily, dates) {
  var allDates = [];
  var today = new Date(); var start = new Date(today); start.setDate(start.getDate() - 59);
  var cursor = new Date(start);
  while (cursor <= today) {
    allDates.push(cursor.getFullYear() + '-' + String(cursor.getMonth()+1).padStart(2,'0') + '-' + String(cursor.getDate()).padStart(2,'0'));
    cursor.setDate(cursor.getDate() + 1);
  }

  var vPoints = [], aPoints = [];
  for (var i = 0; i < allDates.length; i++) {
    var vSum = 0, aSum = 0, count = 0;
    for (var j = Math.max(0, i - 6); j <= i; j++) {
      var ae = daily[allDates[j]] ? daily[allDates[j]].affect : null;
      if (ae) { vSum += ae.v; aSum += ae.a; count++; }
    }
    if (count >= 2) {
      vPoints.push({ idx: i, val: vSum / count });
      aPoints.push({ idx: i, val: aSum / count });
    }
  }

  if (vPoints.length < 3) return '<div class="ins-note">Not enough data for trend.</div>';

  var w = 280, h = 60, padX = 2, padY = 4;
  var xScale = (w - 2 * padX) / (allDates.length - 1);
  var yScale = (h - 2 * padY) / (GRID_SIZE - 1);

  function buildPath(points) {
    var d = '';
    points.forEach(function(p, pi) {
      var x = padX + p.idx * xScale;
      var y = h - padY - p.val * yScale;
      d += (pi === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    });
    return d;
  }

  var html = '<div class="ins-dual-trend-wrap">';
  html += '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">';
  for (var g = 0; g < GRID_SIZE; g++) {
    var gy = h - padY - g * yScale;
    html += '<line x1="0" y1="'+gy.toFixed(1)+'" x2="'+w+'" y2="'+gy.toFixed(1)+'" stroke="var(--border-divider)" stroke-width="0.5"/>';
  }
  html += '<path d="'+buildPath(vPoints)+'" fill="none" stroke="#30d158" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>';
  html += '<path d="'+buildPath(aPoints)+'" fill="none" stroke="#ff9500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" stroke-dasharray="4,3"/>';
  html += '</svg>';

  html += '<div class="ins-dual-trend-legend">';
  html += '<span><span class="legend-line" style="background:#30d158;"></span> valence</span>';
  html += '<span><span class="legend-line" style="background:#ff9500;"></span> arousal</span>';
  if (vPoints.length > 0) {
    html += '<span style="margin-left:auto;">now: v='+vPoints[vPoints.length-1].val.toFixed(1)+' a='+aPoints[aPoints.length-1].val.toFixed(1)+'</span>';
  }
  html += '</div></div>';
  return html;
}

// ── VARIABILITY ──
function renderVariability(daily, affectDates) {
  var recent = affectDates.slice(-14);
  if (recent.length < 7) return '<div class="ins-note">Need more data for variability.</div>';

  var vs = [], as = [];
  recent.forEach(function(d) { var ae = daily[d].affect; vs.push(ae.v); as.push(ae.a); });

  function stdev(arr) {
    var n = arr.length, mean = arr.reduce(function(s,x){return s+x;},0)/n;
    return Math.sqrt(arr.reduce(function(s,x){return s+(x-mean)*(x-mean);},0)/n);
  }

  var vSD = stdev(vs), aSD = stdev(as);
  var combined = (vSD + aSD) / 2;
  var normalized = Math.min(1, combined / 1.5);
  var pct = Math.round(normalized * 100);

  var radius = 20, stroke = 5, circ = 2 * Math.PI * radius;
  var offset = circ * (1 - normalized);
  var ringColor = normalized > 0.5 ? '#30d158' : (normalized > 0.25 ? '#ffcc00' : '#ff9500');

  var html = '<div class="ins-variability">';
  html += '<div class="ins-variability-ring"><svg viewBox="0 0 52 52">';
  html += '<circle cx="26" cy="26" r="'+radius+'" fill="none" stroke="var(--border-divider)" stroke-width="'+stroke+'"/>';
  html += '<circle cx="26" cy="26" r="'+radius+'" fill="none" stroke="'+ringColor+'" stroke-width="'+stroke+'" stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+offset.toFixed(1)+'" stroke-linecap="round"/>';
  html += '</svg><div class="ins-variability-val">'+pct+'</div></div>';

  var granLabel = normalized > 0.5 ? 'High' : (normalized > 0.25 ? 'Moderate' : 'Low');
  html += '<div class="ins-variability-text">';
  html += '<strong>'+granLabel+' variability</strong> over '+recent.length+' days. ';
  html += 'Valence SD: '+vSD.toFixed(2)+', Arousal SD: '+aSD.toFixed(2)+'. ';
  if (normalized > 0.5) html += 'Your affect is differentiated — a wide range of states.';
  else if (normalized > 0.25) html += 'Moderate spread in your day-to-day experience.';
  else html += 'Fairly consistent affect — staying in a narrow band.';
  html += '</div></div>';
  return html;
}

// ── CONTEXT PROFILES ──
function renderContextProfiles(daily, ctxDates) {
  var profiles = {};
  ctxDates.forEach(function(d) {
    var ae = daily[d].affect, ctx = ae.ctx;
    if (!profiles[ctx]) profiles[ctx] = { vSum:0, aSum:0, count:0 };
    profiles[ctx].vSum += ae.v; profiles[ctx].aSum += ae.a; profiles[ctx].count++;
  });

  var keys = Object.keys(profiles).sort(function(a,b){ return profiles[b].count - profiles[a].count; });
  var html = '<div class="ins-context-profile">';
  keys.forEach(function(ctx) {
    var p = profiles[ctx];
    if (p.count < 2) return;
    var avgV = p.vSum/p.count, avgA = p.aSum/p.count;
    var vPct = (avgV/(GRID_SIZE-1))*100, aPct = (avgA/(GRID_SIZE-1))*100;
    var color = CTX_COLORS[ctx] || CTX_COLORS.none;

    html += '<div class="ins-ctx-row">';
    html += '<div class="ins-ctx-label">'+esc(ctx)+'</div>';
    html += '<div class="ins-ctx-bar-wrap">';
    html += '<div class="ins-ctx-bar" style="width:'+Math.max(20,vPct).toFixed(0)+'%;background:'+color+';opacity:0.8;">v '+avgV.toFixed(1)+'</div>';
    html += '<div class="ins-ctx-bar" style="width:'+Math.max(20,aPct).toFixed(0)+'%;background:'+color+';opacity:0.45;">a '+avgA.toFixed(1)+'</div>';
    html += '</div>';
    html += '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);width:20px;text-align:right;">'+p.count+'d</div>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="ins-note" style="margin-top:8px;">Solid = avg valence, faded = avg arousal. Higher = more pleasant / more energized.</div>';
  return html;
}

// ── HABIT × AFFECT ──
function renderHabitAffect(daily, affectDates) {
  var html = '<div class="ins-corr">';

  HABITS.forEach(function(h) {
    var wV=0, wA=0, wC=0, woV=0, woA=0, woC=0;
    affectDates.forEach(function(d) {
      var ae = daily[d].affect, did = daily[d].habits[h.id];
      if (did) { wV+=ae.v; wA+=ae.a; wC++; } else { woV+=ae.v; woA+=ae.a; woC++; }
    });

    if (wC < 3 || woC < 3) {
      html += '<div class="ins-corr-row"><span class="ins-corr-name">'+esc(h.label)+'</span><span class="ins-corr-val muted">not enough data</span></div>';
      return;
    }

    var wAvgV=wV/wC, woAvgV=woV/woC, wAvgA=wA/wC, woAvgA=woA/woC;
    var vDiff=wAvgV-woAvgV, aDiff=wAvgA-woAvgA;
    var effectiveVDiff = h.bad ? -vDiff : vDiff;

    var label, cls;
    if (Math.abs(vDiff)<0.15 && Math.abs(aDiff)<0.15) {
      label='no clear co-occurrence'; cls='flat';
    } else {
      var parts=[];
      if (Math.abs(vDiff)>=0.15) {
        parts.push(h.bad ? 'valence '+Math.abs(vDiff).toFixed(1)+(vDiff>0?' higher with':' higher without') : 'valence '+(vDiff>0?'+':'')+vDiff.toFixed(1));
      }
      if (Math.abs(aDiff)>=0.15) parts.push('arousal '+(aDiff>0?'+':'')+aDiff.toFixed(1));
      label=parts.join(', ');
      cls = effectiveVDiff>0.15 ? 'pos' : (effectiveVDiff<-0.15 ? 'neg' : 'flat');
    }

    html += '<div class="ins-corr-row"><span class="ins-corr-name">'+esc(h.label)+'</span><span class="ins-corr-val '+cls+'">'+label+'</span></div>';
    html += '<div class="ins-corr-bars">';
    html += '<div class="ins-corr-bar-row"><span class="ins-corr-bar-label">with</span><div class="ins-corr-bar"><div class="ins-corr-bar-fill" style="width:'+((wAvgV/(GRID_SIZE-1))*100).toFixed(0)+'%;background:var(--accent)"></div></div><span class="ins-corr-bar-val">'+wAvgV.toFixed(1)+'</span></div>';
    html += '<div class="ins-corr-bar-row"><span class="ins-corr-bar-label">w/o</span><div class="ins-corr-bar"><div class="ins-corr-bar-fill" style="width:'+((woAvgV/(GRID_SIZE-1))*100).toFixed(0)+'%;background:var(--text-muted)"></div></div><span class="ins-corr-bar-val">'+woAvgV.toFixed(1)+'</span></div>';
    html += '</div>';
  });

  html += '<div class="ins-note" style="margin-top:10px;">Based on '+affectDates.length+' days. Co-occurrence ≠ causation.</div>';
  html += '</div>';
  return html;
}

// ── TEMPORAL DYNAMICS ──
function renderTemporalDynamics(daily, affectDates) {
  var dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var buckets = []; for (var i=0;i<7;i++) buckets.push({vSum:0,aSum:0,count:0});

  affectDates.forEach(function(dateStr) {
    var d = new Date(dateStr+'T12:00:00');
    var dow = d.getDay(), idx = dow===0?6:dow-1;
    var ae = daily[dateStr].affect;
    buckets[idx].vSum+=ae.v; buckets[idx].aSum+=ae.a; buckets[idx].count++;
  });

  var html = '<div style="display:flex;flex-direction:column;gap:2px;">';
  buckets.forEach(function(b,i) {
    if (b.count<1) { html+='<div class="ins-temporal-row"><div class="ins-temporal-day">'+dayNames[i]+'</div><div style="font-size:10px;color:var(--text-muted);font-style:italic;">—</div></div>'; return; }
    var avgV=b.vSum/b.count, avgA=b.aSum/b.count;
    var vPct=(avgV/(GRID_SIZE-1))*100, aPct=(avgA/(GRID_SIZE-1))*100;
    html += '<div class="ins-temporal-row"><div class="ins-temporal-day">'+dayNames[i]+'</div>';
    html += '<div class="ins-temporal-bars">';
    html += '<div class="ins-temporal-bar" style="width:'+Math.max(8,vPct).toFixed(0)+'%;background:#30d158;opacity:0.7;"></div>';
    html += '<div class="ins-temporal-bar" style="width:'+Math.max(8,aPct).toFixed(0)+'%;background:#ff9500;opacity:0.45;"></div>';
    html += '</div>';
    html += '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);width:52px;text-align:right;">'+avgV.toFixed(1)+' / '+avgA.toFixed(1)+'</div></div>';
  });
  html += '</div>';
  html += '<div class="ins-note" style="margin-top:6px;">Green = valence, orange = arousal. Scale: 0 (rough/drained) to 4 (good/wired).</div>';
  return html;
}

// ── HABIT RATES ──
function renderHabitRates(daily, dates) {
  var today = getTodayStr();
  var relevantDates = dates.filter(function(d) { return d <= today; });
  if (relevantDates.length === 0) return '';

  var html = '<div class="ins-habit-rates">';
  HABITS.forEach(function(h) {
    var total=0, checked=0, streakCurrent=0, inStreak=true;
    for (var i=relevantDates.length-1;i>=0;i--) {
      var d=daily[relevantDates[i]], did=d&&d.habits[h.id];
      total++; if(did) checked++;
      if(inStreak&&did&&!h.bad) streakCurrent++;
      else if(inStreak&&!did&&!h.bad) inStreak=false;
      if(h.bad&&inStreak&&!did) streakCurrent++;
      else if(h.bad&&inStreak&&did) inStreak=false;
    }
    var pct=total>0?Math.round((checked/total)*100):0;
    var barColor=h.bad?'var(--danger)':'var(--success)';
    var streakLabel='';
    if(!h.bad&&streakCurrent>1) streakLabel=' · '+streakCurrent+'-day streak';
    else if(h.bad&&streakCurrent>1) streakLabel=' · '+streakCurrent+' days clean';

    html+='<div class="ins-habit-row"><div class="ins-habit-info"><span class="ins-habit-name">'+esc(h.label)+'</span><span class="ins-habit-pct">'+pct+'%'+streakLabel+'</span></div>';
    html+='<div class="ins-habit-bar"><div class="ins-habit-bar-fill" style="width:'+Math.min(100,pct)+'%;background:'+barColor+'"></div></div></div>';
  });
  html += '</div>';
  return html;
}

// ── WEEKLY REFLECTION ──
function renderWeeklyReflection() {
  var ds = getDState();
  var card = document.getElementById('dWeeklyReflectCard');
  if (!card) return;

  var now = new Date(), week = getISOWeek(now);
  var dow = now.getDay();
  var affectCount = Object.keys(ds.affect || {}).length;

  // Show Fri-Sun or if enough data exists
  if (affectCount < 5 && dow !== 0 && dow !== 5 && dow !== 6) {
    card.style.display = 'none'; return;
  }
  card.style.display = 'block';

  if (!ds.weeklyReflections) ds.weeklyReflections = {};

  var doy = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  var weekNum = Math.floor(doy / 7);
  document.getElementById('dWeeklyPrompt').textContent = WEEKLY_PROMPTS[weekNum % WEEKLY_PROMPTS.length];
  document.getElementById('dWeeklyReflect').value = ds.weeklyReflections[week] || '';

  var pastEl = document.getElementById('dPastLabels');
  pastEl.innerHTML = '';
  Object.keys(ds.weeklyReflections).sort().reverse().slice(0,8).forEach(function(wk) {
    var text = ds.weeklyReflections[wk];
    if (!text || text.length < 2) return;
    var el = document.createElement('span');
    el.className = 'ins-past-label';
    el.textContent = wk.replace(/^\d{4}-/,'') + ': ' + (text.length>35 ? text.slice(0,33)+'…' : text);
    el.title = wk + ': ' + text;
    pastEl.appendChild(el);
  });
}

// ── FULL RENDER ──

function renderDashFull() {
  updateClock(); renderIntention(); renderDashTasks(); renderCountdown();
  renderQuote(); renderReflection(); renderAffect(); renderHabits(); renderBook();
  renderInsights();
}

// ── ENTER / EXIT ──

function onDashEnter() {
  renderDashFull();
  if (!weatherLoaded) loadWeather();
  if (!clockTimer) clockTimer = setInterval(updateClock, 1000);

  var dash = document.getElementById('dashView');
  if (!dash) return;
  var items = dash.querySelectorAll(':scope > .d-card, :scope > .d-grid-2');
  items.forEach(function(el, i) {
    el.classList.remove('stagger-child'); el.classList.add('stagger-ready');
    el.style.setProperty('--si', i);
  });
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      items.forEach(function(el) { el.classList.remove('stagger-ready'); el.classList.add('stagger-child'); });
    });
  });
}

function onDashExit() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  var dash = document.getElementById('dashView');
  if (dash) {
    dash.querySelectorAll('.stagger-child, .stagger-ready').forEach(function(el) {
      el.classList.remove('stagger-child', 'stagger-ready');
    });
  }
}

// ── INIT ──

function initDashboard({ isActuallyDueToday, dueClass, fmtDue }) {
  _isActuallyDueToday = isActuallyDueToday;
  _dueClass = dueClass;
  _fmtDue = fmtDue;

  migrateOldMoods();

  // Intention
  document.getElementById('dIntention').addEventListener('input', function() { getDState().intention = this.value; saveDash(true); });

  // Countdown
  document.getElementById('dCountdownSetBtn').addEventListener('click', function() {
    const edit = document.getElementById('dCountdownEdit'); edit.classList.toggle('open');
    if (edit.classList.contains('open')) { const ds = getDState(); document.getElementById('dCountdownName').value = ds.countdown.name || ''; document.getElementById('dCountdownDate').value = ds.countdown.date || ''; }
  });
  document.getElementById('dCountdownSave').addEventListener('click', function() {
    const name = document.getElementById('dCountdownName').value.trim(); const date = document.getElementById('dCountdownDate').value;
    if (!date) return; getDState().countdown = { name, date }; saveDash(true); renderCountdown(); document.getElementById('dCountdownEdit').classList.remove('open');
  });

  // Quotes
  document.getElementById('dQuotePrev').addEventListener('click', function() { const ds = getDState(); ds.quoteIdx = (ds.quoteIdx - 1 + QUOTES.length) % QUOTES.length; saveDash(true); renderQuote(); });
  document.getElementById('dQuoteNext').addEventListener('click', function() { const ds = getDState(); ds.quoteIdx = (ds.quoteIdx + 1) % QUOTES.length; saveDash(true); renderQuote(); });

  // Reflection
  document.getElementById('dReflect').addEventListener('input', function() { getDState().reflection = this.value; if (reflectTimer) clearTimeout(reflectTimer); reflectTimer = setTimeout(function() { saveDash(); }, 800); });

  // ── AFFECT GRID ──
  var grid = document.getElementById('dAffectGrid');
  var isDrawing = false;
  grid.addEventListener('pointerdown', function(e) {
    isDrawing = true; grid.setPointerCapture(e.pointerId);
    handleAffectGridInput(e, grid);
  });
  grid.addEventListener('pointermove', function(e) { if (isDrawing) handleAffectGridInput(e, grid); });
  grid.addEventListener('pointerup', function() { isDrawing = false; });
  grid.addEventListener('pointercancel', function() { isDrawing = false; });

  // Context chips
  document.getElementById('dAffectContextRow').addEventListener('click', function(e) {
    var chip = e.target.closest('.affect-ctx-chip'); if (!chip) return;
    var ctx = chip.dataset.ctx;
    var ds = getDState();
    if (!ds.affect) ds.affect = {};
    var today = getTodayStr();
    if (!ds.affect[today]) return; // Must log affect first
    ds.affect[today].ctx = (ds.affect[today].ctx === ctx) ? null : ctx;
    saveDash(true); renderAffect(); renderInsights();
  });

  // Weekly reflection
  var weeklyEl = document.getElementById('dWeeklyReflect');
  if (weeklyEl) {
    weeklyEl.addEventListener('input', function() {
      var ds = getDState(), week = getISOWeek(new Date());
      if (!ds.weeklyReflections) ds.weeklyReflections = {};
      ds.weeklyReflections[week] = this.value;
      if (weeklyReflectTimer) clearTimeout(weeklyReflectTimer);
      weeklyReflectTimer = setTimeout(function() { saveDash(true); }, 800);
    });
  }

  // Book
  document.getElementById('dBookSetBtn').addEventListener('click', function() {
    const ds = getDState(); const edit = document.getElementById('dBookEdit'); edit.classList.toggle('open');
    if (edit.classList.contains('open') && ds.book) {
      document.getElementById('dBookTitle').value = ds.book.title || ''; document.getElementById('dBookAuthor').value = ds.book.author || '';
      document.getElementById('dBookCurrent').value = ds.book.current || ''; document.getElementById('dBookTotal').value = ds.book.total || '';
      setTimeout(function() { document.getElementById('dBookCurrent').focus(); }, 50);
    }
  });
  document.getElementById('dBookSave').addEventListener('click', function() {
    const ds = getDState(); const title = document.getElementById('dBookTitle').value.trim(); const author = document.getElementById('dBookAuthor').value.trim();
    const current = parseInt(document.getElementById('dBookCurrent').value) || 0; const total = parseInt(document.getElementById('dBookTotal').value) || 0;
    if (!title) return; ds.book = { title, author, current, total }; saveDash(true); renderBook(); document.getElementById('dBookEdit').classList.remove('open');
  });
}

export { initDashboard, renderDashFull, onDashEnter, onDashExit };
