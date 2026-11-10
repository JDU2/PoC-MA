import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web';
import { FheTypes } from '@cofhe/sdk';
import { chains } from '@cofhe/sdk/chains';
import { createPublicClient, createWalletClient, http, webSocket } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Network Config ───────────────────────────────────────────────────────────
// Switch between 'local' (Hardhat) and 'arbitrum-sepolia' (testnet)

const NETWORK = 'arbitrum-sepolia'; // 'local' for Hardhat

// How Connect binds a signer. All later txs still auto-sign with the local key.
//   'auto'     — no MetaMask; connect immediately with the key for this acc index
//   'metamask' — Connect asks MetaMask to confirm the account, then txs auto-sign
const DEFAULT_CONNECT_MODE = 'auto';
const SIGNER_CONNECT_MODE = {
  0: 'metamask', // Dev Acc Owner
  1: 'auto',     // Dev Acc Player 2 (?acc=1)
  2: 'auto',     // Dev Acc Player 3 (?acc=2) — PRIVATE_KEY_2
};

export function getConnectMode(accIndex = getAccountIndex()) {
  return SIGNER_CONNECT_MODE[accIndex] ?? DEFAULT_CONNECT_MODE;
}

export function shouldAutoConnect() {
  if (getConnectMode() === 'auto') return true;
  try { return !!localStorage.getItem('pks-account'); } catch { return false; }
}

const NETWORKS = {
  local: {
    id: 31337,
    name: 'Hardhat Local',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:8545'], webSocket: ['ws://127.0.0.1:8545'] } },
    cofheChain: chains.hardhat,
  },
  'arbitrum-sepolia': {
    id: 421614,
    name: 'Arbitrum Sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    // Public, keyless RPC endpoints by default — no per-user provider account
    // required. Override via ARBITRUM_SEPOLIA_RPC_URL / _WS_RPC_URL in .env
    // (served through /api/signers) if a dedicated/private endpoint is preferred.
    rpcUrls: { default: {
      http: ['https://arbitrum-sepolia.publicnode.com'],
      webSocket: ['wss://arbitrum-sepolia.publicnode.com'],
    } },
    cofheChain: chains.arbSepolia,
  },
};

// Hardhat / Anvil default mnemonic keys (public, well-known). Used for local auto-sign.
const HARDHAT_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
];

function normalizePk(pk) {
  if (!pk) return null;
  const s = String(pk).trim();
  if (!s) return null;
  return s.startsWith('0x') ? s : `0x${s}`;
}

let _signerKeys = null;
let _rpcOverride = null;
let _wsRpcOverride = null;

export function getAccountIndex() {
  const q = new URLSearchParams(location.search).get('acc');
  if (q !== null && q !== '') {
    const n = parseInt(q, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const stored = sessionStorage.getItem('pks-acc');
  if (stored !== null) {
    const n = parseInt(stored, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

export function setAccountIndex(i) {
  sessionStorage.setItem('pks-acc', String(i));
}

async function loadSignerKeys() {
  if (_signerKeys) return _signerKeys;
  if (NETWORK === 'local') {
    _signerKeys = HARDHAT_KEYS;
    return _signerKeys;
  }
  const res = await fetch('/api/signers', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load Arbitrum Sepolia signers from the client server.');
  const data = await res.json();
  const keys = (data.keys || []).map(normalizePk).filter(Boolean);
  if (!keys.length) {
    throw new Error('No PRIVATE_KEY in the project .env. Add PRIVATE_KEY (and optional PRIVATE_KEY_1, …) for Arbitrum Sepolia auto-sign.');
  }
  _signerKeys = keys;
  // Optional overrides (dedicated/private RPC) — public endpoints are used by
  // default (see NETWORKS above), so these are not required.
  if (data.rpcUrl) _rpcOverride = data.rpcUrl;
  if (data.wsRpcUrl) _wsRpcOverride = data.wsRpcUrl;
  return _signerKeys;
}

export async function listSignerAddresses() {
  const keys = await loadSignerKeys();
  return keys.map(k => privateKeyToAccount(k).address);
}

async function ensureWalletOnNetwork(net) {
  if (!window.ethereum) throw new Error('No browser wallet detected. Please install MetaMask.');
  const chainIdHex = '0x' + net.id.toString(16);
  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (current === chainIdHex) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        chainName: net.name,
        nativeCurrency: net.nativeCurrency,
        rpcUrls: net.rpcUrls.default.http,
      }],
    });
  }
}

async function confirmSignerWithMetaMask(net, keys, preferredIdx, { interactive = true } = {}) {
  await ensureWalletOnNetwork(net);
  let accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts?.length) {
    if (!interactive) throw new Error('MetaMask is not connected.');
    accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  }
  const mm = (accounts[0] || '').toLowerCase();
  if (!mm) throw new Error('MetaMask did not return an account.');
  const match = keys.findIndex(k => privateKeyToAccount(k).address.toLowerCase() === mm);
  if (match >= 0) return match;
  const expected = privateKeyToAccount(keys[preferredIdx]).address;
  throw new Error(
    `MetaMask is ${accounts[0]} but no local auto-sign key matches it (expected e.g. #${preferredIdx} ${expected}). Switch MetaMask to that Hardhat account.`
  );
}

