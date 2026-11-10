// ─── Shared UI Helpers ────────────────────────────────────────────────────────

import { shortAddr } from './ui/seats.js';

// ─── Tab Navigation ───────────────────────────────────────────────────────────

export function showNav() {
  document.getElementById('tab-nav').style.display = '';
}

export function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('tab-active', btn.dataset.tab === tab);
  });
  for (const id of ['about', 'lobby', 'table']) {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.style.display = tab === id ? '' : 'none';
  }
  try { sessionStorage.setItem('pks-tab', tab); } catch (_) {}
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

export function showStatus(msg, color = '#aaa') {
  const el = document.getElementById('status');
  if (el) { el.textContent = msg; el.style.color = color; }
}

// Reverted contract calls come back with a long viem error dump. Keep only
// the useful part, up to and including the custom error name, e.g.:
// 'The contract function "foo" reverted. Error: AlreadyWhitelisted()'
export function truncateRevertError(msg) {
  if (!msg) return msg;
  const m = msg.match(/Error:\s*\w+\([^)]*\)/);
  return m ? msg.slice(0, m.index + m[0].length) : msg;
}

// Shows an error in the table strip (right-aligned), used for in-game player
// actions where there is no dedicated status box.
export function showTableError(msg) {
  const el = document.getElementById('table-error');
  if (el) el.textContent = msg ? `✗ ${truncateRevertError(msg)}` : '';
}

export function setConnectedAccount(address, networkName) {
  const bar = document.getElementById('account');
  if (bar) {
    bar.replaceChildren();
    const line = document.createElement('span');
    const accountLabel = document.createElement('span');
    accountLabel.className = 'account-label';
    accountLabel.textContent = 'Connected with Account: ';
    line.append(accountLabel, document.createTextNode(address));
    bar.appendChild(line);
    if (networkName) {
      bar.appendChild(document.createElement('br'));
      const net = document.createElement('span');
      const netLabel = document.createElement('span');
      netLabel.className = 'account-label';
      netLabel.textContent = 'Network: ';
      net.append(netLabel, document.createTextNode(networkName));
      bar.appendChild(net);
    }
  }
  const el = document.getElementById('my-addr');
  if (el) el.textContent = shortAddr(address);
}

let _spectateOwner = false;

export function setSpectateOwner(isOwner) {
  _spectateOwner = !!isOwner;
}

export function setSpectateNote(spectating) {
  const el = document.getElementById('spectate-note');
  if (!el) return;
  const ownerEl = document.getElementById('spectate-owner-note');
  if (!spectating) {
    el.style.display = 'none';
    el.textContent = '';
    if (ownerEl) { ownerEl.style.display = 'none'; ownerEl.textContent = ''; }
    return;
  }
  el.style.display = '';
  el.textContent = 'You are now spectating the game!';
  if (ownerEl) {
    ownerEl.style.display = _spectateOwner ? '' : 'none';
    ownerEl.textContent = _spectateOwner
      ? 'You are connected with the contract owner account. Your client application serves the showdown process and handles the resumption after tournament breaks.\n\nDo not close this page and do not disconnect your account until the tournament is over!'
      : '';
  }
}

export function setEthBalance(text) {
  const el = document.getElementById('eth-balance');
  if (el) el.textContent = text || '—';
}
