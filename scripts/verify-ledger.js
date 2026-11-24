// Standalone auditor. Trusts nothing except the chain's logs.
//   RPC_URL=https://sepolia.base.org CONTRACT=0x... FROM_BLOCK=123456 node scripts/verify-ledger.js
// or, with a deployments file:  NETWORK=baseSepolia node scripts/verify-ledger.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { replayLedger } = require("../lib/ledger");

(async () => {
  const net = process.env.NETWORK || "baseSepolia";
  const depFile = path.join(__dirname, "..", "deployments", `${net}.json`);
  const dep = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : {};
  const rpc = process.env.RPC_URL || process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
  const address = process.env.CONTRACT || dep.address;
  const fromBlock = Number(process.env.FROM_BLOCK ?? dep.deployBlock ?? 0);
  if (!address) { console.error("Set CONTRACT or create deployments/<network>.json"); process.exit(2); }

  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "abi", "SkyPact.json"), "utf8"));
  const provider = new ethers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(address, abi, provider);
  const report = await replayLedger(contract, fromBlock);

  console.log(`Contract   ${address}`);
  console.log(`Entries    ${report.entries}`);
  console.log(`Replayed   ${report.head}`);
  console.log(`On-chain   ${report.onChainHead}`);
  if (report.ok) console.log("RESULT     PASS: every digest and link recomputed from raw logs, head matches.");
  else { console.log("RESULT     FAIL"); report.problems.forEach((p) => console.log("  - " + p)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
