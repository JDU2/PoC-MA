// ─── Tournament State ─────────────────────────────────────────────────────────
//
// Single source of truth for all cached on-chain state.
// Every event handler writes here; the UI reads from here.
// State is persisted to localStorage so page reloads restore the full UI
// without any chain reads.

import * as SeatUI                                             from './ui/seats.js';
import { updatePot, updateHandState, updateSessionState,
         updateBlinds, renderTableStrip, renderMyCards, renderCardsInto, renderBoardCards } from './ui/table.js';
import { setSpectateNote } from './ui.js';
import { syncBreakTimer } from './ui/break.js';
import { showTournamentResult, hideTournamentResult } from './ui/result.js';
import { renderActionBox }                                     from './ui/actions.js';
import { ENABLED as TURN_TIMER_ON, DURATION_MS, startCountdown, stopCountdown } from './ui/turnTimer.js';
import { applyGameEvent }                                      from './gameReducer.js';

const _KEY_PREFIX = 'pks:';
let _KEY = 'pks';
let _contract = '';

const _s = {
  // Tournament config (from TournamentCreated or getTournamentMeta)
  startingChips: 0,
  maxSeats: 6,
  smallBlind: 0,
  actualStartTime: 0,
  scheduledStartTime: 0,
  handsPerBlindDoubling: 0,
  handsPer5MinuteBreak: 0,
  buttonIndex: -1,
  // Session / hand
  sessionState: 0,
  handState: 0,
  pot: 0,
  inBetting: false,
  seatInAction: -1,
  leadingBet: 0,
  minRaiseIncrement: 0,
  canActCount: 0,
  playerCount: 0,
  startPlayerCount: 0,
  tournamentResult: null,
  lastLogBlock:      '0',
  lastLogIndex:      -1,
  // My state
  myContractSeat: -1,
  watchSeat: -1,
  isSitting: false,
  myChips: 0,
  myCurrentBet: 0,
  // Per-seat data indexed by contractSeat (always dense, length === playerCount)
  seatAddrs:       [],   // string[]
  seatChips:       [],   // number[]
  seatCurrentBets: [],   // number[]  (currentBet this street, chips in front of the seat)
  seatBlinds:      [],   // string[]  ('SB' | 'BB' | '')
  seatLabels:      [],   // string[]  ('Fold','Check','Bet','Raise','All-In',…,'')
  seatFolded:      [],   // bool[]
  seatAllIn:       [],   // bool[]
  seatWinPending:  [],   // number[]  summed winAmount until PotUpdated(0)
  seatWinHand:     [],   // string[]  showdown category; '' for a fold win
  seatWinShow:     false,
  // Decrypted cards (restored on refresh so the table does not flash backs)
  boardCards:      [],   // number[] length 0–5
  myHoleCards:     null, // [number, number] | null
  seatShowdownCards: [], // (number[2] | null)[] indexed by contractSeat — decrypted at showdown, cleared next hand
  breakEndsAt:     0,
  turnDeadline:    0,    // epoch ms; persisted so a page refresh resumes the countdown instead of resetting it
  turnToken:       0,    // bumped on every SeatInActionUpdated; detects a same-seat consecutive turn (heads-up)
  handId:          0,    // incremented on each PreflopSetup; keeps decrypted cards from leaking across hands
  winHoldUntil:    0,    // epoch ms; persisted so a refresh resumes the winner delay
  winHoldSnap:     null, // table snapshot shown during the winner delay
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const state = _s;

export function syncMe() {
  const seat = _s.myContractSeat;
  if (seat < 0) return;
  if (_s.seatChips[seat] !== undefined) _s.myChips = _s.seatChips[seat];
  if (_s.seatCurrentBets[seat] !== undefined) _s.myCurrentBet = _s.seatCurrentBets[seat];
}

function _isMyTurn() {
  const me = _s.myContractSeat;
  return _s.inBetting && me >= 0 && _s.seatInAction === me
    && !_s.seatFolded[me] && !_s.seatAllIn[me];
}

export function isMyTurn() { return _isMyTurn(); }

// Seat the table is drawn around. After a bust this stays on the index the
// next player shifted into, so that circle shows their address.
export function viewSeat() {
  if (_s.isSitting && _s.myContractSeat >= 0) return _s.myContractSeat;
  const n = _s.seatAddrs.length;
  if (n <= 0) return 0;
  const w = Number(_s.watchSeat);
  if (Number.isFinite(w) && w >= 0 && w < n) return w;
  return 0;
}

let _turnHandlers = null;
export function setTurnHandlers(handlers) { _turnHandlers = handlers; }

// Edge-detected off `_isMyTurn()` itself (not off whether the countdown is
// currently running) so an auto-fold's own async tx — which keeps
// `_isMyTurn()` true for a moment after the countdown already stopped —
// can never look like a brand-new turn and re-arm the countdown.
let _wasMyTurn = false;

// `null` until the first render after (re)load — distinguishes "resume a
// persisted deadline after a refresh" from "the same seat is owed a second,
// brand-new turn in a row" (heads-up: same seat can act first both preflop
// and postflop), which must always get a fresh full countdown instead.
let _lastTurnToken = null;

function _playersWhoCanAct() {
  let n = 0;
  for (let i = 0; i < _s.seatAddrs.length; i++) {
    if (!_s.seatAddrs[i] || _s.seatFolded[i] || _s.seatAllIn[i]) continue;
    n++;
  }
  return n;
}

function _syncTurnTimer() {
  const myTurn = _isMyTurn();
  const isFirstObservation = _lastTurnToken === null;
  const tokenChanged = !isFirstObservation && _s.turnToken !== _lastTurnToken;
  _lastTurnToken = _s.turnToken;

  if (myTurn && (!_wasMyTurn || tokenChanged)) {
    _wasMyTurn = true;
    if (_turnHandlers?.shouldSkip?.()) {
      _s.turnDeadline = 0; _save();
      stopCountdown();
      return;
    }
    if (!TURN_TIMER_ON) {
      stopCountdown();
      return;
    }
    const now = Date.now();
    const resumable = isFirstObservation && _s.turnDeadline > 0;
    if (resumable && _s.turnDeadline <= now) {
      // Deadline already passed while the page was reloading/backgrounded.
      _s.turnDeadline = 0; _save();
      _turnHandlers?.onExpire?.();
      return;
    }
    if (!resumable) { _s.turnDeadline = now + DURATION_MS; _save(); }
    startCountdown(_s.turnDeadline, () => {
      _s.turnDeadline = 0; _save();
      _turnHandlers?.onExpire?.();
    });
  } else if (!myTurn && _wasMyTurn) {
    _wasMyTurn = false;
    _s.turnDeadline = 0; _save();
    stopCountdown();
  } else if (!TURN_TIMER_ON) {
    stopCountdown();
  }
}

export function replaceTable(table, extra = {}) {
  Object.assign(_s, table, extra);
  syncMe();
  _save();
}

export function applyEvent(eventName, args, ctx) {
  applyGameEvent(_s, eventName, args, ctx);
}

export function commit() {
  syncMe();
  _save();
}

// Merge a patch into state and persist
export function update(patch) {
  Object.assign(_s, patch);
  _save();
}

// Update one seat's fields and persist
export function updateSeat(contractSeat, { addr, chips, currentBet, blind, label, folded, allIn } = {}) {
  if (addr       !== undefined) _s.seatAddrs      [contractSeat] = addr;
  if (chips      !== undefined) _s.seatChips      [contractSeat] = chips;
  if (currentBet !== undefined) _s.seatCurrentBets[contractSeat] = currentBet;
  if (blind      !== undefined) _s.seatBlinds     [contractSeat] = blind;
  if (label      !== undefined) _s.seatLabels     [contractSeat] = label;
  if (folded     !== undefined) _s.seatFolded     [contractSeat] = folded;
  if (allIn      !== undefined) _s.seatAllIn      [contractSeat] = allIn;
  _save();
}

// Remap seat arrays after UpdateSeats(newOrder) — preserves chips by address
export function remapSeats(newOrder) {
  const arr = Array.from(newOrder ?? []);
  const chipByAddr = {};
  _s.seatAddrs.forEach((a, i) => { if (a) chipByAddr[a.toLowerCase()] = _s.seatChips[i] ?? 0; });
  _s.seatAddrs       = arr;
  _s.seatChips       = arr.map(a => chipByAddr[a?.toLowerCase()] ?? 0);
  _s.seatCurrentBets = arr.map(() => 0);
  _s.seatBlinds      = arr.map(() => '');
  _s.seatLabels      = arr.map(() => '');
  _s.seatFolded      = arr.map(() => false);
  _s.seatAllIn       = arr.map(() => false);
  _s.seatWinPending  = arr.map(() => 0);
  _s.seatWinHand     = arr.map(() => '');
  _s.seatWinShow     = false;
  _s.playerCount  = arr.length;
  _save();
}

// Clear all seat arrays (tournament cancelled / ended / new tournament)
export function clearSeats() {
  _s.seatAddrs = []; _s.seatChips = []; _s.seatCurrentBets = [];
  _s.seatBlinds = []; _s.seatLabels = []; _s.seatFolded = []; _s.seatAllIn = [];
  _s.seatWinPending = []; _s.seatWinHand = []; _s.seatWinShow = false;
  _s.playerCount = 0; _s.pot = 0; _s.inBetting = false; _s.seatInAction = -1;
  _s.leadingBet = 0; _s.minRaiseIncrement = 0; _s.canActCount = 0;
  _s.actualStartTime = 0;
  _s.buttonIndex = -1;
  _s.boardCards = [];
  _s.myHoleCards = null;
  _s.seatShowdownCards = [];
  _s.breakEndsAt = 0;
  _save();
}

// Wipe in-memory table state and localStorage (force-end / cancel). Does not persist.
export function resetTableAndStorage() {
  _s.startingChips = 0;
  _s.maxSeats = 6;
  _s.smallBlind = 0;
  _s.actualStartTime = 0;
  _s.buttonIndex = -1;
  _s.sessionState = 0;
  _s.handState = 0;
  _s.pot = 0;
  _s.inBetting = false;
  _s.seatInAction = -1;
  _s.leadingBet = 0;
  _s.minRaiseIncrement = 0;
  _s.canActCount = 0;
  _s.playerCount = 0;
  _s.myContractSeat = -1;
  _s.watchSeat = -1;
  _s.isSitting = false;
  _s.myChips = 0;
  _s.myCurrentBet = 0;
  _s.seatAddrs = [];
  _s.seatChips = [];
  _s.seatCurrentBets = [];
  _s.seatBlinds = [];
  _s.seatLabels = [];
  _s.seatFolded = [];
  _s.seatAllIn = [];
  _s.seatWinPending = [];
  _s.seatWinHand = [];
  _s.seatWinShow = false;
  _s.boardCards = [];
  _s.myHoleCards = null;
  _s.seatShowdownCards = [];
  _s.breakEndsAt = 0;
  try {
    localStorage.removeItem(_KEY);
    localStorage.removeItem('pks');
  } catch (_) {}
}

// Reset per-hand seat state (new preflop setup)
export function newHand() {
  _s.canActCount = _s.playerCount;
  _s.pot = 0;
  _s.seatCurrentBets = _s.seatAddrs.map(() => 0);
  _s.seatBlinds      = _s.seatAddrs.map(() => '');
  _s.seatLabels      = _s.seatAddrs.map(() => '');
  _s.seatFolded      = _s.seatAddrs.map(() => false);
  _s.seatAllIn       = _s.seatAddrs.map(() => false);
  _s.myCurrentBet = 0;
  _s.boardCards = [];
  _s.myHoleCards = null;
  _s.seatShowdownCards = [];
  _save();
}

export function resetStreetBets() {
  _s.myCurrentBet = 0;
  const n = Math.max(_s.seatAddrs.length, (_s.seatLabels || []).length);
  _s.seatCurrentBets = Array(n).fill(0);
  _s.seatLabels = Array.from({ length: n }, (_, i) => {
    if (_s.seatAllIn && _s.seatAllIn[i]) return 'All-In';
    const lab = (_s.seatLabels && _s.seatLabels[i]) || '';
    return lab === 'Fold' || lab === 'All-In' ? lab : '';
  });
  _save();
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export function save() { _save(); }

export function load(account, contractAddress) {
  _contract = String(contractAddress || '').toLowerCase();
  if (account) {
    const acc = String(account).toLowerCase();
    _KEY = _contract ? `${_KEY_PREFIX}${acc}:${_contract}` : `${_KEY_PREFIX}${acc}`;
  }
  try {
    const raw = localStorage.getItem(_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.seatContribs && !parsed.seatCurrentBets) {
      parsed.seatCurrentBets = parsed.seatContribs;
      delete parsed.seatContribs;
    }
    if (!parsed.seatBlinds) {
      parsed.seatBlinds = (parsed.seatLabels || []).map(l => (l === 'SB' || l === 'BB') ? l : '');
      parsed.seatLabels = (parsed.seatLabels || []).map(l => (l === 'SB' || l === 'BB') ? '' : l);
    }
    if (_contract && parsed.contractAddress && String(parsed.contractAddress).toLowerCase() !== _contract) return false;
    if (_contract) parsed.contractAddress = _contract;
    Object.assign(_s, parsed);
    return true;
  } catch {
    return false;
  }
}

export function clear() {
  localStorage.removeItem(_KEY);
}

function _save() {
  try {
    if (_contract) _s.contractAddress = _contract;
    localStorage.setItem(_KEY, JSON.stringify(_s));
  } catch (_) {}
}

// ─── Action Box (shared helper used by events.js and app.js) ─────────────────

function _iFolded() {
  const i = _s.myContractSeat;
  return i >= 0 && !!_s.seatFolded[i];
}

function _iAllIn() {
  const i = _s.myContractSeat;
  return i >= 0 && !!_s.seatAllIn[i];
}

export function renderActionBoxFromState() {
  renderActionBox({
    inBetting:         _s.inBetting,
    isMyTurn:          _isMyTurn(),
    leadingBet:        _s.leadingBet,
    myCurrentBet:      _s.myCurrentBet,
    minRaiseIncrement: _s.minRaiseIncrement,
    myChips:           _s.myChips,
    canActCount:       _playersWhoCanAct(),
    pot:               _s.pot,
    sessionState:      _s.sessionState,
    hasFolded:         _iFolded(),
    isAllIn:           _iAllIn(),
    isSitting:         _s.isSitting,
  });
  _syncTurnTimer();
}

// ─── Full DOM Render ──────────────────────────────────────────────────────────
//
// Rebuilds the entire table UI from cached state.
// Called on page reload (after localStorage restore) or after first-load bootstrap.

let _renderOverride = null;
export function setRenderOverride(fn) { _renderOverride = fn; }

export function render(myContractSeat) {
  if (_renderOverride?.()) return;
  if (myContractSeat === undefined || myContractSeat < 0) myContractSeat = viewSeat();
  SeatUI.initSeats(myContractSeat, _s.maxSeats || 6);

  // Seat addresses, chips, contributions, folded/allin flags
  SeatUI.updateSeatsFromData({
    addrs:            _s.seatAddrs,
    chips:            _s.seatChips,
    currentBets:      _s.seatCurrentBets,
    hasFolded:        _s.seatFolded,
    isAllIn:          _s.seatAllIn,
    labels:           _s.seatLabels,
    blinds:           _s.seatBlinds,
    wins:             _s.seatWinPending,
    hands:            _s.seatWinHand,
    winShow:          _s.seatWinShow,
    hideMyAction:     _isMyTurn(),
    length:           _s.seatAddrs.length,
    heroIsMe:         _s.isSitting,
  });

  // Active seat ring
  const act = _s.seatInAction;
  const actOk = act >= 0 && !_s.seatFolded[act] && !_s.seatAllIn[act];
  SeatUI.setActiveSeat(_s.inBetting && actOk ? act : -1);
  SeatUI.setDealerButton(_s.sessionState >= 3 ? _s.buttonIndex : -1);

  // Info strip
  updateSessionState(_s.sessionState);
  updateHandState(_s.handState);
  updateBlinds(_s.smallBlind);
  updatePot(_s.pot);
  renderBoardCards(_s.boardCards || []);
  const mine = _s.myContractSeat;
  if (_s.isSitting) {
    const holes = (Array.isArray(_s.myHoleCards) && _s.myHoleCards.length)
      ? _s.myHoleCards
      : (mine >= 0 ? _s.seatShowdownCards?.[mine] : null);
    renderMyCards(holes);
  } else {
    const shown = _s.seatShowdownCards?.[viewSeat()];
    renderCardsInto('my-cards', Array.isArray(shown) ? shown : null);
  }
  SeatUI.renderShowdownCards(_s.seatShowdownCards);

  // Action box
  renderActionBox({
    inBetting: _s.inBetting,
    isMyTurn:  _isMyTurn(),
    leadingBet: _s.leadingBet,
    myCurrentBet: _s.myCurrentBet,
    minRaiseIncrement: _s.minRaiseIncrement,
    myChips: _s.myChips,
    canActCount: _playersWhoCanAct(),
    pot: _s.pot,
    sessionState: _s.sessionState,
    hasFolded: _iFolded(),
    isAllIn: _iAllIn(),
    isSitting: _s.isSitting,
  });
  syncBreakTimer();
  const spectating = !_s.isSitting && (_s.sessionState === 3 || _s.sessionState === 4);
  setSpectateNote(spectating);
  if (_s.tournamentResult) showTournamentResult(_s.tournamentResult);
  else hideTournamentResult();
  // Last: the countdown must arm only after every other turn-start side
  // effect (seat ring, action box, hole cards, etc.) has already painted.
  _syncTurnTimer();
}
