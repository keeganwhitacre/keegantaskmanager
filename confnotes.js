// ══════════════════════════════════════════════════════════════════
// CONFNOTES MODULE — zettelkasten notes
// Types: memo, paper, idea
// Features: markdown preview, [[backlinks]], PIN lock, full-bleed editor
// ══════════════════════════════════════════════════════════════════

import {
  uid, esc, showToast,
  getCnNotes, setCnNotes, saveCN,
  CAT_LABEL, state,
} from './state.js';

// ── NOTE TYPES ──
const NOTE_TYPES = {
  memo:  { label: 'Note',  icon: '✎', color: 'memo' },
  paper: { label: 'Paper', icon: '📄', color: 'paper' },
  idea:  { label: 'Idea',  icon: '💡', color: 'idea' },
};

const TAGS = ['manuscript', 'lab', 'phd', 'conf', 'personal', 'hobby'];

const PAPER_TEMPLATE = `## Summary
What does this paper argue?

## Challenge
What are the methodological or theoretical weaknesses?

## Steal
What idea or technique is worth borrowing?
`;

function noteTypeOf(n) {
  const t = n.type || 'memo';
  return NOTE_TYPES[t] ? t : 'memo';
}

// ── FILTER STATE ──
let cnFilter = 'all';
let cnTypeFilter = 'all';

// ── ACTIVE NOTE ──
let cnActiveId = null;
let _cnOpenSnapshot = null;
let cnMdPreview = false;
let _cnSaveTimer = null;

// ── TIME AGO ──
function cnTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7)  return days + 'd ago';
  const wks = Math.floor(days / 7);
  if (wks < 5)   return wks + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}

// ── FILTER CHIP REBUILD ──
function rebuildCNChips() {
  const row = document.getElementById('cnFilterRow');
  if (!row) return;
  row.innerHTML = '';

  const allChip = document.createElement('div');
  allChip.className = 'chip' + (cnFilter === 'all' && cnTypeFilter === 'all' ? ' active' : '');
  allChip.dataset.cnfilter = 'all'; allChip.textContent = 'All';
  row.appendChild(allChip);

  Object.keys(NOTE_TYPES).forEach(function(type) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (cnTypeFilter === type ? ' active' : '');
    chip.dataset.cnfilter = '_type_' + type;
    chip.textContent = NOTE_TYPES[type].label;
    row.appendChild(chip);
  });
}

// ── LIST RENDER ──
function renderCNList() {
  const cnNotes = getCnNotes();
  const list = document.getElementById('cnNotesList');
  if (!list) return;
  list.innerHTML = '';

  let searchQ = '';
  const searchEl = document.getElementById('cnSearchInput');
  if (searchEl) searchQ = searchEl.value.trim().toLowerCase();

  const filtered = cnNotes.filter(function(n) {
    if (cnTypeFilter !== 'all' && noteTypeOf(n) !== cnTypeFilter) return false;
    if (cnFilter !== 'all') {
      if (!(n.tags || []).includes(cnFilter)) return false;
    }
    if (searchQ) {
      const hay = ((n.title||'') + ' ' + (n.body||'') + ' ' + (n.url||'')).toLowerCase();
      if (!hay.includes(searchQ)) return false;
    }
    return true;
  });

  filtered.sort(function(a, b) {
    const ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.updatedAt || b.createdAt || '') > (a.updatedAt || a.createdAt || '') ? 1 : -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="cn-empty">' +
      '<div class="cn-empty-icon">📝</div>' +
      '<div class="cn-empty-text">' + (cnNotes.length === 0 ? 'No notes yet.<br>Tap + to start.' : 'No notes match.') + '</div>' +
      '</div>';
    return;
  }

  filtered.forEach(function(n, i) {
    const nType = noteTypeOf(n);
    const card = document.createElement('div');
    card.className = 'cn-note-card' + (n.id === cnActiveId ? ' cn-active-note' : '');
    card.style.animationDelay = (i * 25) + 'ms';
    card.dataset.id = n.id;

    const pinHtml  = n.pinned ? '<span class="cn-card-pin">📌</span>' : '';
    const lockHtml = n.locked ? '<span class="cn-card-pin">🔒</span>' : '';
    const ageText  = cnTimeAgo(n.updatedAt || n.createdAt);

    let statusHtml = '';
    if (nType === 'idea' && n.ideaStatus) {
      const sc = n.ideaStatus.replace(/\s+/g, '-').toLowerCase();
      statusHtml = '<span class="idea-status ' + sc + '">' + esc(n.ideaStatus) + '</span>';
    }

    // Stale ideas
    let staleHtml = '';
    if (nType === 'idea' && n.updatedAt) {
      const daysSince = Math.floor((Date.now() - new Date(n.updatedAt).getTime()) / 86400000);
      if (daysSince > 14 && n.ideaStatus !== 'ready to pitch') {
        staleHtml = '<span class="cn-stale-badge">stale ' + daysSince + 'd</span>';
      }
    }

    card.innerHTML =
      '<div class="cn-card-eyebrow">' +
        '<span class="cn-type-badge ' + nType + '">' + NOTE_TYPES[nType].label + '</span>' +
        pinHtml + lockHtml +
        '<span class="cn-card-time">' + esc(ageText) + '</span>' +
      '</div>' +
      '<div class="cn-card-title">' + esc(n.title || 'Untitled') + '</div>' +
      (n.body ? '<div class="cn-card-preview">' + esc((n.body || '').slice(0, 120)) + '</div>' : '') +
      '<div class="cn-card-meta">' + statusHtml + staleHtml + '</div>';

    card.addEventListener('click', function() {
      document.querySelectorAll('.cn-note-card').forEach(c => c.classList.remove('cn-active-note'));
      card.classList.add('cn-active-note');
      openCNDetail(n.id);
    });
    list.appendChild(card);
  });
}

