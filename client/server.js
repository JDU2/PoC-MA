// Local server for the poker client at http://localhost:3000.
// Manual start via terminal (bash / Linux): cd client && npm start
// Note: Rebuild bundle first if you changed client code: npm run build

const fs = require('fs');
const express = require('express');
const path = require('path');
const open = require('open');

const envPath = path.join(__dirname, '..', '.env');
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
} catch (_) {}

function normalizePk(pk) {
  if (!pk) return null;
  const s = String(pk).trim();
  if (!s) return null;
  return s.startsWith('0x') ? s : `0x${s}`;
}

const app = express();
const PORT = 3000;

app.get('/api/signers', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const seen = new Set();
  const keys = [];
  const add = (pk) => {
    const n = normalizePk(pk);
    if (!n || n.length < 66 || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    keys.push(n);
  };
  add(process.env.PRIVATE_KEY);
  for (let i = 0; i < 10; i++) add(process.env[`PRIVATE_KEY_${i}`]);
  res.json({
    keys,
    // Optional overrides — Arbitrum Sepolia uses public, keyless RPC
    // endpoints by default (see cofhe.js), so these are not required.
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || '',
    wsRpcUrl: process.env.ARBITRUM_SEPOLIA_WS_RPC_URL || '',
  });
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

app.listen(PORT, () => {
  console.log(`Poker client running at http://localhost:${PORT}`);
  open(`http://localhost:${PORT}`);
});
