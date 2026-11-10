// The table is the event log. Websocket deliveries and the receipt from our
// own transaction are applied in chain order. A getLogs read happens only for
// the first history load, for our own receipt's block range (so we cannot
// skip someone else's earlier action), and to close a gap when the socket
// errors or the tab becomes visible again.

import { parseEventLogs } from 'viem';
import { getPublicClient, getWsPublicClient, getNetwork, decryptUint8 } from './cofhe.js';
import { CONTRACT_ADDRESS, ABI, getSeatOfPlayer,
         getMyHoleCardHandles, getBoardCardHandle } from './contract.js';
import { switchTab, showTableError, setSpectateOwner, setSpectateNote } from './ui.js';
import { renderLobby } from './ui/lobby.js';
import * as SeatUI from './ui/seats.js';
import { updateBlinds, updateHandState, updatePot, renderMyCards, renderCardsInto, renderBoardCards,
         showResumeCountdown, hideResumeCountdown, showBoardRunout, hideBoardRunout,
         showBoardGear, hideBoardGear } from './ui/table.js';
import { renderActionBox } from './ui/actions.js';
import { setBreakOwner, startBreakTimer, hideBreakTimer, showForcedEndOverlay, hideForcedEndOverlay } from './ui/break.js';
import { showTournamentResult, hideTournamentResult } from './ui/result.js';
import * as TState from './tournamentState.js';
import * as Showdown from './showdownStorage.js';
import { getOrderedLogs, replayFromLogs } from './bootstrap.js';
import { sortLogs } from './gameReducer.js';

const _session = { connectedAccount: null, isOwner: false };
let _unwatchers = [];
let _onVisible = null;
let _hold = null;
let _streetHold = null;
let _streetQueue = [];
let _holdTimer = null;
let _holdCountdownInterval = null;
let _keepScreen = false;

function _go(tab) {
  if (_keepScreen) return;
  switchTab(tab);
}

function _paintLobby() {
  renderLobby({
    s_state: TState.state.sessionState,
    smallBlind: TState.state.smallBlind,
    maxSeats: TState.state.maxSeats,
    handsPerBlindDoubling: TState.state.handsPerBlindDoubling,
    handsPer5MinuteBreak: TState.state.handsPer5MinuteBreak,
    scheduledStartTime: TState.state.scheduledStartTime,
  }, TState.state.playerCount, _session.isOwner, TState.state.isSitting);
}

function _account() {
  return (_session.connectedAccount || '').toLowerCase();
}

function _setBoard(cards) {
  TState.update({ boardCards: cards });
  if (!_streetHold) renderBoardCards(cards);
}

let _liveBoard = [];

function _resetLiveBoard() {
  _liveBoard = [];
  _setBoard([]);
}

function _mergeLiveBoard(partial) {
  const next = _liveBoard.slice();
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    next[Number(k)] = v;
  }
  _liveBoard = next;
  _setBoard(next.slice());
}

function _boardCountForHand(handState) {
  switch (Number(handState)) {
    case 3: return 3;
    case 4: return 4;
    case 5:
    case 6: return 5;
    default: return 0;
  }
}

function _knownBoard(i) {
  if (Number.isFinite(_liveBoard[i])) return _liveBoard[i];
  const saved = TState.state.boardCards?.[i];
  return Number.isFinite(saved) ? saved : null;
}

// A missed or failed decrypt used to stick: refresh restored the partial
// board and never asked the chain again, so one player could sit through
// the turn (and later streets) with that card face down.
let _boardFill = null;
function _ensureVisibleBoard() {
  if (_streetHold || _hold) return;
  if (_boardFill) return _boardFill;
  _boardFill = _fillVisibleBoard().finally(() => { _boardFill = null; });
  return _boardFill;
}

async function _fillVisibleBoard() {
  if (_streetHold || _hold) return;
  const handId = TState.state.handId;
  const n = _boardCountForHand(TState.state.handState);
  if (!n) return;
  const partial = {};
  const missing = [];
  for (let i = 0; i < n; i++) {
    const known = _knownBoard(i);
    if (known == null) missing.push(i);
    else partial[i] = known;
  }
  if (missing.length) {
    const got = await Promise.all(missing.map(async i => {
      try {
        const handle = await getBoardCardHandle(i);
        const value = await decryptUint8(handle);
        return Number.isFinite(value) ? value : null;
      } catch (err) {
        console.warn(`[events] board card ${i}:`, err.message);
        return null;
      }
    }));
    if (TState.state.handId !== handId || _streetHold || _hold) return;
    missing.forEach((i, k) => { if (got[k] != null) partial[i] = got[k]; });
  }
  if (!Object.keys(partial).length) return;
  if (TState.state.handId !== handId || _streetHold || _hold) return;
  const changed = Object.keys(partial).some(k => !Number.isFinite(_liveBoard[k]));
  if (changed) _mergeLiveBoard(partial);
}

