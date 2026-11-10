const { expect } = require("chai");
const { mock_getPlaintext } = require("@cofhe/hardhat-plugin");

// topic0 of Shuffled(bytes32[]) — used to find the event in the receipt
const SHUFFLED_EVENT_SIG = ethers.id("Shuffled(bytes32[])");

// eth_estimateGas is capped at ~16M (EIP-7825). Override so n=17 can run.
// n=9 used ~25M; n=17 is expected well above that.
const TX_GAS_LIMIT = 80_000_000;

// Deploy a fresh wrapper, shuffle n cards, return ctHashes from the committed tx.
async function runShuffle(n) {
  const factory = await ethers.getContractFactory("Test_ConfidentialCardsLib");
  const contract = await factory.deploy();

  // Transaction (not staticCall) so mock storage is written and mock_getPlaintext works.
  const tx = await contract.encryptedCardShuffle(n, { gasLimit: TX_GAS_LIMIT });
  const receipt = await tx.wait();

  // Return values are not in the receipt; ctHashes come from the Shuffled event.
  const log = receipt.logs.find((l) => l.topics[0] === SHUFFLED_EVENT_SIG);
  if (!log) throw new Error("Shuffled event not found in receipt");

  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["bytes32[]"], log.data);
  return { ctHashes: decoded[0], gasUsed: receipt.gasUsed };
}

describe("Test_ConfidentialCardsLib (with cardsNeeded 9-17 in steps of 2, which translates to 2-6 players * 2 hole cards + 5 board cards)", function () {
  for (const n of [9, 11, 13, 15, 17]) {
    it(`encryptedCardShuffle(${n})`, async function () {
      const [signer] = await ethers.getSigners();

      let ctHashes, gasUsed;
      try {
        ({ ctHashes, gasUsed } = await runShuffle(n));
      } catch (e) {
        expect.fail(`encryptedCardShuffle(${n}) reverted: ${e.message?.slice(0, 200)}`);
      }

      expect(ctHashes.length, "wrong array length").to.equal(n);

      // Decrypt each ciphertext hash via the CoFHE mock storage.
      const plaintexts = await Promise.all(
        ctHashes.map((h) => mock_getPlaintext(signer.provider, h))
      );
      const cards = plaintexts.map(Number);
      console.log(`\n  n=${n}, gasUsed=${gasUsed}, card positions: [${cards.join(", ")}]`);

      // Each card must be a valid deck index and all must be unique.
      for (const v of cards) expect(v).to.be.gte(0).and.lte(51);
      expect(new Set(cards).size, "cards not unique").to.equal(n);
      console.log("  All card positions are within bounds (0-51) and are unique ✔");
    });
  }
});