// ── AUTO-RESIZE BODY ──
function autoResizeBody() {
  // No-op: textarea uses min-height:60vh, #cnDetailView scrolls naturally.
  // Growing the textarea via JS would fight the parent scroll model.
}

// ── MARKDOWN PREVIEW ──
// FIX #3: Do NOT call saveCNDetailNow from here — previewing a note
// should never touch updatedAt. Save is only triggered by actual input events.
function toggleMdPreview(mode) {
  const bodyEl    = document.getElementById('cnBodyInput');
  const previewEl = document.getElementById('cnMdPreview');
  const toggleBtn = document.getElementById('cnMdToggle');
  if (!bodyEl || !previewEl || !toggleBtn) return;

  if (mode === undefined) mode = cnMdPreview ? 'off' : 'on';

  if (mode !== 'off') {
    cnMdPreview = true;
    // NOTE: removed saveCNDetailNow() call here — opening preview is read-only

    // 1. Process [[Internal Links]]
    const rawContent = bodyEl.value || '';
    const processedContent = rawContent.replace(
      /\[\[(.*?)\]\]/g,
      '<a href="#" class="internal-note-link" data-notetitle="$1">[[ $1 ]]</a>'
    );

    // 2. Parse markdown
    let finalHtml = (typeof marked !== 'undefined')
      ? marked.parse(processedContent, { breaks: true, gfm: true })
      : processedContent.replace(/\n/g, '<br>');

    // 3. Paper URL card
    const activeType = document.querySelector('#cnTypeRow .cn-type-chip.active');
    const isPaper = activeType && activeType.dataset.type === 'paper';
    const urlInput = document.getElementById('cnUrlInput');
    const urlVal = urlInput ? urlInput.value.trim() : '';
    if (isPaper && urlVal) {
      const linkHref = urlVal.startsWith('http') ? urlVal : 'https://doi.org/' + urlVal;
      finalHtml = '<a href="' + esc(linkHref) + '" target="_blank" class="cn-md-paper-link">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
        '<span>Source Document</span></a>' + finalHtml;
    }

    previewEl.innerHTML = finalHtml;
    previewEl.querySelectorAll('a:not(.internal-note-link)').forEach(function(a) {
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
    if (mode !== 'off_no_focus') bodyEl.focus();
    autoResizeBody();
  }
}

// ── UPDATE META SUMMARY LABEL ──
function updatePropsSummary() {
  const btn = document.getElementById('cnPropsTriggerLabel');
  if (!btn) return;
  const activeType = document.querySelector('#cnTypeRow .cn-type-chip.active');
  const typeLabel = activeType ? activeType.textContent : 'Note';
  const tagsCount = document.querySelectorAll('#cnTagRow .cn-tag-chip.active').length;
  
  let text = typeLabel;
  if (tagsCount > 0) {
    text += ' · ' + tagsCount + (tagsCount === 1 ? ' tag' : ' tags');
  }
  btn.textContent = text;
}

// ── SHOW / HIDE DESKTOP EMPTY STATE ──
// FIX #5: Instead of using opacity on cn-no-note, show an explicit empty state overlay.
function showDesktopEmptyState() {
  const detailEl = document.getElementById('cnDetailView');
  const emptyEl  = document.getElementById('cnDetailEmpty');
  const editorEl = document.getElementById('cnEditorInner');
  if (emptyEl)  emptyEl.style.display  = 'flex';
  if (editorEl) editorEl.style.display = 'none';
  if (detailEl) detailEl.classList.add('cn-no-note');
}

function hideDesktopEmptyState() {
  const detailEl = document.getElementById('cnDetailView');
  const emptyEl  = document.getElementById('cnDetailEmpty');
  const editorEl = document.getElementById('cnEditorInner');
  if (emptyEl)  emptyEl.style.display  = 'none';
  if (editorEl) editorEl.style.display = '';
  if (detailEl) detailEl.classList.remove('cn-no-note');
}

// ── OPEN NOTE DETAIL ──
function openCNDetail(id) {
  const cnNotes = getCnNotes();
  const n = cnNotes.find(function(x) { return x.id === id; });
  if (!n) return;

  // Check PIN lock
  if (n.locked) {
    requestPinUnlock(function() { _doOpenDetail(n); });
    return;
  }
  _doOpenDetail(n);
}

function _doOpenDetail(n) {
  cnActiveId = n.id;
  _cnOpenSnapshot = { title: n.title || '', body: n.body || '' };
  cnMdPreview = false;

  hideDesktopEmptyState(); // FIX #5

  // Populate type row
  const typeRow = document.getElementById('cnTypeRow');
  if (typeRow) {
    typeRow.innerHTML = '';
    Object.keys(NOTE_TYPES).forEach(function(type) {
      const chip = document.createElement('div');
      chip.className = 'cn-type-chip' + (noteTypeOf(n) === type ? ' active' : '');
      chip.dataset.type = type;
      chip.textContent = NOTE_TYPES[type].label;
      chip.addEventListener('click', function() {
        document.querySelectorAll('#cnTypeRow .cn-type-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        updateMetaVisibility();
        updatePropsSummary();
        queueCNSave();
      });
      typeRow.appendChild(chip);
    });
  }

  // Idea status row
  const ideaRow = document.getElementById('cnIdeaStatusRow');
  if (ideaRow) {
    ideaRow.innerHTML = '';
    ['raw', 'developing', 'ready to pitch'].forEach(function(s) {
      const chip = document.createElement('div');
      chip.className = 'cn-idea-chip' + (n.ideaStatus === s ? ' active' : '');
      chip.textContent = s;
      chip.addEventListener('click', function() {
        document.querySelectorAll('#cnIdeaStatusRow .cn-idea-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        queueCNSave();
      });
      ideaRow.appendChild(chip);
    });
  }

  // Tag row
  const tagRow = document.getElementById('cnTagRow');
  if (tagRow) {
    tagRow.innerHTML = '';
    TAGS.forEach(function(t) {
      const chip = document.createElement('div');
      chip.className = 'cn-tag-chip s-chip' + ((n.tags || []).includes(t) ? ' active' : '');
      chip.dataset.val = t;
      chip.textContent = CAT_LABEL[t] || t;
      chip.addEventListener('click', function() { 
        chip.classList.toggle('active'); 
        updatePropsSummary();
        queueCNSave(); 
      });
      tagRow.appendChild(chip);
    });
  }

  // URL input visibility
  const urlInput = document.getElementById('cnUrlInput');
  if (urlInput) {
    urlInput.value = n.url || '';
    urlInput.style.display = noteTypeOf(n) === 'paper' ? 'block' : 'none';
  }

  updateMetaVisibility();
  updatePropsSummary();

  // Title bar label
  const titleLabel = document.getElementById('cnDetailTitle');
  if (titleLabel) titleLabel.textContent = NOTE_TYPES[noteTypeOf(n)].label;

  // Inputs
  document.getElementById('cnTitleInput').value = n.title || '';

  const bodyEl = document.getElementById('cnBodyInput');
  bodyEl.value = n.body || '';
  const isMono = !!(n.bodyIsMono);
  bodyEl.classList.toggle('mono', isMono);

  const monoBtn = document.getElementById('cnMonoToggle');
  if (monoBtn) monoBtn.classList.toggle('mono-active', isMono);

  // Meta drawer — closed by default
  const drawer = document.getElementById('cnMetaDrawer');
  if (drawer) drawer.removeAttribute('open');

  // Pin button
  const pinBtn = document.getElementById('cnPinBtn');
  if (pinBtn) pinBtn.classList.toggle('pinned', !!(n.pinned));

  // Lock button
  const lockBtn = document.getElementById('cnLockBtn');
  if (lockBtn) {
    lockBtn.style.display = hasPinSet() ? '' : 'none';
    lockBtn.classList.toggle('locked', !!(n.locked));
  }

  // Created/updated meta
  const metaEl = document.getElementById('cnDetailMeta');
  if (metaEl) {
    const parts = [];
    if (n.createdAt) parts.push('Created ' + cnTimeAgo(n.createdAt));
    if (n.updatedAt && n.updatedAt !== n.createdAt) parts.push('Updated ' + cnTimeAgo(n.updatedAt));
    metaEl.textContent = parts.join(' · ');
  }

  // Show detail, hide list (mobile only)
  const isDesktopLayout = window.matchMedia('(min-width: 768px)').matches;
  if (!isDesktopLayout) {
    document.getElementById('cnListView').style.display = 'none';
  }
  const detailEl = document.getElementById('cnDetailView');
  detailEl.style.display = 'flex';
  detailEl.classList.remove('cn-detail-exit');
  detailEl.classList.add('cn-detail-enter');
  detailEl.addEventListener('animationend', function handler() {
    detailEl.classList.remove('cn-detail-enter');
    detailEl.removeEventListener('animationend', handler);
  });

  renderBacklinks(n.title || '');

  // FIX #3: toggleMdPreview no longer saves on open, so this is safe
  toggleMdPreview((n.body || '').trim() ? 'on' : 'off_no_focus');
  autoResizeBody();
}

function updateMetaVisibility() {
  const activeType = document.querySelector('#cnTypeRow .cn-type-chip.active');
  const type = activeType ? activeType.dataset.type : 'memo';
  const urlInput = document.getElementById('cnUrlInput');
  const ideaRow  = document.getElementById('cnIdeaStatusRow');
  if (urlInput) urlInput.style.display = type === 'paper' ? 'block' : 'none';
  if (ideaRow)  ideaRow.style.display  = type === 'idea'  ? 'flex'  : 'none';
}

// ── CLOSE DETAIL ──
function closeCNDetail() {
  saveCNDetailNow();
  cnActiveId = null;
  _cnOpenSnapshot = null;

  const isDesktopLayout = window.matchMedia('(min-width: 768px)').matches;
  const detailEl = document.getElementById('cnDetailView');
  const listEl = document.getElementById('cnListView');

  if (isDesktopLayout) {
    detailEl.classList.remove('cn-detail-enter');
    const titleInput = document.getElementById('cnTitleInput');
    const bodyInput = document.getElementById('cnBodyInput');
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';
    showDesktopEmptyState(); // FIX #5
    renderCNList();
  } else {
    detailEl.classList.remove('cn-detail-enter');
    detailEl.classList.add('cn-detail-exit');
    detailEl.addEventListener('animationend', function handler() {
      detailEl.classList.remove('cn-detail-exit');
      detailEl.style.display = 'none';
      detailEl.removeEventListener('animationend', handler);
      listEl.style.display = 'block';
      listEl.classList.add('cn-list-enter');
      listEl.addEventListener('animationend', function lh() {
        listEl.classList.remove('cn-list-enter');
        listEl.removeEventListener('animationend', lh);
      });
      renderCNList();
    });
  }
}

// ── SAVE ──
function queueCNSave() {
  if (_cnSaveTimer) clearTimeout(_cnSaveTimer);
  _cnSaveTimer = setTimeout(saveCNDetailNow, 800);
}

function saveCNDetailNow() {
  if (!cnActiveId) return;
  const cnNotes = getCnNotes();
  const n = cnNotes.find(x => x.id === cnActiveId);
  if (!n) return;

  const newTitle = document.getElementById('cnTitleInput').value.trim();
  const newBody  = document.getElementById('cnBodyInput').value;

  // FIX #3: Only touch updatedAt if content actually changed
  const titleChanged = newTitle !== (n.title || '');
  const bodyChanged  = newBody  !== (n.body  || '');

  // Rename backlinks if title changed
  if (_cnOpenSnapshot && newTitle && newTitle !== _cnOpenSnapshot.title && _cnOpenSnapshot.title) {
    renameLinkReferences(_cnOpenSnapshot.title, newTitle);
    _cnOpenSnapshot.title = newTitle;
  }

  n.title      = newTitle;
  n.body       = newBody;
  n.bodyIsMono = document.getElementById('cnBodyInput').classList.contains('mono');

  // Type
  const activeType = document.querySelector('#cnTypeRow .cn-type-chip.active');
  n.type = activeType ? activeType.dataset.type : (n.type || 'memo');

  // URL
  const urlInput = document.getElementById('cnUrlInput');
  n.url = (n.type === 'paper' && urlInput) ? urlInput.value.trim() : '';

  // Idea status
  const activeIdea = document.querySelector('#cnIdeaStatusRow .cn-idea-chip.active');
  if (activeIdea) n.ideaStatus = activeIdea.textContent;

  // Tags
  n.tags = Array.from(document.querySelectorAll('#cnTagRow .cn-tag-chip.active')).map(c => c.dataset.val);

  // Only update timestamp if something actually changed
  if (titleChanged || bodyChanged) {
    n.updatedAt = new Date().toISOString();
  }
  if (!n.createdAt) n.createdAt = new Date().toISOString();

  saveCN(true);

  // FIX #4: Re-render the list so cards reflect latest title/preview/timestamp
  renderCNList();

  // Update topbar label
  const titleLabel = document.getElementById('cnDetailTitle');
  if (titleLabel) titleLabel.textContent = NOTE_TYPES[n.type || 'memo'].label;
}

// ── CREATE NEW ──
function createNewNote(type) {
  type = type || 'memo';
  const cnNotes = getCnNotes();
  const n = {
    id: uid(), title: '', body: type === 'paper' ? PAPER_TEMPLATE : '',
    tags: [], bodyIsMono: false, pinned: false, locked: false,
    type, url: '',
    ideaStatus: type === 'idea' ? 'raw' : '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  cnNotes.unshift(n);
  saveCN(false);
  openCNDetail(n.id);
}

// ── BACKLINKS ──
function renderBacklinks(noteTitle) {
  const drawer = document.getElementById('cnBacklinksDrawer');
  if (!drawer) return;

  if (!noteTitle) { drawer.innerHTML = ''; return; }

  const cnNotes = getCnNotes();
  const refs = cnNotes.filter(function(n) {
    if (n.id === cnActiveId) return false;
    return (n.body || '').toLowerCase().includes('[[' + noteTitle.toLowerCase() + ']]');
  });

  if (refs.length === 0) { drawer.innerHTML = ''; return; }

  const toggle = document.createElement('button');
  toggle.className = 'cn-backlinks-toggle';
  toggle.innerHTML =
    '<span class="cn-backlinks-arrow" id="cnBacklinksArrow">▶</span>' +
    '<span class="cn-backlinks-label-text">Backlinks</span>' +
    '<span class="cn-backlinks-count">' + refs.length + '</span>';

  const listEl = document.createElement('div');
  listEl.style.display = 'none';

  refs.forEach(function(n) {
    const item = document.createElement('div');
    item.className = 'cn-backlink-item';
    item.dataset.blid = n.id;
    item.innerHTML =
      '<span class="cn-backlink-icon">' + (NOTE_TYPES[noteTypeOf(n)] || NOTE_TYPES.memo).icon + '</span>' +
      '<div><div class="cn-backlink-title">' + esc(n.title || 'Untitled') + '</div>' +
      '<div class="cn-backlink-preview">' + esc((n.body || '').slice(0, 80)) + '</div></div>';
    item.addEventListener('click', function() {
      saveCNDetailNow();
      openCNDetail(n.id);
    });
    listEl.appendChild(item);
  });

  toggle.addEventListener('click', function() {
    const open = listEl.style.display !== 'none';
    listEl.style.display = open ? 'none' : 'block';
    toggle.classList.toggle('open', !open);
    const arrow = document.getElementById('cnBacklinksArrow');
    if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
  });

  drawer.innerHTML = '';
  drawer.appendChild(toggle);
  drawer.appendChild(listEl);
}

// ── RENAME LINK REFERENCES ──
function renameLinkReferences(oldTitle, newTitle) {
  if (!oldTitle || oldTitle === newTitle) return;
  const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('\\[\\[' + escaped + '\\]\\]', 'gi');
  const replacement = '[[' + newTitle + ']]';
  let changed = false;
  getCnNotes().forEach(function(n) {
    if (n.id === cnActiveId) return;
    const updated = (n.body || '').replace(pattern, replacement);
    if (updated !== n.body) { n.body = updated; changed = true; }
  });
  if (changed) saveCN(true);
}

// ── PIN / LOCK SYSTEM ──
function hasPinSet() {
  try { return !!localStorage.getItem('kw_pin_v1'); } catch(e) { return false; }
}

let _pinUnlocked = false;

function requestPinUnlock(onSuccess) {
  if (_pinUnlocked) { onSuccess(); return; }

  const overlay = document.getElementById('cnPinOverlay');
  const input   = document.getElementById('cnPinInputField');
  const error   = document.getElementById('cnPinError');
  const submit  = document.getElementById('cnPinSubmit');
  const cancel  = document.getElementById('cnPinCancel');
  if (!overlay) { onSuccess(); return; }

  overlay.style.display = 'flex';
  if (input) { input.value = ''; input.focus(); }
  if (error) error.textContent = '';

  function cleanup() {
    overlay.style.display = 'none';
    if (submit) submit.removeEventListener('click', tryUnlock);
    if (cancel) cancel.removeEventListener('click', doCancel);
    if (input)  input.removeEventListener('keydown', onKey);
  }

  function tryUnlock() {
    const val = input ? input.value.trim() : '';
    const stored = localStorage.getItem('kw_pin_v1') || '';
    if (val === stored) {
      _pinUnlocked = true;
      cleanup();
      onSuccess();
    } else {
      if (error) error.textContent = 'Incorrect PIN';
      if (input) { input.value = ''; input.focus(); }
    }
  }

  function doCancel() { cleanup(); }
  function onKey(e) { if (e.key === 'Enter') tryUnlock(); }

  if (submit) submit.addEventListener('click', tryUnlock);
  if (cancel) cancel.addEventListener('click', doCancel);
  if (input)  input.addEventListener('keydown', onKey);
}

// ── INTERNAL LINK NAVIGATION ──
document.addEventListener('click', function(e) {
  const link = e.target.closest('.internal-note-link');
  if (!link) return;
  e.preventDefault(); e.stopPropagation();
  const targetTitle = link.getAttribute('data-notetitle');
  if (!targetTitle) return;
  const cnNotes = getCnNotes();
  const target = cnNotes.find(n => (n.title || '').toLowerCase() === targetTitle.toLowerCase());
  if (target) {
    saveCNDetailNow();
    openCNDetail(target.id);
  } else if (confirm('"' + targetTitle + '" doesn\'t exist. Create it?')) {
    saveCNDetailNow();
    const newNote = {
      id: uid(), title: targetTitle, body: '',
      tags: [], bodyIsMono: false, pinned: false, locked: false,
      type: 'memo', url: '', ideaStatus: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    getCnNotes().unshift(newNote);
    saveCN(false);
    openCNDetail(newNote.id);
  }
});

// ── PREVIEW CLICK ──
const mdPreviewEl = document.getElementById('cnMdPreview');
if (mdPreviewEl) {
  mdPreviewEl.addEventListener('click', function(e) {
    if (e.target.closest('a')) return;
    toggleMdPreview('off');
  });
}

// ── TOPBAR BUTTONS ──
const cnBackBtn = document.getElementById('cnBackBtn');
if (cnBackBtn) cnBackBtn.addEventListener('click', closeCNDetail);

const cnMdToggleBtn = document.getElementById('cnMdToggle');
if (cnMdToggleBtn) cnMdToggleBtn.addEventListener('click', function() { toggleMdPreview(); });

const cnMonoToggleBtn = document.getElementById('cnMonoToggle');
if (cnMonoToggleBtn) cnMonoToggleBtn.addEventListener('click', function() {
  const bodyEl = document.getElementById('cnBodyInput');
  const isMono = bodyEl.classList.toggle('mono');
  cnMonoToggleBtn.classList.toggle('mono-active', isMono);
  queueCNSave(); autoResizeBody();
});

const cnPinBtnEl = document.getElementById('cnPinBtn');
if (cnPinBtnEl) cnPinBtnEl.addEventListener('click', function() {
  if (!cnActiveId) return;
  const n = getCnNotes().find(x => x.id === cnActiveId);
  if (!n) return;
  n.pinned = !n.pinned;
  cnPinBtnEl.classList.toggle('pinned', n.pinned);
  saveCN(true);
  showToast(n.pinned ? 'Note pinned' : 'Note unpinned');
});

const cnLockBtnEl = document.getElementById('cnLockBtn');
if (cnLockBtnEl) cnLockBtnEl.addEventListener('click', function() {
  if (!cnActiveId) return;
  const n = getCnNotes().find(x => x.id === cnActiveId);
  if (!n) return;
  if (n.locked) {
    n.locked = false;
    cnLockBtnEl.classList.remove('locked');
    saveCN(true);
    showToast('Note unlocked');
  } else {
    if (!hasPinSet()) { showToast('Set a PIN in Settings first'); return; }
    n.locked = true;
    cnLockBtnEl.classList.add('locked');
    saveCN(true);
    showToast('Note locked');
  }
});

const cnDeleteBtnEl = document.getElementById('cnDeleteBtn');
if (cnDeleteBtnEl) cnDeleteBtnEl.addEventListener('click', function() {
  if (!cnActiveId) return;
  if (!confirm('Delete this note?')) return;
  const notes = getCnNotes();
  const idx = notes.findIndex(x => x.id === cnActiveId);
  if (idx !== -1) notes.splice(idx, 1);
  saveCN(true);
  showToast('Note deleted');
  closeCNDetail();
});

// ── BODY INPUT — auto-save + resize ──
const cnBodyInputEl = document.getElementById('cnBodyInput');
if (cnBodyInputEl) {
  cnBodyInputEl.addEventListener('input', function() { queueCNSave(); autoResizeBody(); });
}
const cnTitleInputEl = document.getElementById('cnTitleInput');
if (cnTitleInputEl) cnTitleInputEl.addEventListener('input', queueCNSave);
const cnUrlInputEl = document.getElementById('cnUrlInput');
if (cnUrlInputEl) cnUrlInputEl.addEventListener('input', queueCNSave);

// ── SEARCH TOGGLE ──
const cnSearchBtn = document.getElementById('cnSearchBtn');
const cnSearchWrap = document.getElementById('cnSearchWrap');
if (cnSearchBtn && cnSearchWrap) {
  cnSearchBtn.addEventListener('click', function() {
    cnSearchWrap.classList.toggle('open');
    if (cnSearchWrap.classList.contains('open')) {
      document.getElementById('cnSearchInput').focus();
    } else {
      document.getElementById('cnSearchInput').value = '';
      renderCNList();
    }
  });
}
const cnSearchInput = document.getElementById('cnSearchInput');
if (cnSearchInput) cnSearchInput.addEventListener('input', renderCNList);

// ── FILTER ROW ──
const cnFilterRow = document.getElementById('cnFilterRow');
if (cnFilterRow) {
  cnFilterRow.addEventListener('click', function(e) {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#cnFilterRow .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const val = chip.dataset.cnfilter;
    if (val === 'all') { cnFilter = 'all'; cnTypeFilter = 'all'; }
    else if (val && val.startsWith('_type_')) { cnTypeFilter = val.replace('_type_', ''); cnFilter = 'all'; }
    else { cnFilter = val || 'all'; cnTypeFilter = 'all'; }
    renderCNList();
  });
}

// ── KEYBOARD SHORTCUTS (desktop) ──
// FIX #1: Don't use Cmd+number (conflicts with Mac tab switching).
// Use Ctrl+number for view switching (handled in router/app.js).
// Local note shortcuts use plain letters when not in an input.
document.addEventListener('keydown', function(e) {
  if (!document.body.classList.contains('notes-mode')) return;
  const tag = (document.activeElement || {}).tagName || '';
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); createNewNote('memo'); }
  else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); createNewNote('paper'); }
  else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); createNewNote('idea'); }
  else if (e.key === 'Escape' && cnActiveId) closeCNDetail();
});

// ── INIT — show empty state immediately on desktop so the blank editor never appears ──
(function initNotesView() {
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;
  if (isDesktop) {
    showDesktopEmptyState();
  } else {
    // Mobile: detail view should be fully hidden until a note is opened
    const detailEl = document.getElementById('cnDetailView');
    if (detailEl) detailEl.style.display = 'none';
  }
})();

// ── EXPORTS ──
export { renderCNList, createNewNote, rebuildCNChips, NOTE_TYPES, noteTypeOf };