function _logStartsNewHand(log) {
  if (!log || log.eventName !== 'HandStateUpdated') return false;
  const a = log.args || {};
  return Number(a.newHandState ?? a[0]) === 1;
}

export function initSession({ connectedAccount, isOwner }) {
  _session.connectedAccount = connectedAccount;
  _session.isOwner = isOwner;
  _liveBoard = [...(TState.state.boardCards || [])];
  setBreakOwner(isOwner);
  setSpectateOwner(isOwner);
  TState.setRenderOverride(() => {
    if (_hold && (Date.now() < _hold.until || _hold.keepTable)) {
      _renderWinHold(_hold.snap, { awarded: !!_hold.showAward });
      return true;
    }
    if (_streetHold) {
      _paintStreetHold();
      return true;
    }
    return false;
  });
}

function _applyLogs(logs) {
  const ctx = { account: _account() };
  const names = new Set();
  // Streets closed inside this batch. A later new hand drops earlier ones so
  // a multi-hand catch-up does not replay every street of the tournament.
  const batch = [];
  for (const log of logs) {
    if (!log.eventName) continue;
    if (_logStartsNewHand(log)) {
      Showdown.clear();
      _liveBoard = [];
      batch.length = 0;
    }
    // Snapshot after the closing action and before the street reset, so the
    // hold can keep showing those bets and seat-circle actions for every seat.
    if (log.eventName === 'HandStateUpdated') {
      const h = Number(log.args?.newHandState ?? log.args?.[0]);
      const prev = Number(TState.state.handState);
      if (prev >= 2 && prev <= 5 && Number.isFinite(h) && h > prev) {
        const steps = _cardsForJump(prev, h);
        // River betting ends with no new card. Skip the hold so the winner
        // display can start immediately and the last actions stay up.
        if (steps.length) {
          batch.push({
            labels: [...(TState.state.seatLabels || [])],
            bets: [...(TState.state.seatCurrentBets || [])],
            steps,
            toHand: h,
          });
        }
      }
    }
    TState.applyEvent(log.eventName, log.args || {}, ctx);
    names.add(log.eventName);
  }
  if (batch.length) _streetQueue.push(...batch);
  TState.commit();
  return names;
}

function _mergeNames(into, names) {
  if (!into) return new Set(names);
  for (const n of names) into.add(n);
  return into;
}

async function _afterLogs(names, logs) {
  if (!names || !names.size) return;
  if (_hold && Date.now() < _hold.until) {
    _hold.queuedNames = _mergeNames(_hold.queuedNames, names);
    _streetQueue = [];
    return;
  }
  if (names.has('TournamentCreated')) {
    hideTournamentResult();
    hideForcedEndOverlay();
    if (_hold) { _hold = null; _clearHoldTimers(); }
    updateBlinds(TState.state.smallBlind);
  }
  if (names.has('BlindsIncreased')) updateBlinds(TState.state.smallBlind);

  if (names.has('TournamentEndForced') || names.has('TournamentCancelled')) {
    Showdown.clear();
    _liveBoard = [];
    TState.update({ boardCards: [], myHoleCards: [], seatShowdownCards: [] });
    renderMyCards([]);
    renderBoardCards([]);
    SeatUI.renderShowdownCards([]);
    SeatUI.clearAllActions();
    SeatUI.setActiveSeat(-1);
    SeatUI.setDealerButton(-1);
    hideBreakTimer();
    hideTournamentResult();
    if (_hold) { _hold = null; _clearHoldTimers(); }
    if (names.has('TournamentEndForced')) {
      _go('table');
      showForcedEndOverlay();
    } else {
      hideForcedEndOverlay();
      _go('lobby');
    }
  }

  if (names.has('TournamentEnded')) {
    Showdown.clear();
    hideBreakTimer();
    hideForcedEndOverlay();
    _go('table');
    showTournamentResult(TState.state.tournamentResult);
  }

  if (names.has('HandStateUpdated') && TState.state.handState === 1) {
    Showdown.clear();
    _resetLiveBoard();
    TState.update({ myHoleCards: null, seatShowdownCards: [] });
    _paintHeroCards(TState.state);
    SeatUI.renderShowdownCards([]);
  }

  if (names.has('UpdateSeats') || names.has('PlayerJoinedTournamentTable')) {
    SeatUI.initSeats(TState.viewSeat(), TState.state.maxSeats || 6);
  }

  const LOBBY_EVENTS = new Set([
    'TournamentCreated', 'TournamentStarted', 'TournamentCancelled',
    'TournamentEnded', 'TournamentEndForced', 'SessionStateUpdated',
    'PlayerJoinedTournamentTable', 'BlindsIncreased',
  ]);
  if ([...names].some(n => LOBBY_EVENTS.has(n))) _paintLobby();

  if (names.has('SessionStateUpdated')) {
    if (TState.state.sessionState === 4) {
      startBreakTimer();
      if (TState.state.isSitting || _session.isOwner) _go('table');
    } else {
      hideBreakTimer();
    }
  }

  if (names.has('SessionStateUpdated') && TState.state.sessionState === 3 && TState.state.isSitting) {
    _go('table');
  }

  if (TState.state.isSitting && TState.state.handState >= 2
      && (names.has('HandStateUpdated') || names.has('TournamentStarted') || names.has('SessionStateUpdated'))) {
    tryDecryptMyHoleCards();
  }

  if (names.has('DecryptedHoleCardsOfShowdownParticipant')) {
    SeatUI.renderShowdownCards(TState.state.seatShowdownCards);
  }
  try {
    await _presentBoard(names);
  } catch (err) {
    console.warn('[events] board:', err.message);
  }
  if (_ownerShouldRunShowdown()) {
    await Showdown.onProcessShowdown().catch(err => {
      console.error('[showdown] processShowdown:', err.message);
      setTimeout(() => {
        if (_ownerShouldRunShowdown()) {
          Showdown.onProcessShowdown().catch(e => console.error('[showdown] retry:', e.message));
        }
      }, 2000);
    });
  }
}

