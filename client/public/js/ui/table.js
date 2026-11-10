import { formatCompact, formatGrouped } from './format.js';

// ─── Cards ────────────────────────────────────────────────────────────────────

// Deck index 0–51 matches the contract: (rank-2)*4 + suit, suit 0=♣ 1=♦ 2=♥ 3=♠
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = [
  { sym: '♣', cls: 'card-clubs' },
  { sym: '♦', cls: 'card-diamonds' },
  { sym: '♥', cls: 'card-hearts' },
  { sym: '♠', cls: 'card-spades' },
];

function makeCard(index) {
  const i = Number(index);
  const rank = RANKS[Math.floor(i / 4)];
  const suit = SUITS[i % 4];
  const d = document.createElement('div');
  d.className = `card ${suit.cls}`;
  const corner = document.createElement('div');
  corner.className = 'card-corner';
  const rankEl = document.createElement('span');
  rankEl.className = 'card-rank';
  rankEl.textContent = rank;
  const suitEl = document.createElement('span');
  suitEl.className = 'card-suit';
  suitEl.textContent = suit.sym;
  corner.append(rankEl, suitEl);
  const pipEl = document.createElement('span');
  pipEl.className = 'card-pip';
  pipEl.textContent = suit.sym;
  d.append(corner, pipEl);
  return d;
}

function makeBackCard() {
  const d = document.createElement('div');
  d.className = 'card card-back';
  return d;
}

export function renderMyCards(indices) {
  const el = document.getElementById('my-cards');
  if (!el) return;
  el.innerHTML = '';
  if (Array.isArray(indices) && indices.length === 0) return;
  if (indices) indices.forEach(i => el.appendChild(makeCard(i)));
  else { el.appendChild(makeBackCard()); el.appendChild(makeBackCard()); }
}

// Generic showdown card-row renderer used for seats other than the client's own.
// `indices` is [rank0, rank1] to reveal the cards, or null/undefined to show nothing.
export function renderCardsInto(elementId, indices) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = '';
  if (Array.isArray(indices)) indices.forEach(i => el.appendChild(makeCard(i)));
}

export function renderBoardCards(indices) {
  const el = document.getElementById('board-cards');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < 5; i++)
    el.appendChild(Number.isFinite(indices?.[i]) ? makeCard(indices[i]) : makeBackCard());
}

// ─── Pot & Strip ──────────────────────────────────────────────────────────────

const SESSION_LABELS = ['—', 'Waiting for Players', 'Ready to Start', 'In Progress', 'On Break'];
const HAND_LABELS    = ['—', 'Preflop Setup', 'Preflop Betting', 'Flop Betting', 'Turn Betting', 'River Betting', 'Showdown', 'Paused'];

export function updatePot(amount) {
  const el = document.getElementById('pot');
  if (el) el.textContent = formatCompact(amount);
}

// Countdown shown below the pot while the winner display is held.
export function showResumeCountdown(seconds) {
  const el = document.getElementById('resume-countdown');
  if (!el) return;
  el.textContent = `Resuming in ${seconds} second${seconds === 1 ? '' : 's'} ...`;
  el.style.display = '';
}

export function hideResumeCountdown() {
  const el = document.getElementById('resume-countdown');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

export function showBoardRunout() {
  const el = document.getElementById('runout-status');
  if (!el) return;
  el.textContent = 'Running out the board ...';
  el.style.display = '';
}

export function hideBoardRunout() {
  const el = document.getElementById('runout-status');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

const GEAR_SLOTS = { flop: [0, 1, 2], turn: [3], river: [4] };

// One spinning gear centered on each face-down board card about to be revealed.
export function showBoardGear(step) {
  const on = new Set(GEAR_SLOTS[step] || []);
  document.querySelectorAll('.board-gear').forEach(el => {
    const show = on.has(Number(el.dataset.i));
    el.classList.remove('board-gear-spin');
    el.hidden = !show;
    if (!show) return;
    void el.offsetWidth;
    el.classList.add('board-gear-spin');
  });
}

export function hideBoardGear() {
  document.querySelectorAll('.board-gear').forEach(el => {
    el.hidden = true;
    el.classList.remove('board-gear-spin');
  });
}

export function renderTableStrip(meta) {
  _set('session-state', SESSION_LABELS[meta.s_state] ?? '—');
  _set('hand-state',    HAND_LABELS[meta.h_state] ?? '—');
  _set('pot',           formatCompact(meta.pot ?? 0));
  _set('blinds',        meta.smallBlind ? `${formatGrouped(meta.smallBlind)} / ${formatGrouped(meta.smallBlind * 2)}` : '—');
}

export function updateHandState(h_state) {
  _set('hand-state', HAND_LABELS[h_state] ?? '—');
}

export function updateSessionState(s_state) {
  _set('session-state', SESSION_LABELS[s_state] ?? '—');
}

export function updateBlinds(smallBlind) {
  _set('blinds', smallBlind ? `${formatGrouped(smallBlind)} / ${formatGrouped(smallBlind * 2)}` : '—');
}

function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
