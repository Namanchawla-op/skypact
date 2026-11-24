// Off-chain helpers for SkyPact: commitments, synthetic data, secrets, friendly errors.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ACTION = { NONE: 0, HOLD: 1, MANEUVER: 2 };
const ACTION_NAME = ["NONE", "HOLD", "MANEUVER"];
const PHASE_NAME = ["NONE", "COMMIT", "REVEAL", "LOCKED", "ATTEST", "FINALIZED"];
const VERDICT_NAME = ["PENDING", "COORDINATED", "DOUBLE_MANEUVER", "UNMITIGATED", "INCOMPLETE"];
const PLEDGE_NAME = ["PENDING", "KEPT", "BROKEN", "WITHHELD", "SILENT", "UNVERIFIED"];

const coder = ethers.AbiCoder.defaultAbiCoder();

/** Same formula as SkyPact.commitmentHash. */
function commitmentHash({ chainId, contract, eventId, satId, operator, action, paramsHash, salt }) {
  return ethers.keccak256(
    coder.encode(
      ["uint256", "address", "uint256", "uint256", "address", "uint8", "bytes32", "bytes32"],
      [chainId, contract, eventId, satId, operator, action, paramsHash, salt]
    )
  );
}

const randomSalt = () => ethers.hexlify(ethers.randomBytes(32));

/** JSON with sorted keys so the same data always hashes the same. */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const fingerprint = (obj) => ethers.keccak256(ethers.toUtf8Bytes(canonical(obj)));

// ---- Synthetic data (fictional, deterministic) -------------------------------

function prng(seedText) {
  let a = parseInt(ethers.id(seedText).slice(2, 10), 16) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const satLabel = (i) => "SAT-" + String(i).padStart(3, "0");

/** A fictional conjunction data message. Never real orbital data. */
function syntheticCdm(labelA, labelB, tcaUnix) {
  const r = prng(`cdm:${labelA}:${labelB}:${tcaUnix}`);
  return {
    cdmId: "SYN-" + ethers.id(`${labelA}${labelB}${tcaUnix}`).slice(2, 10).toUpperCase(),
    synthetic: true,
    objectA: labelA,
    objectB: labelB,
    tca: new Date(tcaUnix * 1000).toISOString(),
    missDistanceMeters: Math.round(80 + r() * 420),
    relativeSpeedMetersPerSec: Math.round(7000 + r() * 8000),
    collisionProbability: Number((1e-5 + r() * 9e-4).toExponential(3)),
    sigmaRadialMeters: Math.round(20 + r() * 80),
  };
}

/** A fictional burn plan. paramsHash = fingerprint(plan) is what goes on chain. */
function syntheticPlan(label, action, tcaUnix) {
  const r = prng(`plan:${label}:${action}:${tcaUnix}`);
  if (action === "HOLD") return { satellite: label, action, rationale: "Risk below own threshold, holding attitude and orbit." };
  return {
    satellite: label,
    action,
    deltaVMetersPerSec: Number((0.02 + r() * 0.2).toFixed(3)),
    direction: r() > 0.5 ? "prograde" : "retrograde",
    burnStart: new Date((tcaUnix - 3600 * 6) * 1000).toISOString(),
  };
}

// ---- Secret salts (operators must keep these until reveal) -------------------

class SecretStore {
  constructor(file = path.join(__dirname, "..", ".secrets", "pacts.json")) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, "{}");
  }
  key(chainId, contract, eventId, operator) {
    return `${chainId}:${contract.toLowerCase()}:${eventId}:${operator.toLowerCase()}`;
  }
  load() { return JSON.parse(fs.readFileSync(this.file, "utf8")); }
  save(chainId, contract, eventId, operator, record) {
    const all = this.load();
    all[this.key(chainId, contract, eventId, operator)] = record;
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }
  get(chainId, contract, eventId, operator) {
    return this.load()[this.key(chainId, contract, eventId, operator)];
  }
}

// ---- Friendly errors -----------------------------------------------------------

const ERRORS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "errors.json"), "utf8"));

/** Turn any ethers/hardhat failure into a plain-language message. */
function friendlyError(err, iface) {
  const data = err?.data || err?.info?.error?.data || err?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return { code: parsed.name, message: ERRORS[parsed.name] || parsed.name };
    } catch (_) { /* fall through */ }
  }
  const named = err?.revert?.name || err?.errorName;
  if (named) return { code: named, message: ERRORS[named] || named };
  const m = /reverted with custom error '(\w+)/.exec(String(err?.message || ""));
  if (m) return { code: m[1], message: ERRORS[m[1]] || m[1] };
  return { code: "Unknown", message: err?.shortMessage || err?.message || "Something went wrong." };
}

module.exports = {
  ACTION, ACTION_NAME, PHASE_NAME, VERDICT_NAME, PLEDGE_NAME, ERRORS,
  commitmentHash, randomSalt, canonical, fingerprint,
  satLabel, syntheticCdm, syntheticPlan, SecretStore, friendlyError,
};
