import { connectWallet, shouldAutoConnect, getNetworkName, getNetwork, getPublicClient } from './cofhe.js';
import { formatEther } from 'viem';
import {
  addPlayerToWhitelist, removePlayerFromWhitelist,
  joinTournamentTable, createTournament, startTournament, cancelTournament, forceEndTournament,
  fold, check, bet, call, raise, allIn,
  getOwner, CONTRACT_ADDRESS,
} from './contract.js';
import { showNav, switchTab, showStatus, truncateRevertError, showTableError, setConnectedAccount, setEthBalance } from './ui.js';
import { renderLobby }                                        from './ui/lobby.js';
import { getBetOrRaiseMode, getBetOrRaiseAmount, getCallAmount, getCheckOrCallMode, getMyChips, isActionPending, setActionPending } from './ui/actions.js';
import { initSeats }                                          from './ui/seats.js';
import { initSession, startEventListening, tryDecryptMyHoleCards, catchUpLogs, applyReceipt } from './events.js';
import * as TState                                            from './tournamentState.js';
import { replayFromLogs }                                     from './bootstrap.js';

const OWNER_ADDRESS_FALLBACK = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

let connectedAccount = null;
let isOwner = false;

function paintFromState() {
  renderLobby({
    s_state: TState.state.sessionState,
    smallBlind: TState.state.smallBlind,
    maxSeats: TState.state.maxSeats,
    handsPerBlindDoubling: TState.state.handsPerBlindDoubling,
    handsPer5MinuteBreak: TState.state.handsPer5MinuteBreak,
    scheduledStartTime: TState.state.scheduledStartTime,
  }, TState.state.playerCount, isOwner, TState.state.isSitting);
  TState.render();
}

// Manual catch-up from the log cursor. Does not read tournament meta.
async function refresh() {
  try {
    await catchUpLogs();
    paintFromState();
    await refreshEthBalance();
  } catch (err) {
    console.error(err.message);
  }
}

function _ethUnit() {
  return getNetwork() === 'local' ? 'Hardhat ETH' : 'Sepolia ETH';
}

function _formatEth(wei) {
  const [w, f = ''] = formatEther(wei).split('.');
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = f.replace(/0+$/, '').slice(0, 6);
  return frac ? `${grouped}.${frac}` : grouped;
}

async function refreshEthBalance() {
  if (!connectedAccount) return;
  try {
    const wei = await getPublicClient().getBalance({ address: connectedAccount });
    setEthBalance(`${_formatEth(wei)} ${_ethUnit()}`);
  } catch {
    setEthBalance('—');
  }
}