// ─── State ────────────────────────────────────────────────────────────────────

let cofheClient = null;
let _publicClient = null;
let _wsPublicClient = null;
let _walletClient = null;

// ─── Connect ──────────────────────────────────────────────────────────────────

export async function connectWallet({ interactive = true } = {}) {
  const net = NETWORKS[NETWORK];
  const keys = await loadSignerKeys();
  let idx = Math.min(getAccountIndex(), keys.length - 1);
  if (getConnectMode(idx) === 'metamask') {
    idx = await confirmSignerWithMetaMask(net, keys, idx, { interactive });
  }
  setAccountIndex(idx);
  const account = privateKeyToAccount(keys[idx]);
  const httpUrl = _rpcOverride || net.rpcUrls.default.http[0];

  const config = createCofheConfig({
    environment: 'web',
    supportedChains: net.cofheChain ? [net.cofheChain] : [],
  });
  cofheClient = createCofheClient(config);

  _publicClient = createPublicClient({ chain: net, transport: http(httpUrl) });
  _walletClient = createWalletClient({ chain: net, transport: http(httpUrl), account });

  // WS client is required — it is the only path for all live reads and
  // subscriptions (contract reads, log catch-up, push event notifications).
  // No HTTP fallback: every network config must supply a WS RPC endpoint.
  const wsUrl = _wsRpcOverride || net.rpcUrls.default.webSocket?.[0];
  if (!wsUrl) {
    throw new Error(`[cofhe] No WebSocket RPC configured for "${NETWORK}". Set a webSocket URL in NETWORKS, or ARBITRUM_SEPOLIA_WS_RPC_URL in .env.`);
  }
  _wsPublicClient = createPublicClient({ chain: net, transport: webSocket(wsUrl) });

  await cofheClient.connect(_publicClient, _walletClient);
  try {
    await cofheClient.acp.getOrCreateSelfACP();
  } catch (e) {
    console.warn('[cofhe] self-ACP setup failed (card decryption will be unavailable):', e.message);
  }

  return account.address;
}

// ─── Getters ──────────────────────────────────────────────────────────────────

export function getClient() {
  if (!cofheClient?.connected) throw new Error('Wallet not connected.');
  return cofheClient;
}

export function getPublicClient() {
  if (!_publicClient) throw new Error('Wallet not connected.');
  return _publicClient;
}

export function getWalletClient() {
  if (!_walletClient) throw new Error('Wallet not connected.');
  return _walletClient;
}

export function getWsPublicClient() {
  if (!_wsPublicClient) throw new Error('Wallet not connected.');
  return _wsPublicClient;
}

export function getNetwork() {
  return NETWORK;
}

export function getNetworkName() {
  return NETWORKS[NETWORK]?.name || NETWORK;
}

// ─── FHE Decryption Helpers ───────────────────────────────────────────────────

function _ctHash(handle) {
  if (handle == null) return null;
  if (typeof handle === 'bigint') return handle;
  if (typeof handle === 'object' && handle !== null && 'toString' in handle) {
    const s = String(handle);
    if (s.startsWith('0x') || /^\d+$/.test(s)) return BigInt(s);
  }
  const s = String(handle);
  if (!s || s === '0x' + '0'.repeat(64)) return null;
  return s.startsWith('0x') ? BigInt(s) : s;
}

export async function decryptUint8(handle) {
  const ctHash = _ctHash(handle);
  if (ctHash == null) throw new Error('Empty ciphertext handle');
  const timeout = getNetwork() === 'local' ? 10_000 : 120_000;
  const result = await getClient()
    .decryptForView(ctHash, FheTypes.Uint8)
    .set404RetryTimeout(timeout)
    .execute();
  return Number(result);
}

export async function decryptUint8WithSig(handle) {
  const result = await getClient()
    .decryptForTx(handle)
    .withoutACP()
    .execute();
  return { handle: result.ctHash, value: Number(result.decryptedValue), sig: result.signature };
}
