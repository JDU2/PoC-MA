const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { FheTypes } = require("@cofhe/sdk");

const TX_GAS_LIMIT = 80_000_000;

const SessionState = {
  WaitingForHostToStartTheTournament: 2,
  InProgress: 3,
};

const HandState = {
  PreflopBetting: 2,
  Showdown: 6,
};

const PlayerAction = { All_In: 5 };

const PROCESS_SHOWDOWN_TOPIC = ethers.id("ProcessShowdown()");
const TOURNAMENT_ENDED_TOPIC = ethers.id("TournamentEnded(uint16,uint256,address,uint16)");

const RANKS = "xx23456789TJQKA";
const SUITS = ["♣", "♦", "♥", "♠"];
const fmt = (id) => RANKS[Math.floor(id / 4) + 2] + SUITS[id % 4];
const fmtHand = (ids) => ids.map(fmt).join(" ");

async function decryptView(client, handle) {
  return Number(await client.decryptForView(handle, FheTypes.Uint8).execute());
}

async function decryptTx(client, handle) {
  const r = await client.decryptForTx(handle).withoutPermit().execute();
  return { value: Number(r.decryptedValue), sig: r.signature };
}

describe("PokerTournamentMain.startTournament", function () {
  this.timeout(600_000);

  it("start, decrypt hole cards, both all-in, decrypt board, processShowdown, end tournament", async function () {
    const [owner, player2] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("PokerTournamentMain");
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const startTime = (await time.latest()) + 60;
    await contract.createTournament(startTime, 2, 50, 5, 10);

    await contract.addPlayerToWhitelist(owner.address);
    await contract.addPlayerToWhitelist(player2.address);
    await contract.joinTournamentTable();
    await contract.connect(player2).joinTournamentTable();

    expect((await contract.t_meta()).s_state).to.equal(SessionState.WaitingForHostToStartTheTournament);

    await time.increaseTo(startTime);

    let receipt;
    try {
      const tx = await contract.startTournament({ gasLimit: TX_GAS_LIMIT });
      receipt = await tx.wait();
    } catch (e) {
      expect.fail(`startTournament reverted: ${e.message?.slice(0, 400)}`);
    }

    expect(receipt.status).to.equal(1);

    let meta = await contract.t_meta();
    expect(meta.s_state).to.equal(SessionState.InProgress);
    expect(meta.h_state).to.equal(HandState.PreflopBetting);
    expect(meta.handCounter).to.equal(1);
    console.log(`\n  startTournament gasUsed=${receipt.gasUsed}`);

    const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
    const p2Client = await hre.cofhe.createClientWithBatteries(player2);

    const ownerHoles = await contract.getMyEncryptedHoleCards();
    const p2Holes = await contract.connect(player2).getMyEncryptedHoleCards();

    const ownerHoleCards = [await decryptView(ownerClient, ownerHoles[0]), await decryptView(ownerClient, ownerHoles[1])];
    const p2HoleCards = [await decryptView(p2Client, p2Holes[0]), await decryptView(p2Client, p2Holes[1])];

    console.log(`  owner hole cards (decryptForView): ${fmtHand(ownerHoleCards)}  [${ownerHoleCards.join(", ")}]`);
    console.log(`  p2    hole cards (decryptForView): ${fmtHand(p2HoleCards)}  [${p2HoleCards.join(", ")}]`);

    for (const v of [...ownerHoleCards, ...p2HoleCards]) expect(v).to.be.gte(0).and.lte(51);

    // Heads-up: button (seat 0 / owner) acts first. Remaining chips after blinds: SB 9950, BB 9900.
    await contract.playerAction(PlayerAction.All_In, 9950);
    const allIn2 = await contract.connect(player2).playerAction(PlayerAction.All_In, 9900);
    const allIn2Receipt = await allIn2.wait();
    expect(
      allIn2Receipt.logs.some((l) => l.topics[0] === PROCESS_SHOWDOWN_TOPIC),
      "ProcessShowdown event missing"
    ).to.equal(true);

    meta = await contract.t_meta();
    expect(meta.h_state).to.equal(HandState.Showdown);

    const boardHandles = await Promise.all([0, 1, 2, 3, 4].map((i) => contract.encryptedBoardCards(i)));

    const ownerBoard = await Promise.all(boardHandles.map((h) => decryptTx(ownerClient, h)));
    const p2Board = await Promise.all(boardHandles.map((h) => decryptView(p2Client, h)));

    const ownerBoardVals = ownerBoard.map((c) => c.value);
    console.log(`  owner board (decryptForTx):  ${fmtHand(ownerBoardVals)}  [${ownerBoardVals.join(", ")}]`);
    console.log(`  p2    board (decryptForView): ${fmtHand(p2Board)}  [${p2Board.join(", ")}]`);

    expect(p2Board).to.deep.equal(ownerBoardVals);
    for (const v of ownerBoardVals) expect(v).to.be.gte(0).and.lte(51);
    expect(new Set([...ownerHoleCards, ...p2HoleCards, ...ownerBoardVals]).size).to.equal(9);
    for (const c of ownerBoard) expect(c.sig).to.match(/^0x[0-9a-fA-F]+$/);

    await (await contract.getEncryptedHoleCardsOfShowdownParticipants()).wait();
    const sdpHandles = [
      await contract.encryptedHoleCardsOf(owner.address, 0),
      await contract.encryptedHoleCardsOf(owner.address, 1),
      await contract.encryptedHoleCardsOf(player2.address, 0),
      await contract.encryptedHoleCardsOf(player2.address, 1),
    ];
    const sdp = await Promise.all(sdpHandles.map((h) => decryptTx(ownerClient, h)));
    const sdpVals = sdp.map((c) => c.value);
    console.log(`  owner SDP hole cards (decryptForTx): ${fmtHand(sdpVals)}  [${sdpVals.join(", ")}]`);
    expect(sdpVals).to.deep.equal([...ownerHoleCards, ...p2HoleCards]);

    const encryptedCards = [...boardHandles, ...sdpHandles];
    const decryptedCards = [...ownerBoardVals, ...sdpVals];
    const signatures = [...ownerBoard.map((c) => c.sig), ...sdp.map((c) => c.sig)];

    let showdownReceipt;
    try {
      const tx = await contract.processShowdown(encryptedCards, decryptedCards, signatures, {
        gasLimit: TX_GAS_LIMIT,
      });
      showdownReceipt = await tx.wait();
    } catch (e) {
      expect.fail(`processShowdown reverted: ${e.message?.slice(0, 400)}`);
    }

    const endedLog = showdownReceipt.logs.find((l) => l.topics[0] === TOURNAMENT_ENDED_TOPIC);
    expect(endedLog, "TournamentEnded event missing").to.exist;
    const ended = contract.interface.parseLog(endedLog);
    console.log(`  processShowdown gasUsed=${showdownReceipt.gasUsed}, winner=${ended.args.winner}`);

    expect(await contract.remainingPlayerCount()).to.equal(0);
    expect((await contract.t_meta()).s_state).to.equal(0);
    expect(await contract.tournamentsCompleted()).to.equal(1);
    expect([owner.address, player2.address]).to.include(ended.args.winner);
  });
});
