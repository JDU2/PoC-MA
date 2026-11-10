import { getContract } from 'viem';
import { getPublicClient, getWalletClient, getNetwork } from './cofhe.js';

// ─── Contract Config ─────────────────────────────────────────────────────────
// Fill in after deploying. Use 'local' address when testing with Hardhat.

export const CONTRACT_ADDRESS = {
  local: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  'arbitrum-sepolia': '0xFB2b6A2C88E9F3ebbDEAc385523B7E510FFA2f48',
};

export const ABI = [
  { "inputs": [], "name": "AlreadyJoined", "type": "error" },
  { "inputs": [], "name": "AlreadyWhitelisted", "type": "error" },
  { "inputs": [], "name": "CannotAct", "type": "error" },
  { "inputs": [], "name": "CannotBetEverythingOrMoreThanYouHave", "type": "error" },
  { "inputs": [], "name": "CannotBetWhenLeadingBetIsPresent", "type": "error" },
  { "inputs": [], "name": "BetBelowMinimum", "type": "error" },
  { "inputs": [], "name": "CannotCallForMoreThanYouHave", "type": "error" },
  { "inputs": [], "name": "CannotCallWhenNoBetIsPresent", "type": "error" },
  { "inputs": [], "name": "CannotCheckWhenLeadingBetIsUnmatched", "type": "error" },
  { "inputs": [], "name": "CannotGoAllInWhenNoOneElseCanMatchIt", "type": "error" },
  { "inputs": [], "name": "CannotRaiseToAllInOrByMoreThanYouHave", "type": "error" },
  { "inputs": [], "name": "CannotRaiseWhenNoOneElseCanAct", "type": "error" },
  { "inputs": [], "name": "InvalidActionIdentifier", "type": "error" },
  { "inputs": [], "name": "InvalidAllInAmount", "type": "error" },
  { "inputs": [], "name": "InvalidCallAmount", "type": "error" },
  { "inputs": [], "name": "InvalidEncryptedBoardCard", "type": "error" },
  { "inputs": [], "name": "InvalidEncryptedHoleCard", "type": "error" },
  { "inputs": [], "name": "InvalidHandsPerTournamentBreak", "type": "error" },
  { "inputs": [], "name": "InvalidHandsPerBlindDoubling", "type": "error" },
  { "inputs": [], "name": "InvalidMaxSeats", "type": "error" },
  { "inputs": [], "name": "InvalidSmallBlind", "type": "error" },
  { "inputs": [], "name": "InvalidStartTime", "type": "error" },
  { "inputs": [], "name": "NoNextActingSeat", "type": "error" },
  { "inputs": [], "name": "NoTournamentInProgressOrPaused", "type": "error" },
  { "inputs": [], "name": "NoTournamentScheduled", "type": "error" },
  { "inputs": [], "name": "NotEnoughPlayersJoined", "type": "error" },
  { "inputs": [], "name": "NotInBettingPhase", "type": "error" },
  { "inputs": [], "name": "NotInShowdownPhase", "type": "error" },
  { "inputs": [], "name": "NotWhitelisted", "type": "error" },
  { "inputs": [], "name": "NotYourTurn", "type": "error" },
  { "inputs": [], "name": "OnlyContractOwnerCanCall", "type": "error" },
  { "inputs": [], "name": "PlayerNotAtTheTournamentTable", "type": "error" },
  { "inputs": [], "name": "RaiseBelowMinimum", "type": "error" },
  { "inputs": [{ "internalType": "int32", "name": "value", "type": "int32" }], "name": "SecurityZoneOutOfBounds", "type": "error" },
  { "inputs": [], "name": "StartTimeNotReached", "type": "error" },
  { "inputs": [], "name": "TableFull", "type": "error" },
  { "inputs": [], "name": "TotalShowdownPayoutsDontMatchPotAmount", "type": "error" },
  { "inputs": [], "name": "TournamentAlreadyInProgress", "type": "error" },
  { "inputs": [], "name": "TournamentAlreadyScheduledOrInProgress", "type": "error" },
  { "inputs": [], "name": "TournamentNotPaused", "type": "error" },
  { "inputs": [], "name": "TournamentTableClosed", "type": "error" },
  { "anonymous": false, "inputs": [], "name": "FlopDecryptionAllowed", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "newButtonIndex", "type": "uint8" }], "name": "HandEnded", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "enum StorageLayout.HandState", "name": "newHandState", "type": "uint8" }], "name": "HandStateUpdated", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }], "name": "PlayerFolded", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }], "name": "PlayerChecked", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "chips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "leadingBet", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "minRaiseIncrement", "type": "uint24" }], "name": "PlayerBet", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "chips", "type": "uint24" }, { "indexed": false, "internalType": "bool", "name": "isAllIn", "type": "bool" }], "name": "PlayerCalled", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "chips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "leadingBet", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "minRaiseIncrement", "type": "uint24" }], "name": "PlayerRaised", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "leadingBet", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "minRaiseIncrement", "type": "uint24" }], "name": "PlayerWentAllInAndRaisedFull", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "leadingBet", "type": "uint24" }], "name": "PlayerWentAllInAndRaisedNotFull", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "currentBet", "type": "uint24" }], "name": "PlayerWentAllInShortStacked", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "player", "type": "address" }], "name": "PlayerBusted", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "player", "type": "address" }, { "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }], "name": "PlayerJoinedTournamentTable", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint24", "name": "newPotAmount", "type": "uint24" }], "name": "PotUpdated", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "newChips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "winAmount", "type": "uint24" }], "name": "PlayerChipsUpdated", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "newChips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "winAmount", "type": "uint24" }, { "indexed": false, "internalType": "uint8", "name": "handCategory", "type": "uint8" }], "name": "PlayerChipsUpdatedPlusHandCategory", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint8", "name": "remainder", "type": "uint8" }], "name": "PlayerReceivedRemainder", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint24", "name": "newSmallBlind", "type": "uint24" }], "name": "BlindsIncreased", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "chips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "currentBet", "type": "uint24" }, { "indexed": false, "internalType": "bool", "name": "isAllIn", "type": "bool" }], "name": "SmallBlindPosted", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "chips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "currentBet", "type": "uint24" }, { "indexed": false, "internalType": "bool", "name": "isAllIn", "type": "bool" }], "name": "BigBlindPosted", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "newSeatInAction", "type": "uint8" }], "name": "SeatInActionUpdated", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "ProcessShowdown", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "RiverDecryptionAllowed", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "enum StorageLayout.SessionState", "name": "newSessionState", "type": "uint8" }], "name": "SessionStateUpdated", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "ShowdownHoleCardsDecryptionAllowed", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint8", "name": "seatIndex", "type": "uint8" }, { "indexed": false, "internalType": "uint8", "name": "holeCard0", "type": "uint8" }, { "indexed": false, "internalType": "uint8", "name": "holeCard1", "type": "uint8" }], "name": "DecryptedHoleCardsOfShowdownParticipant", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "TournamentCancelled", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint32", "name": "scheduledStartTime", "type": "uint32" }, { "indexed": false, "internalType": "uint8", "name": "maxSeats", "type": "uint8" }, { "indexed": false, "internalType": "uint24", "name": "startingChips", "type": "uint24" }, { "indexed": false, "internalType": "uint24", "name": "smallBlind", "type": "uint24" }, { "indexed": false, "internalType": "uint8", "name": "hPBD", "type": "uint8" }, { "indexed": false, "internalType": "uint8", "name": "hPTB", "type": "uint8" }], "name": "TournamentCreated", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "TournamentEndForced", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint16", "name": "completedTournaments", "type": "uint16" }, { "indexed": false, "internalType": "uint256", "name": "endTime", "type": "uint256" }, { "indexed": false, "internalType": "address", "name": "winner", "type": "address" }, { "indexed": false, "internalType": "uint16", "name": "handCounter", "type": "uint16" }], "name": "TournamentEnded", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "TournamentOn5MinuteBreak", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint256", "name": "actualStartTime", "type": "uint256" }], "name": "TournamentStarted", "type": "event" },
  { "anonymous": false, "inputs": [], "name": "TurnDecryptionAllowed", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address[]", "name": "newOrder", "type": "address[]" }], "name": "UpdateSeats", "type": "event" },
  { "inputs": [{ "internalType": "address", "name": "player", "type": "address" }], "name": "addPlayerToWhitelist", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "cancelTournament", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "startTime", "type": "uint256" }, { "internalType": "uint256", "name": "maxSeats", "type": "uint256" }, { "internalType": "uint256", "name": "sb", "type": "uint256" }, { "internalType": "uint256", "name": "hPBD", "type": "uint256" }, { "internalType": "uint256", "name": "hPTB", "type": "uint256" }], "name": "createTournament", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "encryptedBoardCards", "outputs": [{ "internalType": "euint8", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "", "type": "address" }, { "internalType": "uint256", "name": "", "type": "uint256" }], "name": "encryptedHoleCardsOf", "outputs": [{ "internalType": "euint8", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "forceEndTournament", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "getEncryptedHoleCardsOfShowdownParticipants", "outputs": [{ "internalType": "euint8[]", "name": "encryptedHoleCards_SDP", "type": "bytes32[]" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "getMyEncryptedHoleCards", "outputs": [{ "internalType": "euint8[2]", "name": "", "type": "bytes32[2]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "isWhitelisted", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "joinTournamentTable", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "minLegalTotalBet", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "enum StorageLayout.PlayerAction", "name": "action", "type": "uint8" }, { "internalType": "uint24", "name": "amount", "type": "uint24" }], "name": "playerAction", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "euint8[]", "name": "encryptedCards", "type": "bytes32[]" }, { "internalType": "uint8[]", "name": "decryptedCards", "type": "uint8[]" }, { "internalType": "bytes[]", "name": "signatures", "type": "bytes[]" }], "name": "processShowdown", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "remainingPlayerCount", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "player", "type": "address" }], "name": "removePlayerFromWhitelist", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "resumeAfterBreak", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "player", "type": "address" }], "name": "seatOfPlayer", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "sitsAtTheTournamentTable", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "startTournament", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "t_meta", "outputs": [{ "internalType": "enum StorageLayout.SessionState", "name": "s_state", "type": "uint8" }, { "internalType": "uint8", "name": "maxSeats", "type": "uint8" }, { "internalType": "uint24", "name": "startingChips", "type": "uint24" }, { "internalType": "uint32", "name": "scheduledStartTime", "type": "uint32" }, { "internalType": "enum StorageLayout.HandState", "name": "h_state", "type": "uint8" }, { "internalType": "uint16", "name": "handCounter", "type": "uint16" }, { "internalType": "uint8", "name": "handsPerTournamentBreak", "type": "uint8" }, { "internalType": "uint8", "name": "handsPerBlindDoubling", "type": "uint8" }, { "internalType": "uint24", "name": "smallBlind", "type": "uint24" }, { "internalType": "uint8", "name": "buttonIndex", "type": "uint8" }, { "internalType": "uint8", "name": "seatInAction", "type": "uint8" }, { "internalType": "uint8", "name": "canActCount", "type": "uint8" }, { "internalType": "uint8", "name": "mustActCount", "type": "uint8" }, { "internalType": "uint8", "name": "foldedCount", "type": "uint8" }, { "internalType": "uint24", "name": "leadingBet", "type": "uint24" }, { "internalType": "uint24", "name": "minRaiseIncrement", "type": "uint24" }, { "internalType": "uint24", "name": "pot", "type": "uint24" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "tournamentsCompleted", "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }], "stateMutability": "view", "type": "function" },
];

// ─── Contract Instance ────────────────────────────────────────────────────────

let _contract = null;

// Reads and receipts use HTTP. WS is only for live log subscriptions
// (see events.js) — public testnet WS nodes often fail historical queries.
function getContractInstance() {
  if (!_contract) {
    const network = getNetwork();
    const address = CONTRACT_ADDRESS[network];
    if (!address) throw new Error(`No contract address set for network: ${network}`);
    _contract = getContract({ address, abi: ABI, client: { public: getPublicClient(), wallet: getWalletClient() } });
  }
  return _contract;
}

// Call this if the wallet/network changes to force a fresh instance
export function resetContractInstance() { _contract = null; }

async function waitForReceipt(hash) {
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new Error('Transaction reverted on-chain');
  return receipt;
}

// Fetches the confirmed nonce directly from the chain, bypassing MetaMask's
// internal nonce cache. Prevents "nonce too low" errors during Hardhat sessions.
// Uses the HTTP client (see note above) so it's unaffected by WS drops.
async function freshNonce() {
  const wc = getWalletClient();
  const pc = getPublicClient();
  return await pc.getTransactionCount({ address: wc.account.address, blockTag: 'latest' });
}

// Local mock-FHE shuffle needs ~25M+ gas; eth_estimateGas is capped at ~16M.
async function wo(extra = {}) {
  const gas = getNetwork() === 'local' ? 80_000_000n : 16_000_000n;
  return { gas, nonce: await freshNonce(), ...extra };
}

// ─── PlayerAction enum (mirrors StorageLayout.sol) ───────────────────────────

export const PlayerAction = { Fold: 0, Check: 1, Bet: 2, Call: 3, Raise: 4, All_In: 5 };

// ─── Read: Game State ─────────────────────────────────────────────────────────

export async function getTournamentMeta() {
  const c = getContractInstance();
  const r = await c.read.t_meta();
  // viem may return array or named object — normalize to named object
  return {
    s_state:             Number(r.s_state             ?? r[0]),
    maxSeats:            Number(r.maxSeats            ?? r[1]),
    startingChips:       Number(r.startingChips       ?? r[2]),
    scheduledStartTime:  Number(r.scheduledStartTime  ?? r[3]),
    h_state:             Number(r.h_state             ?? r[4]),
    handCounter:         Number(r.handCounter         ?? r[5]),
    handsPer5MinuteBreak:Number(r.handsPerTournamentBreak ?? r.handsPer5MinuteBreak ?? r[6]),
    handsPerBlindDoubling:Number(r.handsPerBlindDoubling??r[7]),
    smallBlind:          Number(r.smallBlind          ?? r[8]),
    buttonIndex:         Number(r.buttonIndex         ?? r[9]),
    seatInAction:        Number(r.seatInAction        ?? r[10]),
    canActCount:         Number(r.canActCount         ?? r[11]),
    mustActCount:        Number(r.mustActCount        ?? r[12]),
    foldedCount:         Number(r.foldedCount         ?? r[13]),
    leadingBet:          Number(r.leadingBet          ?? r[14]),
    minRaiseIncrement:   Number(r.minRaiseIncrement   ?? r[15]),
    pot:                 Number(r.pot                 ?? r[16]),
  };
}

export async function getOwner() {
  const c = getContractInstance();
  return await c.read.owner();
}

export async function getRemainingPlayerCount() {
  const c = getContractInstance();
  return await c.read.remainingPlayerCount();
}

// Returns the contract seat index of a player, or -1 if not seated
export async function getSeatOfPlayer(address) {
  const c = getContractInstance();
  try {
    const sitting = await c.read.sitsAtTheTournamentTable([address]);
    if (!sitting) return -1;
    return Number(await c.read.seatOfPlayer([address]));
  } catch {
    return -1;
  }
}


// ─── Owner: Tournament Management ────────────────────────────────────────────

export async function addPlayerToWhitelist(addr) {
  const c = getContractInstance();
  const hash = await c.write.addPlayerToWhitelist([addr], await wo());
  return waitForReceipt(hash);
}

export async function removePlayerFromWhitelist(addr) {
  const c = getContractInstance();
  const hash = await c.write.removePlayerFromWhitelist([addr], await wo());
  return waitForReceipt(hash);
}

export async function createTournament(startTime, maxSeats, smallBlind, handsPerBlindDoubling, handsPer5MinBreak) {
  const c = getContractInstance();
  const hash = await c.write.createTournament([startTime, maxSeats, smallBlind, handsPerBlindDoubling, handsPer5MinBreak], await wo());
  return waitForReceipt(hash);
}

export async function startTournament() {
  const c = getContractInstance();
  const hash = await c.write.startTournament(await wo());
  return waitForReceipt(hash);
}

export async function cancelTournament() {
  const c = getContractInstance();
  const hash = await c.write.cancelTournament(await wo());
  return waitForReceipt(hash);
}

export async function forceEndTournament() {
  const c = getContractInstance();
  const hash = await c.write.forceEndTournament(await wo());
  return waitForReceipt(hash);
}

export async function resumeAfterBreak() {
  const c = getContractInstance();
  const hash = await c.write.resumeAfterBreak(await wo());
  return waitForReceipt(hash);
}

export async function joinTournamentTable() {
  const c = getContractInstance();
  const hash = await c.write.joinTournamentTable(await wo());
  return waitForReceipt(hash);
}

export async function fold() {
  const c = getContractInstance();
  const hash = await c.write.playerAction([PlayerAction.Fold, 0], await wo());
  return waitForReceipt(hash);
}

export async function check() {
  const c = getContractInstance();
  const hash = await c.write.playerAction([PlayerAction.Check, 0], await wo());
  return waitForReceipt(hash);
}

export async function bet(amount) {
  const c = getContractInstance();
  const hash = await c.write.playerAction([PlayerAction.Bet, amount], await wo());
  return waitForReceipt(hash);
}

export async function call(amount) {
  const c = getContractInstance();
  const hash = await c.write.playerAction([PlayerAction.Call, amount], await wo());
  return waitForReceipt(hash);
}

export async function raise(amount) {
  const c = getContractInstance();
  const hash = await c.write.playerAction([PlayerAction.Raise, amount], await wo());
  return waitForReceipt(hash);
}

export async function allIn(amount) {
  const c = getContractInstance();
  const hash = await c.write.playerAction([PlayerAction.All_In, amount], await wo());
  return waitForReceipt(hash);
}

export async function allowPublicHoleCardsForShowdown() {
  const c = getContractInstance();
  const hash = await c.write.getEncryptedHoleCardsOfShowdownParticipants(await wo());
  return waitForReceipt(hash);
}

export async function processShowdown(encryptedCards, decryptedCards, signatures) {
  const c = getContractInstance();
  const hash = await c.write.processShowdown([encryptedCards, decryptedCards, signatures], await wo());
  return waitForReceipt(hash);
}

// ─── Read: Encrypted Card Handles ────────────────────────────────────────────

export async function getMyHoleCardHandles() {
  const c = getContractInstance();
  const account = getWalletClient().account;
  return await c.read.getMyEncryptedHoleCards({ account });
}

export async function getBoardCardHandle(index) {
  const c = getContractInstance();
  return await c.read.encryptedBoardCards([index]);
}

export async function getHoleCardHandle(addr, index) {
  const c = getContractInstance();
  return await c.read.encryptedHoleCardsOf([addr, index]);
}
