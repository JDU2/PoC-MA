// ─── Per-Turn Countdown ───────────────────────────────────────────────────────
//
// Small countdown circle above the action box (position: #turn-timer in style.css).
// wall-clock deadline (rather than a simple decrementing counter) so that a
// page refresh mid-turn can resume the same deadline instead of resetting it
// — the caller (tournamentState.js) is responsible for persisting/restoring
// that deadline; this module only paints it and detects when it has passed.

export const ENABLED = false; // set true to restore the per-turn countdown
export const DURATION_MS = 120_000;
const WARNING_MS = 10_000;
const TICK_MS = 250;

let _intervalId = null;

export function startCountdown(deadlineMs, onExpire) {
  stopCountdown();
  const tick = () => {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      stopCountdown();
      onExpire?.();
      return;
    }
    _paint(remainingMs);
  };
  tick();
  if (_intervalId === null && deadlineMs - Date.now() > 0) {
    _intervalId = setInterval(tick, TICK_MS);
  }
}

export function stopCountdown() {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null; }
  _show(false);
}

function _paint(remainingMs) {
  const val = document.getElementById('turn-timer-value');
  if (val) val.textContent = String(Math.ceil(remainingMs / 1000));
  const circle = document.getElementById('turn-timer');
  if (circle) {
    circle.classList.toggle('turn-timer-warning', remainingMs <= WARNING_MS);
  }
  _show(true);
}

function _show(visible) {
  const el = document.getElementById('turn-timer');
  if (el) el.style.display = visible ? '' : 'none';
}
