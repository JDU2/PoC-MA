// Deploy PokerTournamentMain (bash / Linux).
//
// Local (Hardhat + mock CoFHE):
//   Terminal 1:  npx hardhat node
//   Terminal 2:  npx hardhat run scripts/deploy.js --network localhost
//
// Arbitrum Sepolia (real CoFHE testnet) — needs .env: PRIVATE_KEY
//   (ARBITRUM_SEPOLIA_RPC_URL optional; defaults to the public Arbitrum RPC)
//   npx hardhat run scripts/deploy.js --network arbitrum-sepolia
//
// After deploy, paste the printed address into client/public/js/contract.js (CONTRACT_ADDRESS).

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const PokerTournamentMain = await hre.ethers.getContractFactory("PokerTournamentMain");
  const contract = await PokerTournamentMain.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("PokerTournamentMain deployed to:", address);
  console.log("Network:", hre.network.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
