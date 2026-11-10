import { formatGrouped } from './format.js';

// ─── Action Box ───────────────────────────────────────────────────────────────

const _state = {
  callAmount: 0,
  myChips: 0,
  myCurrentBet: 0,
  showRaiseCost: false,
  pending: false,
  presets: [],
  presetIndex: 0,
};

export function getCallAmount() { return _state.callAmount; }
export function getMyChips()    { return _state.myChips; }
export function isActionPending() { return _state.pending; }

export function setActionPending(pending) {
  _state.pending = !!pending;
}

export function getBetOrRaiseAmount() {
  const p = _state.presets[_state.presetIndex];
  return p ? p.amount : 0;
}

export function getBetOrRaiseMode() {
  const lbl = document.getElementById('bet-raise-label');
  const t = (lbl?.textContent || '').trim();
  if (t === 'Bet:') return 'bet';
  if (t === 'Raise to:') return 'raise';
  return t.startsWith('Bet') ? 'bet' : 'raise';
}

export function getCheckOrCallMode() {
  const lbl = document.getElementById('check-call-label');
  return (lbl?.textContent || '').includes('Call') ? 'call' : 'check';
}

let _stepperBound = false;
function _ensureStepperListeners() {
  if (_stepperBound) return;
  const down = document.getElementById('btn-preset-down');
  const up   = document.getElementById('btn-preset-up');
  if (!down || !up) return;
  _stepperBound = true;
  down.addEventListener('click', (e) => { e.preventDefault(); _stepPreset(1); });
  up.addEventListener('click',   (e) => { e.preventDefault(); _stepPreset(-1); });
}

function _stepPreset(dir) {
  if (_state.pending || _state.presets.length === 0) return;
  const next = _state.presetIndex + dir;
  if (next < 0 || next >= _state.presets.length) return;
  _state.presetIndex = next;
  _paintPreset();
}

function _paintPreset() {
  const el = document.getElementById('preset-value');
  if (el) {
    const p = _state.presets[_state.presetIndex];
    if (!p) {
      el.textContent = '—';
    } else {
      const main = `[${p.label}] ${formatGrouped(p.amount)}`;
      if (_state.showRaiseCost) {
        const cost = Math.max(0, p.amount - _state.myCurrentBet);
        el.textContent = `${main} (cost: ${formatGrouped(cost)})`;
      } else {
        el.textContent = main;
      }
    }
  }
  const up = document.getElementById('btn-preset-up');
  if (up) up.style.visibility = _state.presetIndex === 0 || _state.presets.length === 0 ? 'hidden' : 'visible';
}

function _setKind(el, kind) {
  if (!el) return;
  el.classList.remove('btn-check', 'btn-call', 'btn-bet', 'btn-raise');
  if (kind) el.classList.add(kind);
}

