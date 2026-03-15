// ══════════════════════════════════════════════════════════════════
// DASHBOARD MODULE — all dashboard widgets
// Clock, weather, intention, countdown, quotes, reflection,
// mood tracker, habits, book tracker, today's tasks summary
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

const HABITS = [
  { id: 'sleep', label: 'Slept 7h+', bad: false },
  { id: 'read',  label: 'Read',      bad: false },
  { id: 'lift',  label: 'Lifted',    bad: false },
  { id: 'doom',  label: 'Doom scrolled', bad: true },
];

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

// ── MOOD ──

function renderMood() {
  const ds = getDState();
  if (!ds.moods) ds.moods = {};
  const today = getTodayStr(); const todayMood = ds.moods[today];
  document.querySelectorAll('.mood-btn').forEach(btn => { const val = parseInt(btn.dataset.val); btn.classList.toggle('active', val === todayMood); });
  const heatmap = document.getElementById('dMoodHeatmap'); heatmap.innerHTML = '';
  const colors = {1:'#ff3b30', 2:'#ff9500', 3:'#ffcc00', 4:'#a2d952', 5:'#30d158'};
  let sum = 0, count = 0;
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const val = ds.moods[dStr]; const cell = document.createElement('div'); cell.className = 'mood-cell';
    if (val) { cell.style.background = colors[val]; sum += val; count++; }
    heatmap.appendChild(cell);
  }
  const avgEl = document.getElementById('dMoodAvg');
  if (count > 0) { avgEl.textContent = '14-day avg: ' + (sum/count).toFixed(1); } else { avgEl.textContent = ''; }
}

// ── HABITS ──

function renderHabits() {
  const ds = getDState();
  const now = new Date(); const week = getISOWeek(now); const todayDow = getDayOfWeek();
  const dayLabels = ['M','T','W','T','F','S','S'];
  if (!ds.habits[week]) { ds.habits[week] = {}; }
  let habitsDirty = false;
  HABITS.forEach(h => { if (!ds.habits[week][h.id]) { ds.habits[week][h.id] = [false,false,false,false,false,false,false]; habitsDirty = true; } });
  const weeks = Object.keys(ds.habits).sort(); while (weeks.length > 2) { delete ds.habits[weeks.shift()]; habitsDirty = true; }
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

// ── FULL RENDER ──

function renderDashFull() {
  updateClock(); renderIntention(); renderDashTasks(); renderCountdown();
  renderQuote(); renderReflection(); renderMood(); renderHabits(); renderBook();
}

// ── ENTER / EXIT (called by router) ──

function onDashEnter() {
  renderDashFull();
  if (!weatherLoaded) loadWeather();
  if (!clockTimer) clockTimer = setInterval(updateClock, 1000);
}

function onDashExit() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

// ── INIT: wire up DOM events, receive dependencies ──

function initDashboard({ isActuallyDueToday, dueClass, fmtDue }) {
  _isActuallyDueToday = isActuallyDueToday;
  _dueClass = dueClass;
  _fmtDue = fmtDue;

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

  // Mood
  document.getElementById('dMoodSelect').addEventListener('click', function(e) {
    const btn = e.target.closest('.mood-btn'); if (!btn) return;
    const val = parseInt(btn.dataset.val); const today = getTodayStr(); const ds = getDState();
    if (!ds.moods) ds.moods = {};
    if (ds.moods[today] === val) { delete ds.moods[today]; } else { ds.moods[today] = val; }
    saveDash(true); renderMood();
  });

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