function _ownerShouldRunShowdown() {
  return _session.isOwner
    && !_hold
    && TState.state.handState === 6
    && !(TState.state.seatShowdownCards || []).some(Boolean)
    && !Showdown.isRunning();
}

function _cardsForJump(prev, next) {
  const steps = [];
  if (prev < 3 && next >= 3) steps.push('flop');
  if (prev < 4 && next >= 4) steps.push('turn');
  if (prev < 5 && next >= 5) steps.push('river');
  return steps;
}

async function _presentBoard(names) {
  const queue = _streetQueue.splice(0);
  if (queue.length) {
    for (const face of queue) await _revealStreet(face);
    return;
  }
  await _decryptBoardFromNames(names);
}

async function _decryptBoardFromNames(names) {
  const boardWait = [];
  if (names.has('FlopDecryptionAllowed')) boardWait.push(_decryptFlop());
  if (names.has('TurnDecryptionAllowed')) boardWait.push(_decryptTurn());
  if (names.has('RiverDecryptionAllowed')) boardWait.push(_decryptRiver());
  if (boardWait.length) await Promise.all(boardWait);
}

const GEAR_MS = 2400;

async function _loadFlopCards() {
  if (_session.isOwner) return Showdown.onFlopDecryptionAllowed();
  return Promise.all([0, 1, 2].map(i => getBoardCardHandle(i).then(h => decryptUint8(h))));
}

async function _loadTurnCard() {
  if (_session.isOwner) return Showdown.onTurnDecryptionAllowed();
  return getBoardCardHandle(3).then(h => decryptUint8(h));
}

async function _loadRiverCard() {
  if (_session.isOwner) return Showdown.onRiverDecryptionAllowed();
  return getBoardCardHandle(4).then(h => decryptUint8(h));
}

function _loadStep(step) {
  if (step === 'flop') return _loadFlopCards();
  if (step === 'turn') return _loadTurnCard();
  return _loadRiverCard();
}

function _publishLoaded(step, value) {
  if (value == null) return;
  if (step === 'flop') _mergeLiveBoard({ 0: value[0], 1: value[1], 2: value[2] });
  else if (step === 'turn') _mergeLiveBoard({ 3: value });
  else _mergeLiveBoard({ 4: value });
  if (_streetHold) _streetHold.board = [..._liveBoard];
}

function _paintStreetHold() {
  const s = TState.state;
  const hold = _streetHold;
  if (!hold) return;
  const n = s.seatAddrs.length;
  SeatUI.initSeats(s.isSitting && s.myContractSeat >= 0 ? s.myContractSeat : (s.watchSeat >= 0 ? s.watchSeat : 0), s.maxSeats || 6);
  SeatUI.updateSeatsFromData({
    addrs: s.seatAddrs,
    chips: s.seatChips,
    currentBets: hold.showFace ? hold.bets : s.seatCurrentBets,
    hasFolded: s.seatFolded,
    isAllIn: s.seatAllIn,
    labels: (hold.showFace || hold.keepLabels) ? hold.labels : s.seatLabels,
    blinds: s.seatBlinds,
    wins: s.seatWinPending,
    winShow: false,
    hideMyAction: false,
    length: n,
  });
  SeatUI.setActiveSeat(-1);
  SeatUI.setDealerButton(s.sessionState >= 3 ? s.buttonIndex : -1);
  updateHandState(s.handState);
  updatePot(s.pot);
  renderBoardCards(hold.board);
  _paintHeroCards(s);
  SeatUI.renderShowdownCards(s.seatShowdownCards);
  renderActionBox({
    inBetting: false, isMyTurn: false, leadingBet: 0, myCurrentBet: 0,
    minRaiseIncrement: 0, myChips: s.myChips, canActCount: 0, pot: s.pot,
    sessionState: s.sessionState, hasFolded: true,
  });
}

