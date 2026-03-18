// ══════════════════════════════════════════════════════════════════
// UNIFIED NOTES MODULE — confnotes.js
// Scratchpad + structured notes in one view.
// Accesses shared state/utils via window._app bridge.
// ══════════════════════════════════════════════════════════════════

const _a = window._app;

let cnActiveId = null;
let cnFilter = 'all';
let cnSaveTimer = null;
let scratchSyncTimer = null;
let cnMdPreview = false;

// ── HELPERS ──
function cnTimeAgo(iso) {
  if (!iso) return '';
  const now = new Date(), then = new Date(iso);
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay + 'd ago';
  return _a.fmtShort(then);
}

// ══════════════════════════════════════════════════════════════════
// SCRATCHPAD
// ══════════════════════════════════════════════════════════════════

function initScratchpad() {
  const sp = document.getElementById('cnScratchpad');
  const monoBtn = document.getElementById('cnScratchMono');
  if (!sp || !monoBtn) return;

  sp.value = _a.state.scratchpad || '';

  const isMono = localStorage.getItem('kw_notes_mono_v3') === 'true';
  sp.classList.toggle('mono', isMono);
  monoBtn.textContent = isMono ? 'mono on' : 'mono off';
  monoBtn.classList.toggle('mono-active', isMono);

  sp.addEventListener('input', function() {
    _a.state.scratchpad = this.value;
    localStorage.setItem('kw_notes_v3', _a.state.scratchpad);
    const syncEl = document.getElementById('cnScratchSync');
    if (syncEl) syncEl.textContent = 'unsaved';
    if (scratchSyncTimer) clearTimeout(scratchSyncTimer);
    scratchSyncTimer = setTimeout(function() {
      _a.ghPush();
      if (syncEl) syncEl.textContent = '';
    }, 1500);
  });

  monoBtn.addEventListener('click', function() {
    const isMono = !sp.classList.contains('mono');
    sp.classList.toggle('mono', isMono);
    this.textContent = isMono ? 'mono on' : 'mono off';
    this.classList.toggle('mono-active', isMono);
    localStorage.setItem('kw_notes_mono_v3', isMono ? 'true' : 'false');
  });
}

function refreshScratchpad() {
  const sp = document.getElementById('cnScratchpad');
  if (sp && document.activeElement !== sp) {
    sp.value = _a.state.scratchpad || '';
  }
}

// ══════════════════════════════════════════════════════════════════
// NOTE LIST
// ══════════════════════════════════════════════════════════════════

function renderCNList() {
  const cnNotes = _a.cnNotes;
  const list = document.getElementById('cnNotesList');
  if (!list) return;
  list.innerHTML = '';

  refreshScratchpad();

  let searchQ = '';
  const searchEl = document.getElementById('cnSearchInput');
  if (searchEl) searchQ = searchEl.value.trim().toLowerCase();

  const filtered = cnNotes.filter(function(n) {
    if (cnFilter !== 'all') {
      const tags = n.tags || [];
      if (tags.indexOf(cnFilter) === -1) return false;
    }
    if (searchQ) {
      const haystack = ((n.title||'') + ' ' + (n.speaker||'') + ' ' + (n.body||'')).toLowerCase();
      if (haystack.indexOf(searchQ) === -1) return false;
    }
    return true;
  });

  filtered.sort(function(a, b) {
    // Pinned notes always first
    const ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.updatedAt || b.createdAt || '') > (a.updatedAt || a.createdAt || '') ? 1 : -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="cn-empty"><div class="cn-empty-icon">\u{1F4DD}</div><div class="cn-empty-text">' +
      (cnNotes.length === 0 ? 'No notes yet.<br>Tap + to start writing.' : 'No notes match this filter.') +
      '</div></div>';
    return;
  }

  var cards = [];
  filtered.forEach(function(n, i) {
    const card = document.createElement('div');
    card.className = 'cn-note-card';
    card.style.animationDelay = (i * 30) + 'ms';
    card.dataset.id = n.id;

    const tagsHtml = (n.tags || []).map(function(t) {
      return '<span class="cat ' + _a.catCls(t) + '">' + _a.esc(_a.CAT_LABEL[t] || t) + '</span>';
    }).join('');

    let projHtml = '';
    if (n.projectId) {
      const p = (_a.state.projects || []).find(function(x) { return x.id === n.projectId; });
      if (p) projHtml = '<span class="proj-link-label">\u26CC ' + _a.esc(p.title) + '</span>';
    }

    const pinHtml = n.pinned ? '<span class="cn-card-pin">📌</span>' : '';

    card.innerHTML =
      '<div class="cn-card-title">' + pinHtml + _a.esc(n.title || 'Untitled') + '</div>' +
      (n.speaker ? '<div class="cn-card-speaker">' + _a.esc(n.speaker) + '</div>' : '') +
      (n.body ? '<div class="cn-card-preview">' + _a.esc(n.body) + '</div>' : '') +
      '<div class="cn-card-meta">' + tagsHtml + projHtml +
      '<span class="cn-card-time">' + cnTimeAgo(n.updatedAt || n.createdAt) + '</span></div>';

    card.addEventListener('click', function() { openCNDetail(n.id); });
    list.appendChild(card);
    cards.push(card);
  });

  // Defer animation start until Safari has committed display:block
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      cards.forEach(function(c) { c.classList.add('entering'); });
    });
  });
}

