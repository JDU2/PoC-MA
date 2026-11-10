// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Texas Hold'em Poker: Showdown Hand Evaluator
///
/// @dev Contains: 
///      - Library "ShowdownHandEvaluatorLib"
///      - Wrapper Contract "Test_ShowdownHandEvaluatorLib" (only for testing the library independently)
///
///      Call "evaluateAll()" once per showdown to find the best 5-of-7 card hand for all players involved.
///      It returns an array of integer scores representing each player's best hand.
///      Higher score means stronger hand. 
///
///      Score packing — 6 nibbles (24 bits), read left to right:
///
///      nibble 5   bit index 23-20   hand category    (0-8: high card - straight flush)
///      nibble 4   bit index 19-16   primary rank     (used for all hand categories)
///      nibble 3   bit index 15-12   secondary rank   (only used where needed)
///      nibble 2   bit index 11-8    third rank       (only used where needed)
///      nibble 1   bit index 7-4     fourth rank      (only used where needed)
///      nibble 0   bit index 3-0     fifth rank       (only used where needed)
///
///      Ranks are raw card values (2-14), where 11 = Jack, 12 = Queen, 13 = King, 14 = Ace. 
///      All ranks fit safely in one nibble (Hex: 0x2 … 0xE).
///
///      Suits have no inherent value. Encoded as: 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades.
///      All suits are treated as equally strong (i.e. no tie breakers) and are only used for flush detection.
///
///      Cards arrive in the form of card positions (0-51) of the ordered deck.
///      The rank and suit of a card are derived from its position.
///
///      Card positions in the ordered deck: 
///
///      0-3:     2♣, 2♦, 2♥, 2♠ 
///      4-7:     3♣, 3♦, 3♥, 3♠ 
///      8-11:    4♣, 4♦, 4♥, 4♠ 
///      12-15:   5♣, 5♦, 5♥, 5♠ 
///      16-19:   6♣, 6♦, 6♥, 6♠ 
///      20-23:   7♣, 7♦, 7♥, 7♠ 
///      24-27:   8♣, 8♦, 8♥, 8♠ 
///      28-31:   9♣, 9♦, 9♥, 9♠ 
///      32-35:   T♣, T♦, T♥, T♠ 
///      36-39:   J♣, J♦, J♥, J♠ 
///      40-43:   Q♣, Q♦, Q♥, Q♠ 
///      44-47:   K♣, K♦, K♥, K♠ 
///      48-51:   A♣, A♦, A♥, A♠