function _waitGear() {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const svgs = [...document.querySelectorAll('.board-gear.board-gear-spin svg')];
    if (!svgs.length) { finish(); return; }
    let left = svgs.length;
    for (const svg of svgs) {
      svg.addEventListener('animationend', () => { if (--left <= 0) finish(); }, { once: true });
    }
    setTimeout(finish, GEAR_MS + 200);
  });
}

// Face-down card and gear first. The face is painted only after that spin ends.
async function _revealStep(step, load) {
  showBoardGear(step);
  _paintStreetHold();
  const value = await Promise.all([
    load,
    _waitGear(),
  ]).then(([card]) => card);
  if (!_streetHold) return;
  hideBoardGear();
  _publishLoaded(step, value);
  _paintStreetHold();
}

// Keep the closing street's bets up while each new card's gear spins, then
// reveal that card. A runout does this once per street.
async function _revealStreet(face) {
  const steps = face.steps || [];
  const loads = steps.map(step => _loadStep(step).catch(err => {
    console.warn('[events] street reveal:', err.message);
    return null;
  }));
  if (steps.length > 1) showBoardRunout();
  _streetHold = {
    showFace: true,
    keepLabels: steps.length > 1,
    labels: face.labels,
    bets: face.bets,
    board: _liveBoard.slice(),
  };
  try {
    if (!steps.length) return;
    await _revealStep(steps[0], loads[0]);
    if (!_streetHold) return;
    _streetHold.showFace = false;
    _paintStreetHold();
    for (let i = 1; i < steps.length; i++) {
      await _revealStep(steps[i], loads[i]);
      if (!_streetHold) return;
    }
  } finally {
    _streetHold = null;
    hideBoardGear();
    hideBoardRunout();
  }
}

function _ownHoles(s) {
  const mine = s.myContractSeat;
  if (Array.isArray(s.myHoleCards) && s.myHoleCards.length) return s.myHoleCards;
  if (mine >= 0 && s.seatShowdownCards?.[mine]) return s.seatShowdownCards[mine];
  return s.myHoleCards;
}

function _paintHeroCards(s) {
  if (s.isSitting) {
    renderMyCards(_ownHoles(s));
    return;
  }
  const n = (s.seatAddrs || []).length;
  let view = 0;
  const w = Number(s.watchSeat);
  if (n > 0 && Number.isFinite(w) && w >= 0 && w < n) view = w;
  const shown = s.seatShowdownCards?.[view];
  renderCardsInto('my-cards', Array.isArray(shown) ? shown : null);
}

function _decryptFlop() {
  if (_session.isOwner) {
    return Showdown.onFlopDecryptionAllowed()
      .then(vals => _mergeLiveBoard({ 0: vals[0], 1: vals[1], 2: vals[2] }))
      .catch(err => console.error('[showdown] flop:', err.message));
  }
  return Promise.all([0, 1, 2].map(i => getBoardCardHandle(i).then(h => decryptUint8(h))))
    .then(cards => _mergeLiveBoard({ 0: cards[0], 1: cards[1], 2: cards[2] }))
    .catch(err => console.warn('[events] flop decrypt:', err.message));
}

function _decryptTurn() {
  if (_session.isOwner) {
    return Showdown.onTurnDecryptionAllowed()
      .then(val => _mergeLiveBoard({ 3: val }))
      .catch(err => console.error('[showdown] turn:', err.message));
  }
  return getBoardCardHandle(3).then(h => decryptUint8(h))
    .then(card => _mergeLiveBoard({ 3: card }))
    .catch(err => console.warn('[events] turn decrypt:', err.message));
}

function _decryptRiver() {
  if (_session.isOwner) {
    return Showdown.onRiverDecryptionAllowed()
      .then(val => _mergeLiveBoard({ 4: val }))
      .catch(err => console.error('[showdown] river:', err.message));
  }
  return getBoardCardHandle(4).then(h => decryptUint8(h))
    .then(card => _mergeLiveBoard({ 4: card }))
    .catch(err => console.warn('[events] river decrypt:', err.message));
}

