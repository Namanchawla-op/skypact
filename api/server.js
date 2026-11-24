// Read-only REST API over the live contract. No database, no keys, no writes:
// every answer is read from the chain at request time.
//   NETWORK=localhost node api/server.js        (reads deployments/<network>.json)
//   RPC_URL=... CONTRACT=0x... node api/server.js
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const P = require("../lib/pact");
const { replayLedger } = require("../lib/ledger");

const root = path.join(__dirname, "..");
const net = process.env.NETWORK || "baseSepolia";
const depFile = path.join(root, "deployments", `${net}.json`);
const dep = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : {};
const RPC = process.env.RPC_URL || (net === "localhost" ? "http://127.0.0.1:8545" : process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
const ADDRESS = process.env.CONTRACT || dep.address;
const FROM_BLOCK = Number(process.env.FROM_BLOCK ?? dep.deployBlock ?? 0);
const PORT = Number(process.env.PORT || 8787);
if (!ADDRESS) { console.error("No contract address. Set CONTRACT or create deployments/<network>.json"); process.exit(2); }

const abi = JSON.parse(fs.readFileSync(path.join(root, "abi", "SkyPact.json"), "utf8"));
const provider = new ethers.JsonRpcProvider(RPC);
const pact = new ethers.Contract(ADDRESS, abi, provider);

// ---- serialisation -------------------------------------------------------------
const plain = (v) => {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};
const struct = (r) => (r && r.toObject ? r.toObject(true) : r);
const iso = (s) => (Number(s) ? new Date(Number(s) * 1000).toISOString() : null);

function conjunctionView(id, c, phase) {
  const o = struct(c);
  return plain({
    id,
    phase: P.PHASE_NAME[Number(phase)],
    satA: o.satA, satB: o.satB, operatorA: o.opA, operatorB: o.opB, screener: o.screener,
    openedAt: iso(o.openedAt), tca: iso(o.tca), commitDeadline: iso(o.commitDeadline),
    revealDeadline: iso(o.revealDeadline), attestDeadline: iso(o.attestDeadline),
    cdmHash: o.cdmHash, predictedMissMeters: o.predictedMissMeters, quorum: o.quorum,
    finalized: o.finalized, attested: o.attested,
    observed: o.attested ? { aManeuvered: (Number(o.observedMask) & 1) === 1, bManeuvered: (Number(o.observedMask) & 2) === 2, missMeters: o.observedMissMeters } : null,
    verdict: P.VERDICT_NAME[Number(o.verdict)],
    pledgeA: P.PLEDGE_NAME[Number(o.pledgeA)], pledgeB: P.PLEDGE_NAME[Number(o.pledgeB)],
  });
}

async function satelliteView(id) {
  const s = struct(await pact.satellite(id));
  return plain({ id, label: s.label, operator: s.operator, registeredAt: iso(s.registeredAt) });
}

async function conjunctionFull(id) {
  const [c, phase] = await Promise.all([pact.getConjunction(id), pact.phaseOf(id)]);
  const base = conjunctionView(id, c, phase);
  const [commitsA, commitsB, revA, revB, atts, errata, satA, satB] = await Promise.all([
    pact.getCommits(id, 0), pact.getCommits(id, 1), pact.getReveal(id, 0), pact.getReveal(id, 1),
    pact.getAttestations(id), pact.getErrata(id), satelliteView(Number(c.satA)), satelliteView(Number(c.satB)),
  ]);
  const commits = (list) => list.map((x, i) => ({ revision: i + 1, commitment: x.hash, at: iso(x.at), superseded: i < list.length - 1 }));
  // Before reveals close, nothing about the other side's decision is exposed: only that a commitment exists.
  const reveal = (r) => (Number(r.action) === 0 ? null : { action: P.ACTION_NAME[Number(r.action)], paramsHash: r.paramsHash, at: iso(r.at) });
  return plain({
    ...base, satelliteA: satA, satelliteB: satB,
    sideA: { commitments: commits(commitsA), reveal: reveal(revA) },
    sideB: { commitments: commits(commitsB), reveal: reveal(revB) },
    attestations: atts.map((a) => ({ screener: a.screener, aManeuvered: (Number(a.mask) & 1) === 1, bManeuvered: (Number(a.mask) & 2) === 2, missMeters: a.missMeters, at: iso(a.at) })),
    errata: errata.map((e) => ({ by: e.by, noteHash: e.noteHash, at: iso(e.at) })),
  });
}

async function operatorView(address) {
  const [info, rep] = await Promise.all([pact.operatorInfo(address), pact.reputationOf(address)]);
  const r = struct(rep[0]);
  return plain({
    address, name: info.name, active: info.active, known: info.exists,
    reputation: { kept: r.kept, broken: r.broken, withheld: r.withheld, silent: r.silent, scorePercent: rep[2] ? Number(rep[1]) / 100 : null, rated: rep[2] },
  });
}

async function operatorAddresses() {
  const topic = pact.interface.getEvent("OperatorAdded").topicHash;
  const latest = await provider.getBlockNumber();
  const found = new Set();
  for (let from = FROM_BLOCK; from <= latest; from += 9000) {
    const logs = await provider.getLogs({ address: ADDRESS, topics: [topic], fromBlock: from, toBlock: Math.min(from + 8999, latest) });
    logs.forEach((l) => found.add(pact.interface.parseLog(l).args.operator));
  }
  return [...found];
}

// ---- tiny cache for the expensive audit ------------------------------------------
let ledgerCache = { at: 0, value: null };

// ---- routes ------------------------------------------------------------------
const routes = [
  [/^\/health$/, async () => ({ ok: true, network: net, chainId: Number((await provider.getNetwork()).chainId), contract: ADDRESS })],
  [/^\/stats$/, async () => plain({
    contract: ADDRESS, admin: await pact.admin(), satellites: await pact.satelliteCount(), conjunctions: await pact.conjunctionCount(),
    ledgerEntries: await pact.entryCount(), ledgerHead: await pact.ledgerHead(),
    attestQuorum: await pact.attestQuorum(), attestWindowSeconds: await pact.attestWindowSeconds(), minPhaseSeconds: await pact.minPhaseSeconds(),
  })],
  [/^\/satellites$/, async () => { const n = Number(await pact.satelliteCount()); return Promise.all(Array.from({ length: n }, (_, i) => satelliteView(i + 1))); }],
  [/^\/satellites\/(\d+)$/, async (m) => satelliteView(Number(m[1]))],
  [/^\/conjunctions$/, async () => {
    const n = Number(await pact.conjunctionCount());
    return Promise.all(Array.from({ length: n }, async (_, i) => conjunctionView(i + 1, await pact.getConjunction(i + 1), await pact.phaseOf(i + 1))));
  }],
  [/^\/conjunctions\/(\d+)$/, async (m) => conjunctionFull(Number(m[1]))],
  [/^\/operators$/, async () => Promise.all((await operatorAddresses()).map(operatorView))],
  [/^\/operators\/(0x[0-9a-fA-F]{40})$/, async (m) => operatorView(ethers.getAddress(m[1]))],
  [/^\/leaderboard$/, async () => {
    const ops = await Promise.all((await operatorAddresses()).map(operatorView));
    return ops.sort((a, b) => (b.reputation.scorePercent ?? -1) - (a.reputation.scorePercent ?? -1));
  }],
  [/^\/ledger$/, async () => {
    if (Date.now() - ledgerCache.at > 30000) {
      const r = await replayLedger(pact, FROM_BLOCK);
      ledgerCache = { at: Date.now(), value: { ok: r.ok, entries: r.entries, replayedHead: r.head, onChainHead: r.onChainHead, problems: r.problems } };
    }
    return ledgerCache.value;
  }],
  [/^\/ledger\/entries$/, async () => (await replayLedger(pact, FROM_BLOCK)).list],
  [/^\/errors$/, async () => P.ERRORS],
  [/^\/abi$/, async () => abi],
];

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "GET") { res.writeHead(405); return res.end(JSON.stringify({ error: "read-only API" })); }
  const url = new URL(req.url, "http://x");
  for (const [re, fn] of routes) {
    const m = re.exec(url.pathname);
    if (!m) continue;
    try { const body = JSON.stringify(await fn(m), null, 2); res.writeHead(200); return res.end(body); }
    catch (e) {
      const fe = P.friendlyError(e, pact.interface);
      res.writeHead(fe.code === "Unknown" ? 500 : 404);
      return res.end(JSON.stringify({ error: fe.code, message: fe.message }));
    }
  }
  res.writeHead(404); res.end(JSON.stringify({ error: "NotFound", routes: routes.map(([r]) => r.source) }));
});

server.listen(PORT, () => console.log(`SkyPact read API on http://localhost:${PORT}  (contract ${ADDRESS}, rpc ${RPC})`));
