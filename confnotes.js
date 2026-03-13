// ══════════════════════════════════════════════════════════════════
// NOTES MODULE — confnotes.js
// Load after app.js. Hooks into: ghPush, uid, esc, catCls, CAT_LABEL,
// state.projects, showToast, fmtShort, switchTab, toggleQuickAdd, openAddSheet
// ══════════════════════════════════════════════════════════════════

var CN_KEY = 'kw_confnotes_v1';
var cnNotes = [];
var cnActiveId = null;
var cnFilter = 'all';
var cnSaveTimer = null;

// ── PERSISTENCE ──
function loadCN() {
  try { var raw = localStorage.getItem(CN_KEY); if (raw) cnNotes = JSON.parse(raw); } catch(e) {}
  if (!cnNotes) cnNotes = [];
}

function saveCN(sync) {
  try { localStorage.setItem(CN_KEY, JSON.stringify(cnNotes)); } catch(e) {}
  if (sync) ghPush();
}

// Hook: called by patched ghFetch when payload contains cnNotes
window._cnLoadFromGH = function(data) {
  if (data) {
    cnNotes = data;
    try { localStorage.setItem(CN_KEY, JSON.stringify(cnNotes)); } catch(e) {}
    if (document.body.classList.contains('confnotes-mode')) renderCNList();
  }
};

// ── HELPERS ──
function cnTimeAgo(iso) {
  if (!iso) return '';
  var now = new Date(), then = new Date(iso);
  var diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  var diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  var diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay + 'd ago';
  return fmtShort(then);
}

// ── LIST RENDERING ──
function renderCNList() {
  var list = document.getElementById('cnNotesList');
  if (!list) return;
  list.innerHTML = '';

  var searchQ = '';
  var searchEl = document.getElementById('cnSearchInput');
  if (searchEl) searchQ = searchEl.value.trim().toLowerCase();

  var filtered = cnNotes.filter(function(n) {
    if (cnFilter !== 'all') {
      var tags = n.tags || [];
      if (tags.indexOf(cnFilter) === -1) return false;
    }
    if (searchQ) {
      var haystack = ((n.title||'') + ' ' + (n.speaker||'') + ' ' + (n.body||'')).toLowerCase();
      if (haystack.indexOf(searchQ) === -1) return false;
    }
    return true;
  });

  filtered.sort(function(a, b) {
    return (b.updatedAt || b.createdAt || '') > (a.updatedAt || a.createdAt || '') ? 1 : -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="cn-empty"><div class="cn-empty-icon">\u{1F4DD}</div><div class="cn-empty-text">' +
      (cnNotes.length === 0 ? 'No notes yet.<br>Tap + to start writing.' : 'No notes match this filter.') +
      '</div></div>';
    return;
  }

  filtered.forEach(function(n, i) {
    var card = document.createElement('div');
    card.className = 'cn-note-card';
    card.style.animationDelay = (i * 30) + 'ms';
    card.dataset.id = n.id;

    var tagsHtml = (n.tags || []).map(function(t) {
      return '<span class="cat ' + catCls(t) + '">' + esc(CAT_LABEL[t] || t) + '</span>';
    }).join('');

    var projHtml = '';
    if (n.projectId) {
      var p = (state.projects || []).find(function(x) { return x.id === n.projectId; });
      if (p) projHtml = '<span class="proj-link-label">\u26CC ' + esc(p.title) + '</span>';
    }

    card.innerHTML =
      '<div class="cn-card-title">' + esc(n.title || 'Untitled') + '</div>' +
      (n.speaker ? '<div class="cn-card-speaker">' + esc(n.speaker) + '</div>' : '') +
      (n.body ? '<div class="cn-card-preview">' + esc(n.body) + '</div>' : '') +
      '<div class="cn-card-meta">' + tagsHtml + projHtml +
      '<span class="cn-card-time">' + cnTimeAgo(n.updatedAt || n.createdAt) + '</span></div>';

    card.addEventListener('click', function() { openCNDetail(n.id); });
    list.appendChild(card);
  });
}

// ── DETAIL VIEW ──
function populateCNProjectSelect() {
  var sel = document.getElementById('cnProjectInput');
  if (!sel) return;
  sel.innerHTML = '<option value="">None</option>';
  (state.projects || []).forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    sel.appendChild(opt);
  });
}

