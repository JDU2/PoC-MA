// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StorageLayout} from "./StorageLayout.sol";

/// @title Texas Hold'em Poker: Pot Settlement and Beyond

abstract contract PotSettlementAndBeyond is StorageLayout {

    // Determines the pot layer(s) and winner(s) of the showdown, then distributes the payouts
    function settlePot(uint256[] memory seatScores) internal {
        uint256 n = playerInSeat.length;
        TournamentMeta storage t = t_meta; // storage pointer
        uint256 bI = t.buttonIndex;
        uint256 totalPayouts;
        uint256 prevT;
        unchecked {
            // optimized for most common case: one pot layer (i.e. no side pots), and one winner (i.e. no split pots)
            for (uint256 layer = 0; layer < n; layer++) {
                uint256 nextT = type(uint256).max;
                // find next contribution threshold (ascending order) for new pot layer 
                for (uint256 i = 0; i < n; i++) {
                    PlayerMeta storage p = playerInSeat[i]; // storage pointer
                    if (p.handContribution > prevT && p.handContribution < nextT)
                        nextT = p.handContribution;
                }
                if (nextT == type(uint256).max) break; // break loop if no further pot layer exists
                uint256 contributionCount;
                uint256 bestScore = 1; // greater than 0, but cannot be matched by any score
                uint256 winnerMask;
                uint256 winnerCount;
                // count layer contributions and find winner(s)
                for (uint256 i = 0; i < n; i++) {
                    if (playerInSeat[i].handContribution < nextT) continue;
                    contributionCount++;
                    uint256 score = seatScores[i];
                    if (score > bestScore) { 
                        bestScore = score; // update current best score
                        winnerMask = (1 << i); // resets winner mask
                        winnerCount = 1; // reset winner count
                    } else if (score == bestScore) { 
                        winnerMask |= (1 << i); // adds to winner mask
                        winnerCount++; // increment winner count
                    }
                }
                uint256 layerAmount = (nextT - prevT) * contributionCount; // in chips
                uint24 share = uint24(layerAmount / winnerCount); // share per winner of pot layer
                uint8 remainder = uint8(layerAmount % winnerCount); // value between 0 and winnerCount - 1 
                bool payOutRemainder = (remainder > 0); // true if remainder exists
                // pay the winner(s) of the pot layer
                // the winner seat next to the button (clockwise) will receive the remainder
                for (uint256 i = bI; i < bI + n; i++) {
                    if ((winnerMask & (1 << (i % n))) == 0) continue;
                    PlayerMeta storage p = playerInSeat[i % n]; // storage pointer
                    p.chips += share;
                    totalPayouts += share;
                    emit PlayerChipsUpdatedPlusHandCategory(uint8(i % n), p.chips, share, uint8(seatScores[i % n] >> 20));
                    if (payOutRemainder) {
                        p.chips += remainder;
                        totalPayouts += remainder;
                        emit PlayerReceivedRemainder(uint8(i % n), remainder);
                        payOutRemainder = false;
                    }
                }
                prevT = nextT;
            }    
        }
        if (totalPayouts != t.pot) revert TotalShowdownPayoutsDontMatchPotAmount();    
        t.pot = 0; // reset pot
        emit PotUpdated(0);
    }


    // Pot settled: rotate button, remove busted players, then end tournament or begin next hand
    function advanceAfterPotSettlement() internal returns (bool) {
        uint256 n = playerInSeat.length;
        TournamentMeta storage t = t_meta; // storage pointer
        address newButtonPlayer; // must be determined before removing busted players
        unchecked {
            uint256 start = (t.buttonIndex + 1) % n; // starting point for new button position
            // find the first seat that still has chips at or after "start"
            for (uint256 i = 0; i < n; i++) {
                uint256 x = (start + i) % n;
                PlayerMeta storage p = playerInSeat[x]; // storage pointer
                if (p.chips > 0) {
                    newButtonPlayer = p.addr; // determine the new button player
                    break;
                }
            }
            // if at least one player went all-in, try to remove busted players and update seat order
            if (t.canActCount < n - t.foldedCount) { 
                removeSeatsOfBustedPlayers();
                uint256 new_n = playerInSeat.length;
                if (new_n == 1) {
                    return false; // signal to end the tournament
                }
                if (new_n != n) {
                    address[] memory newOrder = new address[](new_n);
                    for (uint256 i = 0; i < new_n; i++) newOrder[i] = playerInSeat[i].addr;
                    emit UpdateSeats(newOrder);
                }
            }
        }
        t.buttonIndex = uint8(seatOf[newButtonPlayer]); // update button position
        emit HandEnded(t.buttonIndex);
        return true; // signal to set up the next hand
    }

    // Remove seats of busted players (those with no chips left)
    function removeSeatsOfBustedPlayers() internal {
        uint256 write = 0;
        unchecked {
            for (uint256 read = 0; read < playerInSeat.length; read++) {
                PlayerMeta storage p = playerInSeat[read]; // storage pointer
                if (p.chips > 0) {
                    if (write != read) {
                        playerInSeat[write] = p; // assign player to new seat
                        seatOf[p.addr] = write; // update mapping
                    }
                    write++;
                } else {
                    delete seatOf[p.addr]; // delete mapping entry
                    delete sitsAtTheTournamentTable[p.addr]; // delete mapping entry
                    delete encryptedHoleCardsOf[p.addr]; // delete mapping entry
                    emit PlayerBusted(p.addr);
                }
            }
            while (playerInSeat.length > write) playerInSeat.pop(); // truncate playerInSeat array
        }
    }    

}