window.renderCNList = renderCNList;

// ══════════════════════════════════════════════════════════════════
// DISTRACTION-FREE EDITOR
// ══════════════════════════════════════════════════════════════════

function populateCNProjectSelect() {
  const sel = document.getElementById('cnProjectInput');
  if (!sel) return;
  sel.innerHTML = '<option value="">None</option>';
  (_a.state.projects || []).forEach(function(p) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    sel.appendChild(opt);
  });
}

function openCNDetail(id) {
  const cnNotes = _a.cnNotes;
  let n = null;
  for (let i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === id) { n = cnNotes[i]; break; }
  }
  if (!n) return;
  cnActiveId = id;
  populateCNProjectSelect();

  document.getElementById('cnTitleInput').value = n.title || '';
  document.getElementById('cnSpeakerInput').value = n.speaker || '';
  document.getElementById('cnBodyInput').value = n.body || '';
  const projInp = document.getElementById('cnProjectInput');
  if (projInp) projInp.value = n.projectId || '';

  const bodyEl = document.getElementById('cnBodyInput');
  const isMono = !!(n.bodyIsMono);
  bodyEl.classList.toggle('mono', isMono);
  const monoBtn = document.getElementById('cnMonoToggle');
  monoBtn.textContent = isMono ? 'mono on' : 'mono off';
  monoBtn.classList.toggle('mono-active', isMono);

  const tags = n.tags || [];
  document.querySelectorAll('#cnTagRow .s-chip').forEach(function(c) {
    c.classList.toggle('active', tags.indexOf(c.dataset.val) !== -1);
  });

  // Close meta drawer by default for clean editor feel
  const drawer = document.getElementById('cnMetaDrawer');
  if (drawer) drawer.removeAttribute('open');

  // Pin button state
  const pinBtn = document.getElementById('cnPinBtn');
  if (pinBtn) pinBtn.classList.toggle('pinned', !!(n.pinned));

  const metaEl = document.getElementById('cnDetailMeta');
  if (metaEl) {
    const parts = [];
    if (n.createdAt) parts.push('Created ' + cnTimeAgo(n.createdAt));
    if (n.updatedAt && n.updatedAt !== n.createdAt) parts.push('Updated ' + cnTimeAgo(n.updatedAt));
    metaEl.textContent = parts.join(' \u00B7 ');
  }

  document.getElementById('cnListView').style.display = 'none';
  var detailEl = document.getElementById('cnDetailView');
  detailEl.style.display = 'flex';

  // Always start in edit mode
  toggleMdPreview(true);
}

