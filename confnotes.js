// ══════════════════════════════════════════════════════════════════
// UNIFIED NOTES MODULE — confnotes.js (ES module)
// Scratchpad + structured notes in one view.
// ══════════════════════════════════════════════════════════════════

import {
  state, CAT_LABEL, uid, esc, fmtShort, showToast,
  saveCN, getCnNotes, setCnNotes,
} from './state.js';
import { ghPush } from './sync.js';
import { catCls } from './app.js';

let cnActiveId = null;
let cnFilter = 'all';
let cnTypeFilter = 'all'; // 'all' | 'paper' | 'idea' | 'memo'
let cnSaveTimer = null;
let scratchSyncTimer = null;
let cnMdPreview = false;
let _cnOpenSnapshot = null; // snapshot of note state on open, for dirty detection

// ── NOTE TYPES ──
const NOTE_TYPES = {
  memo:  { label: 'Note',  icon: '✎', color: 'var(--text-muted)' },
  paper: { label: 'Paper', icon: '📄', color: '#af52de' },
  idea:  { label: 'Idea',  icon: '💡', color: '#ff9500' },
};

const PAPER_TEMPLATE = '**One-line summary:**\n\n\n**What I\'d challenge:**\n\n\n**What I\'d steal for my own work:**\n\n';

const IDEA_STATUSES = ['raw', 'developing', 'ready to pitch'];

function noteTypeOf(n) { return n.type || 'memo'; }

function ideaDaysSinceUpdate(n) {
  var ref = n.updatedAt || n.createdAt;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
}

function getIdeasForReview() {
  return getCnNotes().filter(function(n) {
    return noteTypeOf(n) === 'idea' && !n.archived;
  });
}

// ── LOCK SYSTEM ──
let _pinUnlocked = false; // session-only, resets on reload

async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredPinHash() {
  try { return localStorage.getItem('kw_notes_pin_hash') || ''; } catch(e) { return ''; }
}

function hasPinSet() {
  return !!getStoredPinHash();
}

function showPinModal(title, callback) {
  var overlay = document.getElementById('pinModalOverlay');
  var input = document.getElementById('pinModalInput');
  var error = document.getElementById('pinModalError');
  var titleEl = document.getElementById('pinModalTitle');
  titleEl.textContent = title || 'Enter PIN';
  input.value = '';
  error.textContent = '';
  overlay.style.display = 'flex';
  setTimeout(function() { input.focus(); }, 100);

  // Clean up old listeners
  var confirmBtn = document.getElementById('pinModalConfirm');
  var cancelBtn = document.getElementById('pinModalCancel');
  var newConfirm = confirmBtn.cloneNode(true);
  var newCancel = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  function dismiss() { overlay.style.display = 'none'; input.value = ''; }

  newCancel.addEventListener('click', function() { dismiss(); callback(null); });
  newConfirm.addEventListener('click', function() {
    var val = input.value;
    if (!val) { error.textContent = 'Enter a PIN'; return; }
    callback(val, error, dismiss);
  });
  input.addEventListener('keydown', function handler(e) {
    if (e.key === 'Enter') { newConfirm.click(); }
    if (e.key === 'Escape') { dismiss(); callback(null); }
  });
}

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
  return fmtShort(then);
}

// ══════════════════════════════════════════════════════════════════
// SCRATCHPAD
// ══════════════════════════════════════════════════════════════════

