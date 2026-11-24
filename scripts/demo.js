// Walks the whole SkyPact story end to end.
//   local:         npx hardhat run scripts/demo.js
//   Base Sepolia:  npx hardhat run scripts/demo.js --network baseSepolia
// Needs ADMIN_KEY, OPERATOR_A_KEY, OPERATOR_B_KEY (and optionally SCREENER_KEY) for Base Sepolia.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const P = require("../lib/pact");
const { replayLedger } = require("../lib/ledger");

const { ethers, network } = hre;
const DEV = ["hardhat", "localhost"].includes(network.name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];

async function now() { return Number((await ethers.provider.getBlock("latest")).timestamp); }

async function waitUntil(ts) {
  if (DEV) {
    const cur = await now();
    if (ts > cur) { await network.provider.send("evm_increaseTime", [ts - cur]); await network.provider.send("evm_mine"); }
    return;
  }
  let last = -1;
  while ((await now()) < ts) {
    const left = ts - (await now());
    if (left !== last) process.stdout.write(`\r   waiting ${left}s ...   `);
    last = left;
    await sleep(4000);
  }
  process.stdout.write("\r                          \r");
}

const explorer = (h) => (network.config.chainId === 84532 ? `https://sepolia.basescan.org/tx/${h}` : null);
function record(label, hash, status, extra = {}) {
  steps.push({ step: steps.length + 1, label, txHash: hash, status, explorer: hash ? explorer(hash) : null, ...extra });
}

async function send(label, promise) {
  const tx = await promise;
  const rc = await tx.wait();
  record(label, rc.hash, "success");
  console.log(`  ok  ${label}  ${rc.hash}`);
  return rc;
}

/** Shows that the contract refuses something. On a real network it also leaves a failed tx on the explorer. */
async function refuse(label, c, method, args, iface) {
  let fe;
  try {
    await c[method].staticCall(...args);
    throw new Error("EXPECTED A REFUSAL BUT IT SUCCEEDED: " + label);
  } catch (e) {
    if (String(e.message).startsWith("EXPECTED")) throw e;
    fe = P.friendlyError(e, iface);
  }
  let hash = null;
  if (!DEV) {
    try {
      const tx = await c[method](...args, { gasLimit: 300000 });
      hash = tx.hash;
      await tx.wait();
    } catch (e) { hash = hash || e.transactionHash || e.receipt?.hash || null; }
  }
  record(label, hash, "refused", { reason: fe.code, message: fe.message });
  console.log(`  REFUSED  ${label}  ->  ${fe.code}: ${fe.message}${hash ? "\n           " + (explorer(hash) || hash) : ""}`);
}

