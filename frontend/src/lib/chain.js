// Everything the app knows comes from the contract on chain: direct view calls plus its event log.
import { ethers } from "ethers";
import ABI from "../data/abi.json";
import { store } from "./store.js";
import { PHASE_NAME, VERDICT_NAME, PLEDGE_NAME, ACTION_NAME } from "./pact.js";

export const BASE_SEPOLIA = {
  chainId: 84532, chainName: "Base Sepolia", rpcUrl: "https://sepolia.base.org",
  explorerUrl: "https://sepolia.basescan.org", currency: "ETH",
};

export const S = {
  cfg: null, provider: null, contract: null, iface: new ethers.Interface(ABI),
  logs: [], lastBlock: -1, latest: 0, offset: 0, syncing: false, progress: 1, error: null, ready: false,
};

export function normalizeCfg(c) {
  const chainId = Number(c.chainId ?? BASE_SEPOLIA.chainId);
  const base = chainId === BASE_SEPOLIA.chainId ? BASE_SEPOLIA : { chainName: "Custom network", currency: "ETH", explorerUrl: "" };
  return { ...base, ...c, chainId, address: ethers.getAddress(c.address) };
}

export async function loadConfig() {
  let cfg = null;
  try {
    const r = await fetch("./deployment.json", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (j?.address) cfg = j; }
  } catch { /* none shipped */ }
  const ov = store.getCfg();
  if (ov?.address) cfg = { ...(cfg || {}), ...ov };
  return cfg ? normalizeCfg(cfg) : null;
}

/** Smallest block at which the contract has code (binary search). Falls back to a recent window. */
export async function findDeployBlock(provider, address) {
  const latest = await provider.getBlockNumber();
  try {
    let lo = 0, hi = latest;
    if ((await provider.getCode(address, hi)) === "0x") throw new Error("no code");
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await provider.getCode(address, mid)) === "0x") lo = mid + 1; else hi = mid;
    }
    return lo;
  } catch {
    return Math.max(0, latest - 200000);
  }
}

