// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title Storage Layout for PokerTournamentMain.sol and for all abstract contracts it inherits from

abstract contract StorageLayout {

    // ─── Constants ──────────────────────────────────────────────────────────────

    address public immutable owner; // contract owner (is the tournament host and can take part as a player) 

    // ───  Variables ─────────────────────────────────────────────────────────────

    TournamentMeta public t_meta; // 1 storage slot, instance of the TournamentMeta struct
    uint16 public tournamentsCompleted; // 2 bytes, number of completed tournaments (overflows after 65535)

    // ─── Arrays ──────────────────────────────────────────────────────────────────

    PlayerMeta[] internal playerInSeat; // each seat holds an instance of the PlayerMeta struct   
    euint8[5] public encryptedBoardCards; // encrypted board cards (in form of card positions 0-51 of the ordered deck)

    // ─── Mappings ──────────────────────────────────────────────────────────────

    mapping(address => bool) public isWhitelisted;
    mapping(address => bool) public sitsAtTheTournamentTable;
    mapping(address => uint256) internal seatOf;
    mapping(address => euint8[2]) public encryptedHoleCardsOf;

    // ─── Enums ──────────────────────────────────────────────────────────────────

    enum SessionState {
        Blank,
        WaitingForMinAmountOfPlayersToJoin,
        WaitingForHostToStartTheTournament,
        InProgress,
        Paused
    }
    enum HandState {
        Blank,
        PreflopSetup, // setup of the preflop betting round
        PreflopBetting, // betting round before the flop is dealt
        FlopBetting, // betting round after the flop is dealt
        TurnBetting, // betting round after the turn is dealt
        RiverBetting, // betting round after the river is dealt
        Showdown
    }
    enum PlayerAction { 
        Fold, 
        Check,
        Bet,
        Call, 
        Raise, 
        All_In 
    }

    // ─── Structs ────────────────────────────────────────────────────────────────

    struct TournamentMeta {
        SessionState s_state; // 1 byte, instance of the SessionState enum
        uint8 maxSeats; // 1 byte, maximum number of seats at the table (between 2 and 6)
        uint24 startingChips; // 3 bytes, starting chips for the tournament (between 10k and 1M)
        uint32 scheduledStartTime; // 4 bytes, scheduled start time (UNIX time in seconds, out of bounds in year 2106)
        HandState h_state; // 1 byte, instance of the HandState enum
        uint16 handCounter; // 2 bytes, number of completed hands per tournament (overflows after 65535)
        uint8 handsPerTournamentBreak; // 1 byte, amount of hands before the tournament is paused for a break (between 10 and 100)
        uint8 handsPerBlindDoubling; // 1 byte, amount of hands before the blinds double in value (between 5 and 20)
        uint24 smallBlind; // 3 bytes, small blind amount (between 50 and 5k at start, capped by startingChips / 2)
        uint8 buttonIndex; // 1 byte, seat position of the dealer button 
        uint8 seatInAction; // 1 byte, seat position of the player who must act next 
        uint8 canActCount; // 1 byte, number of players who can still act (not folded and not all-in)
        uint8 mustActCount; // 1 byte, number of players who must act before the current betting round is complete
        uint8 foldedCount; // 1 byte, number of players who have folded the current hand
        uint24 leadingBet; // 3 bytes, current highest total bet within a single betting round
        uint24 minRaiseIncrement; // 3 bytes, current minimum allowed raise increment
        uint24 pot; // 3 bytes, current pot amount (between 0 and startingChips * player count)
    } // 31 bytes total (fits in 1 storage slot, 1 byte unused)

    struct PlayerMeta {
        address addr; // 20 bytes, account address (EOA) of the player
        uint24 chips; // 3 bytes, number of chips (initialized by "startingChips")
        uint24 currentBet; // 3 bytes, current total bet within a single betting round
        uint24 handContribution; // 3 bytes, total amount contributed to the pot of current hand
        bool hasFolded; // 1 byte, flag indicating if the player has folded the current hand
        bool isAllIn; // 1 byte, flag indicating if the player is all-in for the current hand        
    } // 31 bytes total (fits in 1 storage slot, 1 byte unused)

    // ─── Events ───────────────────────────────────────────────────────────────

    // used by PokerTournamentMain.sol:
    event TournamentStarted(uint256 actualStartTime);
    event SessionStateUpdated(SessionState newSessionState);
    event HandStateUpdated(HandState newHandState);
    event BlindsIncreased(uint24 newSmallBlind);
    event SmallBlindPosted(uint8 seatIndex, uint24 chips, uint24 currentBet, bool isAllIn);
    event BigBlindPosted(uint8 seatIndex, uint24 chips, uint24 currentBet, bool isAllIn);
    event SeatInActionUpdated(uint8 newSeatInAction);
    event PlayerFolded(uint8 seatIndex);
    event PlayerChecked(uint8 seatIndex);
    event PlayerBet(uint8 seatIndex, uint24 chips, uint24 leadingBet, uint24 minRaiseIncrement);
    event PlayerCalled(uint8 seatIndex, uint24 chips, bool isAllIn);
    event PlayerRaised(uint8 seatIndex, uint24 chips, uint24 leadingBet, uint24 minRaiseIncrement);
    event PlayerWentAllInAndRaisedFull(uint8 seatIndex, uint24 leadingBet, uint24 minRaiseIncrement);
    event PlayerWentAllInAndRaisedNotFull(uint8 seatIndex, uint24 leadingBet);
    event PlayerWentAllInShortStacked(uint8 seatIndex, uint24 currentBet);
    event PotUpdated(uint24 newPotAmount);
    event PlayerChipsUpdated(uint8 seatIndex, uint24 newChips, uint24 winAmount);
    event TournamentEnded(uint16 completedTournaments, uint256 endTime, address winner, uint16 handCounter);

    // used by TournamentManager.sol:
    event TournamentCreated(uint32 scheduledStartTime, uint8 maxSeats, uint24 startingChips, uint24 smallBlind, uint8 hPBD, uint8 hPTB);
    // event SessionStateUpdated(SessionState newSessionState); defined above
    event PlayerJoinedTournamentTable(address player, uint8 seatIndex);    
    event TournamentCancelled();
    event TournamentEndForced();

    // used by ConfidentialCards.sol:
    event ShowdownHoleCardsDecryptionAllowed();
    event FlopDecryptionAllowed();
    event TurnDecryptionAllowed();
    event RiverDecryptionAllowed();
    event ProcessShowdown();
    event DecryptedHoleCardsOfShowdownParticipant(uint8 seatIndex, uint8 holeCard0, uint8 holeCard1);

    // used by PotSettlementAndBeyond.sol:
    event PlayerChipsUpdatedPlusHandCategory(uint8 seatIndex, uint24 newChips, uint24 winAmount, uint8 handCategory); 
    event PlayerReceivedRemainder(uint8 seatIndex, uint8 remainder);
    // event PotUpdated(uint24 newPotAmount); defined above
    event PlayerBusted(address player);   
    event UpdateSeats(address[] newOrder);
    event HandEnded(uint8 newButtonIndex);

    // ─── Custom Errors ─────────────────────────────────────────────────────────

    // used by PokerTournamentMain.sol:
    error NoTournamentScheduled();
    error NotEnoughPlayersJoined();
    error TournamentAlreadyInProgress();
    error StartTimeNotReached();
    error PlayerNotAtTheTournamentTable();
    error NotInBettingPhase();
    error CannotAct();
    error NotYourTurn();
    error CannotCheckWhenLeadingBetIsUnmatched();
    error CannotBetWhenLeadingBetIsPresent();
    error BetBelowMinimum();
    error CannotBetEverythingOrMoreThanYouHave();    
    error CannotCallWhenNoBetIsPresent();
    error InvalidCallAmount();
    error CannotCallForMoreThanYouHave();
    error CannotRaiseWhenNoOneElseCanAct();
    error RaiseBelowMinimum();
    error CannotRaiseToAllInOrByMoreThanYouHave();
    error CannotGoAllInWhenNoOneElseCanMatchIt();
    error InvalidAllInAmount();
    error InvalidActionIdentifier();
    error NoNextActingSeat();
    error NotInShowdownPhase();
    error TournamentNotPaused();

    // used by TournamentManager.sol:
    error AlreadyWhitelisted();
    error NotWhitelisted();
    error TournamentAlreadyScheduledOrInProgress();
    error InvalidStartTime();
    error InvalidMaxSeats();    
    error InvalidSmallBlind();
    error InvalidHandsPerBlindDoubling();
    error InvalidHandsPerTournamentBreak();
    // error NoTournamentScheduled(); defined above
    error TournamentTableClosed();
    error AlreadyJoined();
    error TableFull();
    // error TournamentAlreadyInProgress(); defined above
    error NoTournamentInProgressOrPaused();

    // used by ConfidentialCards.sol:
    // error NotInShowdownPhase(); defined above
    error InvalidEncryptedBoardCard();
    error InvalidEncryptedHoleCard();

    // used by PotSettlementAndBeyond.sol:
    error TotalShowdownPayoutsDontMatchPotAmount();
 
    // used by modifier onlyOwner():
    error OnlyContractOwnerCanCall();

    // ─── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyContractOwnerCanCall();
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender; // deployer becomes the contract owner
    }    
    
    // ────────────────────────────────────────────────────────────────────────────
}