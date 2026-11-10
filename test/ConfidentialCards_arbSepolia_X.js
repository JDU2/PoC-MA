const { expect } = require("chai");
const hre = require("hardhat");

const CARDS_NEEDED = 17; // set to 9-17 in steps of 2, which corresponds to 2-6 players * 2 hole cards + 5 board cards
const NETWORK = "arbitrum-sepolia";
const CHAIN_ID = 421614n;

function fmtMs(ms) {
  return `${ms.toFixed(0)} ms`;
}

function fmtGwei(wei) {
  return `${ethers.formatUnits(wei, "gwei")} gwei`;
}

function fmtEth(wei) {
  return `${ethers.formatEther(wei)} ETH`;
}

async function gasLimitForShuffle(contract) {
  const block = await ethers.provider.getBlock("latest");
  const cap = (block.gasLimit * 90n) / 100n;
  try {
    const est = await contract.encryptedCardShuffle.estimateGas(CARDS_NEEDED);
    const buffered = (est * 120n) / 100n;
    return buffered < cap ? buffered : cap;
  } catch {
    return cap;
  }
}

function l1FeeFromRaw(raw) {
  if (raw?.l1Fee) return BigInt(raw.l1Fee);
  return 0n;
}

describe(`Test_ConfidentialCardsLib.encryptedCardShuffle(${CARDS_NEEDED}) on Arbitrum Sepolia`, function () {
  this.timeout(600_000);

  before(function () {
    if (hre.network.name !== NETWORK) this.skip();
  });

  it(`deploys the wrapper, shuffles ${CARDS_NEEDED} cards, and reports timing + gas`, async function () {
    const [signer] = await ethers.getSigners();
    const net = await ethers.provider.getNetwork();
    expect(net.chainId, "wrong chain").to.equal(CHAIN_ID);

    const factory = await ethers.getContractFactory("Test_ConfidentialCardsLib");

    // --- deploy ---
    const balBeforeDeploy = await ethers.provider.getBalance(signer.address);
    const tDeploy0 = performance.now();
    const contract = await factory.deploy();
    const deployReceipt = await contract.deploymentTransaction().wait();
    const tDeploy1 = performance.now();
    const balAfterDeploy = await ethers.provider.getBalance(signer.address);

    expect(deployReceipt.status).to.equal(1);
    const address = await contract.getAddress();
    const deployRaw = await ethers.provider.send("eth_getTransactionReceipt", [deployReceipt.hash]);
    const deployL1Fee = l1FeeFromRaw(deployRaw);
    const deployPaid = balBeforeDeploy - balAfterDeploy;
    const deployGasPrice = deployReceipt.gasPrice ?? 0n;

    console.log("\n  === deploy Test_ConfidentialCardsLib ===");
    console.log(`  address:           ${address}`);
    console.log(`  tx:                ${deployReceipt.hash}`);
    console.log(`  wall time:         ${fmtMs(tDeploy1 - tDeploy0)}`);
    console.log(`  gasUsed:           ${deployReceipt.gasUsed}`);
    console.log(`  effectiveGasPrice: ${fmtGwei(deployGasPrice)}`);
    console.log(`  L2 fee:            ${fmtEth(deployReceipt.gasUsed * deployGasPrice)}`);
    if (deployL1Fee) console.log(`  L1 fee:            ${fmtEth(deployL1Fee)}`);
    console.log(`  ETH spent:         ${fmtEth(deployPaid)}`);

    // --- shuffle ---
    const gasLimit = await gasLimitForShuffle(contract);
    const balBeforeShuffle = await ethers.provider.getBalance(signer.address);

    const tSend0 = performance.now();
    let tx;
    try {
      tx = await contract.encryptedCardShuffle(CARDS_NEEDED, { gasLimit });
    } catch (e) {
      expect.fail(`encryptedCardShuffle(${CARDS_NEEDED}) send failed: ${e.message?.slice(0, 400)}`);
    }
    const tSend1 = performance.now();

    const tWait0 = performance.now();
    const receipt = await tx.wait();
    const tWait1 = performance.now();
    const balAfterShuffle = await ethers.provider.getBalance(signer.address);

    expect(receipt.status, "shuffle tx failed").to.equal(1);

    const parsed = receipt.logs
      .map((l) => {
        try {
          return contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "Shuffled");
    expect(parsed, "Shuffled event not found").to.exist;

    const ctHashes = parsed.args.cards;
    expect(ctHashes.length, "wrong array length").to.equal(CARDS_NEEDED);
    for (const h of ctHashes) {
      expect(h, "zero ctHash").to.not.equal(ethers.ZeroHash);
    }

    const shuffleRaw = await ethers.provider.send("eth_getTransactionReceipt", [receipt.hash]);
    const shuffleL1Fee = l1FeeFromRaw(shuffleRaw);
    const shufflePaid = balBeforeShuffle - balAfterShuffle;
    const shuffleGasPrice = receipt.gasPrice ?? 0n;
    const sendMs = tSend1 - tSend0;
    const waitMs = tWait1 - tWait0;
    const shuffleMs = tWait1 - tSend0;

    console.log(`\n  === encryptedCardShuffle(${CARDS_NEEDED}) ===`);
    console.log(`  tx:                ${receipt.hash}`);
    console.log(`  gasLimit used:     ${gasLimit}`);
    console.log(`  send time:         ${fmtMs(sendMs)}`);
    console.log(`  confirm time:      ${fmtMs(waitMs)}`);
    console.log(`  wall time (total): ${fmtMs(shuffleMs)}`);
    console.log(`  gasUsed:           ${receipt.gasUsed}`);
    console.log(`  effectiveGasPrice: ${fmtGwei(shuffleGasPrice)}`);
    console.log(`  L2 fee:            ${fmtEth(receipt.gasUsed * shuffleGasPrice)}`);
    if (shuffleL1Fee) console.log(`  L1 fee:            ${fmtEth(shuffleL1Fee)}`);
    console.log(`  ETH spent:         ${fmtEth(shufflePaid)}`);
    console.log(`  ctHashes (${ctHashes.length}):`);
    ctHashes.forEach((h, i) => console.log(`    [${i}] ${h}`));

    console.log("\n  === summary ===");
    console.log(`  deploy:  ${fmtMs(tDeploy1 - tDeploy0)}, gasUsed=${deployReceipt.gasUsed}, cost=${fmtEth(deployPaid)}`);
    console.log(`  shuffle: ${fmtMs(shuffleMs)}, gasUsed=${receipt.gasUsed}, cost=${fmtEth(shufflePaid)}`);
    console.log(`  total:   ${fmtMs(tDeploy1 - tDeploy0 + shuffleMs)}, cost=${fmtEth(deployPaid + shufflePaid)}`);
  });
});