// Public RPCs sometimes answer a call with an empty error (reported as "missing revert data"). Retry those; real reverts carry data and are rethrown.
class RetryRpc extends ethers.JsonRpcProvider {
  async call(tx) {
    let last;
    for (let i = 0; i < 4; i++) {
      try { return await super.call(tx); }
      catch (e) {
        last = e;
        if (e?.code !== "CALL_EXCEPTION" || e?.data || e?.revert) throw e;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw last;
  }
}

export async function init() {
  const cfg = await loadConfig();
  if (!cfg) return { needsSetup: true };
  S.cfg = cfg;
  S.provider = new RetryRpc(cfg.rpcUrl, cfg.chainId, { staticNetwork: ethers.Network.from(cfg.chainId), batchMaxCount: 1 });
  const code = await S.provider.getCode(cfg.address);
  if (code === "0x") throw new Error("There is no SkyPact contract at " + cfg.address + " on " + cfg.chainName + ". Check the address and network.");
  S.contract = new ethers.Contract(cfg.address, ABI, S.provider);
  if (cfg.deployBlock == null) {
    cfg.deployBlock = await findDeployBlock(S.provider, cfg.address);
  }
  S.lastBlock = Number(cfg.deployBlock) - 1;
  S.logs = [];
  await sync();
  S.ready = true;
  return { ok: true };
}

export const explorerTx = (h) => (S.cfg?.explorerUrl ? `${S.cfg.explorerUrl}/tx/${h}` : null);
export const explorerAddr = (a) => (S.cfg?.explorerUrl ? `${S.cfg.explorerUrl}/address/${a}` : null);
export const chainNow = () => Math.floor(Date.now() / 1000) + S.offset;

// ---- Log indexer (incremental) ---------------------------------------------------------
let step = 5000;
export async function sync({ full = false } = {}) {
  if (S.syncing) return;
  S.syncing = true;
  try {
    if (full) { S.logs = []; S.lastBlock = Number(S.cfg.deployBlock) - 1; }
    const latest = await S.provider.getBlockNumber();
    const start = S.lastBlock + 1;
    let from = start;
    const CONC = 5;
    const fetchWindow = async (f, t) => {
      for (let i = 0; ; i++) {
        try { return await S.provider.getLogs({ address: S.cfg.address, fromBlock: f, toBlock: t }); }
        catch (e) {
          const m = String(e?.message || "") + String(e?.info?.responseBody || "");
          if (i < 4 && /429|rate.?limit|too many requests|timeout|ETIMEDOUT|fetch/i.test(m) && !/range/i.test(m)) { await new Promise((r) => setTimeout(r, 400 * (i + 1))); continue; }
          throw e;
        }
      }
    };
    while (from <= latest) {
      const ranges = [];
      for (let f = from; f <= latest && ranges.length < CONC;) { const t = Math.min(f + step - 1, latest); ranges.push([f, t]); f = t + 1; }
      let results;
      try { results = await Promise.all(ranges.map(([f, t]) => fetchWindow(f, t))); }
      catch (e) {
        const msg = String(e?.message || "") + String(e?.info?.responseBody || "");
        if (step > 10 && /range|limit|exceed|too many|10000|query|413/i.test(msg)) {
          // some RPCs state their cap ("limited to a 200 range"): use it, otherwise halve
          const cap = Number((msg.match(/limited to (?:a )?(\d+)/i) || [])[1]);
          step = cap > 20 ? Math.min(step - 1, cap - 10) : Math.max(10, Math.floor(step / 2));
          continue;
        }
        throw e;
      }
      for (const raw of results) {
        for (const l of raw) {
          let p; try { p = S.iface.parseLog({ topics: l.topics, data: l.data }); } catch { continue; }
          if (p) S.logs.push({ name: p.name, args: p.args, fragment: p.fragment, block: l.blockNumber, tx: l.transactionHash, idx: l.index });
        }
      }
      const to = ranges[ranges.length - 1][1];
      S.lastBlock = to;
      S.progress = latest === start ? 1 : Math.min(1, (to - start + 1) / (latest - start + 1));
      from = to + 1;
    }
    S.latest = latest;
    const blk = await S.provider.getBlock(latest);
    if (blk) S.offset = blk.timestamp - Math.floor(Date.now() / 1000);
    S.error = null;
  } catch (e) {
    S.error = e;
    throw e;
  } finally {
    S.syncing = false;
    S.progress = 1;
  }
}

// ---- tiny memo so one render doesn't hammer the RPC -----------------------------------------
const cache = new Map();
function memo(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const p = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), p });
  return p;
}
export const flushCache = () => cache.clear();
const TTL = 3000;
const N = Number;

// ---- Log-derived lookups (no RPC) --------------------------------------------------------------
export function logsNamed(...names) { return S.logs.filter((l) => names.includes(l.name)); }

export function operatorNames() {
  const m = new Map();
  for (const l of logsNamed("OperatorAdded")) m.set(l.args.operator.toLowerCase(), l.args.name);
  return m;
}
export const operatorName = (addr) => operatorNames().get(String(addr).toLowerCase()) || null;

export function satellitesFromLogs() {
  return logsNamed("SatelliteRegistered").map((l) => ({ id: N(l.args.satId), label: l.args.label, operator: l.args.operator, block: l.block, tx: l.tx }));
}
export const satLabel = (id) => satellitesFromLogs().find((s) => s.id === id)?.label || `SAT #${id}`;

export function screenersFromLogs() {
  const set = new Set();
  for (const l of logsNamed("ScreenerAdded", "ScreenerRevoked")) {
    const a = l.args.screener.toLowerCase();
    l.name === "ScreenerAdded" ? set.add(a) : set.delete(a);
  }
  return [...set];
}

