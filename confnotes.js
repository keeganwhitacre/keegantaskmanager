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
  const bodyEl = document.getElementById('cnBodyInput');
  if (!bodyEl) return;
  
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;
  const scrollContainer = isDesktop 
    ? document.querySelector('.cn-editor-body') 
    : document.getElementById('cnDetailView');

  if (!scrollContainer) return;

  // Save current scroll and the height BEFORE we resize
  const currentScroll = scrollContainer.scrollTop;
  const oldHeight = bodyEl.offsetHeight;

  // Do the resize
  bodyEl.style.height = 'auto';
  const newHeight = bodyEl.scrollHeight;
  bodyEl.style.height = newHeight + 'px';

  // If hitting "Enter" made the box taller, force the container to scroll down
  // by that exact amount so the caret doesn't slip behind the toolbar
  if (newHeight > oldHeight && oldHeight > 0) {
    scrollContainer.scrollTop = currentScroll + (newHeight - oldHeight);
  } else {
    // Otherwise, just restore the scroll
    scrollContainer.scrollTop = currentScroll;
  }
}

// ── MARKDOWN PREVIEW ──
// FIX #3: Do NOT call saveCNDetailNow from here — previewing a note
// should never touch updatedAt. Save is only triggered by actual input events.
// ── MARKDOWN PREVIEW ──
function toggleMdPreview(mode) {
  const bodyEl    = document.getElementById('cnBodyInput');
  const previewEl = document.getElementById('cnMdPreview');
  const toggleBtn = document.getElementById('cnMdToggle');
  const metaEl    = document.getElementById('cnDetailMeta');
  const mdToolbar = document.getElementById('cnMdToolbar'); // Grab the toolbar

  if (!bodyEl || !previewEl || !toggleBtn) return;

  if (mode === undefined) mode = cnMdPreview ? 'off' : 'on';

  if (mode !== 'off') {
    cnMdPreview = true;

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
    
    // Toggle UI visibility for preview
    if (metaEl) metaEl.style.display = 'block'; 
    if (mdToolbar) mdToolbar.style.display = 'none'; // Hide Toolbar

    toggleBtn.textContent = 'edit';
    toggleBtn.classList.add('md-active');
  } else {
    cnMdPreview = false;
    previewEl.style.display = 'none';
    previewEl.innerHTML = '';
    bodyEl.style.display = '';
    
    // Toggle UI visibility for editing
    if (metaEl) metaEl.style.display = 'none';
    if (mdToolbar) mdToolbar.style.display = ''; // Show Toolbar

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
  if (editorEl) editorEl.style.display = 'flex';
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

  // On mobile: directly hide nav pill and quick-add so they don't overlap the editor
  if (!window.matchMedia('(min-width: 768px)').matches) {
    const nav = document.querySelector('.glass-nav-wrap');
    const pill = document.getElementById('quickAddWrap');
    if (nav) nav.style.display = 'none';
    if (pill) pill.style.display = 'none';
  }

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

  // Restore nav pill and quick-add
  if (!window.matchMedia('(min-width: 768px)').matches) {
    const nav = document.querySelector('.glass-nav-wrap');
    const pill = document.getElementById('quickAddWrap');
    if (nav) nav.style.display = '';
    if (pill) pill.style.display = '';
  }

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

// ── MARKDOWN TOOLBAR LOGIC ──
function insertMarkdown(action) {
  const t = document.getElementById('cnBodyInput');
  if (!t) return;
  
  const start = t.selectionStart;
  const end = t.selectionEnd;
  const text = t.value;
  const selected = text.slice(start, end);

  let replacement = '';
  let newCursor = start;

  const wraps = {
    'bold': ['**', '**'],
    'italic': ['*', '*'],
    'strike': ['~~', '~~'],
    'code': ['`', '`'],
    'codeblock': ['\n```\n', '\n```\n']
  };

  const prefixes = {
    'h1': '# ',
    'h2': '## ',
    'h3': '### ',
    'quote': '> ',
    'bullet': '- ',
    'number': '1. ',
    'task': '- [ ] '
  };

  if (wraps[action]) {
    const [w1, w2] = wraps[action];
    replacement = w1 + selected + w2;
    newCursor = selected ? start + replacement.length : start + w1.length;
    
  } else if (prefixes[action]) {
    // Quality of Life: If multiple lines are highlighted, prefix ALL of them
    if (selected.includes('\n')) {
      const lines = selected.split('\n');
      replacement = lines.map(l => prefixes[action] + l).join('\n');
      newCursor = start + replacement.length;
    } else {
      replacement = prefixes[action] + selected;
      newCursor = selected ? start + replacement.length : start + prefixes[action].length;
    }
    
  } else if (action === 'link') {
    replacement = `[${selected || 'link text'}](https://)`;
    newCursor = start + replacement.length - 1; 
  } else if (action === 'image') {
    replacement = `![${selected || 'alt text'}](https://)`;
    newCursor = start + replacement.length - 1;
  } else if (action === 'hr') {
    // Ensure horizontal rules have breathing room
    replacement = `\n---\n`;
    newCursor = start + replacement.length;
  }

  // Update textarea and refocus
  t.value = text.slice(0, start) + replacement + text.slice(end);
  t.focus();
  t.setSelectionRange(newCursor, newCursor);
  
  queueCNSave();
  autoResizeBody();
}

// Intercept mousedown to stop the textarea from losing highlighted text
document.addEventListener('mousedown', function(e) {
  const btn = e.target.closest('#cnMdToolbar button');
  if (btn) {
    e.preventDefault(); 
  }
});

// Handle the actual click insertion
document.addEventListener('click', function(e) {
  const btn = e.target.closest('#cnMdToolbar button');
  if (btn) {
    insertMarkdown(btn.getAttribute('data-md'));
  }
});

// Keyboard shortcuts (Cmd+B, Cmd+I)
document.addEventListener('keydown', function(e) {
  // Only trigger if we are actively editing a note (not in preview mode)
  if (cnActiveId && !cnMdPreview && (e.metaKey || e.ctrlKey)) {
    if (e.key === 'b') { e.preventDefault(); insertMarkdown('bold'); }
    if (e.key === 'i') { e.preventDefault(); insertMarkdown('italic'); }
  }
});

// ── [[ AUTOCOMPLETE STATE & LOGIC ──
let acActive = false;
let acStartIndex = -1;
let acSelectedIndex = 0;
let acMatches = [];

const acMenu = document.getElementById('cnAutocompleteMenu');
const acBodyInputEl = document.getElementById('cnBodyInput');

// 1. Listen for typing in the editor
if (cnBodyInputEl) {
  cnBodyInputEl.addEventListener('input', handleAutocompleteInput);
  cnBodyInputEl.addEventListener('keydown', handleAutocompleteKeydown);
}

function handleAutocompleteInput(e) {
  const t = e.target;
  const val = t.value;
  const cursor = t.selectionStart;
  
  // Look backward from the cursor to find "[["
  const textBeforeCursor = val.slice(0, cursor);
  const match = textBeforeCursor.match(/\[\[([^\]\n]*)$/);

  if (match) {
    // We are actively typing inside a [[ link
    acActive = true;
    acStartIndex = cursor - match[1].length;
    const query = match[1].toLowerCase();
    
    // Filter existing notes by query
    const allNotes = getCnNotes();
    acMatches = allNotes.filter(n => 
      n.id !== cnActiveId && // Don't link to the note we are currently editing
      (n.title || 'Untitled').toLowerCase().includes(query)
    );

    if (acMatches.length > 0) {
      renderAutocompleteMenu(t);
    } else {
      closeAutocomplete();
    }
  } else {
    closeAutocomplete();
  }
}

// 2. Render the floating menu
function renderAutocompleteMenu(textarea) {
  if (!acMenu) return;
  acMenu.innerHTML = '';
  acMenu.style.display = 'flex';

  // Ensure selected index is within bounds
  if (acSelectedIndex >= acMatches.length) acSelectedIndex = 0;

  acMatches.forEach((n, idx) => {
    const item = document.createElement('div');
    item.className = 'cn-ac-item' + (idx === acSelectedIndex ? ' selected' : '');
    const icon = NOTE_TYPES[noteTypeOf(n)] ? NOTE_TYPES[noteTypeOf(n)].icon : '✎';
    
    item.innerHTML = `<span class="cn-ac-icon">${icon}</span> ${esc(n.title || 'Untitled')}`;
    
    // Handle mouse click and mobile touch
    const commitFn = (e) => {
      e.preventDefault(); // Prevents keyboard from dropping on mobile!
      commitAutocomplete(n.title);
    };
    item.addEventListener('mousedown', commitFn);
    item.addEventListener('touchstart', commitFn, { passive: false });
    
    acMenu.appendChild(item);
  });

  // Get relative caret coordinates inside the textarea
  const { top, left } = getCaretCoordinates(textarea, textarea.selectionEnd);
  
  // Get the textarea's actual position on the screen
  const rect = textarea.getBoundingClientRect();
  
  // Fix the menu to the viewport exactly where the cursor is
  acMenu.style.position = 'fixed';
  acMenu.style.top = (rect.top + top + 24) + 'px'; 
  acMenu.style.left = Math.min(rect.left + left, window.innerWidth - 290) + 'px'; // Prevents it from clipping off the right edge
}

// 3. Handle Keyboard Navigation (Up, Down, Enter, Escape)
function handleAutocompleteKeydown(e) {
  if (!acActive) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acSelectedIndex = Math.min(acSelectedIndex + 1, acMatches.length - 1);
    renderAutocompleteMenu(e.target);
  } 
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acSelectedIndex = Math.max(acSelectedIndex - 1, 0);
    renderAutocompleteMenu(e.target);
  } 
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (acMatches[acSelectedIndex]) {
      commitAutocomplete(acMatches[acSelectedIndex].title);
    }
  } 
  else if (e.key === 'Escape') {
    closeAutocomplete();
  }
}

