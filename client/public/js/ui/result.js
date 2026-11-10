import { shortAddr } from './seats.js';

function _fmtTs(unix) {
  const n = Number(unix) || 0;
  return n > 0 ? new Date(n * 1000).toLocaleString() : '—';
}

function _fmtDuration(startUnix, endUnix) {
  const start = Number(startUnix) || 0;
  const end = Number(endUnix) || 0;
  if (!start || !end || end < start) return '—';
  let s = end - start;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

export function showTournamentResult(result) {
  const overlay = document.getElementById('result-overlay');
  const body = document.getElementById('result-body');
  if (!overlay || !body || !result) return;
  const winner = shortAddr(result.winner) || result.winner || '—';
  const rows = [
    ['Start time', _fmtTs(result.actualStartTime)],
    ['End time', _fmtTs(result.endTime)],
    ['Duration', _fmtDuration(result.actualStartTime, result.endTime)],
    ['Tournament Number', `#${result.tournamentNumber}`],
    ['Players', String(result.players)],
    ['Hands dealt', String(result.handsDealt)],
  ];
  body.innerHTML = '';
  const headline = document.createElement('div');
  headline.className = 'result-headline';
  headline.textContent = `Player ${winner} wins the Tournament! 🏆`;
  body.appendChild(headline);
  body.appendChild(document.createElement('div')).className = 'result-spacer';
  for (const [label, value] of rows) {
    const line = document.createElement('div');
    line.className = 'result-line';
    line.append(label + ': ');
    const val = document.createElement('span');
    val.className = 'result-val';
    val.textContent = value;
    line.appendChild(val);
    body.appendChild(line);
  }
  overlay.style.display = 'flex';
}

export function hideTournamentResult() {
  const overlay = document.getElementById('result-overlay');
  if (overlay) overlay.style.display = 'none';
}