// ---- Contract reads -----------------------------------------------------------------------------
export function readStats() {
  return memo("stats", TTL, async () => {
    const c = S.contract;
    const [admin, satellites, conjunctions, entries, head, quorum, window_, minPhase] = await Promise.all([
      c.admin(), c.satelliteCount(), c.conjunctionCount(), c.entryCount(), c.ledgerHead(), c.attestQuorum(), c.attestWindowSeconds(), c.minPhaseSeconds(),
    ]);
    return { admin, satellites: N(satellites), conjunctions: N(conjunctions), entries: N(entries), head, quorum: N(quorum), attestWindow: N(window_), minPhase: N(minPhase) };
  });
}

export function readOperator(address) {
  return memo("op:" + address.toLowerCase(), TTL, async () => {
    const [info, rep] = await Promise.all([S.contract.operatorInfo(address), S.contract.reputationOf(address)]);
    const r = rep[0];
    return {
      address, name: info.name || operatorName(address) || "", active: info.active, known: info.exists,
      kept: N(r.kept), broken: N(r.broken), withheld: N(r.withheld), silent: N(r.silent),
      score: rep[2] ? N(rep[1]) / 100 : null, rated: rep[2],
    };
  });
}

export async function readOperators() {
  const addrs = [...operatorNames().keys()].map((a) => ethers.getAddress(a));
  return Promise.all(addrs.map(readOperator));
}

export async function readRoles(address) {
  if (!address) return { admin: false, operator: false, screener: false, name: "" };
  const [admin, info, screener] = await Promise.all([
    memo("admin", TTL, () => S.contract.admin()), S.contract.operatorInfo(address), S.contract.isScreener(address),
  ]);
  return { admin: admin.toLowerCase() === address.toLowerCase(), operator: info.active, screener, name: info.name || "" };
}

function mapConj(id, c, phase) {
  const mask = N(c.observedMask);
  return {
    id, phase: PHASE_NAME[N(phase)],
    satA: N(c.satA), satB: N(c.satB), opA: c.opA, opB: c.opB, screener: c.screener,
    openedAt: N(c.openedAt), tca: N(c.tca), commitDeadline: N(c.commitDeadline), revealDeadline: N(c.revealDeadline), attestDeadline: N(c.attestDeadline),
    cdmHash: c.cdmHash, predictedMiss: N(c.predictedMissMeters), quorum: N(c.quorum),
    finalized: c.finalized, attested: c.attested,
    observed: c.attested ? { aMan: (mask & 1) === 1, bMan: (mask & 2) === 2, miss: N(c.observedMissMeters) } : null,
    verdict: VERDICT_NAME[N(c.verdict)], pledgeA: PLEDGE_NAME[N(c.pledgeA)], pledgeB: PLEDGE_NAME[N(c.pledgeB)],
  };
}

export function readConjunction(id) {
  return memo("c:" + id, TTL, async () => {
    const [c, phase] = await Promise.all([S.contract.getConjunction(id), S.contract.phaseOf(id)]);
    return mapConj(id, c, phase);
  });
}

export async function readConjunctions() {
  const n = (await readStats()).conjunctions;
  const list = await Promise.all(Array.from({ length: n }, (_, i) => readConjunction(i + 1)));
  return list.reverse(); // newest first
}

