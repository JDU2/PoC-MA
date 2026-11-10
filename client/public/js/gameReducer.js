// Pure table-state transitions from contract events.
// Live UI, log replay, and refresh catch-up all use this so order is the only requirement.

// Matches ShowdownHandEvaluatorLib categories (0 high card … 8 straight flush).
const HAND_CATEGORY = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

export function emptyTableState() {
  return {
    startingChips: 0,
    maxSeats: 6,
    smallBlind: 0,
    actualStartTime: 0,
    scheduledStartTime: 0,
    handsPerBlindDoubling: 0,
    handsPer5MinuteBreak: 0,
    buttonIndex: 0,
    sessionState: 0,
    handState: 0,
    pot: 0,
    inBetting: false,
    seatInAction: -1,
    leadingBet: 0,
    minRaiseIncrement: 0,
    canActCount: 0,
    playerCount: 0,
    startPlayerCount: 0,
    tournamentResult: null,
    seatAddrs: [],
    seatChips: [],
    seatCurrentBets: [],
    seatBlinds: [],
    seatLabels: [],
    seatFolded: [],
    seatAllIn: [],
    seatWinPending: [],
    seatWinHand: [],
    seatWinShow: false,
    boardCards: [],
    myHoleCards: null,
    seatShowdownCards: [], // (number[2] | null)[] indexed by contractSeat — decrypted at showdown, cleared next hand
    isSitting: false,
    myContractSeat: -1,
    watchSeat: -1, // seat the camera stays on after this player busts
    turnToken: 0,
    handId: 0,
  };
}

function _num(a, key, idx) {
  if (!a) return 0;
  const n = Number(a[key] ?? a[idx]);
  return Number.isFinite(n) ? n : 0;
}

function _ensureSeat(s, i) {
  while (s.seatAddrs.length <= i) {
    s.seatAddrs.push('');
    s.seatChips.push(0);
    s.seatCurrentBets.push(0);
    s.seatBlinds.push('');
    s.seatLabels.push('');
    s.seatFolded.push(false);
    s.seatAllIn.push(false);
    if (!s.seatWinPending) s.seatWinPending = [];
    s.seatWinPending.push(0);
    if (!s.seatWinHand) s.seatWinHand = [];
    s.seatWinHand.push('');
  }
}

function _resetHandSeats(s) {
  const n = s.seatAddrs.length;
  s.canActCount = s.playerCount;
  s.pot = 0;
  s.seatCurrentBets = Array(n).fill(0);
  s.seatBlinds = Array(n).fill('');
  s.seatLabels = Array(n).fill('');
  s.seatFolded = Array(n).fill(false);
  s.seatAllIn = Array(n).fill(false);
  s.seatWinPending = Array(n).fill(0);
  s.seatWinHand = Array(n).fill('');
  s.seatWinShow = false;
  s.seatShowdownCards = Array(n).fill(null);
}

function _stickyAction(lab) {
  return lab === 'Fold' || lab === 'All-In';
}

function _clearStreetActions(s) {
  const n = Math.max((s.seatLabels || []).length, (s.seatAddrs || []).length);
  const next = new Array(n);
  for (let i = 0; i < n; i++) {
    const lab = (s.seatLabels && s.seatLabels[i]) || '';
    next[i] = _stickyAction(lab) ? lab : '';
    if (s.seatAllIn && s.seatAllIn[i]) next[i] = 'All-In';
  }
  s.seatLabels = next;
}

function _resetStreet(s) {
  const n = s.seatAddrs.length;
  s.leadingBet = 0;
  s.minRaiseIncrement = (s.smallBlind || 0) * 2;
  s.seatCurrentBets = Array(n).fill(0);
  s.myCurrentBet = 0;
}

function _putBet(s, i, { chips, currentBet, label, blind, allIn }) {
  _ensureSeat(s, i);
  if (chips !== undefined) s.seatChips[i] = chips;
  if (currentBet !== undefined) s.seatCurrentBets[i] = currentBet;
  if (label !== undefined) s.seatLabels[i] = label;
  if (blind !== undefined) s.seatBlinds[i] = blind;
  if (allIn !== undefined) s.seatAllIn[i] = allIn;
  if (chips === 0 && s.seatLabels[i] !== 'Fold') {
    s.seatAllIn[i] = true;
    s.seatLabels[i] = 'All-In';
  }
}