function closeCNDetail() {
  saveCNDetailNow();
  cnActiveId = null;
  document.getElementById('cnDetailView').style.display = 'none';
  var listEl = document.getElementById('cnListView');
  listEl.style.display = 'block';
  renderCNList();
}

function saveCNDetailNow() {
  if (!cnActiveId) return;
  const cnNotes = _a.cnNotes;
  let n = null;
  for (let i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === cnActiveId) { n = cnNotes[i]; break; }
  }
  if (!n) return;

  n.title = document.getElementById('cnTitleInput').value.trim();
  n.speaker = document.getElementById('cnSpeakerInput').value.trim();
  n.body = document.getElementById('cnBodyInput').value;
  const projInp = document.getElementById('cnProjectInput');
  n.projectId = projInp ? projInp.value : '';
  n.bodyIsMono = document.getElementById('cnBodyInput').classList.contains('mono');

  const tags = [];
  document.querySelectorAll('#cnTagRow .s-chip.active').forEach(function(c) {
    tags.push(c.dataset.val);
  });
  n.tags = tags;
  n.updatedAt = new Date().toISOString();

  _a.saveCN(true);
}

function queueCNSave() {
  if (cnSaveTimer) clearTimeout(cnSaveTimer);
  cnSaveTimer = setTimeout(saveCNDetailNow, 1200);
}