function openCNDetail(id) {
  var n = null;
  for (var i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === id) { n = cnNotes[i]; break; }
  }
  if (!n) return;
  cnActiveId = id;
  populateCNProjectSelect();

  document.getElementById('cnTitleInput').value = n.title || '';
  document.getElementById('cnSpeakerInput').value = n.speaker || '';
  document.getElementById('cnBodyInput').value = n.body || '';
  var projInp = document.getElementById('cnProjectInput');
  if (projInp) projInp.value = n.projectId || '';

  var bodyEl = document.getElementById('cnBodyInput');
  var isMono = !!(n.bodyIsMono);
  bodyEl.classList.toggle('mono', isMono);
  document.getElementById('cnMonoToggle').textContent = isMono ? 'mono on' : 'mono off';

  // Tags
  var tags = n.tags || [];
  document.querySelectorAll('#cnTagRow .s-chip').forEach(function(c) {
    c.classList.toggle('active', tags.indexOf(c.dataset.val) !== -1);
  });

  // Meta line
  var metaEl = document.getElementById('cnDetailMeta');
  if (metaEl) {
    var parts = [];
    if (n.createdAt) parts.push('Created ' + cnTimeAgo(n.createdAt));
    if (n.updatedAt && n.updatedAt !== n.createdAt) parts.push('Updated ' + cnTimeAgo(n.updatedAt));
    metaEl.textContent = parts.join(' \u00B7 ');
  }

  document.getElementById('cnListView').style.display = 'none';
  document.getElementById('cnDetailView').style.display = 'block';
}

function closeCNDetail() {
  saveCNDetailNow();
  cnActiveId = null;
  document.getElementById('cnDetailView').style.display = 'none';
  document.getElementById('cnListView').style.display = 'block';
  renderCNList();
}

function saveCNDetailNow() {
  if (!cnActiveId) return;
  var n = null;
  for (var i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === cnActiveId) { n = cnNotes[i]; break; }
  }
  if (!n) return;

  n.title = document.getElementById('cnTitleInput').value.trim();
  n.speaker = document.getElementById('cnSpeakerInput').value.trim();
  n.body = document.getElementById('cnBodyInput').value;
  var projInp = document.getElementById('cnProjectInput');
  n.projectId = projInp ? projInp.value : '';
  n.bodyIsMono = document.getElementById('cnBodyInput').classList.contains('mono');

  var tags = [];
  document.querySelectorAll('#cnTagRow .s-chip.active').forEach(function(c) {
    tags.push(c.dataset.val);
  });
  n.tags = tags;
  n.updatedAt = new Date().toISOString();

  saveCN(true);
}

function queueCNSave() {
  if (cnSaveTimer) clearTimeout(cnSaveTimer);
  cnSaveTimer = setTimeout(saveCNDetailNow, 1200);
}