function _creditWin(s, a, hand) {
  const i = _num(a, 'seatIndex', 0);
  _ensureSeat(s, i);
  const prev = Number(s.seatChips[i]) || 0;
  const next = _num(a, 'newChips', 1);
  s.seatChips[i] = next;
  if (!s.seatWinPending) s.seatWinPending = [];
  while (s.seatWinPending.length <= i) s.seatWinPending.push(0);
  if (!s.seatWinHand) s.seatWinHand = [];
  while (s.seatWinHand.length <= i) s.seatWinHand.push('');
  if (s.seatWinShow) {
    s.seatWinPending = s.seatWinPending.map(() => 0);
    s.seatWinHand = s.seatWinHand.map(() => '');
    s.seatWinShow = false;
  }
  let win = _num(a, 'winAmount', 2);
  if (win <= 0 && next > prev) win = next - prev;
  s.seatWinPending[i] += win;
  if (hand) s.seatWinHand[i] = hand;
}

/**
 * Apply one contract event to table state. Mutates `s`.
 * `ctx.account` (lowercase) is used to keep myContractSeat / isSitting in sync.
 */
export function applyGameEvent(s, eventName, a = {}, ctx = {}) {
  const account = (ctx.account || '').toLowerCase();

  switch (eventName) {
    case 'TournamentCreated':
      s.startingChips = Number(a.startingChips);
      s.maxSeats = Number(a.maxSeats);
      s.smallBlind = Number(a.smallBlind);
      s.scheduledStartTime = Number(a.scheduledStartTime);
      s.handsPerBlindDoubling = Number(a.hPBD);
      s.handsPer5MinuteBreak = Number(a.hPTB ?? a.hP5MB);
      s.actualStartTime = 0;
      s.buttonIndex = 0;
      s.sessionState = 1;
      s.handState = 0;
      s.seatAddrs = []; s.seatChips = []; s.seatCurrentBets = [];
      s.seatBlinds = []; s.seatLabels = []; s.seatFolded = []; s.seatAllIn = [];
      s.seatWinPending = []; s.seatWinHand = []; s.seatWinShow = false;
      s.playerCount = 0; s.pot = 0; s.inBetting = false; s.seatInAction = -1;
      s.startPlayerCount = 0;
      s.tournamentResult = null;
      s.leadingBet = 0; s.minRaiseIncrement = 0; s.canActCount = 0;
      s.isSitting = false; s.myContractSeat = -1; s.watchSeat = -1;
      s.myChips = 0; s.myCurrentBet = 0;
      if ('boardCards' in s) s.boardCards = [];
      if ('myHoleCards' in s) s.myHoleCards = null;
      if ('seatShowdownCards' in s) s.seatShowdownCards = [];
      if ('breakEndsAt' in s) s.breakEndsAt = 0;
      break;

    case 'TournamentStarted':
      s.actualStartTime = Number(a.actualStartTime);
      s.buttonIndex = 0;
      s.startPlayerCount = s.playerCount;
      s.tournamentResult = null;
      // The first hand skips HandState.PreflopSetup, which is what normally
      // sets this. Blinds that follow can still decrement it.
      s.canActCount = s.playerCount;
      break;

    case 'TournamentCancelled':
    case 'TournamentEndForced':
      s.seatAddrs = []; s.seatChips = []; s.seatCurrentBets = [];
      s.seatBlinds = []; s.seatLabels = []; s.seatFolded = []; s.seatAllIn = [];
      s.seatWinPending = []; s.seatWinHand = []; s.seatWinShow = false;
      s.playerCount = 0; s.pot = 0; s.actualStartTime = 0;
      s.scheduledStartTime = 0;
      s.sessionState = 0; s.handState = 0;
      s.inBetting = false; s.seatInAction = -1;
      s.leadingBet = 0; s.minRaiseIncrement = 0; s.canActCount = 0;
      s.smallBlind = 0; s.startingChips = 0; s.maxSeats = 6;
      s.isSitting = false; s.myContractSeat = -1; s.watchSeat = -1;
      s.myChips = 0; s.myCurrentBet = 0;
      s.startPlayerCount = 0;
      s.tournamentResult = null;
      if ('boardCards' in s) s.boardCards = [];
      if ('myHoleCards' in s) s.myHoleCards = [];
      if ('seatShowdownCards' in s) s.seatShowdownCards = [];
      if ('breakEndsAt' in s) s.breakEndsAt = 0;
      break;

    case 'TournamentEnded':
      s.tournamentResult = {
        winner: a.winner,
        endTime: Number(a.endTime),
        tournamentNumber: Number(a.completedTournaments),
        handsDealt: Number(a.handCounter),
        actualStartTime: Number(s.actualStartTime) || 0,
        players: Number(s.startPlayerCount || s.playerCount) || 0,
      };
      s.seatAddrs = []; s.seatChips = []; s.seatCurrentBets = [];
      s.seatBlinds = []; s.seatLabels = []; s.seatFolded = []; s.seatAllIn = [];
      s.seatWinPending = []; s.seatWinHand = []; s.seatWinShow = false;
      s.playerCount = 0; s.pot = 0; s.actualStartTime = 0;
      s.scheduledStartTime = 0;
      s.sessionState = 0; s.handState = 0;
      s.inBetting = false; s.seatInAction = -1;
      s.leadingBet = 0; s.minRaiseIncrement = 0; s.canActCount = 0;
      s.smallBlind = 0; s.startingChips = 0; s.maxSeats = 6;
      s.isSitting = false; s.myContractSeat = -1; s.watchSeat = -1;
      s.myChips = 0; s.myCurrentBet = 0;
      s.startPlayerCount = 0;
      if ('boardCards' in s) s.boardCards = [];
      if ('myHoleCards' in s) s.myHoleCards = [];
      if ('seatShowdownCards' in s) s.seatShowdownCards = [];
      if ('breakEndsAt' in s) s.breakEndsAt = 0;
      break;

    case 'PlayerJoinedTournamentTable': {
      const i = Number(a.seatIndex);
      _ensureSeat(s, i);
      s.seatAddrs[i] = a.player;
      s.seatChips[i] = s.startingChips;
      s.seatCurrentBets[i] = 0;
      s.seatBlinds[i] = '';
      s.seatLabels[i] = '';
      s.seatFolded[i] = false;
      s.seatAllIn[i] = false;
      if (!s.seatWinPending) s.seatWinPending = [];
      while (s.seatWinPending.length <= i) s.seatWinPending.push(0);
      s.seatWinPending[i] = 0;
      if (!s.seatWinHand) s.seatWinHand = [];
      while (s.seatWinHand.length <= i) s.seatWinHand.push('');
      s.seatWinHand[i] = '';
      s.playerCount = s.seatAddrs.filter(Boolean).length;
      if (account && String(a.player).toLowerCase() === account) {
        s.isSitting = true;
        s.myContractSeat = i;
        s.watchSeat = i;
      }
      break;
    }

    case 'UpdateSeats': {
      const arr = Array.from(a.newOrder ?? []);
      const chipByAddr = {};
      const winByAddr = {};
      const handByAddr = {};
      s.seatAddrs.forEach((addr, i) => {
        if (!addr) return;
        const key = addr.toLowerCase();
        chipByAddr[key] = s.seatChips[i] ?? 0;
        winByAddr[key] = s.seatWinPending?.[i] ?? 0;
        handByAddr[key] = s.seatWinHand?.[i] ?? '';
      });
      s.seatAddrs = arr;
      s.seatChips = arr.map(addr => chipByAddr[addr?.toLowerCase()] ?? 0);
      s.seatWinPending = arr.map(addr => winByAddr[addr?.toLowerCase()] ?? 0);
      s.seatWinHand = arr.map(addr => handByAddr[addr?.toLowerCase()] ?? '');
      s.seatCurrentBets = arr.map(() => 0);
      s.seatBlinds = arr.map(() => '');
      s.seatLabels = arr.map(() => '');
      s.seatFolded = arr.map(() => false);
      s.seatAllIn = arr.map(() => false);
      s.playerCount = arr.length;
      if (account) {
        const prevSeat = s.myContractSeat;
        const my = arr.findIndex(x => x?.toLowerCase() === account);
        s.myContractSeat = my;
        s.isSitting = my >= 0;
        if (my >= 0) s.watchSeat = my;
        else if (arr.length) {
          // Stay on the same index after later busts, so the player who
          // shifts into it is the one shown in that circle.
          const held = s.watchSeat >= 0 ? s.watchSeat : prevSeat;
          s.watchSeat = Math.min(Math.max(held, 0), arr.length - 1);
        } else s.watchSeat = -1;
        if (my < 0) s.myHoleCards = null;
      }
      break;
    }

    case 'PlayerBusted':
      s.playerCount = Math.max(0, s.playerCount - 1);
      break;

    case 'PlayerChipsUpdated':
      _creditWin(s, a, '');
      break;

    case 'PlayerChipsUpdatedPlusHandCategory':
      _creditWin(s, a, HAND_CATEGORY[_num(a, 'handCategory', 3)] || '');
      break;

    case 'PlayerReceivedRemainder': {
      const i = _num(a, 'seatIndex', 0);
      _ensureSeat(s, i);
      const rem = _num(a, 'remainder', 1);
      s.seatChips[i] = (Number(s.seatChips[i]) || 0) + rem;
      if (!s.seatWinPending) s.seatWinPending = [];
      while (s.seatWinPending.length <= i) s.seatWinPending.push(0);
      s.seatWinPending[i] += rem;
      break;
    }

    case 'SessionStateUpdated':
      s.sessionState = Number(a.newSessionState);
      break;

    case 'HandStateUpdated': {
      const h = Number(a.newHandState);
      const prev = s.handState;
      s.handState = h;
      s.inBetting = h >= 2 && h <= 5;
      if (h === 1 && prev !== 1) {
        s.handId = (s.handId || 0) + 1;
        _resetHandSeats(s);
        if ('boardCards' in s) s.boardCards = [];
        if ('myHoleCards' in s) s.myHoleCards = null;
      } else if (prev !== h && !(h === 6 && prev >= 2 && prev <= 5)) {
        // Keep the closing street's last actions through showdown, including
        // a board run-out. Earlier streets still clear when the next card is dealt.
        _clearStreetActions(s);
      }
      // A betting round just closed (next street, or showdown / run-out).
      // Chips are already in the pot; drop the street bets. A 0 stays hidden.
      if (prev >= 2 && prev <= 5 && h > prev) _resetStreet(s);
      break;
    }

    case 'HandEnded':
      s.buttonIndex = Number(a.newButtonIndex);
      s.inBetting = false;
      break;

    case 'DecryptedHoleCardsOfShowdownParticipant': {
      const i = Number(a.seatIndex);
      _ensureSeat(s, i);
      if (!s.seatShowdownCards) s.seatShowdownCards = [];
      while (s.seatShowdownCards.length <= i) s.seatShowdownCards.push(null);
      const holes = [Number(a.holeCard0), Number(a.holeCard1)];
      s.seatShowdownCards[i] = holes;
      if (s.myContractSeat === i) s.myHoleCards = holes;
      break;
    }

    case 'PotUpdated':
      s.pot = _num(a, 'newPotAmount', 0);
      if (s.pot === 0 && ((s.seatWinPending || []).some(v => v > 0) || s.handState === 6)) {
        s.seatWinShow = true;
      }
      break;

    case 'SeatInActionUpdated':
      s.seatInAction = Number(a.newSeatInAction);
      // The contract emits this every time a betting round hands off to a
      // new actor, even when (heads-up) the same seat ends up acting twice
      // in a row across streets — so a plain seat-number comparison can't
      // detect that case. This token changes on every such event instead.
      s.turnToken = (s.turnToken || 0) + 1;
      break;

    case 'BlindsIncreased':
      s.smallBlind = Number(a.newSmallBlind);
      break;

    case 'SmallBlindPosted': {
      const i = Number(a.seatIndex);
      _putBet(s, i, {
        chips: Number(a.chips), currentBet: Number(a.currentBet),
        blind: 'SB', label: (a.isAllIn || Number(a.chips) === 0) ? 'All-In' : '', allIn: !!a.isAllIn || Number(a.chips) === 0,
      });
      if (a.isAllIn || Number(a.chips) === 0) s.canActCount = Math.max(0, s.canActCount - 1);
      break;
    }

    case 'BigBlindPosted': {
      const i = Number(a.seatIndex);
      const bb = s.smallBlind * 2;
      _putBet(s, i, {
        chips: Number(a.chips), currentBet: Number(a.currentBet),
        blind: 'BB', label: (a.isAllIn || Number(a.chips) === 0) ? 'All-In' : '', allIn: !!a.isAllIn || Number(a.chips) === 0,
      });
      s.leadingBet = bb;
      s.minRaiseIncrement = bb;
      if (a.isAllIn || Number(a.chips) === 0) s.canActCount = Math.max(0, s.canActCount - 1);
      break;
    }

    case 'PlayerFolded': {
      const i = Number(a.seatIndex);
      _ensureSeat(s, i);
      s.seatFolded[i] = true;
      s.seatLabels[i] = 'Fold';
      s.seatCurrentBets[i] = 0;
      s.canActCount = Math.max(0, s.canActCount - 1);
      if (s.seatInAction === i) s.seatInAction = -1;
      break;
    }

    case 'PlayerChecked':
      _ensureSeat(s, Number(a.seatIndex));
      s.seatLabels[Number(a.seatIndex)] = 'Check';
      break;

    case 'PlayerBet': {
      const i = Number(a.seatIndex);
      const lb = Number(a.leadingBet);
      s.leadingBet = lb;
      s.minRaiseIncrement = Number(a.minRaiseIncrement);
      // A bet is only legal when this street has no chips in front of anyone.
      // Drop leftover amounts from the previous street, then record the bet.
      s.seatCurrentBets = (s.seatCurrentBets || []).map(() => 0);
      s.myCurrentBet = 0;
      _putBet(s, i, { chips: Number(a.chips), currentBet: lb, label: 'Bet' });
      if (s.myContractSeat === i) s.myCurrentBet = lb;
      break;
    }

    case 'PlayerCalled': {
      const i = Number(a.seatIndex);
      const remaining = Number(a.chips);
      const allInCall = !!a.isAllIn || remaining === 0;
      _putBet(s, i, {
        chips: remaining,
        currentBet: s.leadingBet,
        label: allInCall ? 'All-In' : 'Call',
        allIn: allInCall,
      });
      if (allInCall) s.canActCount = Math.max(0, s.canActCount - 1);
      break;
    }

    case 'PlayerRaised': {
      const i = Number(a.seatIndex);
      const lb = Number(a.leadingBet);
      s.leadingBet = lb;
      s.minRaiseIncrement = Number(a.minRaiseIncrement);
      _putBet(s, i, { chips: Number(a.chips), currentBet: lb, label: 'Raise' });
      break;
    }

    case 'PlayerWentAllInShortStacked': {
      const i = Number(a.seatIndex);
      _putBet(s, i, { chips: 0, currentBet: Number(a.currentBet), label: 'All-In', allIn: true });
      s.canActCount = Math.max(0, s.canActCount - 1);
      break;
    }

    case 'PlayerWentAllInAndRaisedFull': {
      const i = Number(a.seatIndex);
      const lb = Number(a.leadingBet);
      s.leadingBet = lb;
      s.minRaiseIncrement = Number(a.minRaiseIncrement);
      _putBet(s, i, { chips: 0, currentBet: lb, label: 'All-In', allIn: true });
      s.canActCount = Math.max(0, s.canActCount - 1);
      break;
    }

    case 'PlayerWentAllInAndRaisedNotFull': {
      const i = Number(a.seatIndex);
      const lb = Number(a.leadingBet);
      s.leadingBet = lb;
      _putBet(s, i, { chips: 0, currentBet: lb, label: 'All-In', allIn: true });
      s.canActCount = Math.max(0, s.canActCount - 1);
      break;
    }

    default:
      break;
  }
}

export function sortLogs(logs) {
  return [...logs].sort((a, b) => {
    const bd = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
    if (bd) return bd;
    const td = Number((a.transactionIndex ?? 0) - (b.transactionIndex ?? 0));
    if (td) return td;
    return Number((a.logIndex ?? 0) - (b.logIndex ?? 0));
  });
}