export function readConjunctionFull(id) {
  return memo("cf:" + id, TTL, async () => {
    const base = await readConjunction(id);
    const [cA, cB, rA, rB, atts, errs, opA, opB] = await Promise.all([
      S.contract.getCommits(id, 0), S.contract.getCommits(id, 1), S.contract.getReveal(id, 0), S.contract.getReveal(id, 1),
      S.contract.getAttestations(id), S.contract.getErrata(id), readOperator(base.opA), readOperator(base.opB),
    ]);
    const commits = (list) => list.map((x, i) => ({ revision: i + 1, hash: x.hash, at: N(x.at), superseded: i < list.length - 1 }));
    const reveal = (r) => (N(r.action) === 0 ? null : { action: ACTION_NAME[N(r.action)], paramsHash: r.paramsHash, at: N(r.at) });
    const sats = satellitesFromLogs();
    const sat = (sid) => sats.find((s) => s.id === sid) || { id: sid, label: `SAT #${sid}` };
    const timeline = S.logs
      .filter((l) => l.args?.eventId !== undefined && N(l.args.eventId) === id && l.name !== "Entry")
      .map((l) => ({ name: l.name, args: l.args, tx: l.tx, block: l.block, idx: l.idx }));
    return {
      ...base,
      satelliteA: sat(base.satA), satelliteB: sat(base.satB), operatorA: opA, operatorB: opB,
      sideA: { operator: base.opA, sat: sat(base.satA), commits: commits(cA), reveal: reveal(rA) },
      sideB: { operator: base.opB, sat: sat(base.satB), commits: commits(cB), reveal: reveal(rB) },
      attestations: atts.map((a) => ({ screener: a.screener, aMan: (N(a.mask) & 1) === 1, bMan: (N(a.mask) & 2) === 2, miss: N(a.missMeters), at: N(a.at) })),
      errata: errs.map((e) => ({ by: e.by, noteHash: e.noteHash, at: N(e.at) })),
      timeline,
    };
  });
}

/** Latest commitment hash on a side (what a reveal must match). */
export const latestCommit = (side) => (side.commits.length ? side.commits[side.commits.length - 1] : null);

// ---- Independent audit of the hash chain, in the browser ----------------------------------------------
const coder = ethers.AbiCoder.defaultAbiCoder();
export const KIND = ["OPERATOR_ADDED", "OPERATOR_REVOKED", "SCREENER_ADDED", "SCREENER_REVOKED", "SATELLITE_REGISTERED", "CONJUNCTION_OPENED", "COMMITTED", "REVEALED", "ATTESTED", "FINALIZED", "ERRATUM", "CONFIG"];

/** Recomputes every digest and link from the raw logs and compares the head with the contract's ledgerHead. */
export async function auditLedger() {
  const problems = [];
  const entries = [];
  let head = ethers.ZeroHash;
  let expected = 0;
  let prev = null;
  const ordered = [...S.logs].sort((a, b) => a.block - b.block || a.idx - b.idx);
  for (const l of ordered) {
    if (l.name !== "Entry") { prev = l; continue; }
    const index = N(l.args.index), kind = N(l.args.kind), digest = l.args.digest, claimed = l.args.head;
    if (index !== expected) problems.push(`Gap: expected entry ${expected} but found ${index}.`);
    expected = index + 1;
    let ok = true;
    if (!prev || prev.tx !== l.tx) { problems.push(`Entry ${index}: its event log is missing.`); ok = false; }
    else {
      const recomputed = ethers.keccak256(coder.encode(prev.fragment.inputs, [...prev.args]));
      if (recomputed !== digest) { problems.push(`Entry ${index}: digest does not match its ${prev.name} log.`); ok = false; }
    }
    const link = ethers.keccak256(coder.encode(["bytes32", "uint256", "uint8", "bytes32"], [head, index, kind, digest]));
    if (link !== claimed) { problems.push(`Entry ${index}: chain link does not match.`); ok = false; }
    head = claimed;
    entries.push({ index, kind: KIND[kind], event: prev?.name, digest, head: claimed, block: l.block, tx: l.tx, ok });
    prev = null;
  }
  const [onChainHead, onChainCount] = await Promise.all([S.contract.ledgerHead(), S.contract.entryCount()]);
  if (onChainHead !== head) problems.push("The replayed head differs from the contract's ledgerHead.");
  if (N(onChainCount) !== entries.length) problems.push(`Replayed ${entries.length} entries but the contract reports ${N(onChainCount)}.`);
  return { ok: problems.length === 0, entries, head, onChainHead, onChainCount: N(onChainCount), problems };
}
