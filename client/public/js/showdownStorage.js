// ─── Showdown Storage (Owner Only) ───────────────────────────────────────────
//
// Builds the board card batch (flop → turn → river) and, at showdown,
// appends the non-folded players' hole cards, then submits the full batch
// to processShowdown() for on-chain verification.
//
// Board slots are filled by index and in-flight decrypts are shared, so a
// run-out (flop+turn+river+ProcessShowdown in one tx) cannot submit an
// incomplete board.
//
// Lifecycle per hand:
//   clear()                    ← called on PreflopSetup (events.js)
//   onFlopDecryptionAllowed()  ← called on FlopDecryptionAllowed  (events.js)
//   onTurnDecryptionAllowed()  ← called on TurnDecryptionAllowed  (events.js)
//   onRiverDecryptionAllowed() ← called on RiverDecryptionAllowed (events.js)
//   onProcessShowdown()        ← called on ProcessShowdown        (events.js)

import { getBoardCardHandle, getHoleCardHandle,
         allowPublicHoleCardsForShowdown,
         processShowdown }                        from './contract.js';
import { decryptUint8WithSig }                    from './cofhe.js';
import * as TState                                from './tournamentState.js';
import { applyReceipt }                           from './events.js';

// Each entry: { handle: bytes32, value: uint8, sig: bytes } | null
const _board = [null, null, null, null, null];
const _inflight = [null, null, null, null, null];

export function clear() {
  for (let i = 0; i < 5; i++) {
    _board[i] = null;
    _inflight[i] = null;
  }
}

function _handleKey(h) {
  if (h == null) return '';
  if (typeof h === 'bigint') return '0x' + h.toString(16).padStart(64, '0');
  const s = String(h.handle ?? h);
  if (s.startsWith('0x') || s.startsWith('0X')) return s.toLowerCase();
  try { return '0x' + BigInt(s).toString(16).padStart(64, '0'); } catch { return s.toLowerCase(); }
}

async function _slot(i) {
  const handle = await getBoardCardHandle(i);
  const key = _handleKey(handle);
  if (_board[i] && _handleKey(_board[i].handle) === key) return _board[i];
  if (_inflight[i] && _inflight[i]._key === key) return _inflight[i];
  const p = (async () => {
    const card = await decryptUint8WithSig(handle);
    _board[i] = card;
    return card;
  })().catch(err => {
    if (_inflight[i] === p) _inflight[i] = null;
    throw err;
  });
  p._key = key;
  _inflight[i] = p;
  return p;
}

export async function onFlopDecryptionAllowed() {
  const cards = await Promise.all([0, 1, 2].map(_slot));
  return cards.map(c => c.value);
}

export async function onTurnDecryptionAllowed() {
  const card = await _slot(3);
  return card.value;
}

export async function onRiverDecryptionAllowed() {
  const card = await _slot(4);
  return card.value;
}

export async function boardValues() {
  const cards = await Promise.all([0, 1, 2, 3, 4].map(_slot));
  return cards.map(c => c.value);
}

// Full showdown flow:
//   1. Ensure all 5 board cards are decrypted (run-out or street-by-street)
//   2. Call the contract to FHE.allowPublic all non-folded players' hole cards
//   3. Decrypt hole cards for every non-folded seat (in seat order)
//   4. Assemble [5 board cards + N×2 hole cards] and call processShowdown()
let _running = null;

export function isRunning() {
  return !!_running;
}

export async function onProcessShowdown() {
  if (_running) return _running;
  _running = _runProcessShowdown().finally(() => { _running = null; });
  return _running;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _boardReady() {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await Promise.all([0, 1, 2, 3, 4].map(_slot));
    } catch (err) {
      last = err;
      await _sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

async function _runProcessShowdown() {
  if ((TState.state.seatShowdownCards || []).some(Boolean)) return;
  if (TState.state.handState !== 6) return;
  const board = await _boardReady();

  await applyReceipt(await allowPublicHoleCardsForShowdown());

  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (TState.state.handState !== 6) return;
    if ((TState.state.seatShowdownCards || []).some(Boolean)) return;
    try {
      const sdp = [];
      for (let seat = 0; seat < TState.state.seatAddrs.length; seat++) {
        if (TState.state.seatFolded[seat]) continue;
        const addr = TState.state.seatAddrs[seat];
        sdp.push(await decryptUint8WithSig(await getHoleCardHandle(addr, 0)));
        sdp.push(await decryptUint8WithSig(await getHoleCardHandle(addr, 1)));
      }
      const all = [...board, ...sdp];
      await applyReceipt(await processShowdown(
        all.map(c => c.handle),
        all.map(c => c.value),
        all.map(c => c.sig),
      ));
      return;
    } catch (err) {
      last = err;
      await _sleep(500 * (attempt + 1));
    }
  }
  throw last;
}
