import { resumeAfterBreak } from '../contract.js';
import { applyReceipt } from '../events.js';
import * as TState from '../tournamentState.js';

const BREAK_MS = 5 * 60 * 1000;
const SESSION_PAUSED = 4;
const FORCED_END_TITLE = 'Tournament End forced by the Tournament Host';

let _tick = null;
let _resumeSent = false;
let _isOwner = false;
let _forcedEnd = false;

export function setBreakOwner(isOwner) {
  _isOwner = !!isOwner;
}

export function syncBreakTimer() {
  if (TState.state.sessionState === SESSION_PAUSED) startBreakTimer();
  else hideBreakTimer();
}

export function startBreakTimer() {
  if (TState.state.sessionState !== SESSION_PAUSED) return;
  _forcedEnd = false;
  _setForcedEndChrome(false);
  if (!TState.state.breakEndsAt) {
    TState.update({ breakEndsAt: Date.now() + BREAK_MS });
    _resumeSent = false;
  }
  const box = document.getElementById('break-overlay');
  if (box) box.style.display = 'flex';
  _paint();
  if (!_tick) _tick = setInterval(_paint, 250);
}

export function hideBreakTimer() {
  if (_tick) { clearInterval(_tick); _tick = null; }
  _resumeSent = false;
  if (TState.state.breakEndsAt) TState.update({ breakEndsAt: 0 });
  if (_forcedEnd) return;
  const box = document.getElementById('break-overlay');
  if (box) box.style.display = 'none';
}

export function showForcedEndOverlay() {
  if (_tick) { clearInterval(_tick); _tick = null; }
  _resumeSent = false;
  if (TState.state.breakEndsAt) TState.update({ breakEndsAt: 0 });
  _forcedEnd = true;
  _setForcedEndChrome(true);
  const box = document.getElementById('break-overlay');
  if (box) box.style.display = 'flex';
}

export function hideForcedEndOverlay() {
  if (!_forcedEnd) return;
  _forcedEnd = false;
  _setForcedEndChrome(false);
  const box = document.getElementById('break-overlay');
  if (box) box.style.display = 'none';
}

function _setForcedEndChrome(on) {
  document.getElementById('break-overlay')?.classList.toggle('fit-text', on);
  document.getElementById('break-box')?.classList.toggle('fit-text', on);
  const title = document.getElementById('break-title');
  const timer = document.getElementById('break-timer');
  if (title) title.textContent = on ? FORCED_END_TITLE : '5-Minute Break';
  if (timer) timer.style.display = on ? 'none' : '';
}

function _paint() {
  const el = document.getElementById('break-timer');
  const ends = Number(TState.state.breakEndsAt) || 0;
  const left = Math.max(0, ends - Date.now());
  if (el) el.textContent = _fmt(left);
  if (left > 0) return;
  if (_tick) { clearInterval(_tick); _tick = null; }
  if (_isOwner && !_resumeSent) {
    _resumeSent = true;
    resumeAfterBreak()
      .then(receipt => applyReceipt(receipt))
      .catch(err => {
        _resumeSent = false;
        console.error('[break] resumeAfterBreak:', err.message);
      });
  }
}

function _fmt(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
