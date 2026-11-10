// ─── Seat Mapping ─────────────────────────────────────────────────────────────
//
// Visual slot → HTML element IDs, clockwise from the hero (poker order).
//   Slot 0: bottom-center → #seat-mine
//   Slot 1: bottom-left   → #seat-3
//   Slot 2: left          → #seat-0
//   Slot 3: top-center    → #seat-1
//   Slot 4: right         → #seat-2
//   Slot 5: bottom-right  → #seat-4
//
// Dealer-button and bet markers are paired with the seat they sit in front of.
// Contract seat for slot i: (myContractSeat + i) % maxSeats
// Empty seats stay in place when fewer players have joined than maxSeats.
// Blind and button seats come from the contract, not from this map.
// 3+ players: SB is clockwise of the button, BB is clockwise of the SB.
// Heads-up: the button posts the SB and acts first preflop; the other seat is the BB.

import { formatCompact, formatStack } from './format.js';
import { renderCardsInto } from './table.js';

const SLOT_IDS         = ['seat-mine', 'seat-3', 'seat-0', 'seat-1', 'seat-2', 'seat-4'];
const CURRENT_BET_IDS  = ['my-current-bet', 'current-bet-0', 'current-bet-1', 'current-bet-2', 'current-bet-3', 'current-bet-4'];
const DEALER_IDS       = ['my-dealer', 'dealer-0', 'dealer-1', 'dealer-2', 'dealer-3', 'dealer-4'];
// Slot 0 (my seat) uses #my-cards, driven by renderMyCards() instead — skipped here.
const CARD_IDS         = ['my-cards', 'cards-3', 'cards-0', 'cards-1', 'cards-2', 'cards-4'];

const ACTION_CLASS = {
  'Fold':    'action-fold',
  'Check':   'action-check',
  'Call':    'action-call',
  'Bet':     'action-bet',
  'Raise':   'action-raise',
  'All-In':  'action-allin',
};

let _myContractSeat = 0;
let _ring = 0;

export function initSeats(myContractSeat, ringSize) {
  _myContractSeat = myContractSeat >= 0 ? myContractSeat : 0;
  _ring = Math.max(0, Number(ringSize) || 0);
}

function contractSeatForSlot(slot) {
  if (_ring === 0 || slot < 0 || slot >= _ring) return -1;
  return (_myContractSeat + slot) % _ring;
}

function slotForContractSeat(contractSeat) {
  if (_ring <= 0 || contractSeat < 0 || contractSeat >= _ring) return -1;
  return (_ring + contractSeat - _myContractSeat) % _ring;
}

// Full refresh from cached seat arrays (length === occupied players)
export function updateSeatsFromData({ addrs, chips, currentBets, hasFolded, isAllIn, labels, blinds, wins, hands, winShow, hideMyAction, length, heroIsMe = true }) {
  const n = Number(length) || 0;
  for (let slot = 0; slot < SLOT_IDS.length; slot++) {
    const id = SLOT_IDS[slot];
    const seatEl = document.getElementById(id);
    if (seatEl && slot > 0) seatEl.style.display = '';

    const contractSeat = contractSeatForSlot(slot);
    if (contractSeat < 0 || contractSeat >= n || !addrs[contractSeat]) {
      _clearSlot(slot);
      continue;
    }

    const addrEl = document.querySelector(`#${id} .seat-addr`);
    if (addrEl) addrEl.textContent = shortAddr(addrs[contractSeat]);

    const chipsEl = document.querySelector(`#${id} .seat-chips`);
    if (chipsEl) chipsEl.textContent = _chipsText(chips[contractSeat]);

    _setFelt(
      slot,
      winShow ? 0 : currentBets[contractSeat],
      winShow ? (wins && wins[contractSeat]) : 0,
      winShow ? (hands && hands[contractSeat]) : '',
      heroIsMe,
    );
    const folded = !!(hasFolded && hasFolded[contractSeat]);
    const chipN = Number(chips[contractSeat]);
    const allIn = !!(isAllIn && isAllIn[contractSeat]) || (!folded && chipN === 0 && !!addrs[contractSeat]);
    let lab = (labels && labels[contractSeat]) || '';
    if (allIn) lab = 'All-In';
    if (hideMyAction && slot === 0 && lab !== 'All-In' && lab !== 'Fold') lab = '';
    _setActionLabel(id, lab);
    _setBlindLabel(id, (blinds && blinds[contractSeat]) || '');

    if (seatEl) {
      seatEl.classList.toggle('seat-folded', folded);
      seatEl.classList.toggle('seat-allin',  allIn);
    }
  }
}

