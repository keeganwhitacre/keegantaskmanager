// ══════════════════════════════════════════════════════════════════
// SHOPPING MODULE — Shopping list
// ══════════════════════════════════════════════════════════════════

import { esc, saveShop, getShopItems, setShopItems } from './state.js';

// openSheet is defined in app.js — passed in via init()
let _openSheet = () => {};

function renderShop() {
  const items = getShopItems();
  const list = document.getElementById('shopList'); if (!list) return;
  const active = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  const ordered = active.concat(done);
  if (ordered.length === 0) { list.innerHTML = '<div class="shop-empty">List is empty. Add something above.</div>'; return; }
  list.innerHTML = '';
  ordered.forEach(function(item, idx) {
    const row = document.createElement('div'); row.className = 'shop-item stagger-child'; row.dataset.id = item.id;
    row.style.setProperty('--si', idx);
    row.innerHTML = '<div class="shop-cb' + (item.done ? ' checked' : '') + '" data-action="check"></div><div class="shop-item-text' + (item.done ? ' checked' : '') + '" data-action="check">' + esc(item.text) + '</div><div class="shop-del" data-action="del">✕</div>';
    list.appendChild(row);
  });
}

function shopAddItem(text) {
  text = text.trim(); if (!text) return;
  const items = getShopItems();
  items.push({ id: Date.now() + Math.random(), text, done: false });
  saveShop(); renderShop();
}

function shopToggle(id) {
  const items = getShopItems();
  for (let i = 0; i < items.length; i++) { if (items[i].id == id) items[i].done = !items[i].done; }
  saveShop(); renderShop();
}

function shopDelete(id) {
  setShopItems(getShopItems().filter(i => i.id != id));
  saveShop(); renderShop();
}

function shopClearDone() {
  setShopItems(getShopItems().filter(i => !i.done));
  saveShop(); renderShop();
}

/**
 * Wire up DOM events. Call once after DOM is ready.
 * @param {Function} openSheet - sheet opener from app.js
 */
function initShopping(openSheet) {
  _openSheet = openSheet;

  document.getElementById('shopBtn').addEventListener('click', function() { renderShop(); _openSheet('shopSheet'); });
  document.getElementById('shopAddBtn').addEventListener('click', function() { const inp = document.getElementById('shopInput'); shopAddItem(inp.value); inp.value = ''; inp.focus(); });
  document.getElementById('shopInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') { shopAddItem(this.value); this.value = ''; } });
  document.getElementById('shopList').addEventListener('click', function(e) { const action = e.target.dataset.action; const row = e.target.closest('.shop-item'); if (!row || !action) return; const id = row.dataset.id; if (action === 'check') shopToggle(id); if (action === 'del') shopDelete(id); });
  document.getElementById('shopClearDone').addEventListener('click', shopClearDone);
}

export { initShopping, renderShop };
