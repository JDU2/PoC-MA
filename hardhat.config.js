require("@nomicfoundation/hardhat-toolbox");
require("@cofhe/hardhat-plugin");

require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  cofhe: {
    logMocks: true,
  },
  networks: {
    hardhat: {
      blockGasLimit: 100_000_000,
      hardfork: "cancun",
    },
    "arbitrum-sepolia": {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};