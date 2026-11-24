require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Compile with the solc-js bundled in node_modules so no compiler download is needed.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === require("solc/package.json").version) {
    return {
      compilerPath: path.join(path.dirname(require.resolve("solc/package.json")), "soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: args.solcVersion,
    };
  }
  return runSuper();
});

const pick = (k) => (process.env[k] ? [process.env[k]] : []);

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts: [
        ...pick("ADMIN_KEY"),
        ...pick("OPERATOR_A_KEY"),
        ...pick("OPERATOR_B_KEY"),
        ...pick("SCREENER_KEY"),
      ],
    },
  },
};
