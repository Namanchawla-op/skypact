// npx hardhat run scripts/deploy.js --network baseSepolia
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const { ethers, network, artifacts } = hre;
  const [deployer] = await ethers.getSigners();
  const minPhase = Number(process.env.MIN_PHASE || 30);
  const attestWindow = Number(process.env.ATTEST_WINDOW || 3600);
  const quorum = Number(process.env.QUORUM || 1);

  console.log(`Deploying SkyPact on ${network.name} from ${deployer.address}`);
  const Factory = await ethers.getContractFactory("SkyPact");
  const pact = await Factory.deploy(minPhase, attestWindow, quorum);
  const receipt = await pact.deploymentTransaction().wait();
  const address = await pact.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const record = {
    network: network.name, chainId, address,
    deployer: deployer.address, deployTx: receipt.hash, deployBlock: receipt.blockNumber,
    params: { minPhase, attestWindow, quorum },
    explorer: chainId === 84532 ? `https://sepolia.basescan.org/address/${address}` : null,
  };
  fs.mkdirSync(path.join(__dirname, "..", "deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), JSON.stringify(record, null, 2));

  // ABI for the frontend
  const art = await artifacts.readArtifact("SkyPact");
  fs.writeFileSync(path.join(__dirname, "..", "abi", "SkyPact.json"), JSON.stringify(art.abi, null, 2));

  // Runtime config for the static frontend (public, contains no secrets).
  const nets = {
    84532: { chainName: "Base Sepolia", rpcUrl: "https://sepolia.base.org", explorerUrl: "https://sepolia.basescan.org", currency: "ETH" },
    31337: { chainName: "Local Hardhat", rpcUrl: "http://127.0.0.1:8545", explorerUrl: "", currency: "ETH" },
  };
  const n = nets[chainId] || { chainName: network.name, rpcUrl: network.config.url || "", explorerUrl: "", currency: "ETH" };
  const fe = path.join(__dirname, "..", "frontend", "public");
  fs.mkdirSync(fe, { recursive: true });
  fs.writeFileSync(path.join(fe, "deployment.json"), JSON.stringify({ address, chainId, deployBlock: receipt.blockNumber, ...n }, null, 2));
  console.log("Wrote frontend/public/deployment.json  ->  now run: cd frontend && npm run build");
  console.log(record);
}
main().catch((e) => { console.error(e); process.exit(1); });
