// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {StorageLayout} from "./StorageLayout.sol";

/// @title Texas Hold'em Confidential Cards Handler
///
/// @dev Contains: 
///      - Library "ConfidentialCardsLib"
///      - Wrapper Contract "Test_ConfidentialCardsLib" (only for testing the library independently)
///      - Abstract Contract "ConfidentialCards"

library ConfidentialCardsLib {

    // Card shuffling algorithm that operates on encrypted values and encrypted branching decisions (fully homomorphic encryption)
    function encryptedCardShuffle(uint256 cardsNeeded) internal returns (euint8[] memory shuffledCards) {

        euint8 cN_enc = FHE.asEuint8(cardsNeeded); // number of cards needed (remaining players * 2 hole cards + 5 board cards)
        euint8 fiftyOne = FHE.asEuint8(51);
        euint8 fiftyTwo = FHE.asEuint8(52);
        ebool collision = FHE.asEbool(false); // meaning duplicate of random card position detected. initialized to "false" for the first draw.
        euint64 one_mask = FHE.asEuint64(1); // bitmask with LSB set to 1 (used for bitwise shifting operations)
        euint64 alreadyChosen_mask = FHE.asEuint64(0); // bitmask of already chosen card positions (bit range 0-51)        
        euint8 selectedCard; // selected card position before rotation. no initialization required.
        euint8 rotation = FHE.rem(FHE.randomEuint8(), fiftyTwo); // secret rotation value modulo 52
        shuffledCards = new euint8[](cardsNeeded); // array to store the encrypted shuffled card positions (returned by the function)

        unchecked {
            for (uint256 i = 0; i < cardsNeeded; i++) {

                euint8 i_enc = FHE.asEuint8(i);
                euint8 randPos = FHE.rem(FHE.randomEuint8(), fiftyTwo); // secret random card position (0 - 255) modulo 52

                // check whether the card position has already been chosen or not. first draw excluded.
                if (i != 0) collision = FHE.asEbool(FHE.and(alreadyChosen_mask, FHE.shl(one_mask, FHE.asEuint64(randPos)))); 

                // simplified logic for last draw, since reserved range is empty (no future draws) and alreadyChosen_mask needs no further update
                if (i == cardsNeeded - 1) selectedCard = FHE.select(collision, i_enc, randPos); // if collision: select i, otherwise select the random position
                else {
                    // check whether the card position is in the reserved range [i+1, cardsNeeded-1], which is reserved for future draws to have an alternative (i)
                    ebool inReservedRange = FHE.and(FHE.gt(randPos, i_enc), FHE.lt(randPos, cN_enc));

                    ebool drawAlternative = FHE.or(collision, inReservedRange); // check whether an alternative draw is needed

                    // if drawAlternative is true: select i, if drawAlternative is false: select the random position
                    selectedCard = FHE.select(drawAlternative, i_enc, randPos);
                        
                    // update the bitmask of already chosen card positions    
                    alreadyChosen_mask = FHE.or(alreadyChosen_mask, FHE.shl(one_mask, FHE.asEuint64(selectedCard)));
                }

                euint8 shiftedCard = FHE.add(selectedCard, rotation); // add the rotation value to the selected card position

                // if shiftedCard is greater than 51, subtract 52 from it, otherwise keep it as is. This replaces the more expensive mod 52 operation.
                shuffledCards[i] = FHE.select(FHE.gt(shiftedCard, fiftyOne), FHE.sub(shiftedCard, fiftyTwo), shiftedCard); 
            }
            
            return shuffledCards; // return the encrypted shuffled card positions
        }
    }
}

/// @dev Deployable wrapper contract around "ConfidentialCardsLib" only for testing purposes.
///      Since the library cannot be deployed independently (only imported by other contracts),  
///      this contract allows testing "encryptedCardShuffle()" directly via external function calls.
///      Production contracts import the library directly and never call this wrapper contract.