library ShowdownHandEvaluatorLib {

    // ── Hand categories (from strongest to weakest) ────────────────────────────────────────────────────

    uint256 internal constant STRAIGHT_FLUSH = 8; // five consecutive card ranks in the same suit
    uint256 internal constant QUADS          = 7; // four of a kind (same rank)
    uint256 internal constant FULL_HOUSE     = 6; // three of a kind and one pair (distinct ranks)
    uint256 internal constant FLUSH          = 5; // five cards in the same suit
    uint256 internal constant STRAIGHT       = 4; // five consecutive card ranks
    uint256 internal constant TRIPS          = 3; // three of a kind (same rank)
    uint256 internal constant TWO_PAIR       = 2; // two pairs (distinct ranks)
    uint256 internal constant ONE_PAIR       = 1; // one pair (same rank)
    uint256 internal constant HIGH_CARD      = 0; // just the 5 highest out of 7 card ranks

    // ── Entry point for showdown hand evaluation ──────────────────────────────────
    //
    //    "evaluateAll()" encodes the board state once, then evaluates every non-folded player's hand for the showdown.
    //    Returns an array of integer scores of each player's best hand, where higher score means stronger hand.
    //
    //    - decryptedCards — array containing the 5 board cards followed by the 2 hole cards of each non-folded player (in seat order).
    //    - seatHasFolded — array of boolean values indicating if a player has folded (true) or not (false).
    //    - seatScores (returns) — array of integer scores of each player's best hand.

    function evaluateAll(uint8[] memory decryptedCards, bool[] memory seatHasFolded)
        internal pure returns (uint256[] memory seatScores) {
            
        uint256 rank; uint256 suit; // board card variables
        uint256 bRPS; uint256 bSC; uint256 bFS = 4; // board state variables
        uint256 n = seatHasFolded.length; // number of seats
        seatScores = new uint256[](n); // scores per seat     

        // ── Phase 1: Board state encoding ───────────────────────────────────────────────────
        //
        //    Encodes the 5 board cards once into three packed integers
        //    to be reused for all subsequent per-player evaluations:
        //
        //  - bRPS (boardRanksPerSuit) — four 15-bit rank-presence windows starting at bit indices (suit × 15).
        //      Bit index (suit × 15 + rank) is set when that suit holds that rank.
        //      Example: K♥ (rank = 13, suit = 2) sets bit index (2 × 15 + 13) = 43.
        //  - bSC (boardSuitCounter) — four 3-bit suit-counter windows starting at bit indices (suit × 3).
        //  - bFS (boardFlushSuit) — holds the suit index (0-3) if all 5 board cards share that suit; 4 if not.  

        unchecked {
            for (uint256 i; i < 5; i++) { // board cards (0-2: flop, 3: turn, 4: river)
                rank = decryptedCards[i] / 4 + 2; // derive rank from card position (0-51) of the ordered deck
                suit = decryptedCards[i] % 4; // derive suit from card position (0-51) of the ordered deck
                bRPS |= uint256(1) << (suit * 15 + rank); // we use "OR" to set the bit index representing the rank
                bSC += uint256(1) << (suit * 3); // increment the suit-counter by 1 for that suit
            }    
            if (((bSC >> (suit * 3)) & 5) == 5) {
                bFS = suit; // if the suit count reaches 5 for the suit of the river card, then set the flush suit 
            }
        
            // ── Phase 2: Per-player hand evaluation ───────────────────────────────────────────
            //
            //    Evaluates 5-of-7-cards hands per player, then returns the scores array:

            uint256 indexPointer = 5;
            for (uint256 i; i < n; i++) {
                if (seatHasFolded[i]) continue; // skip folded players
                seatScores[i] = evaluateHand(bRPS, bSC, bFS, [decryptedCards[indexPointer++], decryptedCards[indexPointer++]]);
            }
        }
    }

    // ── Per-player hand evaluation ───────────────────────────────────────────────
    //
    //    "evaluateHand()" integrates a player's two hole cards into the encoded board state, 
    //    then finds the best possible 5-of-7-cards hand and returns its score.
    //
    //    - bRPS, bSC, bFS — board state variables from "phase 1" of evaluateAll().
    //    - holeRanks — array of 2 hole card ranks of a player.
    //    - holeSuits — array of 2 hole card suits of a player.
    //    - score (returns) — The best possible 5-card hand score out of 7 cards (5 board cards + 2 hole cards).

    function evaluateHand(uint256 bRPS, uint256 bSC, uint256 bFS, uint8[2] memory holeCards) 
        private pure returns (uint256 score) {

        uint256 rank; uint256 suit; // hole card variables
        uint256 ranksPerSuit = bRPS; // will be used for evaluating hand categories that don't involve a flush
        uint256 suitCounter  = bSC; // only used for flush detection
        uint256 flushSuit    = bFS; // only used for flush detection
        
        unchecked {   
            // integrate the player's two hole cards into the encoded board state 
            for (uint256 i; i < 2; i++) {
                rank = holeCards[i] / 4 + 2; // derive rank from card position (0-51) of the ordered deck
                suit = holeCards[i] % 4; // derive suit from card position (0-51) of the ordered deck
                ranksPerSuit |= uint256(1) << (suit * 15 + rank);
                suitCounter  += uint256(1) << (suit * 3);
                // if still no flush suit found (4) and suit count reaches 5 for current suit, then set the flush suit
                if (flushSuit == 4 && ((suitCounter >> (suit * 3)) & 5) == 5) flushSuit = suit;
            }
        }

        // ── Flush detected? ─────────────────────────────────────────────────────────
        //
        //    At this point we know if a flush is present (flushSuit < 4) or not (flushSuit = 4). 
        //    Whenever a flush is present, it is impossible for quads or full houses (trips + pair) 
        //    to coexist within the same 7 cards. That allows us to skip the encoding process below.

        // ── Card combinations encoding ──────────────────────────────────────────────
        //
        //    This is the final encoding step before the hand evaluation process.
        //    (All encoding processes within this library simplify and speed up the hand evaluation process.)
        //
        //    For the ranks present in all 7 cards (5 board cards + 2 hole cards) encode:
        //
        //    - allRanks — bitmask of all ranks present.
        //    - quads    — bitmask for the rank of quads present.
        //    - trips    — bitmask for the ranks of trips present.
        //    - pairs    — bitmask for the ranks of pairs present.
        //    - singles  — bitmask for the ranks of singles present.

        uint256 allRanks; uint256 quads; uint256 trips; uint256 pairs; uint256 singles; // card combinations variables          
 
        // If no flush is present ...
        if (flushSuit == 4) {

            // Extract the four 15-bit rank-presence windows from ranksPerSuit
            uint256 r0 =  ranksPerSuit        & 0x7FFF; // ranks in clubs
            uint256 r1 = (ranksPerSuit >> 15) & 0x7FFF; // ranks in diamonds
            uint256 r2 = (ranksPerSuit >> 30) & 0x7FFF; // ranks in hearts
            uint256 r3 = (ranksPerSuit >> 45) & 0x7FFF; // ranks in spades

            uint256 r0_AND_r1 = r0 & r1; // bitwise AND
            uint256 r2_AND_r3 = r2 & r3; // bitwise AND

            uint256 r0_OR_r1 = r0 | r1; // bitwise OR
            uint256 r2_OR_r3 = r2 | r3; // bitwise OR

            allRanks = r0_OR_r1 | r2_OR_r3; // rank-presence mask for all ranks

            quads = r0_AND_r1 & r2_AND_r3; // rank that appears exactly 4 times   

            // the 4 AND-combinations for atLeast3: (r0 & r1 & r2) | (r0 & r1 & r3) | (r0 & r2 & r3) | (r1 & r2 & r3) 
            // can be simplified to:
            uint256 atLeast3 = (r0_AND_r1 & r2_OR_r3) | (r0_OR_r1 & r2_AND_r3); // ranks that appear at least 3 times

            trips = atLeast3 ^ quads; // ranks that appear exactly 3 times. XOR excludes quads.

            // the 6 AND-combinations for atLeast2: (r0 & r1) | (r0 & r2) | (r0 & r3) | (r1 & r2) | (r1 & r3) | (r2 & r3)
            // can be simplified to:
            uint256 atLeast2 = r0_AND_r1 | (r0_OR_r1 & r2_OR_r3) | r2_AND_r3; // ranks that appear at least 2 times

            pairs = atLeast2 ^ atLeast3; // ranks that appear exactly 2 times. XOR excludes atLeast3.
            singles = allRanks ^ atLeast2; // ranks that appear exactly once. XOR excludes atLeast2.
        }

        // ── Begin hand evaluation steps ─────────────────────────────────────────────
        //
        //    The steps are executed in decreasing order of strength, starting with the strongest hand category.
        //    As soon as a hand category is found, the evaluation stops and the score is returned.
        //
        //    1. straight flush
        //    2. quads
        //    3. full house
        //    4. flush
        //    5. straight
        //    6. trips
        //    7. two pair
        //    8. one pair
        //    9. high card

        // ── Step 1: Straight flush ────────────────────────────────────────────────
        //
        //    Extract the flush suit's 15-bit window from ranksPerSuit and run straight detection on it. 
        //    Only the top card rank of the straight flush influences the resulting score.
        //    If no straight is found within the flush, it skips step 2 and 3 and continues with step 4 (Flush).

        uint256 flushMask; // bitmask for the card ranks in the flush suit (5-7 ranks)

        if (flushSuit < 4) {
            unchecked { flushMask = (ranksPerSuit >> (flushSuit * 15)) & 0x7FFF; } // extract the ranks for the flush
            uint256 sfRank = straightTop(flushMask); // detect straight and its top card rank
            if (sfRank != 0) {
                unchecked { return (STRAIGHT_FLUSH << 20) | (sfRank << 16); } // return score as packed integer
            }
        }

        // ── Step 2: Quads ───────────────────────────────────────────────────────
        //
        //    "msb(quads)" gives the quads rank. The kicker card's rank is the highest 
        //    remaining rank within allRanks after masking out the quads rank's bit index.

        if (quads != 0) {
            uint256 qRank = msb(quads); // determine quads rank
            uint256 kRank = msb(allRanks ^ quads); // determine kicker rank (XOR excludes quads)
            unchecked { return (QUADS << 20) | (qRank << 16) | (kRank << 12); } // return score as packed integer
        }

        // ── Step 3: Full house ────────────────────────────────────────────────────
        //
        //    "msb(trips)" gives the highest trips rank. "msb(pairs)" gives the highest pair rank.
        //    Special case: If the trips mask contains two trips, the lower trips rank becomes
        //    the pair rank for the full house.

        uint256 tRank; // highest trips rank

        if (trips != 0) {
            tRank = msb(trips); // determine highest trips rank
            if (pairs != 0) {
                // normal case (eliminates special case, since no pair can coexist with two trips in 7 cards)
                // return score as packed integer
                unchecked { return (FULL_HOUSE << 20) | (tRank << 16) | (msb(pairs) << 12); } 
            }
            uint256 reducedTripsMask = trips ^ (uint256(1) << tRank); // XOR excludes highest trips rank
            if (reducedTripsMask != 0) {
                // special case: two trips // return score as packed integer
                unchecked { return (FULL_HOUSE << 20) | (tRank << 16) | (msb(reducedTripsMask) << 12); } 
            }
        }

        // ── Step 4: Flush ─────────────────────────────────────────────────────────
        //
        //    If a flush is present, then the flush mask has already been set in step 1.  
        //    "top5Packed()" extracts the highest 5 ranks from the flush mask (can hold up to 7 ranks).

        if (flushSuit < 4) {
            unchecked { return (FLUSH << 20) | top5Packed(flushMask); } // return score as packed integer
        }

        // ── Step 5: Straight ──────────────────────────────────────────────────────
        //
        //    Run straight detection on all ranks present.
        //    Only the top card rank of the straight influences the resulting score.

        uint256 sRank = straightTop(allRanks); // detect straight and its top card rank
        if (sRank != 0) {
            unchecked { return (STRAIGHT << 20) | (sRank << 16); } // return score as packed integer
        }

        // ── Step 6: Trips ───────────────────────────────────────────────────────
        //
        //    If trips are present, then the trips rank ("tRank") has already been determined in step 3.
        //    The two highest kickers come from singles.

        if (trips != 0) {
            uint256 kRank1st = msb(singles); // determine 1st kicker rank (highest single rank)
            // determine 2nd kicker rank (second highest single rank)
            uint256 kRank2nd = msb(singles ^ (uint256(1) << kRank1st)); 
            // return score as packed integer
            unchecked { return (TRIPS << 20) | (tRank << 16) | (kRank1st << 12) | (kRank2nd << 8); } 
        }

        // ── Step 7: Two pair ──────────────────────────────────────────────────────
        //
        //    Determine the two highest pair ranks. The kicker is the highest rank from singles.
        //    Special case: If the pairs mask contains three pairs, then the lowest pair rank
        //    becomes the kicker rank, if it's higher than the singles rank.

        if (pairs != 0) {
            uint256 pRank1st = msb(pairs); // determine highest pair rank
            uint256 reducedPairMask = pairs ^ (uint256(1) << pRank1st); // XOR removes highest pair rank 
            if (reducedPairMask != 0) {
                uint256 pRank2nd = msb(reducedPairMask); // determine second highest pair rank
                // determine kicker rank (covers special case)
                uint256 kRank = msb(singles | (reducedPairMask ^ (uint256(1) << pRank2nd))); 
                // return score as packed integer
                unchecked { return (TWO_PAIR << 20) | (pRank1st << 16) | (pRank2nd << 12) | (kRank << 8); } 
            }

            // ── Step 8: One pair ──────────────────────────────────────────────────
            //
            //    Only one pair is present ("pRank1st", determined in previous step). 
            //    The three highest kickers come from singles.

            uint256 kRank1st = msb(singles); // determine 1st kicker rank (highest single rank)
            uint256 reducedSinglesMask = singles ^ (uint256(1) << kRank1st); // XOR removes highest single rank
            uint256 kRank2nd = msb(reducedSinglesMask); // determine 2nd kicker rank (second highest single rank)
            // determine 3rd kicker rank (third highest single rank)
            uint256 kRank3rd = msb(reducedSinglesMask ^ (uint256(1) << kRank2nd)); 
            // return score as packed integer
            unchecked { 
                return (ONE_PAIR << 20) | (pRank1st << 16) | (kRank1st << 12) | (kRank2nd << 8) | (kRank3rd << 4);
            }
        }

        // ── Step 9: High card ────────────────────────────────────────────────────
        //
        //    No combination was found. Use the five highest ranks out of the 7 ranks present.

        unchecked { return (HIGH_CARD << 20) | top5Packed(allRanks); } // return score as packed integer
    }



    // ── Bitmanipulation helpers ──────────────────────────────────────────────────────
    //
    //    "msb(rpm)" finds the highest set bit index "r" of a rank-presence mask "rpm" via 4-step binary search.
    //    It searches in the lowest 16 bits (0-15) of "rpm" (sufficient, since highest rank (Ace) is at bit index 14).
    //    "r" starts with 0. Each step asks "is the most significant bit (MSB) in the upper half of "rpm"?. 
    //    If "yes", it adds the number of bits of the lower half of "rpm" to "r" and then shifts these bits away
    //    (which get cut off by right shift). If "no", it just moves on to the next step.
    //
    //    Example in binary format:  rpm = 0b_0010_0000_0001_1000  (with bit indices 13 (King), 4, 3 set)
    //    step 1:  rpm >= 0b_1_0000_0000 (bit index 8 set) ?  YES  →  r = 8,  rpm >>= 8,  rpm = 0b_0010_0000
    //    step 2:  rpm >= 0b_1_0000 (bit index 4 set) ?  YES  →  r = 12,  rpm >>= 4,  rpm = 0b_0010
    //    step 3:  rpm >= 0b_100 (bit index 2 set) ?  NO 
    //    step 4:  rpm == 0b_10 (bit index 1 set) ?  YES  →  r = 13

    function msb(uint256 rpm) private pure returns (uint256 r) {
        unchecked {
            if (rpm >= 0x100) { r += 8; rpm >>= 8; } // MSB in bit index 15 ... 8 of rpm? (upper half of 16 bits)
            if (rpm >= 0x010) { r += 4; rpm >>= 4; } // MSB in bit index 7 ... 4 of rpm? (upper half of 8 bits)
            if (rpm >= 0x004) { r += 2; rpm >>= 2; } // MSB in bit index 3 ... 2 of rpm? (upper half of 4 bits)
            if (rpm == 0x002) { r += 1; }            // MSB in bit index 1 of rpm? (upper half of 2 bits)
        }
    }

    //    "straightTop(rpm)" detects if a rank-presence mask "rpm" contains a 5-card straight, 
    //    and returns the top card rank of the strongest straight found, or 0 if none.
    //    Used for straight flush and straight detection. "rpm" can contain up to 7 distinct ranks.
    // 
    //    It uses bitwise AND on "rpm" with itself shifted right by 1, 2, 3, and 4 positions.
    //    Bit index "r" survives all four ANDs only when bits r, r+1, r+2, r+3, r+4 are all set in "rpm".
    //    The highest surviving "r" is the bottom rank of the best 5-card straight and the top rank is r+4.
    //
    //    Example 1: (7 ranks present, 5 ranks connected) — (A-K-J-T-9-8-7) (bit indices 14, 13, 11-7 set):
    //
    //        rpm       = 0b_0110_1111_1000_0000
    //        rpm >> 1  = 0b_0011_0111_1100_0000
    //        rpm >> 2  = 0b_0001_1011_1110_0000
    //        rpm >> 3  = 0b_0000_1101_1111_0000
    //        rpm >> 4  = 0b_0000_0110_1111_1000
    //                    ──────────────────────
    //        "AND" all = 0b_0000_0000_1000_0000 = s  (bit index 7 alone survives all four ANDs)
    // 
    //        straight bottom rank = msb(s) = 7  →  top rank = 7 + 4 = 11 ("Jack-high straight").
    // 
    //    Example 2: (7 ranks present, 7 ranks connected) — (8-7-6-5-4-3-2) (bit indices 8-2 set):
    // 
    //        "AND" all = 0b_0000_0000_0001_1100 = s  (bit indices 4, 3, 2 survive all four ANDs)
    //                                                
    //        straight bottom rank = msb(s) = 4  →  top rank = 4 + 4 = 8 ("Eight-high straight").
    // 
    //    Special case: "The Wheel" (A-2-3-4-5), Top rank = 5 (Ace is seen as rank 1)
    //         
    //        Ace at bit index 14 won't connect via the shift trick, so we check this case
    //        separately if s == 0, by using AND with mask 0x403C (bit indices 14, 5, 4, 3, 2 set).   
    
    function straightTop(uint256 rpm) private pure returns (uint256) {
        // determine straight bottom rank mask "s"
        uint256 s = rpm & (rpm >> 1) & (rpm >> 2) & (rpm >> 3) & (rpm >> 4); 
        if (s != 0) {
            unchecked { return msb(s) + 4; } // determine and return straight top rank
        }
        if ((rpm & 0x403C) == 0x403C) return 5; // check special case: "The Wheel" (A-2-3-4-5)
        return 0; // no straight found
    }

    //    "top5Packed(rpm)" extracts the five highest rank values from a rank-presence mask "rpm", 
    //    then returns them as one integer packed for the score layout (r4 = highest rank, r0 = lowest rank).
    //    It lowers the bit index "r" continously and checks with AND whether "r" is set in "rpm".
    //
    //    Example: (A-K-J-9-7-4-2):
    //      r4 = 14 (A)  
    //      r3 = 13 (K)  
    //      r2 = 11 (J)  
    //      r1 = 9  
    //      r0 = 7  
    
    function top5Packed(uint256 rpm) private pure returns (uint256 packedTop5) {
        uint256 r = 15;
        unchecked {
            do { --r; } while (rpm & (uint256(1) << r) == 0); // search for r4
            packedTop5 |= r << 16; // pack r4 for score
            do { --r; } while (rpm & (uint256(1) << r) == 0); // search for r3
            packedTop5 |= r << 12; // pack r3 for score
            do { --r; } while (rpm & (uint256(1) << r) == 0); // search for r2
            packedTop5 |= r << 8; // pack r2 for score
            do { --r; } while (rpm & (uint256(1) << r) == 0); // search for r1
            packedTop5 |= r << 4; // pack r1 for score
            do { --r; } while (rpm & (uint256(1) << r) == 0); // search for r0
            packedTop5 |= r; // pack r0 for score
        }
    }
}

/// @dev Deployable wrapper contract around "ShowdownHandEvaluatorLib" only for testing purposes.
///      Since the library cannot be deployed independently (only imported by other contracts),  
///      this contract allows testing "evaluateAll()" directly via external function calls.
///      Production contracts import the library directly and never call this wrapper contract.

contract Test_ShowdownHandEvaluatorLib {

    function evaluateAll(uint8[] calldata decryptedCards, bool[] calldata seatHasFolded) 
        external pure returns (uint256[] memory seatScores) {
            
        seatScores = ShowdownHandEvaluatorLib.evaluateAll(decryptedCards, seatHasFolded);
    }
}