async function main() {
  const signers = await ethers.getSigners();
  const [admin, opA, opB] = signers;
  const screener = signers[3] || admin;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const COMMIT_SECS = Number(process.env.DEMO_COMMIT_SECS || (DEV ? 100 : 75));
  const REVEAL_SECS = Number(process.env.DEMO_REVEAL_SECS || (DEV ? 100 : 60));

  console.log(`\nSkyPact demo on ${network.name}`);
  console.log(`  admin ${admin.address}\n  Alpha ${opA.address}\n  Bravo ${opB.address}\n  screener ${screener.address}\n`);

  // 1. Deploy (or reuse)
  const depFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  let pact;
  if (!DEV && fs.existsSync(depFile) && !process.env.REDEPLOY) {
    const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
    pact = await ethers.getContractAt("SkyPact", dep.address, admin);
    console.log(`Reusing deployment ${dep.address}`);
  } else {
    const F = await ethers.getContractFactory("SkyPact", admin);
    pact = await F.deploy(30, 3600, 1);
    const rc = await pact.deploymentTransaction().wait();
    record("Deploy SkyPact", rc.hash, "success");
    const addr = await pact.getAddress();
    console.log(`Deployed SkyPact at ${addr}`);
    const art = await hre.artifacts.readArtifact("SkyPact");
    fs.mkdirSync(path.join(__dirname, "..", "abi"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "..", "abi", "SkyPact.json"), JSON.stringify(art.abi, null, 2));
    fs.writeFileSync(depFile, JSON.stringify({
      network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId), address: addr,
      deployer: admin.address, deployTx: rc.hash, deployBlock: rc.blockNumber,
      params: { minPhase: 30, attestWindow: 3600, quorum: 1 },
      explorer: network.config.chainId === 84532 ? `https://sepolia.basescan.org/address/${addr}` : null,
    }, null, 2));
  }
  const address = await pact.getAddress();
  const iface = pact.interface;
  const asA = pact.connect(opA), asB = pact.connect(opB), asS = pact.connect(screener);

  // 2. Admin decides who is allowed
  console.log("\n[1] Admin approves operators and a screener");
  if (!(await pact.operatorInfo(opA.address)).active) await send("Admin approves operator Alpha", pact.addOperator(opA.address, "OPR-ALPHA"));
  if (!(await pact.operatorInfo(opB.address)).active) await send("Admin approves operator Bravo", pact.addOperator(opB.address, "OPR-BRAVO"));
  if (!(await pact.isScreener(screener.address))) await send("Admin approves screener", pact.addScreener(screener.address));

  // 3. Satellites
  console.log("\n[2] Operators register their (fictional) satellites");
  let satA = Number(await pact.satelliteIdByLabel("SAT-001"));
  let satB = Number(await pact.satelliteIdByLabel("SAT-002"));
  if (!satA) { await send("Alpha registers SAT-001", asA.registerSatellite("SAT-001")); satA = Number(await pact.satelliteIdByLabel("SAT-001")); }
  if (!satB) { await send("Bravo registers SAT-002", asB.registerSatellite("SAT-002")); satB = Number(await pact.satelliteIdByLabel("SAT-002")); }

  // 4. Screener opens the conjunction
  console.log("\n[3] Screener raises a conjunction between SAT-001 and SAT-002");
  const t0 = await now();
  const commitDeadline = t0 + COMMIT_SECS;
  const revealDeadline = commitDeadline + REVEAL_SECS;
  const tca = revealDeadline + 10;
  const cdm = P.syntheticCdm("SAT-001", "SAT-002", tca);
  const cdmHash = P.fingerprint(cdm);
  console.log("   synthetic CDM:", cdm);
  const rcOpen = await send("Screener opens conjunction", asS.openConjunction(satA, satB, tca, commitDeadline, revealDeadline, cdmHash, cdm.missDistanceMeters));
  const eventId = Number(await pact.conjunctionCount());

  // 5. Seal decisions
  console.log("\n[4] Both operators seal their decision. Neither can see the other's.");
  const store = new P.SecretStore();
  const seal = async (signer, c, label, satId, action) => {
    const plan = P.syntheticPlan(label, action, tca);
    const paramsHash = P.fingerprint(plan);
    const salt = P.randomSalt();
    const hash = P.commitmentHash({ chainId, contract: address, eventId, satId, operator: signer.address, action: P.ACTION[action], paramsHash, salt });
    store.save(chainId, address, eventId, signer.address, { action, plan, paramsHash, salt, hash });
    await send(`${label} seals ${action} (hash only on chain)`, c.commit(eventId, hash));
    return { action, paramsHash, salt };
  };
  const sealedA = await seal(opA, asA, "SAT-001", satA, "HOLD");
  const sealedB = await seal(opB, asB, "SAT-002", satB, "MANEUVER");

  console.log("\n[5] The contract refuses a wallet that does not operate either satellite");
  await refuse("Screener wallet tries to commit as an operator", pact.connect(screener), "commit", [eventId, ethers.id("sneaky")], iface);

  console.log("\n[6] Commit window closes");
  await waitUntil(commitDeadline);
  await refuse("Alpha tries to re-commit after the deadline (backdating)", asA, "commit", [eventId, ethers.id("changed my mind")], iface);
  await refuse("Bravo tries to reveal HOLD instead of the sealed MANEUVER", asB, "reveal", [eventId, P.ACTION.HOLD, sealedB.paramsHash, sealedB.salt], iface);

  console.log("\n[7] Honest reveals");
  await send("Alpha reveals HOLD", asA.reveal(eventId, P.ACTION.HOLD, sealedA.paramsHash, sealedA.salt));
  await send("Bravo reveals MANEUVER", asB.reveal(eventId, P.ACTION.MANEUVER, sealedB.paramsHash, sealedB.salt));

  console.log("\n[8] Time of closest approach passes; the screener reports what it observed (only Bravo moved)");
  await waitUntil(tca);
  const mask = 2; // bit1 = B maneuvered
  await send("Screener attests: Bravo maneuvered, miss distance 1450 m", asS.attest(eventId, mask, 1450));

  // 6. Results
  const c = await pact.getConjunction(eventId);
  const [repA, scoreA] = await pact.reputationOf(opA.address);
  const [repB, scoreB] = await pact.reputationOf(opB.address);
  console.log("\n[9] Result, computed by the contract");
  console.log(`   verdict : ${P.VERDICT_NAME[c.verdict]}`);
  console.log(`   Alpha   : ${P.PLEDGE_NAME[c.pledgeA]}  (score ${Number(scoreA) / 100}%, kept ${repA.kept})`);
  console.log(`   Bravo   : ${P.PLEDGE_NAME[c.pledgeB]}  (score ${Number(scoreB) / 100}%, kept ${repB.kept})`);

  const depInfo = !DEV && fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : null;
  const report = await replayLedger(pact, DEV ? 0 : Math.max(0, depInfo?.deployBlock ?? (await ethers.provider.getBlockNumber()) - 5000));
  console.log(`\n[10] Independent ledger audit: ${report.ok ? "PASS" : "FAIL"}  (${report.entries} entries, head ${report.head})`);
  if (!DEV && !report.ok) console.log("   (if the contract was deployed earlier than 5000 blocks ago, run scripts/verify-ledger.js with FROM_BLOCK)");

  const good = steps.filter((s) => s.status === "success" && /seals|attests/.test(s.label));
  const out = {
    network: network.name, chainId, contract: address, eventId,
    verdict: P.VERDICT_NAME[c.verdict], pledges: { alpha: P.PLEDGE_NAME[c.pledgeA], bravo: P.PLEDGE_NAME[c.pledgeB] },
    ledgerAudit: report.ok, ledgerHead: report.head,
    suggestedSubmissionTxs: [
      steps.find((s) => /Bravo seals MANEUVER/.test(s.label)),
      steps.find((s) => /Screener attests/.test(s.label)),
    ].filter(Boolean),
    steps,
  };
  const file = path.join(__dirname, "..", `demo-output.${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nSaved ${file}`);
  if (good.length) console.log("Suggested hashes for the submission form are under suggestedSubmissionTxs.");
  if (!report.ok) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
