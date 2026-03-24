// ══════════════════════════════════════════════════════════════════
// DASHBOARD MODULE — all dashboard widgets
// Clock, weather, intention, countdown, quotes, reflection,
// affect grid (valence × arousal), habits, book tracker,
// constructionist insights, weekly reflection
// ══════════════════════════════════════════════════════════════════

import { state, esc, saveDash, getDState, getHabits, showToast } from './state.js';
import { switchView } from './router.js';

// ── Dependencies injected from app.js via init ──
let _isActuallyDueToday = () => false;
let _dueClass = () => '';
let _fmtDue = () => '';

// ── Dashboard-local state ──
let reflectTimer = null;
let weeklyReflectTimer = null;

// ── DATA ──

const QUOTES = [
  { text: "I don't sing because I'm happy; I'm happy because I sing.", attr: "William James" },
  { text: "Between stimulus and response there is a space. In that space is our power to choose our response.", attr: "Viktor Frankl" },
  { text: "The body is our general medium for having a world.", attr: "Merleau-Ponty" },
  { text: "Emotions are not reactions to the world. They are your constructions of the world.", attr: "Lisa Feldman Barrett" },
  { text: "An emotion is your brain's creation of what your bodily sensations mean, in relation to what is going on around you.", attr: "Lisa Feldman Barrett" },
  { text: "We suffer more in imagination than in reality.", attr: "Seneca" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", attr: "Marcus Aurelius" },
  { text: "The unexamined life is not worth living.", attr: "Socrates" },
  { text: "Every experience is preceded by expectation.", attr: "William James" },
  { text: "The world of experience is produced by the mind that experiences it.", attr: "John Dewey" },
  { text: "Hard choices, easy life. Easy choices, hard life.", attr: "Jerzy Gregorek" },
  { text: "Your experiences are not a window on reality. They are the product of a brain predicting what comes next.", attr: "Lisa Feldman Barrett" },
  { text: "The mind that is not baffled is not employed. The impeded stream is the one that sings.", attr: "Wendell Berry" },
  { text: "Nothing is so practical as a good theory.", attr: "Kurt Lewin" },
  { text: "A year from now you will wish you had started today.", attr: "Karen Lamb" },
  { text: "Concepts are not reflections of reality; they are tools for constructing it.", attr: "John Dewey" },
  { text: "Most of what we say and do is not essential. Ask yourself at every moment: Is this necessary?", attr: "Marcus Aurelius" },
  { text: "The cost of a thing is the amount of what I will call life which is required to be exchanged for it.", attr: "Thoreau" },
];

const PROMPTS = [
  "What's one thing you're avoiding that you already know the answer to?",
  "What's the one task that, if done today, would make everything else easier?",
  "What am I noticing in my body right now? What does it mean to me?",
  "What would finishing strong today actually require?",
  "Am I categorizing my experience right now, or actually attending to it?",
  "What's the most important thing, and are you doing it first?",
  "What sensations are present right now? How am I making sense of them?",
  "What's cluttering your mental space right now?",
  "If I had to invent a new word for how I feel right now, what would it be?",
  "What does the best version of today look like?",
  "What predictions is my brain making right now — and are they accurate?",
  "If you could only accomplish three things today, what would they be?",
  "What concept am I using to understand this feeling? Is there a better one?",
  "What are you pretending not to know?",
  "How is my body budget right now — depleted, balanced, or surplus?",
];

const WEEKLY_PROMPTS = [
  "Looking at this week's affect pattern, how would you describe the emotional theme?",
  "What concept or word best captures how this week felt overall?",
  "If this week's experience had a color and a texture, what would they be?",
  "What sensations showed up most often this week? How did you make sense of them?",
  "What category would you give the dominant feeling-tone of this week?",
];

const RESEARCH_PROMPTS = [
  "What's a finding in your subfield you disagree with, and why?",
  "If you had unlimited funding and participants, what study would you run tomorrow?",
  "What's the weakest link in your current study's design?",
  "What would a skeptical reviewer say about your methods section right now?",
  "Name one researcher whose approach you want to emulate — what specifically?",
  "What's a construct in your field that's poorly measured? How would you fix it?",
  "What's a question you keep coming back to but haven't formalized into a study?",
  "If you could only publish one more paper, what would it be about?",
  "What's something you learned at a recent conference that changed how you think?",
  "What methodological skill would make your next study significantly better?",
  "What's an assumption in your theoretical framework you haven't tested?",
  "If you had to explain your research to a curious stranger in 60 seconds, what would you say?",
  "What's a dataset that exists somewhere that could answer a question you care about?",
  "What's a paper you keep citing without having fully engaged with its limitations?",
  "What would your research program look like in 5 years if everything went well?",
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

// ── REFLECTION ──

function migrateReflections() {
  var ds = getDState();
  // Migrate old single-string reflection to keyed structure
  if (!ds.reflections) ds.reflections = {};
  if (ds.reflection && ds.reflectionDate && !ds.reflections[ds.reflectionDate]) {
    ds.reflections[ds.reflectionDate] = ds.reflection;
  }
}

function renderReflection() {
  const ds = getDState();
  if (!ds.reflections) ds.reflections = {};
  if (!ds.researchReflections) ds.researchReflections = {};
  const today = getTodayStr();
  const doy = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = PROMPTS[doy % PROMPTS.length];
  document.getElementById('dPrompt').textContent = prompt;
  document.getElementById('dReflect').value = ds.reflections[today] || '';

  // Research prompt
  var resPromptEl = document.getElementById('dResearchPrompt');
  var resReflectEl = document.getElementById('dResearchReflect');
  if (resPromptEl && resReflectEl) {
    var resPrompt = RESEARCH_PROMPTS[doy % RESEARCH_PROMPTS.length];
    resPromptEl.textContent = resPrompt;
    resReflectEl.value = ds.researchReflections[today] || '';
  }
}

// ══════════════════════════════════════════════════════════════════
// AFFECT GRID — 2D valence x arousal
// Data: ds.affect = { "YYYY-MM-DD": { v: 0-4, a: 0-4, ctx: "work"|null } }
// Backward compat: ds.moods = { "YYYY-MM-DD": 1-5 } migrated on init
// ══════════════════════════════════════════════════════════════════

function migrateOldMoods() {
  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  // Migrate old moods → affect arrays
  if (ds.moods && Object.keys(ds.moods).length > 0) {
    Object.keys(ds.moods).forEach(function(dateStr) {
      if (!ds.affect[dateStr]) {
        var oldVal = ds.moods[dateStr]; // 1-5
        ds.affect[dateStr] = [{ v: oldVal - 1, a: 2, ctx: null, t: dateStr + 'T12:00:00' }];
      }
    });
    saveDash(false);
  }
  // Migrate single-object affect entries → arrays
  Object.keys(ds.affect).forEach(function(dateStr) {
    var entry = ds.affect[dateStr];
    if (entry && !Array.isArray(entry)) {
      ds.affect[dateStr] = [{ v: entry.v, a: entry.a, ctx: entry.ctx || null, t: entry.t || dateStr + 'T12:00:00' }];
    }
  });
}

// Get the latest affect entry for a date (returns object or null)
function getLatestAffect(dateStr) {
  var ds = getDState();
  if (!ds.affect || !ds.affect[dateStr]) return null;
  var arr = ds.affect[dateStr];
  if (!Array.isArray(arr)) return arr; // safety
  return arr.length > 0 ? arr[arr.length - 1] : null;
}

// Get all entries for a date
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

function renderAffect() {
  var ds = getDState();
  if (!ds.affect) ds.affect = {};
  var today = getTodayStr();
  var entry = getLatestAffect(today);
  var entries = getAffectEntries(today);

  var dot = document.getElementById('dAffectDot');
  if (entry) {
    dot.style.display = 'block';
    // Inset the dot so it doesn't get clipped at the edges of the grid
    var PAD = 6; // percent inset from each edge
    dot.style.left = PAD + (entry.v / (GRID_SIZE - 1)) * (100 - 2 * PAD) + '%';
    dot.style.top = PAD + (1 - entry.a / (GRID_SIZE - 1)) * (100 - 2 * PAD) + '%';
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

  // Log count indicator
  var logCountEl = document.getElementById('dAffectLogCount');
  if (logCountEl) {
    if (entries.length > 1) {
      logCountEl.style.display = 'block';
      logCountEl.textContent = entries.length + ' logs today';
    } else {
      logCountEl.style.display = 'none';
    }
  }

  // Mini history (last 7 days)
  var histEl = document.getElementById('dAffectHistory');
  histEl.innerHTML = '';
  for (var i = 6; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var ae = getLatestAffect(dStr);
    var dayEntries = getAffectEntries(dStr);
    var miniDot = document.createElement('div');
    miniDot.className = 'affect-mini-dot' + (dStr === today ? ' today' : '');
    if (ae) {
      miniDot.style.background = affectToColor(ae.v, ae.a);
      // Show subtle ring if multiple entries
      if (dayEntries.length > 1) {
        miniDot.style.boxShadow = 'inset 0 0 0 1.5px rgba(255,255,255,0.5)';
      }
    } else {
      miniDot.style.background = 'var(--border-divider)';
    }
    miniDot.title = dStr + (ae ? ' — v:' + ae.v + ' a:' + ae.a + (ae.ctx ? ' (' + ae.ctx + ')' : '') + (dayEntries.length > 1 ? ' (' + dayEntries.length + ' logs)' : '') : '');
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
  var now = new Date().toISOString();

  if (!ds.affect[today]) ds.affect[today] = [];
  if (!Array.isArray(ds.affect[today])) ds.affect[today] = [ds.affect[today]];

  var entries = ds.affect[today];
  var latest = entries.length > 0 ? entries[entries.length - 1] : null;

  // If last entry was less than 2 hours ago, overwrite it (dragging / adjusting)
  // Otherwise append a new entry
  var shouldAppend = true;
  if (latest && latest.t) {
    var lastTime = new Date(latest.t).getTime();
    var elapsed = Date.now() - lastTime;
    if (elapsed < 2 * 60 * 60 * 1000) shouldAppend = false; // less than 2 hours
  }

  if (shouldAppend && entries.length > 0) {
    entries.push({ v: v, a: a, ctx: null, t: now });
  } else if (entries.length > 0) {
    entries[entries.length - 1].v = v;
    entries[entries.length - 1].a = a;
    entries[entries.length - 1].t = now;
  } else {
    entries.push({ v: v, a: a, ctx: null, t: now });
  }

  // Backward compat
  if (!ds.moods) ds.moods = {};
  ds.moods[today] = v + 1;

  saveDash(true);

  var dot = document.getElementById('dAffectDot');
  dot.classList.add('placing');
  setTimeout(function() { dot.classList.remove('placing'); }, 200);

  renderAffect();
  renderInsights();
  renderSnapshot();
}

// ── HABITS ──

function renderHabits() {
  const ds = getDState();
  const now = new Date(); const week = getISOWeek(now); const todayDow = getDayOfWeek();
  const dayLabels = ['M','T','W','T','F','S','S'];
  if (!ds.habits[week]) { ds.habits[week] = {}; }
  let habitsDirty = false;
  getHabits().forEach(h => { if (!ds.habits[week][h.id]) { ds.habits[week][h.id] = [false,false,false,false,false,false,false]; habitsDirty = true; } });
  if (habitsDirty) saveDash(false);

  const labelRow = document.getElementById('dHabitDayLabels'); labelRow.innerHTML = '';
  dayLabels.forEach((l, i) => { const el = document.createElement('div'); el.className = 'd-day-label' + (i === todayDow ? ' today-col' : ''); el.textContent = l; labelRow.appendChild(el); });

  const rowsEl = document.getElementById('dHabitRows'); rowsEl.innerHTML = '';
  getHabits().forEach(h => {
    const checks = ds.habits[week][h.id] || [false,false,false,false,false,false,false];
    const scheduleDays = h.days || [0,1,2,3,4,5,6];
    const row = document.createElement('div'); row.className = 'd-habit-row';
    const label = document.createElement('div'); label.className = 'd-habit-label'; label.textContent = h.label;
    // Show schedule hint if not every day
    if (scheduleDays.length < 7) {
      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:9px;color:var(--text-muted);opacity:0.5;margin-left:4px;font-family:var(--font-mono);';
      const dayAbbr = ['M','T','W','T','F','S','S'];
      hint.textContent = scheduleDays.map(function(d){ return dayAbbr[d]; }).join('');
      label.appendChild(hint);
    }
    row.appendChild(label);
    const checksEl = document.createElement('div'); checksEl.className = 'd-habit-checks';
    checks.forEach((checked, i) => {
      const cb = document.createElement('div'); const isBad = h.bad;
      const isOffDay = scheduleDays.indexOf(i) === -1;
      cb.className = 'd-habit-cb'
        + (isOffDay ? ' off-day' : '')
        + (checked && !isOffDay ? (isBad ? ' checked-bad' : ' checked') : '')
        + (i === todayDow ? ' today-col' : '')
        + (i > todayDow ? ' future' : '');
      cb.dataset.habit = h.id; cb.dataset.day = i;
      if (!isOffDay) {
        cb.addEventListener('click', function() {
          if (!ds.habits[week][h.id]) ds.habits[week][h.id] = [false,false,false,false,false,false,false];
          ds.habits[week][h.id][i] = !ds.habits[week][h.id][i];
          const isNowChecked = ds.habits[week][h.id][i]; saveDash(true);
          if (h.bad) { cb.classList.toggle('checked-bad', isNowChecked); cb.classList.remove('checked'); }
          else { cb.classList.toggle('checked', isNowChecked); cb.classList.remove('checked-bad'); }
          cb.classList.remove('just-checked'); requestAnimationFrame(function() { requestAnimationFrame(function() { cb.classList.add('just-checked'); }); });
        });
      }
      checksEl.appendChild(cb);
    });
    row.appendChild(checksEl); rowsEl.appendChild(row);
  });
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
      getHabits().forEach(function(h) {
        var checks = (ds.habits[wk] && ds.habits[wk][h.id]) || [];
        if (checks[d]) daily[dateStr].habits[h.id] = true;
      });
    }
  });

  var affect = ds.affect || {};
  Object.keys(affect).forEach(function(dateStr) {
    if (!daily[dateStr]) daily[dateStr] = { habits: {}, affect: null };
    // Use latest entry for insights
    var arr = affect[dateStr];
    if (Array.isArray(arr) && arr.length > 0) {
      daily[dateStr].affect = arr[arr.length - 1];
    } else if (arr && !Array.isArray(arr)) {
      daily[dateStr].affect = arr; // legacy single object
    }
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

  // 1. AFFECT CALENDAR HEATMAP
  html += '<div class="ins-section">';
  html += '<div class="ins-label">Affect Calendar <span class="ins-sub">(last 90 days)</span></div>';
  html += renderAffectCalendar(daily);
  html += '</div>';

  // 2. AFFECT SPACE SCATTERPLOT
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

// ── AFFECT CALENDAR ──
function renderAffectCalendar(daily) {
  var today = new Date();
  var startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 89);

  var html = '<div class="ins-cal-wrap">';
  html += '<div class="ins-cal-day-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>';
  html += '<div class="ins-cal-grid">';

  // Find Monday on or before startDate
  var cursor = new Date(startDate);
  var dow = cursor.getDay() || 7;
  cursor.setDate(cursor.getDate() - (dow - 1));

  var endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 1);
  var currentMonth = -1;
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var todayStr = getTodayStr();

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
      var bg = ae ? affectToColor(ae.v, ae.a) : 'var(--border-divider)';
      var cls = 'ins-cal-cell' + (isToday ? ' today' : '') + (isFuture ? ' future' : '');
      var title = dStr + (ae ? ' — valence:' + ae.v + ' arousal:' + ae.a + (ae.ctx ? ' (' + ae.ctx + ')' : '') : '');
      html += '<div class="' + cls + '" style="background:' + (isFuture ? 'transparent' : bg) + '" title="' + title + '"></div>';
      cursor.setDate(cursor.getDate() + 1);
    }
    html += '</div>';
  }
  html += '</div>'; // grid

  // Legend: show the four corners
  html += '<div class="ins-cal-legend">';
  html += '<span class="ins-cal-legend-label">drained+rough</span>';
  html += '<div class="ins-cal-cell legend" style="background:' + affectToColor(0, 0) + '"></div>';
  html += '<div class="ins-cal-cell legend" style="background:' + affectToColor(2, 0) + '"></div>';
  html += '<div class="ins-cal-cell legend" style="background:' + affectToColor(2, 2) + '"></div>';
  html += '<div class="ins-cal-cell legend" style="background:' + affectToColor(2, 4) + '"></div>';
  html += '<div class="ins-cal-cell legend" style="background:' + affectToColor(4, 4) + '"></div>';
  html += '<span class="ins-cal-legend-label">wired+good</span>';
  html += '</div>';

  html += '</div>'; // wrap
  return html;
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

  getHabits().forEach(function(h) {
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
  getHabits().forEach(function(h) {
    var scheduleDays = h.days || [0,1,2,3,4,5,6];
    var total=0, checked=0, streakCurrent=0, inStreak=true;
    for (var i=relevantDates.length-1;i>=0;i--) {
      // Check if this date is a scheduled day for this habit
      var dateObj = new Date(relevantDates[i]+'T12:00:00');
      var dow = dateObj.getDay(); // 0=Sun
      var dowMon = dow===0?6:dow-1; // Convert to Mon=0
      if (scheduleDays.indexOf(dowMon) === -1) continue; // skip off-days entirely

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

// ── DAILY SNAPSHOT ──

function renderSnapshot() {
  var card = document.getElementById('dSnapshotCard');
  var body = document.getElementById('dSnapshotBody');
  if (!card || !body) return;

  var today = getTodayStr();
  var ds = getDState();
  var parts = [];

  // Tasks completed today
  var doneToday = state.tasks.filter(function(t) {
    return t.done && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString();
  });
  if (doneToday.length > 0) {
    // Find dominant category
    var catCounts = {};
    doneToday.forEach(function(t) {
      (t.categories || []).forEach(function(c) { catCounts[c] = (catCounts[c] || 0) + 1; });
    });
    var topCat = null, topCount = 0;
    Object.keys(catCounts).forEach(function(c) { if (catCounts[c] > topCount) { topCat = c; topCount = catCounts[c]; } });

    var taskStr = '<span class="snap-num">' + doneToday.length + '</span> task' + (doneToday.length !== 1 ? 's' : '') + ' done';
    if (topCat) taskStr += ' <span class="snap-dim">(mostly ' + esc(topCat) + ')</span>';
    parts.push(taskStr);
  }

  // Pomodoro sessions today
  var pomoToday = 0;
  state.tasks.forEach(function(t) {
    if (t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()) {
      pomoToday += (t.pomodoros || 0);
    }
    // Also count pomos on incomplete tasks that might have been worked today
    // (pomodoros increment during the day on focused tasks)
  });
  // Simpler: just count from pomo cycles if focus was used today
  // Actually, pomo.cycles resets — skip this unless we track it daily

  // Affect
  var ae = getLatestAffect(today);
  if (ae) {
    var vLabels = ['rough', 'low', 'neutral', 'okay', 'good'];
    var aLabels = ['drained', 'low-energy', 'moderate', 'alert', 'wired'];
    var affectStr = 'feeling <span class="snap-affect" style="color:' + affectToColor(ae.v, ae.a) + '">' + vLabels[ae.v] + ', ' + aLabels[ae.a] + '</span>';
    if (ae.ctx) affectStr += ' <span class="snap-dim">(' + esc(ae.ctx) + ')</span>';
    parts.push(affectStr);
  }

  // Habits checked today
  var week = getISOWeek(new Date());
  var todayDow = getDayOfWeek();
  var habitsChecked = [];
  getHabits().forEach(function(h) {
    var checks = ds.habits && ds.habits[week] && ds.habits[week][h.id];
    if (checks && checks[todayDow] && !h.bad) habitsChecked.push(h.label.toLowerCase());
    if (checks && checks[todayDow] && h.bad) habitsChecked.push(h.label.toLowerCase());
  });
  if (habitsChecked.length > 0) {
    parts.push(habitsChecked.join(', '));
  }

  // Show or hide
  if (parts.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  body.innerHTML = parts.map(function(p) { return '<div class="snap-line">' + p + '</div>'; }).join('');
}

// ── FULL RENDER (Today mode) ──

function renderReflectToday() {
  renderIntention(); renderDashTasks();
  renderReflection(); renderAffect(); renderHabits();
  renderSnapshot(); renderInsights();
}

// ── Segmented control state ──
let _reflectMode = 'today'; // 'today' or 'review'

function getReflectMode() { return _reflectMode; }

function setReflectMode(mode) {
  _reflectMode = mode;
  var todayEl = document.getElementById('reflectToday');
  var reviewEl = document.getElementById('reflectReview');
  var segToday = document.getElementById('reflectSegToday');
  var segReview = document.getElementById('reflectSegReview');
  if (!todayEl || !reviewEl) return;

  if (mode === 'today') {
    todayEl.style.display = '';
    reviewEl.style.display = 'none';
    if (segToday) segToday.classList.add('active');
    if (segReview) segReview.classList.remove('active');
    renderReflectToday();
  } else {
    todayEl.style.display = 'none';
    reviewEl.style.display = '';
    if (segToday) segToday.classList.remove('active');
    if (segReview) segReview.classList.add('active');
  }
}

// ── ENTER / EXIT ──

function onReflectEnter() {
  setReflectMode(_reflectMode);

  // Stagger animate the Today cards
  var container = document.getElementById('reflectToday');
  if (!container || _reflectMode !== 'today') return;
  var items = container.querySelectorAll(':scope > .d-card, :scope > .d-grid-2, :scope > details');
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

function onReflectExit() {
  var container = document.getElementById('reflectToday');
  if (container) {
    container.querySelectorAll('.stagger-child, .stagger-ready').forEach(function(el) {
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
  migrateReflections();

  // Intention
  document.getElementById('dIntention').addEventListener('input', function() { getDState().intention = this.value; saveDash(true); });

  // Reflection
  document.getElementById('dReflect').addEventListener('input', function() {
    var ds = getDState();
    if (!ds.reflections) ds.reflections = {};
    ds.reflections[getTodayStr()] = this.value;
    if (reflectTimer) clearTimeout(reflectTimer);
    reflectTimer = setTimeout(function() { saveDash(true); }, 800);
  });

  // Research reflection
  var resReflectEl = document.getElementById('dResearchReflect');
  if (resReflectEl) {
    resReflectEl.addEventListener('input', function() {
      var ds = getDState();
      if (!ds.researchReflections) ds.researchReflections = {};
      ds.researchReflections[getTodayStr()] = this.value;
      if (reflectTimer) clearTimeout(reflectTimer);
      reflectTimer = setTimeout(function() { saveDash(true); }, 800);
    });
  }

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
    var latest = getLatestAffect(today);
    if (!latest) return;
    latest.ctx = (latest.ctx === ctx) ? null : ctx;
    saveDash(true); renderAffect(); renderInsights(); renderSnapshot();
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

  // Segmented control
  var segToday = document.getElementById('reflectSegToday');
  var segReview = document.getElementById('reflectSegReview');
  if (segToday) segToday.addEventListener('click', function() { setReflectMode('today'); });
  if (segReview) segReview.addEventListener('click', function() { setReflectMode('review'); });
}

export { initDashboard, renderReflectToday, onReflectEnter, onReflectExit, getReflectMode, setReflectMode };