// Incremental update from a single action event
export function updateSeatFromAction(contractSeat, { addr, chips, currentBet, actionLabel, blindLabel, isAllIn } = {}) {
  const slot = slotForContractSeat(contractSeat);
  if (slot < 0 || slot >= SLOT_IDS.length) return;

  const id = SLOT_IDS[slot];

    const seatEl = document.getElementById(id);
    if (seatEl && slot > 0) seatEl.style.display = '';

    if (addr !== undefined) {
    const addrEl = document.querySelector(`#${id} .seat-addr`);
    if (addrEl) addrEl.textContent = shortAddr(addr);
  }

  if (chips !== undefined) {
    const chipsEl = document.querySelector(`#${id} .seat-chips`) || (slot === 0 ? document.getElementById('my-chips') : null);
    if (chipsEl) chipsEl.textContent = _chipsText(chips);
  }

  if (currentBet !== undefined) _setFelt(slot, currentBet, 0);

  if (blindLabel !== undefined) _setBlindLabel(id, blindLabel);
  if (actionLabel !== undefined) _setActionLabel(id, actionLabel);

  if (isAllIn !== undefined) {
    document.getElementById(id)?.classList.toggle('seat-allin', !!isAllIn);
  }
}

// Update only the chip count for a seat (e.g. after showdown payout)
export function updateSeatChips(contractSeat, chips) {
  const slot = slotForContractSeat(contractSeat);
  if (slot < 0 || slot >= SLOT_IDS.length) return;
  const chipsEl = document.querySelector(`#${SLOT_IDS[slot]} .seat-chips`);
  if (chipsEl) chipsEl.textContent = _chipsText(chips);
}

export function markSeatFolded(contractSeat) {
  const slot = slotForContractSeat(contractSeat);
  const id = SLOT_IDS[slot];
  document.getElementById(id)?.classList.add('seat-folded');
  _setActionLabel(id, 'Fold');
}

// Highlight the seat currently in action; contractSeat = -1 to clear all
export function setActiveSeat(contractSeat) {
  SLOT_IDS.forEach(id => document.getElementById(id)?.classList.remove('seat-in-action'));
  if (contractSeat < 0) return;
  const slot = slotForContractSeat(contractSeat);
  if (slot < 0) return;
  document.getElementById(SLOT_IDS[slot])?.classList.add('seat-in-action');
}

export function setDealerButton(contractSeat) {
  if (location.search.includes('dpos=1')) {
    DEALER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
    return;
  }
  const active = slotForContractSeat(contractSeat);
  DEALER_IDS.forEach((id, slot) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (slot === active && active >= 0) ? 'flex' : 'none';
  });
}

// Show revealed showdown hole cards above each non-own seat circle.
// `cardsBySeat` is indexed by contractSeat: (number[2] | null | undefined)[].
export function renderShowdownCards(cardsBySeat) {
  for (let slot = 1; slot < SLOT_IDS.length; slot++) {
    const contractSeat = contractSeatForSlot(slot);
    const cards = (contractSeat >= 0 && cardsBySeat) ? cardsBySeat[contractSeat] : null;
    renderCardsInto(CARD_IDS[slot], cards);
  }
}

export function clearAllActions() {
  for (let slot = 0; slot < SLOT_IDS.length; slot++) {
    const id = SLOT_IDS[slot];
    _setActionLabel(id, '');
    _setBlindLabel(id, '');
    _setFelt(slot, 0, 0);
    document.getElementById(id)?.classList.remove('seat-folded', 'seat-allin', 'seat-in-action');
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _chipsText(n) {
  if (n === undefined || n === null || n === '' || n === '—') return '—';
  return `${formatStack(n)} Chips`;
}

function _setBlindLabel(seatId, label) {
  const el = document.querySelector(`#${seatId} .seat-blind`);
  if (!el) return;
  el.textContent = label || '';
}

function _setActionLabel(seatId, label) {
  const el = document.querySelector(`#${seatId} .seat-action`);
  if (!el) return;
  if (label === 'All-In↑') label = 'All-In';
  el.textContent = label || '';
  el.className = 'seat-action' + (label && ACTION_CLASS[label] ? ` ${ACTION_CLASS[label]}` : '');
}

function _clearSlot(slot) {
  const id = SLOT_IDS[slot];
  const seatEl = document.getElementById(id);
  const addrEl = document.querySelector(`#${id} .seat-addr`);
  if (addrEl) addrEl.textContent = '—';
  if (seatEl && slot > 0) seatEl.style.display = ''; // keep all 6 seats visible
  const chipsEl = document.querySelector(`#${id} .seat-chips`);
  if (chipsEl) chipsEl.textContent = '—';
  _setActionLabel(id, '');
  _setBlindLabel(id, '');
  _setFelt(slot, 0, 0);
  renderCardsInto(CARD_IDS[slot], null);
  seatEl?.classList.remove('seat-folded', 'seat-allin', 'seat-in-action');
}

function _setFelt(slot, bet, win, hand, heroIsMe = true) {
  const el = document.getElementById(CURRENT_BET_IDS[slot]);
  if (!el) return;
  const w = Number(win) || 0;
  if (w > 0) {
    const verb = slot === 0 && heroIsMe ? 'You win' : 'Wins';
    const amt = document.createElement('span');
    amt.className = 'felt-win-amt';
    amt.textContent = formatCompact(w);
    el.replaceChildren(document.createTextNode(`💸 ${verb} `), amt);
    el.append(hand ? ` with ${hand} !` : ' !');
    el.classList.add('felt-win');
    el.style.display = '';
    return;
  }
  el.classList.remove('felt-win');
  const n = Number(bet) || 0;
  if (n === 0) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = formatCompact(n);
  el.style.display = '';
}

export function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