contract Test_ConfidentialCardsLib {

    event Shuffled(bytes32[] cards);

    function encryptedCardShuffle(uint256 cardsNeeded) external returns (euint8[] memory result) {
        result = ConfidentialCardsLib.encryptedCardShuffle(cardsNeeded);
        // Emit ctHashes as bytes32[] so the test can retrieve them from the committed tx
        bytes32[] memory raw = new bytes32[](cardsNeeded);
        for (uint256 i = 0; i < cardsNeeded; i++) raw[i] = euint8.unwrap(result[i]);
        emit Shuffled(raw);
    }

}

abstract contract ConfidentialCards is StorageLayout {

    // Get the encrypted hole cards of a player
    function getMyEncryptedHoleCards() external view returns (euint8[2] memory) {
        return encryptedHoleCardsOf[msg.sender];
    }
    
    // The contract owner collects the encrypted hole cards of the showdown participants (not folded)
    // Afterwards, the contract owner decrypts the cards (off-chain with the fhenix SDK client) 
    // and then calls processShowdown() which verifies the decryption results on-chain (including the board cards)
    function getEncryptedHoleCardsOfShowdownParticipants() external onlyOwner returns (euint8[] memory encryptedHoleCards_SDP) {
        if (t_meta.h_state != HandState.Showdown) revert NotInShowdownPhase();
        uint256 n = playerInSeat.length;
        uint256 x;
        unchecked {
            encryptedHoleCards_SDP = new euint8[](2 * n);
            for (uint256 i = 0; i < n; i++) {
                PlayerMeta storage p = playerInSeat[i]; // storage pointer
                if (!p.hasFolded) { // not folded
                    FHE.allowPublic(encryptedHoleCardsOf[p.addr][0]); // allow anyone to decrypt off-chain with the fhenix SDK client
                    encryptedHoleCards_SDP[x++] = encryptedHoleCardsOf[p.addr][0];
                    FHE.allowPublic(encryptedHoleCardsOf[p.addr][1]); // allow anyone to decrypt off-chain with the fhenix SDK client
                    encryptedHoleCards_SDP[x++] = encryptedHoleCardsOf[p.addr][1];
                }
            }
        }
        emit ShowdownHoleCardsDecryptionAllowed();
        return encryptedHoleCards_SDP;
    }

    // Shuffle, deal, and store encrypted cards (2 cards per player, 5 board cards)
    function shuffleDealAndStoreEncryptedCards(uint256 button) internal {
        uint256 n = playerInSeat.length;
        unchecked {
            euint8[] memory encryptedShuffledCards = ConfidentialCardsLib.encryptedCardShuffle(n * 2 + 5); // calls the library
            uint256 sbSeat = (n == 2 ? button : (button + 1) % n); // small blind seat (the starting point for card dealing)
            // deal encrypted hole cards to players
            for (uint256 i = 0; i < 2 * n; i++) {
                euint8 encryptedCard = encryptedShuffledCards[i];
                FHE.allowThis(encryptedCard); // allow the contract to use the encrypted value later
                PlayerMeta storage p = playerInSeat[(sbSeat + i) % n]; // storage pointer
                if (i < n) {
                    FHE.allow(encryptedCard, p.addr); // allow only the player to decrypt its hole card 0 (via fhenix SDK client)
                    encryptedHoleCardsOf[p.addr][0] = encryptedCard; // deal encrypted hole card 0
                } else {
                    FHE.allow(encryptedCard, p.addr); // allow only the player to decrypt its hole card 1 (via fhenix SDK client)
                    encryptedHoleCardsOf[p.addr][1] = encryptedCard; // deal encrypted hole card 1
                }
            }
            // store encrypted board cards
            for (uint256 i = 0; i < 5; i++) {
                euint8 encryptedCard = encryptedShuffledCards[2 * n + i];
                FHE.allowThis(encryptedCard); // allow the contract to use the encrypted value later
                encryptedBoardCards[i] = encryptedCard; // store encrypted board card
            }
        }
    }

    // Allow anyone to decrypt the 3 flop cards (via fhenix SDK client)
    function allowFlopDecryption() internal {
        FHE.allowPublic(encryptedBoardCards[0]);
        FHE.allowPublic(encryptedBoardCards[1]);
        FHE.allowPublic(encryptedBoardCards[2]);
        emit FlopDecryptionAllowed();
    }

    // Allow anyone to decrypt the turn card (via fhenix SDK client)
    function allowTurnDecryption() internal {
        FHE.allowPublic(encryptedBoardCards[3]);
        emit TurnDecryptionAllowed();
    }

    // Allow anyone to decrypt the river card (via fhenix SDK client)
    function allowRiverDecryption() internal {
        FHE.allowPublic(encryptedBoardCards[4]);
        emit RiverDecryptionAllowed();
    }

    // Allow decryption of all remaining board cards, then move to showdown
    function runOutBoardAndMoveToShowdown() internal {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.h_state == HandState.PreflopBetting) {
            allowFlopDecryption();
            allowTurnDecryption();
            allowRiverDecryption();
        } 
        if (t.h_state == HandState.FlopBetting) {
            allowTurnDecryption();
            allowRiverDecryption();
        } 
        if (t.h_state == HandState.TurnBetting) {
            allowRiverDecryption();
        }
        t.h_state = HandState.Showdown;
        emit ProcessShowdown(); // contract owner then verifies card decryption on-chain by calling processShowdown()
    }

    // Preflop → Flop (3 cards) → Turn (1 card) → River (1 card) → Showdown
    function advanceHandState() internal returns (bool) {
        TournamentMeta storage t = t_meta; // storage pointer
        if (t.h_state == HandState.PreflopBetting) {
            allowFlopDecryption();
            t.h_state = HandState.FlopBetting;
        } else if (t.h_state == HandState.FlopBetting) {
            allowTurnDecryption();
            t.h_state = HandState.TurnBetting;
        } else if (t.h_state == HandState.TurnBetting) {
            allowRiverDecryption();
            t.h_state = HandState.RiverBetting;
        } else if (t.h_state == HandState.RiverBetting) {
            t.h_state = HandState.Showdown;
            emit ProcessShowdown(); // contract owner then verifies card decryption on-chain by calling processShowdown()
            return false; // signal to not set up next betting phase
        }
        return true; // signal to set up next betting phase
    }    

    // Verifies the batched decryption results for the showdown (for board cards and hole cards of non-folded players)
    function verifyDecryptionResultsForShowdown(euint8[] memory encryptedCards, uint8[] memory decryptedCards, bytes[] memory signatures) 
        internal returns (bool[] memory seatHasFolded) {
        
        FHE.verifyDecryptResultBatch(encryptedCards, decryptedCards, signatures); // reverts if the batch result is invalid
        unchecked {
            // verify integrity of the encrypted board cards (i.e. input values must match storage values)
            for (uint256 i = 0; i < 5; i++) {
                // unwrapping (euint -> uint) allows direct comparison
                if (FHE.unwrap(encryptedCards[i]) != FHE.unwrap(encryptedBoardCards[i])) revert InvalidEncryptedBoardCard();
            }
            uint256 n = playerInSeat.length;
            uint256 indexPointer = 5;
            seatHasFolded = new bool[](n);
            // verify integrity of the encrypted hole cards of the showdown participants (i.e. input values must match storage values)
            // and emit the decrypted hole cards for the showdown display in the UI
            for (uint256 i = 0; i < n; i++) {
                PlayerMeta storage p = playerInSeat[i]; // storage pointer
                if (!p.hasFolded) { // not folded
                    euint8[2] storage eHC = encryptedHoleCardsOf[p.addr]; // storage pointer
                    // unwrapping (euint -> uint) allows direct comparison
                    if (FHE.unwrap(encryptedCards[indexPointer]) != FHE.unwrap(eHC[0])) revert InvalidEncryptedHoleCard();
                    if (FHE.unwrap(encryptedCards[indexPointer+1]) != FHE.unwrap(eHC[1])) revert InvalidEncryptedHoleCard();
                    emit DecryptedHoleCardsOfShowdownParticipant(uint8(i), decryptedCards[indexPointer], decryptedCards[indexPointer+1]);
                    indexPointer += 2;
                } 
                else seatHasFolded[i] = true;
            }
        }
        return seatHasFolded; // for further usage in processShowdown()
    }

}

