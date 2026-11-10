// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StorageLayout} from "./StorageLayout.sol";

/// @title Texas Hold'em Poker: Tournament Manager

abstract contract TournamentManager is StorageLayout {

    // The contract owner allows an address to register for tournaments
    function addPlayerToWhitelist(address player) external onlyOwner {
        if (isWhitelisted[player]) revert AlreadyWhitelisted();
        isWhitelisted[player] = true;
    }

    // The contract owner revokes an existing whitelist entry
    function removePlayerFromWhitelist(address player) external onlyOwner {
        if (!isWhitelisted[player]) revert NotWhitelisted();
        isWhitelisted[player] = false;
    }

    // The contract owner schedules a tournament by specifying the start time, maximum number of seats, small blind, and hands per blind doubling
    function createTournament(uint256 startTime, uint256 maxSeats, uint256 sb, uint256 hPBD, uint256 hPTB) external onlyOwner {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.s_state != SessionState.Blank) revert TournamentAlreadyScheduledOrInProgress();
        if (startTime <= block.timestamp) revert InvalidStartTime();
        if (maxSeats < 2 || maxSeats > 6) revert InvalidMaxSeats();
        if (sb == 0 || sb < 50 || sb > 5000) revert InvalidSmallBlind();
        if (hPBD < 5 || hPBD > 20) revert InvalidHandsPerBlindDoubling();
        if (hPTB < 10 || hPTB > 100) revert InvalidHandsPerTournamentBreak();
        t.scheduledStartTime = uint32(startTime); // UNIX time in seconds
        t.maxSeats = uint8(maxSeats);
        t.startingChips = uint24(2 * sb * 100); // 100 big blinds (min: 10k, max: 1M)
        t.smallBlind = uint24(sb);
        t.handsPerBlindDoubling = uint8(hPBD); // amount of hands before the blinds double in value
        t.handsPerTournamentBreak = uint8(hPTB); // amount of hands before the tournament is paused for a break
        t.buttonIndex = 0; // dealer button starting position
        t.s_state = SessionState.WaitingForMinAmountOfPlayersToJoin;
        emit TournamentCreated(t.scheduledStartTime, t.maxSeats, t.startingChips, t.smallBlind, t.handsPerBlindDoubling, t.handsPerTournamentBreak);
        emit SessionStateUpdated(SessionState.WaitingForMinAmountOfPlayersToJoin);
    }

    // A whitelisted player reserves a seat at the tournament table
    function joinTournamentTable() external {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.s_state == SessionState.Blank) revert NoTournamentScheduled();
        if (t.s_state == SessionState.InProgress) revert TournamentTableClosed();
        if (!isWhitelisted[msg.sender]) revert NotWhitelisted();
        if (sitsAtTheTournamentTable[msg.sender]) revert AlreadyJoined();
        if (playerInSeat.length == t.maxSeats) revert TableFull();
        playerInSeat.push(PlayerMeta({
            addr: msg.sender,
            chips: t.startingChips,
            currentBet: 0,
            handContribution: 0,
            hasFolded: false,
            isAllIn: false
        }));
        uint256 n = playerInSeat.length;
        seatOf[msg.sender] = n - 1;
        sitsAtTheTournamentTable[msg.sender] = true;
        emit PlayerJoinedTournamentTable(msg.sender, uint8(n - 1));
        if (n == 2) {
            t.s_state = SessionState.WaitingForHostToStartTheTournament;
            emit SessionStateUpdated(SessionState.WaitingForHostToStartTheTournament);
        }
    }

    // The contract owner cancels a tournament that has not started yet
    function cancelTournament() external onlyOwner {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.s_state == SessionState.Blank) revert NoTournamentScheduled();
        if (t.s_state == SessionState.InProgress) revert TournamentAlreadyInProgress();
        unchecked {
            for (uint256 i = 0; i < playerInSeat.length; i++) {
                address x = playerInSeat[i].addr;
                delete seatOf[x]; // delete mapping entry
                delete sitsAtTheTournamentTable[x]; // delete mapping entry
            }
        }
        delete playerInSeat; // delete all array elements
        delete t_meta; // delete all struct properties
        emit TournamentCancelled();
    }    

    // The contract owner forces the end of a running tournament
    // Only for emergencies caused by bugs or external circumstances
    function forceEndTournament() external onlyOwner {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.s_state != SessionState.InProgress && t.s_state != SessionState.Paused) revert NoTournamentInProgressOrPaused();
        unchecked {
            for (uint256 i = 0; i < playerInSeat.length; i++) {
                address x = playerInSeat[i].addr;
                delete seatOf[x]; // delete mapping entry
                delete sitsAtTheTournamentTable[x]; // delete mapping entry
                delete encryptedHoleCardsOf[x]; // delete mapping entry
            }
        }
        delete playerInSeat; // delete all array elements
        delete t_meta; // delete all struct properties
        emit TournamentEndForced();    
    }

}    