function createNewNote() {
  var n = {
    id: uid(),
    title: '',
    speaker: '',
    body: '',
    tags: [],
    projectId: '',
    bodyIsMono: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  cnNotes.unshift(n);
  saveCN(false);
  openCNDetail(n.id);
  setTimeout(function() { document.getElementById('cnTitleInput').focus(); }, 100);
  showToast('New note created');
}

function deleteCNNote(id) {
  cnNotes = cnNotes.filter(function(n) { return n.id !== id; });
  saveCN(true);
  closeCNDetail();
  showToast('Note deleted');
}

// ── DYNAMIC TAG/FILTER CHIPS FROM CAT_LABEL ──
function rebuildCNChips() {
  // Rebuild tag chips in detail view
  var tagRow = document.getElementById('cnTagRow');
  if (tagRow) {
    var activeVals = [];
    tagRow.querySelectorAll('.s-chip.active').forEach(function(c) { activeVals.push(c.dataset.val); });
    tagRow.innerHTML = '';
    Object.keys(CAT_LABEL).forEach(function(key) {
      var c = document.createElement('div');
      c.className = 's-chip' + (activeVals.indexOf(key) !== -1 ? ' active' : '');
      c.dataset.val = key;
      c.textContent = CAT_LABEL[key];
      tagRow.appendChild(c);
    });
  }
  // Rebuild filter chips in list view
  var filterRow = document.getElementById('cnFilterRow');
  if (filterRow) {
    var currentFilter = cnFilter;
    filterRow.innerHTML = '';
    var allChip = document.createElement('div');
    allChip.className = 'chip' + (currentFilter === 'all' ? ' active' : '');
    allChip.dataset.cnfilter = 'all';
    allChip.textContent = 'All';
    filterRow.appendChild(allChip);
    Object.keys(CAT_LABEL).forEach(function(key) {
      var c = document.createElement('div');
      c.className = 'chip' + (currentFilter === key ? ' active' : '');
      c.dataset.cnfilter = key;
      c.textContent = CAT_LABEL[key];
      filterRow.appendChild(c);
    });
  }
}

// ── EVENT WIRING ──
loadCN();
rebuildCNChips();

// Header icon — toggle confnotes view
document.getElementById('confNotesBtn').addEventListener('click', function() {
  if (document.body.classList.contains('confnotes-mode')) {
    switchTab('tasks');
  } else {
    switchTab('confnotes');
  }
});

document.getElementById('closeConfNotesBtn').addEventListener('click', function() {
  switchTab('tasks');
});

document.getElementById('cnBackBtn').addEventListener('click', closeCNDetail);

document.getElementById('cnDeleteBtn').addEventListener('click', function() {
  if (!cnActiveId) return;
  if (confirm('Delete this note?')) deleteCNNote(cnActiveId);
});

// Tag row — multi-select
document.getElementById('cnTagRow').addEventListener('click', function(e) {
  var chip = e.target.closest('.s-chip');
  if (!chip) return;
  chip.classList.toggle('active');
  queueCNSave();
});

// Auto-save on input
['cnTitleInput', 'cnSpeakerInput', 'cnBodyInput'].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('input', queueCNSave);
});
var cnProjInp = document.getElementById('cnProjectInput');
if (cnProjInp) cnProjInp.addEventListener('change', function() { saveCNDetailNow(); });

// Mono toggle
document.getElementById('cnMonoToggle').addEventListener('click', function() {
  var bodyEl = document.getElementById('cnBodyInput');
  var isMono = !bodyEl.classList.contains('mono');
  bodyEl.classList.toggle('mono', isMono);
  this.textContent = isMono ? 'mono on' : 'mono off';
  queueCNSave();
});

// Search
document.getElementById('cnSearchToggle').addEventListener('click', function() {
  var wrap = document.getElementById('cnSearchWrap');
  wrap.classList.toggle('open');
  if (wrap.classList.contains('open')) {
    document.getElementById('cnSearchInput').focus();
  } else {
    document.getElementById('cnSearchInput').value = '';
    renderCNList();
  }
});
document.getElementById('cnSearchInput').addEventListener('input', renderCNList);

// Filter chips
document.getElementById('cnFilterRow').addEventListener('click', function(e) {
  var chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#cnFilterRow .chip').forEach(function(c) { c.classList.remove('active'); });
  chip.classList.add('active');
  cnFilter = chip.dataset.cnfilter;
  renderCNList();
});

// ── FAB OVERRIDE: tap = new note when in confnotes mode ──
(function() {
  var fab = document.getElementById('fab');
  // Replace existing click handler
  var newFab = fab.cloneNode(true);
  fab.parentNode.replaceChild(newFab, fab);

  newFab.addEventListener('click', function() {
    if (document.body.classList.contains('confnotes-mode')) {
      createNewNote();
    } else {
      toggleQuickAdd();
    }
  });

  // Long-press: full task sheet (or new note in confnotes mode)
  var pressTimer;
  newFab.addEventListener('touchstart', function() {
    pressTimer = setTimeout(function() {
      if (document.body.classList.contains('confnotes-mode')) {
        createNewNote();
      } else {
        toggleQuickAdd();
        openAddSheet();
      }
    }, 600);
  }, { passive: true });
  newFab.addEventListener('touchend', function() { clearTimeout(pressTimer); }, { passive: true });
  newFab.addEventListener('contextmenu', function(e) { e.preventDefault(); });
})();

// ── KEYBOARD SHORTCUT: 'n' creates note in confnotes mode ──
document.addEventListener('keydown', function(e) {
  if (!document.body.classList.contains('confnotes-mode')) return;
  var tag = (document.activeElement || {}).tagName || '';
  var inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    e.stopPropagation();
    createNewNote();
  }
});