function restoreTab() {
  let tab = 'lobby';
  try { tab = sessionStorage.getItem('pks-tab') || 'lobby'; } catch (_) {}
  if (tab !== 'about' && tab !== 'lobby' && tab !== 'table') tab = 'lobby';
  switchTab(tab);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function datetimeLocalToUnix() {
  const d = document.getElementById('input-startdate')?.value;
  const h = document.getElementById('input-starthour')?.value;
  const m = document.getElementById('input-startmin')?.value;
  if (!d || h === '' || m === '') return NaN;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return Math.floor(new Date(`${d}T${hh}:${mm}:00`).getTime() / 1000);
}

function setStatus(el, msg, ok) {
  if (!el) return;
  el.textContent = ok ? msg : truncateRevertError(msg);
  el.style.color = ok ? '#88cc88' : '#e74c3c';
  el.style.display = msg ? '' : 'none';
}

// ─── Player Action Runner (shared by button clicks and auto-fold) ───────────

async function runPlayerAction(work) {
  if (isActionPending()) return;
  setActionPending(true);
  TState.renderActionBoxFromState();
  showTableError('');
  try {
    await applyReceipt(await work());
  } finally {
    setActionPending(false);
    TState.renderActionBoxFromState();
    refreshEthBalance();
  }
}

function isAutoFoldChecked() {
  return !!document.getElementById('chk-auto-fold')?.checked;
}

function setAutoFoldChecked(checked) {
  const chk = document.getElementById('chk-auto-fold');
  if (chk) chk.checked = checked;
  try { localStorage.setItem('pks-autofold', checked ? '1' : '0'); } catch (_) {}
}

// ── "Away" mode: once a countdown expires unattended, keep auto-folding
// every subsequent turn until the player explicitly returns. ──
let _away = false;

function setAway(away) {
  _away = away;
  const btn = document.getElementById('btn-im-back');
  if (btn) btn.style.display = away ? '' : 'none';
  const box = document.getElementById('action-buttons');
  box?.classList.toggle('action-away', away);
  const chk = document.getElementById('chk-auto-fold');
  if (chk) chk.disabled = away;
  setAutoFoldChecked(away);
  TState.renderActionBoxFromState();
}

async function triggerAutoFold() {
  try {
    await runPlayerAction(async () => fold());
  } catch (err) { showTableError(err.message); }
  finally {
    if (!_away) setAutoFoldChecked(false);
  }
}

TState.setTurnHandlers({
  shouldSkip: () => {
    if (!isAutoFoldChecked() && !_away) return false;
    triggerAutoFold();
    return true;
  },
  onExpire: () => {
    setAway(true);
    triggerAutoFold();
  },
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function tryConnect({ interactive = true } = {}) {
  connectedAccount = await connectWallet({ interactive });
  const acc = connectedAccount.toLowerCase();
  const prev = (localStorage.getItem('pks-account') || '').toLowerCase();
  if (prev && prev !== acc) TState.clear();
  localStorage.setItem('pks-account', acc);

  try {
    const owner = await getOwner();
    isOwner = acc === String(owner).toLowerCase();
  } catch {
    isOwner = acc === OWNER_ADDRESS_FALLBACK.toLowerCase();
  }
  setConnectedAccount(connectedAccount, getNetworkName());
  showNav();
  showStatus('');
  initSession({ connectedAccount, isOwner });
  refreshEthBalance();

  if (TState.load(acc, CONTRACT_ADDRESS[getNetwork()])) {
    const mySeat = TState.state.myContractSeat;
    initSeats(TState.viewSeat(), TState.state.maxSeats || 6);
    TState.render(mySeat);
  } else {
    await replayFromLogs(acc);
    TState.syncMe();
    TState.render();
  }

  restoreTab();
  await startEventListening();
  paintFromState();
  if (TState.state.isSitting && TState.state.handState >= 2) await tryDecryptMyHoleCards();
}

document.addEventListener('DOMContentLoaded', () => {

  // ── Tab switching ──
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'table') TState.render();
    });
  });

  // ── Connect wallet ──
  document.getElementById('btn-connect').addEventListener('click', async () => {
    try {
      await tryConnect({ interactive: true });
    } catch (err) { showStatus(`Error: ${truncateRevertError(err.message)}`, 'red'); }
  });

  document.getElementById('btn-refresh')?.addEventListener('click', refresh);

  // ── Auto-fold checkbox (preference persists across reloads) ──
  const chkAutoFold = document.getElementById('chk-auto-fold');
  if (chkAutoFold) {
    try { chkAutoFold.checked = localStorage.getItem('pks-autofold') === '1'; } catch (_) {}
    chkAutoFold.addEventListener('change', () => setAutoFoldChecked(chkAutoFold.checked));
  }

  document.getElementById('btn-im-back')?.addEventListener('click', () => setAway(false));

  const hourSel = document.getElementById('input-starthour');
  const minSel = document.getElementById('input-startmin');
  if (hourSel && minSel) {
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const dateEl = document.getElementById('input-startdate');
    if (dateEl && !dateEl.value) {
      dateEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    hourSel.value = String(now.getHours());
    minSel.value = String(now.getMinutes());
  }

  // ── Player actions ──

  document.getElementById('btn-join').addEventListener('click', async () => {
    const s = document.getElementById('join-status');
    try {
      s.style.display = 'none';
      await applyReceipt(await joinTournamentTable());
      setStatus(s, '✓ Joined the tournament table', true);
      refreshEthBalance();
    } catch (err) { setStatus(s, `✗ ${err.message}`, false); }
  });

  document.getElementById('btn-fold').addEventListener('click', async () => {
    // Not your turn yet: Fold just arms/disarms the Auto-Fold checkbox
    // shown inside the button, rather than attempting an illegal action.
    if (!TState.state.isSitting) return;
    if (!TState.isMyTurn()) {
      const me = TState.state.myContractSeat;
      if ((TState.state.sessionState || 0) < 3) return;
      if (me >= 0 && TState.state.seatAllIn[me]) return;
      setAutoFoldChecked(!isAutoFoldChecked());
      return;
    }
    try {
      await runPlayerAction(() => fold());
    } catch (err) { showTableError(err.message); }
  });

  document.getElementById('btn-check-call').addEventListener('click', async () => {
    try {
      await runPlayerAction(() => {
        if (getCheckOrCallMode() === 'call') return call(getCallAmount());
        return check();
      });
    } catch (err) { showTableError(err.message); }
  });

  document.getElementById('btn-bet-raise').addEventListener('click', async () => {
    try {
      await runPlayerAction(() => {
        const amount = getBetOrRaiseAmount();
        if (getBetOrRaiseMode() === 'bet') return bet(amount);
        return raise(amount);
      });
    } catch (err) { showTableError(err.message); }
  });

  document.getElementById('btn-allin').addEventListener('click', async () => {
    try {
      await runPlayerAction(() => allIn(getMyChips()));
    } catch (err) { showTableError(err.message); }
  });

  // ── Owner actions ──

  document.getElementById('btn-create').addEventListener('click', async () => {
    const statusEl = document.getElementById('create-status');
    try {
      const startTime = datetimeLocalToUnix();
      const maxSeats  = parseInt(document.getElementById('input-maxseats').value, 10);
      const sb        = parseInt(document.getElementById('input-sb').value, 10);
      const hpbd      = parseInt(document.getElementById('input-hpbd').value, 10);
      const hp5mb     = parseInt(document.getElementById('input-hp5mb').value, 10);
      statusEl.style.display = 'none';
      await applyReceipt(await createTournament(startTime, maxSeats, sb, hpbd, hp5mb));
      statusEl.textContent = '✓ Tournament created';
      statusEl.style.color = '#88cc88';
      statusEl.style.display = '';
      refreshEthBalance();
    } catch (err) {
      statusEl.textContent = `✗ Creation failed: ${truncateRevertError(err.message)}`;
      statusEl.style.color = '#e74c3c';
      statusEl.style.display = '';
    }
  });

  document.getElementById('btn-start').addEventListener('click', async () => {
    const s = document.getElementById('start-status');
    try {
      setStatus(s, '', true);
      await applyReceipt(await startTournament());
      switchTab('table');
      setStatus(s, '✓ Tournament started', true);
      refreshEthBalance();
      if (TState.state.isSitting && TState.state.handState >= 2) await tryDecryptMyHoleCards();
    } catch (err) { setStatus(s, `✗ ${err.message}`, false); }
  });

  document.getElementById('btn-cancel').addEventListener('click', async () => {
    const s = document.getElementById('cancel-status');
    try {
      setStatus(s, '', true);
      await applyReceipt(await cancelTournament());
      setStatus(s, '✓ Tournament cancelled', true);
      refreshEthBalance();
    } catch (err) { setStatus(s, `✗ ${err.message}`, false); }
  });

  document.getElementById('btn-force-end').addEventListener('click', async () => {
    const s = document.getElementById('force-end-status');
    try {
      setStatus(s, '', true);
      await applyReceipt(await forceEndTournament());
      setStatus(s, '✓ Tournament force-ended', true);
      refreshEthBalance();
    } catch (err) { setStatus(s, `✗ ${err.message}`, false); }
  });

  function wlStatus(msg, ok) {
    setStatus(document.getElementById('whitelist-status'), msg, ok);
  }

  document.getElementById('btn-whitelist-add').addEventListener('click', async () => {
    const addr = document.getElementById('input-whitelist-addr').value.trim();
    try {
      wlStatus('', true);
      await addPlayerToWhitelist(addr);
      wlStatus(`✓ ${addr.slice(0,10)}… added`, true);
      document.getElementById('input-whitelist-addr').value = '';
    } catch (err) { wlStatus(`✗ ${truncateRevertError(err.message)}`, false); }
  });

  document.getElementById('btn-whitelist-remove').addEventListener('click', async () => {
    const addr = document.getElementById('input-whitelist-addr').value.trim();
    try {
      wlStatus('', true);
      await removePlayerFromWhitelist(addr);
      wlStatus(`✓ ${addr.slice(0,10)}… removed`, true);
      document.getElementById('input-whitelist-addr').value = '';
    } catch (err) { wlStatus(`✗ ${truncateRevertError(err.message)}`, false); }
  });

  if (shouldAutoConnect()) {
    tryConnect({ interactive: false }).catch(() => {});
  }

});
