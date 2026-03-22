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
let cnSaveTimer = null;
let scratchSyncTimer = null;
let cnMdPreview = false;
let _cnOpenSnapshot = null; // snapshot of note state on open, for dirty detection

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
    card.className = 'cn-note-card' + (n.locked ? ' locked-card' : '');
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

    var displayDate = n.updatedAt || n.createdAt;
    var timeHtml = displayDate ? '<span class="cn-card-time">' + cnTimeAgo(displayDate) + '</span>' : '';

    card.innerHTML =
      '<div class="cn-card-title">' + lockHtml + pinHtml + esc(n.title || 'Untitled') + '</div>' +
      (n.speaker ? '<div class="cn-card-speaker">' + esc(n.speaker) + '</div>' : '') +
      (n.body ? '<div class="cn-card-preview">' + esc(n.body) + '</div>' : '') +
      '<div class="cn-card-meta">' + tagsHtml + projHtml + timeHtml + '</div>';

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

  // Snapshot current state so we can detect actual edits on save
  _cnOpenSnapshot = {
    title: n.title || '',
    speaker: n.speaker || '',
    body: n.body || '',
    projectId: n.projectId || '',
    bodyIsMono: !!(n.bodyIsMono),
    tags: (n.tags || []).slice().sort().join(','),
  };

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

  // Default to preview if note has content, edit if empty
  toggleMdPreview((n.body || '').trim() ? 'on' : 'off');
}

function closeCNDetail() {
  saveCNDetailNow();
  cnActiveId = null;
  _cnOpenSnapshot = null;
  document.getElementById('cnDetailView').style.display = 'none';
  var listEl = document.getElementById('cnListView');
  listEl.style.display = 'block';
  renderCNList();
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
  };
  var dirty = !_cnOpenSnapshot
    || currentState.title !== _cnOpenSnapshot.title
    || currentState.speaker !== _cnOpenSnapshot.speaker
    || currentState.body !== _cnOpenSnapshot.body
    || currentState.projectId !== _cnOpenSnapshot.projectId
    || currentState.bodyIsMono !== _cnOpenSnapshot.bodyIsMono
    || currentState.tags !== _cnOpenSnapshot.tags;

  if (dirty) {
    n.updatedAt = new Date().toISOString();
    _cnOpenSnapshot = currentState; // update snapshot so subsequent saves during same session don't re-dirty
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
    if (mode !== 'off') bodyEl.focus();
  }
}

function createNewNote() {
  const cnNotes = getCnNotes();
  const n = {
    id: uid(),
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
  saveCN(false);
  openCNDetail(n.id);
  setTimeout(function() { document.getElementById('cnTitleInput').focus(); }, 100);
  showToast('New note created');
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
    const currentFilter = cnFilter;
    filterRow.innerHTML = '';
    const allChip = document.createElement('div');
    allChip.className = 'chip' + (currentFilter === 'all' ? ' active' : '');
    allChip.dataset.cnfilter = 'all';
    allChip.textContent = 'All';
    filterRow.appendChild(allChip);
    Object.keys(CAT_LABEL).forEach(function(key) {
      const c = document.createElement('div');
      c.className = 'chip' + (currentFilter === key ? ' active' : '');
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
  cnFilter = chip.dataset.cnfilter;
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
    createNewNote();
  }
});

// ── EXPORTS ──
export { renderCNList, createNewNote, rebuildCNChips };
