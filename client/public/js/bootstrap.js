// Fetch contract logs (ordered) and rebuild table state via gameReducer.

import { parseEventLogs } from 'viem';
import { getPublicClient, getNetwork } from './cofhe.js';
import { CONTRACT_ADDRESS, ABI, getSeatOfPlayer } from './contract.js';
import * as TState from './tournamentState.js';
import { applyGameEvent, emptyTableState, sortLogs } from './gameReducer.js';

function _address() {
  return CONTRACT_ADDRESS[getNetwork()];
}

// Public RPCs cap eth_getLogs (~50k) and often have no historical state
// (eth_getCode at old blocks fails). Walk recent log windows only.
const MAX_LOG_SPAN = 49_999n;
const MAX_LOOKBACK_CHUNKS = 40;
const _fromFloor = new Map();

function _floorKey(address) {
  return `${getNetwork()}:${address.toLowerCase()}`;
}

function _readFloor(address) {
  const key = _floorKey(address);
  if (_fromFloor.has(key)) return _fromFloor.get(key);
  try {
    const saved = sessionStorage.getItem(`pks-log-from:${key}`);
    if (saved != null && saved !== '') {
      const n = BigInt(saved);
      _fromFloor.set(key, n);
      return n;
    }
  } catch (_) {}
  return null;
}

function _writeFloor(address, block) {
  const key = _floorKey(address);
  _fromFloor.set(key, block);
  try { sessionStorage.setItem(`pks-log-from:${key}`, String(block)); } catch (_) {}
}

async function _logsInRange(client, address, from, to) {
  const raw = await client.getLogs({ address, fromBlock: from, toBlock: to });
  return sortLogs(parseEventLogs({ abi: ABI, logs: raw, strict: false }));
}

async function _walkBackLogs(client, address, to) {
  const cached = _readFloor(address);
  if (cached != null) {
    const from = cached > to ? to : cached;
    return _chunkForward(client, address, from, to);
  }
  const all = [];
  let end = to;
  let empty = 0;
  for (let i = 0; i < MAX_LOOKBACK_CHUNKS && end >= 0n; i++) {
    const start = end > MAX_LOG_SPAN ? end - MAX_LOG_SPAN : 0n;
    const chunk = await _logsInRange(client, address, start, end);
    if (chunk.length) {
      all.unshift(...chunk);
      empty = 0;
      if (chunk.some(l => l.eventName === 'TournamentCreated')) break;
    } else {
      empty++;
      if (all.some(l => l.eventName === 'TournamentCreated')) break;
    }
    if (start === 0n) break;
    end = start - 1n;
  }
  if (all.length) _writeFloor(address, all[0].blockNumber ?? 0n);
  return sortLogs(all);
}

async function _chunkForward(client, address, from, to) {
  if (to < from) return [];
  const span = to - from;
  const chunk = getNetwork() === 'local' ? span : MAX_LOG_SPAN;
  if (span <= chunk) return _logsInRange(client, address, from, to);
  const all = [];
  for (let start = from; start <= to; start += chunk + 1n) {
    const end = start + chunk > to ? to : start + chunk;
    all.push(...await _logsInRange(client, address, start, end));
  }
  return sortLogs(all);
}

export async function getOrderedLogs(fromBlock, toBlock) {
  const client = getPublicClient();
  const address = _address();
  if (!address) return [];

  const from = fromBlock ?? 0n;
  const to = toBlock ?? 'latest';
  const numericTo = to === 'latest' ? await client.getBlockNumber({ cacheTime: 0 }) : BigInt(to);
  if (getNetwork() === 'local') {
    return _chunkForward(client, address, from, numericTo);
  }
  if (from === 0n) return _walkBackLogs(client, address, numericTo);
  return _chunkForward(client, address, from, numericTo);
}

export async function replayFromLogs(account) {
  const client = getPublicClient();
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const logs = await getOrderedLogs(0n, latest);
  const prev = TState.state;
  const s = emptyTableState();
  const ctx = { account: account ? String(account).toLowerCase() : '' };
  for (const log of logs) applyGameEvent(s, log.eventName, log.args || {}, ctx);
  if (account && s.myContractSeat < 0) {
    const seat = await getSeatOfPlayer(account);
    if (seat >= 0) {
      s.isSitting = true;
      s.myContractSeat = seat;
    }
  }
  const last = logs[logs.length - 1];
  const sameHand = (s.handId || 0) > 0 && s.handId === prev.handId && s.handState >= 2;
  TState.replaceTable(s, {
    lastLogBlock: String(last?.blockNumber ?? latest),
    lastLogIndex: last ? Number(last.logIndex ?? 0) : -1,
    myHoleCards: sameHand ? prev.myHoleCards : s.myHoleCards,
    boardCards: sameHand && prev.boardCards?.length ? prev.boardCards : s.boardCards,
    seatShowdownCards: sameHand ? prev.seatShowdownCards : s.seatShowdownCards,
  });
}
