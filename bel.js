// ══════════════════════════════════════════════════════════════════
// BEL MODULE — Relationship tab
// ══════════════════════════════════════════════════════════════════

import { uid, esc, saveBel, getBelState, setBelState } from './state.js';

function renderBel() {
  const bs = getBelState();
  if (!bs) setBelState({ annivDate: '', giftsList: [], datesList: [], favs: '', love: '' });
  const f = document.getElementById('belFavs'); if (f) f.innerHTML = getBelState().favs || '';
  const l = document.getElementById('belLove'); if (l) l.innerHTML = getBelState().love || '';
  renderBelList('belGiftsList', 'giftsList');
  renderBelList('belDatesList', 'datesList');
  updateBelTime();
}

function renderBelList(listId, dataKey) {
  const list = document.getElementById(listId); if (!list) return;
  const bs = getBelState();
  const items = bs[dataKey] || [];
  list.innerHTML = '';
  if (items.length === 0) { list.innerHTML = '<div style="font-size:12px; color:#888; font-style:italic; padding-bottom:8px;">List is empty.</div>'; return; }
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'bel-item'; row.dataset.id = item.id; row.dataset.key = dataKey;
    row.innerHTML = '<div class="bel-cb ' + (item.done ? 'checked' : '') + '" data-action="check"></div><div class="bel-text ' + (item.done ? 'checked' : '') + '" data-action="check">' + esc(item.text) + '</div><div class="bel-del" data-action="del">✕</div>';
    list.appendChild(row);
  });
}

function addBelItem(listKey, inputId, listId) {
  const bs = getBelState();
  const inp = document.getElementById(inputId); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  if (!bs[listKey]) bs[listKey] = [];
  bs[listKey].push({ id: uid(), text, done: false });
  inp.value = '';
  saveBel(true);
  renderBelList(listId, listKey);
}

function updateBelTime() {
  const bs = getBelState();
  const countEl = document.getElementById('belTimeCount');
  const annivEl = document.getElementById('belNextAnniv');
  if (!countEl || !annivEl) return;
  if (!bs.annivDate) { countEl.textContent = '--'; annivEl.textContent = 'Tap Edit Date below to start'; return; }
  const start = new Date(bs.annivDate + 'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  if (start > now) { countEl.textContent = '--'; annivEl.textContent = 'Date is in the future!'; return; }
  let yrs = now.getFullYear() - start.getFullYear();
  let mos = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) { mos--; const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0); days += prevMonth.getDate(); }
  if (mos < 0) { yrs--; mos += 12; }
  const str = [];
  if (yrs > 0) str.push(yrs + ' yr' + (yrs > 1 ? 's' : ''));
  if (mos > 0) str.push(mos + ' mo' + (mos > 1 ? 's' : ''));
  str.push(days + ' d');
  countEl.textContent = str.join(', ');
  const nextAnniv = new Date(start); nextAnniv.setFullYear(now.getFullYear());
  if (nextAnniv < now) nextAnniv.setFullYear(now.getFullYear() + 1);
  const diff = Math.round((nextAnniv - now) / 86400000);
  if (diff === 0) annivEl.textContent = "It's today! Happy Anniversary! ❤️";
  else annivEl.textContent = diff + " days until next anniversary";
}

/**
 * Wire up DOM events. Call once after DOM is ready.
 */
function initBel() {
  const bga = document.getElementById('belGiftAddBtn');
  if (bga) bga.addEventListener('click', function() { addBelItem('giftsList', 'belGiftInput', 'belGiftsList'); });
  const bda = document.getElementById('belDateAddBtn');
  if (bda) bda.addEventListener('click', function() { addBelItem('datesList', 'belDateInput', 'belDatesList'); });
  const bgi = document.getElementById('belGiftInput');
  if (bgi) bgi.addEventListener('keydown', function(e) { if (e.key === 'Enter') addBelItem('giftsList', 'belGiftInput', 'belGiftsList'); });
  const bdi = document.getElementById('belDateInput');
  if (bdi) bdi.addEventListener('keydown', function(e) { if (e.key === 'Enter') addBelItem('datesList', 'belDateInput', 'belDatesList'); });

  ['belGiftsList', 'belDatesList'].forEach(listId => {
    const l = document.getElementById(listId); if (!l) return;
    l.addEventListener('click', function(e) {
      const action = e.target.dataset.action; const row = e.target.closest('.bel-item'); if (!row || !action) return;
      const id = row.dataset.id; const key = row.dataset.key;
      const bs = getBelState();
      if (action === 'check') { const items = bs[key]; for (let i = 0; i < items.length; i++) { if (items[i].id === id) items[i].done = !items[i].done; } }
      if (action === 'del') { bs[key] = bs[key].filter(i => i.id !== id); }
      saveBel(true); renderBelList(listId, key);
    });
  });

  let belTimer = null;
  ['belFavs', 'belLove'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('input', function() {
      const bs = getBelState();
      bs[id.replace('bel', '').toLowerCase()] = this.innerHTML;
      if (belTimer) clearTimeout(belTimer);
      belTimer = setTimeout(function() { saveBel(true); }, 1000);
    });
  });

  const ebd = document.getElementById('editBelDateBtn');
  if (ebd) {
    ebd.addEventListener('click', function() {
      const wrap = document.getElementById('belDateEditWrap');
      wrap.style.display = wrap.style.display === 'flex' ? 'none' : 'flex';
      if (wrap.style.display === 'flex') { document.getElementById('belAnnivInput').value = getBelState().annivDate || ''; }
    });
  }

  const sbd = document.getElementById('saveBelDateBtn');
  if (sbd) {
    sbd.addEventListener('click', function() {
      const d = document.getElementById('belAnnivInput').value;
      const bs = getBelState();
      bs.annivDate = d;
      document.getElementById('belDateEditWrap').style.display = 'none';
      saveBel(true);
      updateBelTime();
    });
  }
}

export { initBel, renderBel };
