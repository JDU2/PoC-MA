const { expect } = require("chai");

// rank 2-14, suit 0=♣ 1=♦ 2=♥ 3=♠  →  deck index 0-51
const C = 0, D = 1, H = 2, S = 3;
const RANKS = "xx23456789TJQKA";
const SUITS = ["♣", "♦", "♥", "♠"];
const card = (rank, suit) => (rank - 2) * 4 + suit;
const fmt = (id) => RANKS[Math.floor(id / 4) + 2] + SUITS[id % 4];
const fmtHand = (ids) => ids.map(fmt).join(" ");

const HIGH_CARD = 0;
const ONE_PAIR = 1;
const TWO_PAIR = 2;
const TRIPS = 3;
const STRAIGHT = 4;
const FLUSH = 5;
const FULL_HOUSE = 6;
const QUADS = 7;
const STRAIGHT_FLUSH = 8;

const FOLDED_SEATS = [false, false, true];
const CATEGORY_SHIFT = 20n;

describe("Test_ShowdownHandEvaluatorLib", function () {
  let evaluator;

  before(async function () {
    const factory = await ethers.getContractFactory("Test_ShowdownHandEvaluatorLib");
    evaluator = await factory.deploy();
  });

  async function expectP2WinsSameCategory(decryptedCards, category) {
    expect(decryptedCards).to.have.length(9);
    expect(new Set(decryptedCards).size).to.equal(9);

    const scores = await evaluator.evaluateAll(decryptedCards, FOLDED_SEATS);

    console.log(`\n  board:    ${fmtHand(decryptedCards.slice(0, 5))}`);
    console.log(`  player 1: ${fmtHand(decryptedCards.slice(5, 7))}  score ${scores[0]}`);
    console.log(`  player 2: ${fmtHand(decryptedCards.slice(7, 9))}  score ${scores[1]}`);
    console.log(`  player 3: folded  score ${scores[2]}`);

    expect(scores).to.have.length(3);
    expect(scores[2]).to.equal(0n, "folded seat 3 must score 0");

    const cat1 = scores[0] >> CATEGORY_SHIFT;
    const cat2 = scores[1] >> CATEGORY_SHIFT;
    expect(cat1).to.equal(BigInt(category), "player 1 category");
    expect(cat2).to.equal(BigInt(category), "player 2 category");
    expect(scores[1]).to.be.gt(scores[0], "player 2 must outscore player 1");
  }

  it("1. high card — player 2 stronger", async function () {
    // board 2♣ 3♦ 5♥ 7♠ 9♣
    // P1 4♦ T♥  → T-high    P2 4♥ J♦  → J-high
    await expectP2WinsSameCategory(
      [
        card(2, C), card(3, D), card(5, H), card(7, S), card(9, C),
        card(4, D), card(10, H),
        card(4, H), card(11, D),
      ],
      HIGH_CARD
    );
  });

  it("2. one pair — player 2 stronger", async function () {
    // board 2♣ 3♦ 5♥ 7♠ 9♣
    // P1 9♦ 4♥  → pair 9s, kicker 7    P2 9♥ K♦  → pair 9s, kicker K
    await expectP2WinsSameCategory(
      [
        card(2, C), card(3, D), card(5, H), card(7, S), card(9, C),
        card(9, D), card(4, H),
        card(9, H), card(13, D),
      ],
      ONE_PAIR
    );
  });

  it("3. two pair — player 2 stronger", async function () {
    // board K♣ 7♦ 4♥ 2♠ 9♣
    // P1 K♦ 7♥  → KK 77    P2 K♥ 9♦  → KK 99
    await expectP2WinsSameCategory(
      [
        card(13, C), card(7, D), card(4, H), card(2, S), card(9, C),
        card(13, D), card(7, H),
        card(13, H), card(9, D),
      ],
      TWO_PAIR
    );
  });

  it("4. trips — player 2 stronger", async function () {
    // board 8♣ 8♦ 5♥ 7♠ 2♣
    // P1 8♥ 4♦  → 888, kickers 7 5    P2 8♠ A♦  → 888, kickers A 7
    await expectP2WinsSameCategory(
      [
        card(8, C), card(8, D), card(5, H), card(7, S), card(2, C),
        card(8, H), card(4, D),
        card(8, S), card(14, D),
      ],
      TRIPS
    );
  });

  it("5. straight — player 2 stronger", async function () {
    // board 2♣ 3♦ 4♥ 5♠ 9♣
    // P1 A♦ 7♥  → A-2-3-4-5 (wheel)    P2 6♥ 8♦  → 2-3-4-5-6
    await expectP2WinsSameCategory(
      [
        card(2, C), card(3, D), card(4, H), card(5, S), card(9, C),
        card(14, D), card(7, H),
        card(6, H), card(8, D),
      ],
      STRAIGHT
    );
  });

  it("6. flush — player 2 stronger", async function () {
    // board 2♣ 5♣ 9♣ K♦ 3♥
    // P1 7♣ J♣  → J-high clubs    P2 T♣ A♣  → A-high clubs
    await expectP2WinsSameCategory(
      [
        card(2, C), card(5, C), card(9, C), card(13, D), card(3, H),
        card(7, C), card(11, C),
        card(10, C), card(14, C),
      ],
      FLUSH
    );
  });

  it("7. full house — player 2 stronger", async function () {
    // board 9♣ 9♦ 4♥ 4♠ 2♣
    // P1 4♣ 7♦  → 44499    P2 9♥ 7♣  → 99944
    await expectP2WinsSameCategory(
      [
        card(9, C), card(9, D), card(4, H), card(4, S), card(2, C),
        card(4, C), card(7, D),
        card(9, H), card(7, C),
      ],
      FULL_HOUSE
    );
  });

  it("8. quads — player 2 stronger", async function () {
    // board 9♣ 9♦ 4♥ 4♠ 2♣
    // P1 4♣ 4♦  → 4444    P2 9♥ 9♠  → 9999
    await expectP2WinsSameCategory(
      [
        card(9, C), card(9, D), card(4, H), card(4, S), card(2, C),
        card(4, C), card(4, D),
        card(9, H), card(9, S),
      ],
      QUADS
    );
  });

  it("9. straight flush — player 2 stronger", async function () {
    // board 5♣ 6♣ 7♣ 2♦ 3♥
    // P1 3♣ 4♣  → 3-7 clubs    P2 8♣ 9♣  → 5-9 clubs
    await expectP2WinsSameCategory(
      [
        card(5, C), card(6, C), card(7, C), card(2, D), card(3, H),
        card(3, C), card(4, C),
        card(8, C), card(9, C),
      ],
      STRAIGHT_FLUSH
    );
  });
});