function _snapshotWinHold() {
  const s = TState.state;
  return {
    myContractSeat: s.myContractSeat,
    watchSeat: s.watchSeat,
    isSitting: s.isSitting,
    seatAddrs: [...s.seatAddrs],
    seatChips: [...s.seatChips],
    seatCurrentBets: [...s.seatCurrentBets],
    seatFolded: [...s.seatFolded],
    seatAllIn: [...s.seatAllIn],
    seatLabels: [...s.seatLabels],
    seatBlinds: [...s.seatBlinds],
    seatWinPending: [...(s.seatWinPending || [])],
    seatWinHand: [...(s.seatWinHand || [])],
    seatWinShow: !!s.seatWinShow,
    boardCards: [...(s.boardCards || [])],
    myHoleCards: _ownHoles(s),
    seatShowdownCards: [...(s.seatShowdownCards || [])],
    buttonIndex: s.buttonIndex,
    handState: s.handState,
    maxSeats: s.maxSeats,
  };
}

// During the countdown the pot is still on the table and winner stacks do not
// include it yet. Both move together once the countdown ends.
function _winHoldView(snap, awarded) {
  const wins = snap.seatWinPending || [];
  if (awarded) return { chips: snap.seatChips, pot: 0 };
  const chips = (snap.seatChips || []).map((c, i) =>
    Math.max(0, (Number(c) || 0) - (Number(wins[i]) || 0)));
  const pot = wins.reduce((sum, v) => sum + (Number(v) || 0), 0);
  return { chips, pot };
}

function _renderWinHold(snap, { awarded = false } = {}) {
  const n = snap.seatAddrs.length;
  const view = _winHoldView(snap, awarded);
  SeatUI.initSeats(snap.isSitting && snap.myContractSeat >= 0 ? snap.myContractSeat : (snap.watchSeat >= 0 ? snap.watchSeat : 0), snap.maxSeats || 6);
  SeatUI.updateSeatsFromData({
    addrs: snap.seatAddrs,
    chips: view.chips,
    currentBets: snap.seatCurrentBets,
    hasFolded: snap.seatFolded,
    isAllIn: snap.seatAllIn,
    labels: snap.seatLabels,
    blinds: snap.seatBlinds,
    wins: snap.seatWinPending,
    hands: snap.seatWinHand,
    winShow: true,
    hideMyAction: false,
    length: n,
    heroIsMe: !!snap.isSitting,
  });
  SeatUI.setActiveSeat(-1);
  SeatUI.setDealerButton(snap.buttonIndex);
  updateHandState(snap.handState);
  updatePot(view.pot);
  renderBoardCards(snap.boardCards);
  _paintHeroCards(snap);
  SeatUI.renderShowdownCards(snap.seatShowdownCards);
  renderActionBox({
    inBetting: false, isMyTurn: false, leadingBet: 0, myCurrentBet: 0,
    minRaiseIncrement: 0, myChips: 0, canActCount: 0, pot: view.pot, sessionState: 3,
    hasFolded: true,
    isSitting: TState.state.isSitting,
  });
  const spectating = !TState.state.isSitting && (TState.state.sessionState === 3 || TState.state.sessionState === 4);
  setSpectateNote(spectating);
}

function _argNum(a, key, idx) {
  if (!a) return 0;
  const n = Number(a[key] ?? a[idx]);
  return Number.isFinite(n) ? n : 0;
}

function _endOfHandLog(name, args) {
  return name === 'PlayerBusted' || name === 'HandEnded' || name === 'TournamentEnded'
    || name === 'UpdateSeats'
    || (name === 'HandStateUpdated' && _argNum(args, 'newHandState', 0) === 1);
}

