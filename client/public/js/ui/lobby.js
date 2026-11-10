// ─── Lobby Rendering ──────────────────────────────────────────────────────────

import * as TState from '../tournamentState.js';
import { formatGrouped } from './format.js';

const SESSION_LABELS = [
  'No Tournament Scheduled',
  'Waiting for Players to Join (Minimum: 2 players)',
  'Waiting for Host to Start the Tournament',
  'Tournament in Progress',
  'Tournament is Paused',
];

// Re-checked below while waiting for the scheduled start time so the Start
// button flips to clickable on its own, without needing a new chain event.
let _recheckTimer = null;

export function renderLobby(meta, playerCount, isOwner, isSitting) {
  if (_recheckTimer) { clearTimeout(_recheckTimer); _recheckTimer = null; }

  const hasTourn = meta.s_state > 0;
  const startTimeReached = (Date.now() / 1000) >= Number(meta.scheduledStartTime || 0);
  const canStart = meta.s_state === 2 && startTimeReached;
  const isActive = meta.s_state === 3 || meta.s_state === 4;

  if (meta.s_state === 2 && !startTimeReached) {
    const msLeft = Number(meta.scheduledStartTime || 0) * 1000 - Date.now();
    _recheckTimer = setTimeout(() => renderLobby(meta, playerCount, isOwner, isSitting), Math.min(Math.max(msLeft, 250), 1000));
  }

  const statusLabel = meta.s_state === 2 && !startTimeReached
    ? 'Waiting for Scheduled Start Time'
    : SESSION_LABELS[meta.s_state] ?? '—';
  _set('lobby-status', `Status: ${statusLabel}`);

  const grid = document.getElementById('lobby-info-grid');
  if (grid) grid.style.display = hasTourn ? '' : 'none';
  if (hasTourn) {
    _set('ls-sb',        formatGrouped(meta.smallBlind));
    _set('ls-bb',        formatGrouped(meta.smallBlind * 2));
    _set('ls-chips',     formatGrouped(meta.smallBlind * 200));
    _set('ls-hpbd',      meta.handsPerBlindDoubling);
    _set('ls-hp5mb',     meta.handsPer5MinuteBreak);
    _set('ls-maxseats',  meta.maxSeats);
    _set('ls-players',   `${playerCount} / ${meta.maxSeats}`);
    _set('ls-starttime', _fmtTs(meta.scheduledStartTime));
    _set('ls-actualstart', _fmtTs(TState.state.actualStartTime));
  }
  _cardEnabled('lobby-info-card', true);
  _hide('start-tournament-wrap', !isOwner);
  _dis('btn-start', !(isOwner && canStart));

  _cardEnabled('lobby-join-card', hasTourn);
  _set('player-seat-status', isSitting
    ? 'You are seated at the tournament table.'
    : hasTourn ? 'You are not yet seated.' : '—');
  _dis('btn-join', isSitting || isActive || !hasTourn);

  _hide('lobby-whitelist-card', !isOwner);
  _hide('lobby-create-card', !isOwner);
  _hide('lobby-cancel-card', !isOwner);
  _hide('lobby-force-end-card', !isOwner);

  _cardEnabled('lobby-create-card', isOwner && !hasTourn);
  _cardEnabled('lobby-cancel-card', isOwner && hasTourn && !isActive);
  _cardEnabled('lobby-force-end-card', isOwner && isActive);
  _dis('btn-force-end', !isOwner || !isActive);
}

function _fmtTs(unix) {
  const n = Number(unix) || 0;
  return n > 0 ? new Date(n * 1000).toLocaleString() : '—';
}

function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _dis(id, disabled) { const el = document.getElementById(id); if (el) el.disabled = disabled; }
function _cardEnabled(id, enabled) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('lobby-card-disabled', !enabled);
  el.querySelectorAll('button, input, select').forEach(ctrl => { ctrl.disabled = !enabled; });
}
function _hide(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.style.display = hidden ? 'none' : '';
}