// 4. Insert the selected link
function commitAutocomplete(title) {
  const t = document.getElementById('cnBodyInput');
  const val = t.value;
  const cursor = t.selectionStart;

  const beforeStr = val.slice(0, acStartIndex);
  const afterStr = val.slice(cursor);
  
  // Insert the title and close the brackets
  const insertStr = title + ']]';
  
  t.value = beforeStr + insertStr + afterStr;
  
  // Set cursor right after the closing brackets
  const newCursor = acStartIndex + insertStr.length;
  t.setSelectionRange(newCursor, newCursor);
  t.focus();
  
  closeAutocomplete();
  queueCNSave();
}

function closeAutocomplete() {
  acActive = false;
  acSelectedIndex = 0;
  if (acMenu) acMenu.style.display = 'none';
}

// ── LIGHTWEIGHT CARET COORDINATE TRACKER ──
// This creates a hidden clone of the textarea to measure exact pixel location
function getCaretCoordinates(element, position) {
  const div = document.createElement('div');
  const style = div.style;
  const computed = window.getComputedStyle(element);

  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.position = 'absolute';
  style.visibility = 'hidden';

  // Copy necessary text styles
  const properties = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'border', 'boxSizing', 'width'];
  properties.forEach(prop => style[prop] = computed[prop]);

  div.textContent = element.value.substring(0, position);
  
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);
  
  document.body.appendChild(div);
  
  const coordinates = {
    top: span.offsetTop - element.scrollTop,
    left: span.offsetLeft - element.scrollLeft
  };
  
  document.body.removeChild(div);
  return coordinates;
}

// ── EXPORTS ──
export { renderCNList, createNewNote, rebuildCNChips, NOTE_TYPES, noteTypeOf };