function _winHoldSplit(logs) {
  let sawWin = false;
  let sawShowdown = false;
  let cut = -1;
  for (let i = 0; i < logs.length; i++) {
    const name = logs[i].eventName;
    const a = logs[i].args || {};
    if (name === 'DecryptedHoleCardsOfShowdownParticipant') sawShowdown = true;
    if ((name === 'PlayerChipsUpdated' || name === 'PlayerChipsUpdatedPlusHandCategory')
      && _argNum(a, 'winAmount', 2) > 0) sawWin = true;
    const holdable = sawWin || sawShowdown;
    if (holdable && name === 'PotUpdated' && _argNum(a, 'newPotAmount', 0) === 0) {
      cut = i + 1;
      continue;
    }
    if (holdable && cut < 0 && _endOfHandLog(name, a)) return i;
  }
  if (cut >= 0) return cut;
  // The socket delivers one event at a time. The win and the revealed cards
  // may already be in state when the pot-clearing or next-hand log arrives.
  const carried = (TState.state.seatWinPending || []).some(v => Number(v) > 0)
    || (TState.state.seatShowdownCards || []).some(Boolean)
    || Number(TState.state.handState) === 6;
  if (!carried) return -1;
  for (let i = 0; i < logs.length; i++) {
    const name = logs[i].eventName;
    const a = logs[i].args || {};
    if (name === 'PotUpdated' && _argNum(a, 'newPotAmount', 0) === 0) return i + 1;
    if (_endOfHandLog(name, a)) return i;
  }
  return -1;
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Fold-win: nobody's hole cards get revealed, so the delay is a flat 20s.
// Showdown: 20s for 2 participants, +5s per additional participant (up to 40s for 6).
function _holdDurationMs(logs) {
  const participants = logs.filter(l => l.eventName === 'DecryptedHoleCardsOfShowdownParticipant').length;
  if (participants === 0) return 20_000;
  return 20_000 + 5_000 * Math.max(0, participants - 2);
}

function _tickHoldCountdown() {
  if (!_hold) return;
  const remaining = Math.max(0, Math.ceil((_hold.until - Date.now()) / 1000));
  showResumeCountdown(remaining);
}

function _clearHoldTimers() {
  if (_holdTimer) {
    clearTimeout(_holdTimer);
    _holdTimer = null;
  }
  if (_holdCountdownInterval) {
    clearInterval(_holdCountdownInterval);
    _holdCountdownInterval = null;
  }
  hideResumeCountdown();
}

function _setCursor(log) {
  if (!log || log.blockNumber == null) return;
  TState.update({
    lastLogBlock: String(log.blockNumber),
    lastLogIndex: Number(log.logIndex ?? 0),
  });
}

function _newLogs(logs) {
  const saved = BigInt(TState.state.lastLogBlock || '0');
  const lastIdx = Number(TState.state.lastLogIndex ?? -1);
  return logs.filter(l => {
    const b = BigInt(l.blockNumber ?? 0);
    const i = Number(l.logIndex ?? 0);
    if (b > saved) return true;
    if (b === saved) return i > lastIdx;
    return false;
  });
}

function _endHold() {
  const queued = _hold?.queuedNames;
  const pendingLogs = _hold?.pendingLogs || [];
  const fetchedTo = _hold?.fetchedTo;
  _hold = null;
  _clearHoldTimers();
  TState.update({ seatWinShow: false, winHoldSnap: null, winHoldUntil: 0 });
  return { queued, pendingLogs, fetchedTo };
}

function _resumeWinHoldIfNeeded() {
  if (_hold) return;
  const snap = TState.state.winHoldSnap;
  const until = Number(TState.state.winHoldUntil) || 0;
  if (!snap || until <= Date.now()) return;
  const left = Math.max(250, until - Date.now());
  _beginHold(snap, new Set(), left, []);
}

function _logKey(l) {
  return `${l.transactionHash ?? ''}:${l.logIndex ?? ''}:${l.eventName ?? ''}`;
}

function _mergePending(existing, incoming) {
  const seen = new Set(existing.map(_logKey));
  for (const l of incoming) {
    const k = _logKey(l);
    if (k === '::' || seen.has(k)) continue;
    seen.add(k);
    existing.push(l);
  }
  return existing;
}

function _beginHold(snap, restNames, durationMs, pendingLogs = [], fetchedTo = 0n) {
  if (_holdTimer) clearTimeout(_holdTimer);
  if (_holdCountdownInterval) clearInterval(_holdCountdownInterval);
  const until = Date.now() + durationMs;
  _hold = { snap, until, queuedNames: restNames, pendingLogs, keepTable: false, fetchedTo };
  TState.update({ winHoldSnap: snap, winHoldUntil: until });
  _go('table');
  _renderWinHold(snap);
  _tickHoldCountdown();
  _holdCountdownInterval = setInterval(_tickHoldCountdown, 250);
  _holdTimer = setTimeout(() => {
    _enqueue(() => _finishHold()).catch(err => console.warn('[events] win hold:', err.message));
  }, durationMs);
}

async function _finishHold() {
  if (!_hold) return;
  const ended = !!_hold.queuedNames?.has('TournamentEnded')
    || (_hold.pendingLogs || []).some(l => l.eventName === 'TournamentEnded');
  if (ended) {
    const queued = _hold.queuedNames;
    const rest = _hold.pendingLogs || [];
    const snap = _hold.snap;
    _hold.pendingLogs = [];
    _hold.keepTable = true;
    _hold.showAward = true;
    _clearHoldTimers();
    TState.update({ winHoldUntil: 0 });
    try {
      if (rest.length) {
        _applyLogs(rest);
        _setCursor(rest[rest.length - 1]);
      }
      if (queued?.size) await _afterLogs(queued, rest);
    } catch (err) {
      console.warn('[events] after win hold:', err.message);
    }
    _renderWinHold(snap, { awarded: true });
    return;
  }
  const { queued, pendingLogs: rest } = _endHold();
  try {
    if (rest.length) {
      _applyLogs(rest);
      _setCursor(rest[rest.length - 1]);
    }
    if (queued?.size) await _afterLogs(queued, rest);
  } catch (err) {
    console.warn('[events] after win hold:', err.message);
  }
  TState.render();
}

async function _ingestLogs(logs) {
  if (_hold) {
    _hold.pendingLogs = _mergePending(_hold.pendingLogs || [], logs);
    _hold.queuedNames = _mergeNames(_hold.queuedNames, new Set(logs.map(l => l.eventName).filter(Boolean)));
    return;
  }
  const split = _winHoldSplit(logs);
  const endedAt = logs.findIndex(l => l.eventName === 'TournamentEnded');
  // Hold on a zeroing pot even when it is the last log in this batch, and
  // always hold before applying TournamentEnded so the table is not wiped
  // (busted seats, next-hand setup) before the winner delay can paint.
  if (split >= 0 || endedAt >= 0) {
    const cut = split >= 0 ? split : endedAt;
    const head = logs.slice(0, Math.max(cut, 0));
    const names = head.length ? _applyLogs(head) : new Set();
    await _presentBoard(names);
    await _ensureVisibleBoard();
    const snap = _snapshotWinHold();
    const pendingLogs = logs.slice(Math.max(cut, 0));
    const pendingNames = new Set(pendingLogs.map(l => l.eventName).filter(Boolean));
    if (head.length) _setCursor(head[head.length - 1]);
    _beginHold(snap, pendingNames, _holdDurationMs(logs), pendingLogs);
    return;
  }
  const names = _applyLogs(logs);
  _setCursor(logs[logs.length - 1]);
  return names;
}

let _queue = Promise.resolve();
let _queueDepth = 0;
let _syncAgain = false;
let _syncQueued = false;

// The socket emits one event at a time. Applying those alone lets the next-hand
// log wipe the showdown before the winner screen starts. A push only means
// "something happened"; the apply always reads the whole range from the cursor
// so one hand stays in one batch.
function _noteChainActivity() {
  if (_queueDepth > 0 || _syncQueued) {
    _syncAgain = true;
    return;
  }
  _syncQueued = true;
  _enqueue(() => _catchUpFromPush()).catch(err => console.warn('[events] WS log:', err.message));
}

function _enqueue(fn) {
  const run = _queue.then(() => _runTurn(fn), () => _runTurn(fn));
  _queue = run.then(() => {}, () => {});
  return run;
}

async function _runTurn(fn) {
  await _runJob(fn);
  while (_syncAgain) {
    _syncAgain = false;
    await _runJob(() => _catchUpThrough());
  }
}

async function _runJob(fn) {
  _queueDepth++;
  try { return await fn(); }
  finally { _queueDepth--; }
}

async function _consume(logs) {
  const fresh = _newLogs(sortLogs(logs || []));
  if (!fresh.length) return;
  const names = await _ingestLogs(fresh);
  if (names) await _afterLogs(names, fresh);
  if (!_hold) await _ensureVisibleBoard();
  _paintLobby();
  TState.render();
}

async function _replayIfNeeded(saved, latest) {
  if (saved !== 0n && saved <= latest) return false;
  await replayFromLogs(_account());
  _paintLobby();
  await _ensureVisibleBoard();
  TState.render();
  return true;
}

// Indexers often trail the socket. When a push finds nothing yet, look again
// a few times. The cursor stays put until a log is actually applied.
async function _catchUpFromPush() {
  _syncQueued = false;
  for (let i = 0; i < 6; i++) {
    const before = `${TState.state.lastLogBlock}:${TState.state.lastLogIndex}`;
    await _catchUpThrough();
    const after = `${TState.state.lastLogBlock}:${TState.state.lastLogIndex}`;
    if (after !== before || _hold) return;
    if (i === 5) return;
    await _sleep(150 + i * 100);
  }
}

// One ordered read from the cursor through `toBlock`. The cursor moves only
// to a log that was actually applied.
async function _catchUpThrough(toBlock) {
  const latest = toBlock ?? await getPublicClient().getBlockNumber({ cacheTime: 0 });
  const saved = BigInt(TState.state.lastLogBlock || '0');
  if (await _replayIfNeeded(saved, latest)) return;
  if (latest < saved) return;
  const logs = _newLogs(await getOrderedLogs(saved, latest));
  if (!logs.length) return;
  await _consume(logs);
}

function _parseReceipt(receipt) {
  if (!receipt?.logs?.length) return [];
  try {
    return sortLogs(parseEventLogs({ abi: ABI, logs: receipt.logs, strict: false }));
  } catch (err) {
    console.warn('[events] receipt logs:', err.message);
    return [];
  }
}

export function catchUpLogs() {
  return _enqueue(() => _catchUpThrough()).catch(err => {
    console.warn('[events] catchUp:', err.message);
  });
}

// Apply this transaction's logs, after any earlier logs in the same range,
// so our action cannot jump the cursor past someone else's.
export function applyReceipt(receipt) {
  if (!receipt) return Promise.resolve();
  // Showdown submits its transaction from inside a log update. Waiting on the
  // queue there would stall that update forever, so apply the receipt inline.
  const job = _queueDepth > 0 ? _applyReceipt(receipt) : _enqueue(() => _applyReceipt(receipt));
  return Promise.resolve(job).catch(err => {
    console.warn('[events] receipt:', err.message);
  });
}

async function _applyReceipt(receipt) {
  const block = receipt.blockNumber ?? null;
  if (block != null) {
    try {
      await _catchUpThrough(block);
    } catch (err) {
      console.warn('[events] receipt range:', err.message);
    }
  }
  const parsed = _newLogs(_parseReceipt(receipt));
  if (parsed.length) await _consume(parsed);
}

export async function startEventListening() {
  stopEventListening();
  const address = CONTRACT_ADDRESS[getNetwork()];
  if (!address) return;

  _resumeWinHoldIfNeeded();
  _liveBoard = [...(TState.state.boardCards || [])];

  const client = getWsPublicClient();
  const unwatch = client.watchContractEvent({
    address,
    abi: ABI,
    onLogs: () => {
      _noteChainActivity();
    },
    onError: (err) => {
      console.warn('[events] WS subscription error, resyncing:', err.message);
      catchUpLogs();
    },
  });
  _unwatchers.push(unwatch);

  _onVisible = () => {
    if (document.visibilityState === 'visible') catchUpLogs();
  };
  document.addEventListener('visibilitychange', _onVisible);

  _keepScreen = true;
  try {
    await catchUpLogs();
    await _enqueue(() => _ensureVisibleBoard());
  } finally {
    _keepScreen = false;
  }
  if (_session.isOwner && TState.state.handState === 6
      && !(TState.state.seatShowdownCards || []).some(Boolean)
      && !_hold) {
    Showdown.boardValues()
      .then(vals => { _liveBoard = vals.slice(); _setBoard(vals); })
      .catch(() => {});
    Showdown.onProcessShowdown().catch(err => console.error('[showdown] resume:', err.message));
  }
}

const ZERO_HANDLE = '0x' + '0'.repeat(64);
let _decryptHole = null;

function _isZeroHandle(h) {
  if (h == null) return true;
  const s = typeof h === 'bigint' ? '0x' + h.toString(16) : String(h);
  return s === ZERO_HANDLE || s === '0x0' || s === '0';
}

export async function tryDecryptMyHoleCards() {
  if (_decryptHole) return _decryptHole;
  _decryptHole = (async () => {
    if (!TState.state.isSitting && TState.state.myContractSeat < 0) {
      const acc = _account();
      if (!acc) return;
      const seat = await getSeatOfPlayer(acc);
      if (seat < 0) return;
      TState.update({ isSitting: true, myContractSeat: seat });
    }
    const attempts = getNetwork() === 'local' ? 8 : 20;
    const delay = getNetwork() === 'local' ? 300 : 1500;
    let lastErr = '';
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const [h0, h1] = await getMyHoleCardHandles();
        if (!_isZeroHandle(h0) && !_isZeroHandle(h1)) {
          const cards = await Promise.all([decryptUint8(h0), decryptUint8(h1)]);
          if (!cards.every(n => Number.isFinite(n) && n >= 0 && n <= 51)) {
            throw new Error(`Decrypted values out of range: ${cards.join(',')}`);
          }
          TState.update({ myHoleCards: cards });
          renderMyCards(cards);
          return;
        }
      } catch (err) {
        lastErr = err.message || String(err);
        console.warn('[events] hole card decrypt:', lastErr);
      }
      await new Promise(r => setTimeout(r, delay));
    }
    if (lastErr) showTableError(`Hole cards: ${lastErr}`);
  })();
  try { await _decryptHole; } finally { _decryptHole = null; }
}

export function stopEventListening() {
  _unwatchers.forEach(u => u());
  _unwatchers = [];
  if (_onVisible) {
    document.removeEventListener('visibilitychange', _onVisible);
    _onVisible = null;
  }
}