function toggleMdPreview(forceOff) {
  var bodyEl = document.getElementById('cnBodyInput');
  var previewEl = document.getElementById('cnMdPreview');
  var toggleBtn = document.getElementById('cnMdToggle');
  if (!bodyEl || !previewEl || !toggleBtn) return;

  if (forceOff) { cnMdPreview = false; }
  else { cnMdPreview = !cnMdPreview; }

  if (cnMdPreview && typeof marked !== 'undefined') {
    // Flush any pending edits before rendering
    saveCNDetailNow();
    previewEl.innerHTML = marked.parse(bodyEl.value || '', { breaks: true, gfm: true });
    // Open links in new tab
    previewEl.querySelectorAll('a').forEach(function(a) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
    bodyEl.style.display = 'none';
    previewEl.style.display = 'block';
    toggleBtn.textContent = 'edit';
    toggleBtn.classList.add('md-active');
  } else {
    cnMdPreview = false;
    previewEl.style.display = 'none';
    previewEl.innerHTML = '';
    bodyEl.style.display = '';
    toggleBtn.textContent = 'preview';
    toggleBtn.classList.remove('md-active');
    if (forceOff !== true) bodyEl.focus();
  }
}

function createNewNote() {
  const cnNotes = _a.cnNotes;
  const n = {
    id: _a.uid(),
    title: '',
    speaker: '',
    body: '',
    tags: [],
    projectId: '',
    bodyIsMono: false,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  cnNotes.unshift(n);
  _a.saveCN(false);
  openCNDetail(n.id);
  setTimeout(function() { document.getElementById('cnTitleInput').focus(); }, 100);
  _a.showToast('New note created');
}

window.createNewNote = createNewNote;

function deleteCNNote(id) {
  _a.cnNotes = _a.cnNotes.filter(function(n) { return n.id !== id; });
  _a.saveCN(true);
  closeCNDetail();
  _a.showToast('Note deleted');
}

// ══════════════════════════════════════════════════════════════════
// DYNAMIC CHIPS
// ══════════════════════════════════════════════════════════════════

function rebuildCNChips() {
  const tagRow = document.getElementById('cnTagRow');
  if (tagRow) {
    const activeVals = [];
    tagRow.querySelectorAll('.s-chip.active').forEach(function(c) { activeVals.push(c.dataset.val); });
    tagRow.innerHTML = '';
    Object.keys(_a.CAT_LABEL).forEach(function(key) {
      const c = document.createElement('div');
      c.className = 's-chip' + (activeVals.indexOf(key) !== -1 ? ' active' : '');
      c.dataset.val = key;
      c.textContent = _a.CAT_LABEL[key];
      tagRow.appendChild(c);
    });
  }
  const filterRow = document.getElementById('cnFilterRow');
  if (filterRow) {
    const currentFilter = cnFilter;
    filterRow.innerHTML = '';
    const allChip = document.createElement('div');
    allChip.className = 'chip' + (currentFilter === 'all' ? ' active' : '');
    allChip.dataset.cnfilter = 'all';
    allChip.textContent = 'All';
    filterRow.appendChild(allChip);
    Object.keys(_a.CAT_LABEL).forEach(function(key) {
      const c = document.createElement('div');
      c.className = 'chip' + (currentFilter === key ? ' active' : '');
      c.dataset.cnfilter = key;
      c.textContent = _a.CAT_LABEL[key];
      filterRow.appendChild(c);
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// EVENT WIRING
// ══════════════════════════════════════════════════════════════════

initScratchpad();
rebuildCNChips();

document.getElementById('confNotesBtn').addEventListener('click', function() {
  if (document.body.classList.contains('confnotes-mode')) {
    _a.switchView('tasks');
  } else {
    _a.switchView('confnotes');
  }
});

document.getElementById('closeConfNotesBtn').addEventListener('click', function() {
  _a.switchView('tasks');
});

document.getElementById('cnBackBtn').addEventListener('click', closeCNDetail);

document.getElementById('cnDeleteBtn').addEventListener('click', function() {
  if (!cnActiveId) return;
  if (confirm('Delete this note?')) deleteCNNote(cnActiveId);
});

document.getElementById('cnPinBtn').addEventListener('click', function() {
  if (!cnActiveId) return;
  const cnNotes = _a.cnNotes;
  let n = null;
  for (let i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === cnActiveId) { n = cnNotes[i]; break; }
  }
  if (!n) return;
  n.pinned = !n.pinned;
  this.classList.toggle('pinned', n.pinned);
  _a.saveCN(true);
  _a.showToast(n.pinned ? 'Note pinned' : 'Note unpinned');
});

document.getElementById('cnTagRow').addEventListener('click', function(e) {
  const chip = e.target.closest('.s-chip');
  if (!chip) return;
  chip.classList.toggle('active');
  queueCNSave();
});

['cnTitleInput', 'cnSpeakerInput', 'cnBodyInput'].forEach(function(id) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', queueCNSave);
});
const cnProjInp = document.getElementById('cnProjectInput');
if (cnProjInp) cnProjInp.addEventListener('change', function() { saveCNDetailNow(); });

document.getElementById('cnMonoToggle').addEventListener('click', function() {
  const bodyEl = document.getElementById('cnBodyInput');
  const isMono = !bodyEl.classList.contains('mono');
  bodyEl.classList.toggle('mono', isMono);
  this.textContent = isMono ? 'mono on' : 'mono off';
  this.classList.toggle('mono-active', isMono);
  queueCNSave();
});

document.getElementById('cnMdToggle').addEventListener('click', function() {
  toggleMdPreview(false);
});

document.getElementById('cnSearchToggle').addEventListener('click', function() {
  const wrap = document.getElementById('cnSearchWrap');
  wrap.classList.toggle('open');
  if (wrap.classList.contains('open')) {
    document.getElementById('cnSearchInput').focus();
  } else {
    document.getElementById('cnSearchInput').value = '';
    renderCNList();
  }
});
document.getElementById('cnSearchInput').addEventListener('input', renderCNList);

document.getElementById('cnFilterRow').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#cnFilterRow .chip').forEach(function(c) { c.classList.remove('active'); });
  chip.classList.add('active');
  cnFilter = chip.dataset.cnfilter;
  renderCNList();
});

document.addEventListener('keydown', function(e) {
  if (!document.body.classList.contains('confnotes-mode')) return;
  const tag = (document.activeElement || {}).tagName || '';
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    e.stopPropagation();
    createNewNote();
  }
});
