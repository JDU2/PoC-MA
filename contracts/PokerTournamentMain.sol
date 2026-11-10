// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@fhenixprotocol/cofhe-contracts/FHE.sol"; // fhenix CoFHE library
import {ConfidentialCardsLib} from "./ConfidentialCards.sol"; // internal library
import {ShowdownHandEvaluatorLib} from "./ShowdownHandEvaluator.sol"; // internal library
import {TournamentManager} from "./TournamentManager.sol"; // abstract contract
import {ConfidentialCards} from "./ConfidentialCards.sol"; // abstract contract
import {PotSettlementAndBeyond} from "./PotSettlementAndBeyond.sol"; // abstract contract

/// @title Texas Hold'em Poker Tournaments (for 2-6 players)

// This is the main contract that inherits from all other contracts, which includes what they inherit as well (i.e. "StorageLayout.sol")
contract PokerTournamentMain is TournamentManager, ConfidentialCards, PotSettlementAndBeyond {
    
    // ─── External View Functions ──────────────────────────────────────────────────

    // Number of players currently sitting at the tournament table
    function remainingPlayerCount() external view returns (uint256) {
        return playerInSeat.length;
    }

    // Seat position of a player currently sitting at the tournament table
    function seatOfPlayer(address player) external view returns (uint256) {
        if (!sitsAtTheTournamentTable[player]) revert PlayerNotAtTheTournamentTable();
        return seatOf[player];
    }

    // ─── Tournament Start ──────────────────────────────────────────────

    // The contract owner starts the tournament after start time is reached
    function startTournament() external onlyOwner {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.s_state == SessionState.Blank) revert NoTournamentScheduled();
        if (t.s_state == SessionState.WaitingForMinAmountOfPlayersToJoin) revert NotEnoughPlayersJoined();
        if (t.s_state == SessionState.InProgress) revert TournamentAlreadyInProgress();
        if (block.timestamp < t.scheduledStartTime) revert StartTimeNotReached();
        t.s_state = SessionState.InProgress;
        emit TournamentStarted(block.timestamp); // actual start time
        emit SessionStateUpdated(SessionState.InProgress);
        preflopSetup(); // start the first hand
    }

    // ─── Preflop Setup ──────────────────────────────────────────────────────────────

    // Post blinds and mark who must act, then shuffle deck and deal encrypted hole cards
    function preflopSetup() internal {
        TournamentMeta storage t = t_meta; // storage pointer
        unchecked {
            uint24 bigBlind = t.smallBlind * 2;
            // Double the blinds after every "handsPerBlindDoubling" hands
            if (bigBlind < t.startingChips && t.handCounter > 0 && t.handCounter % t.handsPerBlindDoubling == 0) {
                bigBlind = (bigBlind * 2 > t.startingChips ? t.startingChips : bigBlind * 2); // cap big blind at starting chips
                t.smallBlind = bigBlind / 2; // BB is always divisible by 2
                emit BlindsIncreased(t.smallBlind);
            }
            uint256 n = playerInSeat.length; // number of playerInSeat of remaining players at the table
            uint256 button = t.buttonIndex; // seat position of the dealer button
            uint256 sbSeat = n == 2 ? button : (button + 1) % n; // seat position of the small blind
            uint256 bbSeat = (sbSeat + 1) % n; // seat position of the big blind
            t.canActCount = uint8(n);
            t.foldedCount = 0;
            // Reset player attributes related to previous hand and post the blinds
            for (uint256 i = 0; i < n; i++) {
                PlayerMeta storage p = playerInSeat[i]; // storage pointer
                p.currentBet = 0;
                p.handContribution = 0;
                p.hasFolded = false;
                p.isAllIn = false;
                if (i == sbSeat) {
                    commitChips(p, (p.chips < t.smallBlind ? p.chips : t.smallBlind)); // post small blind
                    emit SmallBlindPosted(uint8(i), p.chips, p.currentBet, p.isAllIn);
                }
                if (i == bbSeat) {
                    commitChips(p, (p.chips < bigBlind ? p.chips : bigBlind)); // post big blind
                    emit BigBlindPosted(uint8(i), p.chips, p.currentBet, p.isAllIn);
                }
            }
            t.mustActCount = t.canActCount; // all players who still can act must act (depends on short-stacked SB/BB cases)
            t.leadingBet = bigBlind; // the big blind defines the opening bet (even when BB seat is short-stacked)
            t.minRaiseIncrement = bigBlind; // the big blind defines the initial minimum raise increment
            t.seatInAction = uint8(n == 2 ? button : (button + 3) % n); // the seat after the big blind is the first to act
            emit SeatInActionUpdated(t.seatInAction);
            shuffleDealAndStoreEncryptedCards(button);
            t.handCounter++;
        }
        t.h_state = HandState.PreflopBetting;
        emit HandStateUpdated(HandState.PreflopBetting);
    }

    // ─── Player Actions ───────────────────────────────────────────────────────────

    // Player takes action: fold / check / bet / call / raise / all-in
    function playerAction(PlayerAction action, uint24 amount) external {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.h_state < HandState.PreflopBetting || t.h_state > HandState.RiverBetting) revert NotInBettingPhase();
        uint8 from = t.seatInAction;
        PlayerMeta storage actor = playerInSeat[from]; // storage pointer
        if (actor.hasFolded || actor.isAllIn) revert CannotAct();
        if (actor.addr != msg.sender) revert NotYourTurn();
        unchecked {
            // FOLD
            if (action == PlayerAction.Fold) {
                actor.currentBet = 0; // reset current bet
                actor.hasFolded = true; // set folded flag
                t.foldedCount++;
                t.canActCount--;
                emit PlayerFolded(from);
            } 
            // CHECK
            else if (action == PlayerAction.Check) {
                if (actor.currentBet != t.leadingBet) revert CannotCheckWhenLeadingBetIsUnmatched();
                emit PlayerChecked(from);
            } 
            // BET
            else if (action == PlayerAction.Bet) {
                if (t.leadingBet != 0) revert CannotBetWhenLeadingBetIsPresent();
                if (amount < t.minRaiseIncrement) revert BetBelowMinimum();
                if (amount >= actor.chips) revert CannotBetEverythingOrMoreThanYouHave();
                commitChips(actor, amount);
                t.minRaiseIncrement = amount;
                t.leadingBet = amount;
                t.mustActCount = t.canActCount; // reopen the action
                emit PlayerBet(from, actor.chips, t.leadingBet, t.minRaiseIncrement);
            }            
            // CALL
            else if (action == PlayerAction.Call) {
                if (t.leadingBet == 0) revert CannotCallWhenNoBetIsPresent();
                uint24 amountToCall = t.leadingBet - actor.currentBet;
                if (amount != amountToCall) revert InvalidCallAmount();
                if (actor.chips < amountToCall) revert CannotCallForMoreThanYouHave();
                commitChips(actor, amountToCall); // all-in calls can happen if "amountToCall" equals "actor.chips"
                emit PlayerCalled(from, actor.chips, actor.isAllIn);
            } 
            // RAISE (to "amount", not by "amount")
            else if (action == PlayerAction.Raise) {
                if (t.canActCount == 1) revert CannotRaiseWhenNoOneElseCanAct();
                uint24 raiseIncrement = amount - actor.currentBet;
                if (raiseIncrement < t.minRaiseIncrement) revert RaiseBelowMinimum();
                if (raiseIncrement >= actor.chips) revert CannotRaiseToAllInOrByMoreThanYouHave();
                commitChips(actor, raiseIncrement); // thereby "actor.currentBet" updates to "amount"
                t.minRaiseIncrement = actor.currentBet - t.leadingBet;
                t.leadingBet = actor.currentBet;
                t.mustActCount = t.canActCount; // reopen the action
                emit PlayerRaised(from, actor.chips, t.leadingBet, t.minRaiseIncrement);
            } 
            // ALL-IN
            else if (action == PlayerAction.All_In) {
                if (t.canActCount == 1 && actor.chips > t.leadingBet - actor.currentBet) revert CannotGoAllInWhenNoOneElseCanMatchIt();
                if (amount != actor.chips) revert InvalidAllInAmount();
                commitChips(actor, actor.chips); // thereby actor gets removed from "canActCount"
                if (actor.currentBet >= t.leadingBet + t.minRaiseIncrement) {
                    t.minRaiseIncrement = actor.currentBet - t.leadingBet; // update minRaiseIncrement first
                    t.leadingBet = actor.currentBet; // then update leadingBet
                    t.mustActCount = t.canActCount; // reopen the action. "mustActCount" already accounts for the actor in this case.
                    emit PlayerWentAllInAndRaisedFull(from, t.leadingBet, t.minRaiseIncrement);
                }
                else if (actor.currentBet > t.leadingBet) {
                    t.leadingBet = actor.currentBet;
                    t.mustActCount = t.canActCount; // reopen the action. "mustActCount" already accounts for the actor in this case.
                    emit PlayerWentAllInAndRaisedNotFull(from, t.leadingBet);
                } 
                else {
                    t.mustActCount--; // remove actor from "mustActCount"
                    emit PlayerWentAllInShortStacked(from, actor.currentBet);
                }
            }
            // UNIDENTIFIED ACTION
            else revert InvalidActionIdentifier();

            if (action != PlayerAction.All_In) t.mustActCount--; // remove actor from "mustActCount". all-in is handled separately.
            advanceAfterAction(from);
        } 
    }  

    // ─── Betting ───────────────────────────────────────────────────────────────

    // Move chips from stack into pot and update hand contribution
    function commitChips(PlayerMeta storage p, uint24 amount) internal {
        TournamentMeta storage t = t_meta; // storage pointer
        unchecked {
            p.chips -= amount;
            if (p.chips == 0) {
                p.isAllIn = true; // set all-in flag 
                t.canActCount--; // remove actor from "canActCount"
            }
            p.currentBet += amount;
            p.handContribution += amount;
            t.pot += amount;
        }
        emit PotUpdated(t.pot);
    }

    // ─── After Player Action ───────────────────────────────────────────────────────

    // Check for fold-win, check for betting round closure, and set the next seat in action
    function advanceAfterAction(uint256 from) internal {
        TournamentMeta storage t = t_meta; // storage pointer
        uint256 n = playerInSeat.length;
        unchecked {
            // in case of fold-win (only one player remains in the hand, everyone else folded)
            if (t.foldedCount == n - 1) {
                for (uint256 i = 0; i < n; i++) {
                    PlayerMeta storage p = playerInSeat[i]; // storage pointer
                    if (p.hasFolded) continue;
                    p.chips += t.pot; // award the pot to the winner (no showdown process required)
                    emit PlayerChipsUpdated(uint8(i), p.chips, t.pot);
                    break;
                }
                t.pot = 0; // reset pot
                emit PotUpdated(0);
                t.buttonIndex = uint8((t.buttonIndex + 1) % n); // rotate the button
                nextBreakOrNextHand(); // either starts next break or setup of the next hand
                return;
            }
            // if no player owes an action in the current betting round
            if (t.mustActCount == 0) {
                if (t.canActCount < 2) runOutBoardAndMoveToShowdown(); // run out the board cards and move to showdown
                else if (advanceHandState()) setUpNextBettingRound(); // true: set up next betting round, false: move to showdown
                emit HandStateUpdated(t.h_state);
            } 
            // otherwise, set the next seat in action for the current betting round
            else {
                t.seatInAction = uint8(nextActingSeat((from + 1) % n));
                emit SeatInActionUpdated(t.seatInAction);
            }
        }
    }

    // Initiate the next tournament break or begin with the setup of the next hand
    function nextBreakOrNextHand() internal {
        TournamentMeta storage t = t_meta; // storage pointer
        t.h_state = HandState.PreflopSetup;
        emit HandStateUpdated(HandState.PreflopSetup);
        // pause the tournament after every "handsPerTournamentBreak" hands
        if (t.handCounter % t.handsPerTournamentBreak == 0) {
            t.s_state = SessionState.Paused; 
            emit SessionStateUpdated(SessionState.Paused);
        }
        else preflopSetup(); // begin with setup of next hand
    }

    // Set up the next betting round (flop, turn, or river betting)
    function setUpNextBettingRound() internal {
        uint256 n = playerInSeat.length;
        TournamentMeta storage t = t_meta; // storage pointer
        t.mustActCount = t.canActCount; // all players who still can act must act
        t.leadingBet = 0; // reset leading bet
        unchecked {
            t.minRaiseIncrement = t.smallBlind * 2; // reset to default value
            t.seatInAction = uint8(nextActingSeat((t.buttonIndex + 1) % n));
            emit SeatInActionUpdated(t.seatInAction);
            for (uint256 i = 0; i < n; i++) {
                PlayerMeta storage p = playerInSeat[i]; // storage pointer
                if (p.hasFolded) continue;
                p.currentBet = 0; // reset current bet
            }
        }
    }

    // First seat at or after "start" that still can act
    function nextActingSeat(uint256 start) internal view returns (uint256) {
        uint256 n = playerInSeat.length;
        unchecked {
            for (uint256 step = 0; step < n; step++) {
                uint256 seat = (start + step) % n;
                PlayerMeta storage p = playerInSeat[seat]; // storage pointer
                if (p.hasFolded || p.isAllIn) continue;
                return seat;
            }
        }
        revert NoNextActingSeat();
    }

    // ─── Showdown ────────────────────────────────────────────────────────────

    // The contract owner calls this function after decrypting (off-chain) the cards (board cards and hole cards of the non-folded remaining players)
    // It verifies the decryption results, evaluates the hands, and distributes the pot (or side pots) to the winner(s)
    function processShowdown(euint8[] calldata encryptedCards, uint8[] calldata decryptedCards, bytes[] calldata signatures) external onlyOwner {

        TournamentMeta storage t = t_meta; // storage pointer
        if (t.h_state != HandState.Showdown) revert NotInShowdownPhase();
        
        bool[] memory seatHasFolded = verifyDecryptionResultsForShowdown(encryptedCards, decryptedCards, signatures);

        uint256[] memory seatScores = ShowdownHandEvaluatorLib.evaluateAll(decryptedCards, seatHasFolded);

        settlePot(seatScores); // determines the pot layers and awards them to the winner(s)

        if (advanceAfterPotSettlement()) nextBreakOrNextHand(); // either starts next break or setup of the next hand, if more than one player remains
        else endTournament(); // ends the tournament if only one player (tournament winner) remains
    }

    // ─── After Break ──────────────────────────────────────────────────────────────────

    // The contract owner resumes the tournament after the break (default: 5 minutes)
    function resumeAfterBreak() external onlyOwner {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.s_state != SessionState.Paused) revert TournamentNotPaused();
        t.s_state = SessionState.InProgress;
        emit SessionStateUpdated(SessionState.InProgress);
        preflopSetup(); // begin with setup of next hand
    }

    // ─── Regular End of Tournament ───────────────────────────────────────────────────────

    // Declare the winner and duration of the tournament and reset data entries
    function endTournament() internal {
        address winner = playerInSeat[0].addr; // always at index 0 after removing seats of busted players
        emit TournamentEnded(++tournamentsCompleted, block.timestamp, winner, t_meta.handCounter);
        delete seatOf[winner]; // delete remaining mapping entry
        delete sitsAtTheTournamentTable[winner]; // delete remaining mapping entry
        delete encryptedHoleCardsOf[winner]; // delete remaining mapping entry
        delete playerInSeat; // delete all array elements
        delete t_meta; // delete all struct properties
    }    

}