function initScratchpad() {
  const sp = document.getElementById('cnScratchpad');
  const monoBtn = document.getElementById('cnScratchMono');
  if (!sp || !monoBtn) return;

  sp.value = state.scratchpad || '';

  const isMono = localStorage.getItem('kw_notes_mono_v3') === 'true';
  sp.classList.toggle('mono', isMono);
  monoBtn.textContent = isMono ? 'mono on' : 'mono off';
  monoBtn.classList.toggle('mono-active', isMono);

  sp.addEventListener('input', function() {
    state.scratchpad = this.value;
    localStorage.setItem('kw_notes_v3', state.scratchpad);
    const syncEl = document.getElementById('cnScratchSync');
    if (syncEl) syncEl.textContent = 'unsaved';
    if (scratchSyncTimer) clearTimeout(scratchSyncTimer);
    scratchSyncTimer = setTimeout(function() {
      ghPush();
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
    sp.value = state.scratchpad || '';
  }
}

// ══════════════════════════════════════════════════════════════════
// NOTE LIST
// ══════════════════════════════════════════════════════════════════

function renderCNList() {
  const cnNotes = getCnNotes();
  const list = document.getElementById('cnNotesList');
  if (!list) return;
  list.innerHTML = '';

  refreshScratchpad();

  let searchQ = '';
  const searchEl = document.getElementById('cnSearchInput');
  if (searchEl) searchQ = searchEl.value.trim().toLowerCase();

  const filtered = cnNotes.filter(function(n) {
    // Type filter
    if (cnTypeFilter !== 'all') {
      if (noteTypeOf(n) !== cnTypeFilter) return false;
    }
    // Category filter
    if (cnFilter !== 'all') {
      const tags = n.tags || [];
      if (tags.indexOf(cnFilter) === -1) return false;
    }
    if (searchQ) {
      const haystack = ((n.title||'') + ' ' + (n.speaker||'') + ' ' + (n.body||'') + ' ' + (n.url||'')).toLowerCase();
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
    const nType = noteTypeOf(n);
    const typeInfo = NOTE_TYPES[nType] || NOTE_TYPES.memo;
    const card = document.createElement('div');
    card.className = 'cn-note-card cn-type-' + nType + (n.locked ? ' locked-card' : '');
    card.style.animationDelay = (i * 30) + 'ms';
    card.dataset.id = n.id;

    const tagsHtml = (n.tags || []).map(function(t) {
      return '<span class="cat ' + catCls(t) + '">' + esc(CAT_LABEL[t] || t) + '</span>';
    }).join('');

    let projHtml = '';
    if (n.projectId) {
      const p = (state.projects || []).find(function(x) { return x.id === n.projectId; });
      if (p) projHtml = '<span class="proj-link-label">\u26CC ' + esc(p.title) + '</span>';
    }

    const pinHtml = n.pinned ? '<span class="cn-card-pin">📌</span>' : '';
    const lockHtml = n.locked ? '<span class="cn-card-lock-icon">🔒</span>' : '';

    // Type badge
    const typeBadge = '<span class="cn-type-badge cn-type-badge-' + nType + '">' + typeInfo.icon + ' ' + typeInfo.label + '</span>';

    // Stale indicator for ideas
    let staleHtml = '';
    if (nType === 'idea') {
      const staleDays = ideaDaysSinceUpdate(n);
      if (staleDays >= 30) {
        staleHtml = '<span class="cn-idea-stale">dormant ' + staleDays + 'd</span>';
      } else if (staleDays >= 14) {
        staleHtml = '<span class="cn-idea-cooling">cooling ' + staleDays + 'd</span>';
      }
    }

    // Idea status badge
    let statusHtml = '';
    if (nType === 'idea' && n.ideaStatus) {
      statusHtml = '<span class="cn-idea-status cn-idea-status-' + n.ideaStatus.replace(/\s+/g, '-') + '">' + esc(n.ideaStatus) + '</span>';
    }

    // Paper URL indicator
    let urlHtml = '';
    if (nType === 'paper' && n.url) {
      urlHtml = '<span class="cn-paper-url-badge">🔗</span>';
    }

    var displayDate = n.updatedAt || n.createdAt;
    var timeHtml = displayDate ? '<span class="cn-card-time">' + cnTimeAgo(displayDate) + '</span>' : '';

    // Speaker label changes by type
    var speakerDisplay = n.speaker || '';
    var speakerHtml = speakerDisplay ? '<div class="cn-card-speaker">' + esc(speakerDisplay) + '</div>' : '';

    card.innerHTML =
      '<div class="cn-card-title">' + lockHtml + pinHtml + urlHtml + esc(n.title || 'Untitled') + '</div>' +
      speakerHtml +
      (n.body ? '<div class="cn-card-preview">' + esc(n.body) + '</div>' : '') +
      '<div class="cn-card-meta">' + typeBadge + statusHtml + staleHtml + tagsHtml + projHtml + timeHtml + '</div>';

    card.addEventListener('click', function() {
      if (n.locked && !_pinUnlocked) {
        showPinModal('Enter PIN to unlock', function(pin, errorEl, dismiss) {
          if (!pin) return;
          hashPin(pin).then(function(h) {
            if (h === getStoredPinHash()) {
              _pinUnlocked = true;
              dismiss();
              openCNDetail(n.id);
            } else {
              errorEl.textContent = 'Wrong PIN';
            }
          });
        });
        return;
      }
      openCNDetail(n.id);
    });
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

// ══════════════════════════════════════════════════════════════════
// DISTRACTION-FREE EDITOR
// ══════════════════════════════════════════════════════════════════

function populateCNProjectSelect() {
  const sel = document.getElementById('cnProjectInput');
  if (!sel) return;
  sel.innerHTML = '<option value="">None</option>';
  (state.projects || []).forEach(function(p) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    sel.appendChild(opt);
  });
}

function openCNDetail(id) {
  const cnNotes = getCnNotes();
  let n = null;
  for (let i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === id) { n = cnNotes[i]; break; }
  }
  if (!n) return;
  cnActiveId = id;
  populateCNProjectSelect();

  var nType = noteTypeOf(n);

  // Snapshot current state so we can detect actual edits on save
  _cnOpenSnapshot = {
    title: n.title || '',
    speaker: n.speaker || '',
    body: n.body || '',
    projectId: n.projectId || '',
    bodyIsMono: !!(n.bodyIsMono),
    tags: (n.tags || []).slice().sort().join(','),
    type: nType,
    url: n.url || '',
    ideaStatus: n.ideaStatus || '',
  };

  document.getElementById('cnTitleInput').value = n.title || '';
  document.getElementById('cnSpeakerInput').value = n.speaker || '';
  document.getElementById('cnBodyInput').value = n.body || '';
  const projInp = document.getElementById('cnProjectInput');
  if (projInp) projInp.value = n.projectId || '';

  // Type-specific UI
  var titleInput = document.getElementById('cnTitleInput');
  var speakerInput = document.getElementById('cnSpeakerInput');
  var bodyInput = document.getElementById('cnBodyInput');
  var urlRow = document.getElementById('cnUrlRow');
  var urlInput = document.getElementById('cnUrlInput');
  var ideaStatusRow = document.getElementById('cnIdeaStatusRow');
  var topbarTitle = document.getElementById('cnDetailTitle');

  // Type selector chips
  document.querySelectorAll('#cnTypeRow .cn-type-chip').forEach(function(c) {
    c.classList.toggle('active', c.dataset.type === nType);
  });

  if (nType === 'paper') {
    titleInput.placeholder = 'Paper title...';
    speakerInput.placeholder = 'Authors (e.g., Barrett & Simmons, 2015)...';
    bodyInput.placeholder = PAPER_TEMPLATE;
    topbarTitle.textContent = '📄 Paper';
    
    if (urlRow) { 
      urlRow.style.display = 'flex'; 
      urlInput.value = n.url || ''; 
      const launchBtn = document.getElementById('cnUrlLaunchBtn');
      if (launchBtn) {
          launchBtn.style.display = n.url ? 'block' : 'none';
          launchBtn.href = n.url && !n.url.startsWith('http') ? 'https://doi.org/' + n.url : n.url;
      }
    }
    
    if (ideaStatusRow) ideaStatusRow.style.display = 'none';
  } else if (nType === 'idea') {
    titleInput.placeholder = 'Research question or study concept...';
    speakerInput.placeholder = 'Related area, method, or population...';
    bodyInput.placeholder = 'Flesh out the idea... what would the study look like? What\'s the hypothesis?';
    topbarTitle.textContent = '💡 Idea';
    if (urlRow) urlRow.style.display = 'none';
    if (ideaStatusRow) {
      ideaStatusRow.style.display = 'flex';
      document.querySelectorAll('#cnIdeaStatusRow .cn-status-chip').forEach(function(c) {
        c.classList.toggle('active', c.dataset.status === (n.ideaStatus || 'raw'));
      });
    }
  } else {
    titleInput.placeholder = 'Title...';
    speakerInput.placeholder = 'Source, speaker, context...';
    bodyInput.placeholder = 'Write anything...';
    topbarTitle.textContent = 'Note';
    if (urlRow) urlRow.style.display = 'none';
    if (ideaStatusRow) ideaStatusRow.style.display = 'none';
  }

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

  // Lock button state
  const lockBtn = document.getElementById('cnLockBtn');
  if (lockBtn) {
    lockBtn.style.display = hasPinSet() ? '' : 'none';
    lockBtn.classList.toggle('locked', !!(n.locked));
  }

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
  detailEl.classList.remove('cn-detail-exit');
  detailEl.classList.add('cn-detail-enter');
  detailEl.addEventListener('animationend', function handler() {
    detailEl.classList.remove('cn-detail-enter');
    detailEl.removeEventListener('animationend', handler);
  });

  // Default to preview if note has content, edit if empty
  toggleMdPreview((n.body || '').trim() ? 'on' : 'off');
}

function closeCNDetail() {
  saveCNDetailNow();
  cnActiveId = null;
  _cnOpenSnapshot = null;

  var detailEl = document.getElementById('cnDetailView');
  detailEl.classList.remove('cn-detail-enter');
  detailEl.classList.add('cn-detail-exit');
  detailEl.addEventListener('animationend', function handler() {
    detailEl.classList.remove('cn-detail-exit');
    detailEl.style.display = 'none';
    detailEl.removeEventListener('animationend', handler);
    var listEl = document.getElementById('cnListView');
    listEl.style.display = 'block';
    listEl.classList.add('cn-list-enter');
    listEl.addEventListener('animationend', function lh() {
      listEl.classList.remove('cn-list-enter');
      listEl.removeEventListener('animationend', lh);
    });
    renderCNList();
  });
}

function saveCNDetailNow() {
  if (!cnActiveId) return;
  const cnNotes = getCnNotes();
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

  // Type — only set if changed from existing
  var activeType = document.querySelector('#cnTypeRow .cn-type-chip.active');
  var newType = activeType ? activeType.dataset.type : (n.type || 'memo');
  if (n.type !== newType) n.type = newType;

  // URL (papers) — only set if changed
  var urlInput = document.getElementById('cnUrlInput');
  if (urlInput) {
    var newUrl = urlInput.value.trim();
    if ((n.url || '') !== newUrl) n.url = newUrl;
  }

  // Idea status — only set if changed
  var activeStatus = document.querySelector('#cnIdeaStatusRow .cn-status-chip.active');
  if (activeStatus) {
    var newStatus = activeStatus.dataset.status;
    if ((n.ideaStatus || '') !== newStatus) n.ideaStatus = newStatus;
  }

  const tags = [];
  document.querySelectorAll('#cnTagRow .s-chip.active').forEach(function(c) {
    tags.push(c.dataset.val);
  });
  n.tags = tags;

  // Only stamp updatedAt if something actually changed
  var currentState = {
    title: n.title,
    speaker: n.speaker,
    body: n.body,
    projectId: n.projectId,
    bodyIsMono: n.bodyIsMono,
    tags: tags.slice().sort().join(','),
    type: n.type || 'memo',
    url: n.url || '',
    ideaStatus: n.ideaStatus || '',
  };
  var dirty = !_cnOpenSnapshot
    || currentState.title !== _cnOpenSnapshot.title
    || currentState.speaker !== _cnOpenSnapshot.speaker
    || currentState.body !== _cnOpenSnapshot.body
    || currentState.projectId !== _cnOpenSnapshot.projectId
    || currentState.bodyIsMono !== _cnOpenSnapshot.bodyIsMono
    || currentState.tags !== _cnOpenSnapshot.tags
    || currentState.type !== _cnOpenSnapshot.type
    || currentState.url !== _cnOpenSnapshot.url
    || currentState.ideaStatus !== _cnOpenSnapshot.ideaStatus;

  if (dirty) {
    n.updatedAt = new Date().toISOString();
    _cnOpenSnapshot = currentState;
  }

  saveCN(true);
}

function queueCNSave() {
  if (cnSaveTimer) clearTimeout(cnSaveTimer);
  cnSaveTimer = setTimeout(saveCNDetailNow, 1200);
}

function toggleMdPreview(mode) {
  // mode: 'on' = force preview, 'off' = force edit, undefined = toggle
  var bodyEl = document.getElementById('cnBodyInput');
  var previewEl = document.getElementById('cnMdPreview');
  var toggleBtn = document.getElementById('cnMdToggle');
  if (!bodyEl || !previewEl || !toggleBtn) return;

  var wantPreview;
  if (mode === 'on') wantPreview = true;
  else if (mode === 'off') wantPreview = false;
  else wantPreview = !cnMdPreview;

  if (wantPreview && typeof marked !== 'undefined') {
    cnMdPreview = true;
    // Flush any pending edits before rendering
    saveCNDetailNow();
    
    // 1. Process [[Internal Links]] FIRST
    const rawContent = bodyEl.value || '';
    const processedContent = rawContent.replace(
      /\[\[(.*?)\]\]/g, 
      '<a href="#" class="internal-note-link" data-notetitle="$1">[[ $1 ]]</a>'
    );

    // 2. THEN parse markdown
    previewEl.innerHTML = marked.parse(processedContent, { breaks: true, gfm: true });

    // 3. Auto-inject the Paper URL into the preview!
    const activeType = document.querySelector('#cnTypeRow .cn-type-chip.active');
    const isPaper = activeType && activeType.dataset.type === 'paper';
    const urlVal = document.getElementById('cnUrlInput').value.trim();
    
    if (isPaper && urlVal) {
        // Automatically handle DOIs vs full links
        const linkHref = urlVal.startsWith('http') ? urlVal : 'https://doi.org/' + urlVal;
        finalHtml = `<div style="margin-bottom: 16px;"><a href="${linkHref}" target="_blank" class="cn-md-paper-link">🔗 Open Source Document</a></div>` + finalHtml;
    }

    previewEl.innerHTML = finalHtml;
    
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
    if (mode !== 'off') bodyEl.focus();
  }
}

function createNewNote(type) {
  type = type || 'memo';
  const cnNotes = getCnNotes();
  const n = {
    id: uid(),
    title: '',
    speaker: '',
    body: type === 'paper' ? PAPER_TEMPLATE : '',
    tags: [],
    projectId: '',
    bodyIsMono: false,
    pinned: false,
    type: type,
    url: '',
    ideaStatus: type === 'idea' ? 'raw' : '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  cnNotes.unshift(n);
  saveCN(false);
  openCNDetail(n.id);
  setTimeout(function() { document.getElementById('cnTitleInput').focus(); }, 100);
  var labels = { memo: 'New note', paper: 'New paper note', idea: 'New idea' };
  showToast(labels[type] || 'New note created');
}

function deleteCNNote(id) {
  setCnNotes(getCnNotes().filter(function(n) { return n.id !== id; }));
  saveCN(true);
  closeCNDetail();
  showToast('Note deleted');
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
    Object.keys(CAT_LABEL).forEach(function(key) {
      const c = document.createElement('div');
      c.className = 's-chip' + (activeVals.indexOf(key) !== -1 ? ' active' : '');
      c.dataset.val = key;
      c.textContent = CAT_LABEL[key];
      tagRow.appendChild(c);
    });
  }
  const filterRow = document.getElementById('cnFilterRow');
  if (filterRow) {
    var currentFilter = cnFilter;
    var currentTypeFilter = cnTypeFilter;
    // Determine which chip should be active
    var activeKey = 'all';
    if (currentTypeFilter !== 'all') activeKey = '_type_' + currentTypeFilter;
    else if (currentFilter !== 'all') activeKey = currentFilter;

    filterRow.innerHTML = '';

    // "All" chip
    var allChip = document.createElement('div');
    allChip.className = 'chip' + (activeKey === 'all' ? ' active' : '');
    allChip.dataset.cnfilter = 'all';
    allChip.textContent = 'All';
    filterRow.appendChild(allChip);

    // Type chips
    var types = [
      { key: 'paper', label: '📄 Papers' },
      { key: 'idea',  label: '💡 Ideas' },
      { key: 'memo',  label: '✎ Notes' },
    ];
    types.forEach(function(t) {
      var c = document.createElement('div');
      c.className = 'chip' + (activeKey === '_type_' + t.key ? ' active' : '');
      c.dataset.cnfilter = '_type_' + t.key;
      c.textContent = t.label;
      filterRow.appendChild(c);
    });

    // Category chips
    Object.keys(CAT_LABEL).forEach(function(key) {
      var c = document.createElement('div');
      c.className = 'chip' + (activeKey === key ? ' active' : '');
      c.dataset.cnfilter = key;
      c.textContent = CAT_LABEL[key];
      filterRow.appendChild(c);
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// EVENT WIRING
// ══════════════════════════════════════════════════════════════════

initScratchpad();
rebuildCNChips();

// Note: confnotes is now tab-navigated as "Notes" — no icon or close button needed

document.getElementById('cnBackBtn').addEventListener('click', closeCNDetail);

document.getElementById('cnDeleteBtn').addEventListener('click', function() {
  if (!cnActiveId) return;
  if (confirm('Delete this note?')) deleteCNNote(cnActiveId);
});

document.getElementById('cnPinBtn').addEventListener('click', function() {
  if (!cnActiveId) return;
  const cnNotes = getCnNotes();
  let n = null;
  for (let i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === cnActiveId) { n = cnNotes[i]; break; }
  }
  if (!n) return;
  n.pinned = !n.pinned;
  this.classList.toggle('pinned', n.pinned);
  saveCN(true);
  showToast(n.pinned ? 'Note pinned' : 'Note unpinned');
});

document.getElementById('cnLockBtn').addEventListener('click', function() {
  if (!cnActiveId || !hasPinSet()) return;
  var cnNotes = getCnNotes();
  var n = null;
  for (var i = 0; i < cnNotes.length; i++) {
    if (cnNotes[i].id === cnActiveId) { n = cnNotes[i]; break; }
  }
  if (!n) return;
  n.locked = !n.locked;
  this.classList.toggle('locked', n.locked);
  saveCN(true);
  showToast(n.locked ? 'Note locked' : 'Note unlocked');
});

document.getElementById('cnTagRow').addEventListener('click', function(e) {
  const chip = e.target.closest('.s-chip');
  if (!chip) return;
  chip.classList.toggle('active');
  queueCNSave();
});

// Type selector in editor
document.getElementById('cnTypeRow').addEventListener('click', function(e) {
  var chip = e.target.closest('.cn-type-chip');
  if (!chip) return;
  document.querySelectorAll('#cnTypeRow .cn-type-chip').forEach(function(c) { c.classList.remove('active'); });
  chip.classList.add('active');
  var newType = chip.dataset.type;

  // Update UI for new type
  var titleInput = document.getElementById('cnTitleInput');
  var speakerInput = document.getElementById('cnSpeakerInput');
  var bodyInput = document.getElementById('cnBodyInput');
  var urlRow = document.getElementById('cnUrlRow');
  var ideaStatusRow = document.getElementById('cnIdeaStatusRow');
  var topbarTitle = document.getElementById('cnDetailTitle');

  if (newType === 'paper') {
    titleInput.placeholder = 'Paper title...';
    speakerInput.placeholder = 'Authors (e.g., Barrett & Simmons, 2015)...';
    bodyInput.placeholder = PAPER_TEMPLATE;
    topbarTitle.textContent = '📄 Paper';
    if (urlRow) urlRow.style.display = 'flex';
    if (ideaStatusRow) ideaStatusRow.style.display = 'none';
    // Pre-fill template if body is empty
    if (!bodyInput.value.trim()) bodyInput.value = PAPER_TEMPLATE;
  } else if (newType === 'idea') {
    titleInput.placeholder = 'Research question or study concept...';
    speakerInput.placeholder = 'Related area, method, or population...';
    bodyInput.placeholder = 'Flesh out the idea...';
    topbarTitle.textContent = '💡 Idea';
    if (urlRow) urlRow.style.display = 'none';
    if (ideaStatusRow) ideaStatusRow.style.display = 'flex';
  } else {
    titleInput.placeholder = 'Title...';
    speakerInput.placeholder = 'Source, speaker, context...';
    bodyInput.placeholder = 'Write anything...';
    topbarTitle.textContent = 'Note';
    if (urlRow) urlRow.style.display = 'none';
    if (ideaStatusRow) ideaStatusRow.style.display = 'none';
  }
  queueCNSave();
});

// Idea status chips
var ideaStatusRow = document.getElementById('cnIdeaStatusRow');
if (ideaStatusRow) {
  ideaStatusRow.addEventListener('click', function(e) {
    var chip = e.target.closest('.cn-status-chip');
    if (!chip) return;
    document.querySelectorAll('#cnIdeaStatusRow .cn-status-chip').forEach(function(c) { c.classList.remove('active'); });
    chip.classList.add('active');
    queueCNSave();
  });
}

// URL input with live-updating Launch Button
var urlInput = document.getElementById('cnUrlInput');
if (urlInput) {
  urlInput.addEventListener('input', function() {
    queueCNSave();
    const launchBtn = document.getElementById('cnUrlLaunchBtn');
    if(launchBtn) {
      const val = this.value.trim();
      launchBtn.style.display = val ? 'block' : 'none';
      launchBtn.href = val && !val.startsWith('http') ? 'https://doi.org/' + val : val;
    }
  });
}

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
  toggleMdPreview(); // no arg = toggle
});

document.getElementById('cnMdPreview').addEventListener('click', function(e) {
  // Don't swallow link clicks — let them open in new tab
  if (e.target.closest('a')) return;
  toggleMdPreview('off');
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
  var val = chip.dataset.cnfilter;
  if (val === 'all') {
    cnFilter = 'all';
    cnTypeFilter = 'all';
  } else if (val.indexOf('_type_') === 0) {
    cnTypeFilter = val.replace('_type_', '');
    cnFilter = 'all';
  } else {
    cnFilter = val;
    cnTypeFilter = 'all';
  }
  renderCNList();
});

document.addEventListener('keydown', function(e) {
  if (!document.body.classList.contains('notes-mode')) return;
  const tag = (document.activeElement || {}).tagName || '';
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
  if (inInput) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    e.stopPropagation();
    createNewNote('memo');
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    e.stopPropagation();
    createNewNote('paper');
  } else if (e.key === 'i' || e.key === 'I') {
    e.preventDefault();
    e.stopPropagation();
    createNewNote('idea');
  }
});
// ── ZETTELKASTEN LINKED NOTES LISTENER ──
document.addEventListener('click', function(e) {
  const link = e.target.closest('.internal-note-link');
  if (!link) return;

  e.preventDefault();
  e.stopPropagation();

  const targetTitle = link.getAttribute('data-notetitle');
  if (!targetTitle) return;

  const cnNotes = getCnNotes();
  const targetNote = cnNotes.find(n => (n.title || '').toLowerCase() === targetTitle.toLowerCase());

  if (targetNote) {
    // Note exists -> Save current work and open it
    saveCNDetailNow();
    openCNDetail(targetNote.id);
  } else {
    // Note doesn't exist -> Prompt to create it
    if (confirm(`The note "${targetTitle}" doesn't exist yet. Create it?`)) {
      saveCNDetailNow();
      
      const newNote = {
        id: uid(),
        title: targetTitle,
        speaker: '',
        body: '',             // Leaves the body blank
        tags: [],
        projectId: '',
        bodyIsMono: false,
        pinned: false,
        type: 'memo',         // 'memo' is your app's internal key for a standard Note
        url: '',
        ideaStatus: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      cnNotes.unshift(newNote);
      saveCN(false);
      openCNDetail(newNote.id);
    }
  }
});

// ── EXPORTS ──
export { renderCNList, createNewNote, rebuildCNChips, getIdeasForReview, NOTE_TYPES, noteTypeOf };