export function renderActionBox({ inBetting, isMyTurn, leadingBet, myCurrentBet, minRaiseIncrement, myChips, canActCount, pot, sessionState = 0, hasFolded = false, isAllIn = false, isSitting = true }) {
  const box = document.getElementById('action-buttons');
  if (!box) return;
  _ensureStepperListeners();

  box.style.display = '';

  const callAmt = Math.max(0, leadingBet - myCurrentBet);
  _state.callAmount   = callAmt;
  _state.myChips      = myChips;
  _state.myCurrentBet = myCurrentBet;

  const myTurn = inBetting && isMyTurn;
  const tournamentStarted = sessionState >= 3;
  const alreadyMatched = inBetting && myCurrentBet >= leadingBet;
  const spectating = !isSitting && tournamentStarted;
  const autoFoldAvailable = isSitting && tournamentStarted && inBetting && !myTurn && !_state.pending && !alreadyMatched && !hasFolded && !isAllIn;

  box.classList.toggle('action-waiting', spectating || !myTurn);
  box.classList.toggle('action-pending', _state.pending);
  box.classList.toggle('auto-fold-available', autoFoldAvailable);
  const away = box.classList.contains('action-away');
  // Keep a checked box through the start of this turn so the fold can fire.
  // Clear it only once the decision has passed without becoming our turn.
  if (!autoFoldAvailable && !away && !myTurn) {
    const chk = document.getElementById('chk-auto-fold');
    if (chk?.checked) {
      chk.checked = false;
      try { localStorage.setItem('pks-autofold', '0'); } catch (_) {}
    }
  }

  const checkCallLbl = document.getElementById('check-call-label');
  const betRaiseLbl  = document.getElementById('bet-raise-label');
  const callAmtEl    = document.getElementById('call-amount');

  if (!myTurn) {
    // Fold stays clickable only after the tournament has started — it then
    // toggles Auto-Fold instead of attempting an illegal fold.
    _show('btn-fold', true);       _dis('btn-fold', away || !autoFoldAvailable);
    _show('btn-check-call', true); _dis('btn-check-call', true);
    _show('raise-wrap', true);
    _show('btn-bet-raise', true);  _dis('btn-bet-raise', true);
    _show('raise-stepper', true);  _dis('btn-preset-down', true); _dis('btn-preset-up', true);
    _show('btn-allin', true);      _dis('btn-allin', true);
    if (checkCallLbl) checkCallLbl.textContent = 'Check/Call';
    if (betRaiseLbl)  betRaiseLbl.textContent  = 'Bet/Raise-to';
    if (callAmtEl) callAmtEl.textContent = '';
    _setKind(document.getElementById('btn-check-call'), null);
    _setKind(document.getElementById('btn-bet-raise'), null);
    _state.presets = [];
    _state.presetIndex = 0;
    _state.showRaiseCost = false;
    _paintPreset();
    return;
  }

  // ── Your turn ─────────────────────────────────────────────────────────────

  const maxWithoutAllIn = Math.max(0, myChips - 1);
  const canCheck = myCurrentBet >= leadingBet;
  // Exact-stack call is All-In, not Call (Call would not revert, but we route it through All-In).
  const canCall  = leadingBet > 0 && callAmt > 0 && myChips > callAmt;
  const canBet   = leadingBet === 0 && maxWithoutAllIn >= (minRaiseIncrement || 1);
  const minRaiseTo = leadingBet + (minRaiseIncrement || 1);
  const maxRaiseTo = myCurrentBet + maxWithoutAllIn;
  const canRaise = leadingBet > 0 && (canActCount ?? 2) > 1 && minRaiseTo <= maxRaiseTo;
  const allInWouldRevert = (canActCount ?? 2) === 1 && myChips > callAmt;
  const canAllIn = myChips > 0 && !allInWouldRevert;
  const hasBetOrRaise = canBet || canRaise;

  const locked = _state.pending;
  _show('btn-fold', true);              _dis('btn-fold', locked || away);
  _show('btn-check-call', canCheck || canCall); _dis('btn-check-call', locked || !(canCheck || canCall));
  _show('raise-wrap', hasBetOrRaise);
  _show('btn-bet-raise', hasBetOrRaise); _dis('btn-bet-raise', locked || !hasBetOrRaise);
  _show('raise-stepper', hasBetOrRaise);
  _dis('btn-preset-down', locked || !hasBetOrRaise);
  _dis('btn-preset-up',   locked || !hasBetOrRaise);
  _show('btn-allin', canAllIn);         _dis('btn-allin', locked || !canAllIn);

  if (checkCallLbl) checkCallLbl.textContent = canCall ? 'Call' : 'Check';
  if (callAmtEl) callAmtEl.textContent = canCall ? formatGrouped(callAmt) : '';
  if (betRaiseLbl) betRaiseLbl.textContent = canBet ? 'Bet:' : 'Raise to:';
  _setKind(document.getElementById('btn-check-call'), canCall ? 'btn-call' : (canCheck ? 'btn-check' : null));
  _setKind(document.getElementById('btn-bet-raise'), canBet ? 'btn-bet' : (canRaise ? 'btn-raise' : null));

  const minInput = canBet ? (minRaiseIncrement || 1) : minRaiseTo;
  _state.showRaiseCost = canRaise && myCurrentBet > 0;
  _setPresets(hasBetOrRaise ? { minInput, myChips, pot: pot ?? 0 } : null);
}

function _setPresets(params) {
  if (!params) {
    _state.presets = [];
    _state.presetIndex = 0;
    _paintPreset();
    return;
  }

  const { minInput, myChips, pot } = params;
  const maxAmt = myChips - 1;
  const raw = [
    { label: 'min',       amount: minInput },
    { label: '2x min',    amount: minInput * 2 },
    { label: '3x min',    amount: minInput * 3 },
    { label: '4x min',    amount: minInput * 4 },
    { label: '5x min',    amount: minInput * 5 },
    { label: '1/4 stack', amount: Math.round(myChips * 0.25) },
    { label: '1/3 stack', amount: Math.round(myChips / 3) },
    { label: '1/2 stack', amount: Math.round(myChips * 0.5) },
    { label: '2/3 stack', amount: Math.round(myChips * 2 / 3) },
    { label: '3/4 stack', amount: Math.round(myChips * 0.75) },
    { label: '1/4 pot',   amount: Math.round(pot * 0.25) },
    { label: '1/3 pot',   amount: Math.round(pot / 3) },
    { label: '1/2 pot',   amount: Math.round(pot * 0.5) },
    { label: '2/3 pot',   amount: Math.round(pot * 2 / 3) },
    { label: '3/4 pot',   amount: Math.round(pot * 0.75) },
    { label: 'pot',       amount: pot },
  ];

  const seen = new Set();
  const options = raw
    .filter(p => Number.isFinite(p.amount) && p.amount > 0 && p.amount >= minInput && p.amount <= maxAmt)
    .sort((a, b) => a.amount - b.amount || a.label.localeCompare(b.label))
    .filter(p => { if (seen.has(p.amount)) return false; seen.add(p.amount); return true; });

  const prevAmt = _state.presets[_state.presetIndex]?.amount;
  _state.presets = options;
  const keep = options.findIndex(p => p.amount === prevAmt);
  _state.presetIndex = keep >= 0 ? keep : 0;
  _paintPreset();
}

function _show(id, visible) { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; }
function _dis(id, disabled)  { const el = document.getElementById(id); if (el) el.disabled = disabled; }
