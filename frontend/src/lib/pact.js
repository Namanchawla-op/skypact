// Pure helpers shared with the backend (same formulas as lib/pact.js and SkyPact.sol).
import { ethers } from "ethers";
import ERRORS from "../data/errors.json";

export const ACTION = { NONE: 0, HOLD: 1, MANEUVER: 2 };
export const ACTION_NAME = ["NONE", "HOLD", "MANEUVER"];
export const PHASE_NAME = ["NONE", "COMMIT", "REVEAL", "LOCKED", "ATTEST", "FINALIZED"];
export const VERDICT_NAME = ["PENDING", "COORDINATED", "DOUBLE_MANEUVER", "UNMITIGATED", "INCOMPLETE"];
export const PLEDGE_NAME = ["PENDING", "KEPT", "BROKEN", "WITHHELD", "SILENT", "UNVERIFIED"];

export const PHASE_INFO = {
  COMMIT: { label: "Sealing", tone: "cyan", blurb: "Operators are sealing their decisions. Nobody can see them." },
  REVEAL: { label: "Reveal", tone: "violet", blurb: "Seals are locked in. Operators now open them." },
  LOCKED: { label: "Locked", tone: "amber", blurb: "Everything is revealed. Waiting for the closest approach." },
  ATTEST: { label: "Observing", tone: "amber", blurb: "Screeners report what they actually saw." },
  FINALIZED: { label: "Finalized", tone: "green", blurb: "The contract has judged every promise." },
};

export const VERDICT_INFO = {
  COORDINATED: { label: "Coordinated", tone: "green", text: "Exactly one operator committed to maneuver. The risk was handled without waste." },
  DOUBLE_MANEUVER: { label: "Double maneuver", tone: "amber", text: "Both operators committed to maneuver. Wasteful, and they could even have moved into each other." },
  UNMITIGATED: { label: "Unmitigated", tone: "red", text: "Both operators decided to hold. Nobody planned to avoid the conjunction." },
  INCOMPLETE: { label: "Incomplete", tone: "grey", text: "At least one operator never opened their seal, so the plan can't be judged." },
  PENDING: { label: "Pending", tone: "grey", text: "Not finalized yet." },
};

export const PLEDGE_INFO = {
  KEPT: { label: "Kept", tone: "green", text: "Did exactly what they sealed." },
  BROKEN: { label: "Broken", tone: "red", text: "Screeners saw something different from what they sealed." },
  WITHHELD: { label: "Withheld", tone: "amber", text: "Sealed a decision but never opened it." },
  SILENT: { label: "Silent", tone: "red", text: "Never sealed a decision." },
  UNVERIFIED: { label: "Unverified", tone: "grey", text: "Opened their seal, but no observation reached quorum, so it can't be judged." },
  PENDING: { label: "Pending", tone: "grey", text: "Waiting for the event to finalize." },
};

const coder = ethers.AbiCoder.defaultAbiCoder();

/** Same formula as SkyPact.commitmentHash. */
export function commitmentHash({ chainId, contract, eventId, satId, operator, action, paramsHash, salt }) {
  return ethers.keccak256(coder.encode(
    ["uint256", "address", "uint256", "uint256", "address", "uint8", "bytes32", "bytes32"],
    [chainId, contract, eventId, satId, operator, action, paramsHash, salt]
  ));
}
export const randomSalt = () => ethers.hexlify(ethers.randomBytes(32));

export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
export const fingerprint = (obj) => ethers.keccak256(ethers.toUtf8Bytes(canonical(obj)));
export const textFingerprint = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

// ---- Deterministic synthetic sample (fictional) ---------------------------------
function prng(seedText) {
  let a = parseInt(ethers.id(seedText).slice(2, 10), 16) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function sampleCdmFields(labelA, labelB, tcaUnix) {
  const r = prng(`cdm:${labelA}:${labelB}:${tcaUnix}`);
  return {
    missDistanceMeters: Math.round(80 + r() * 420),
    relativeSpeedMetersPerSec: Math.round(7000 + r() * 8000),
    collisionProbability: Number((1e-5 + r() * 9e-4).toExponential(3)),
    sigmaRadialMeters: Math.round(20 + r() * 80),
  };
}
export function buildCdm({ labelA, labelB, tcaUnix, fields }) {
  return {
    cdmId: "SYN-" + ethers.id(`${labelA}${labelB}${tcaUnix}`).slice(2, 10).toUpperCase(),
    synthetic: true,
    objectA: labelA, objectB: labelB,
    tca: new Date(tcaUnix * 1000).toISOString(),
    ...fields,
  };
}
export function buildPlan({ label, action, deltaV, direction, hoursBefore, rationale, tcaUnix }) {
  if (action === "HOLD") return { satellite: label, action, rationale: rationale || "Risk below own threshold; holding orbit." };
  return {
    satellite: label, action,
    deltaVMetersPerSec: Number(deltaV),
    direction,
    burnStart: new Date((tcaUnix - Math.round(Number(hoursBefore) * 3600)) * 1000).toISOString(),
  };
}

// ---- Friendly errors --------------------------------------------------------------
export function friendlyError(err, iface) {
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || /user rejected|user denied/i.test(String(err?.message || "")))
    return { code: "Rejected", message: "You cancelled the request in your wallet." };
  if (err?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(String(err?.message || "")))
    return { code: "NoFunds", message: "This wallet has no test ETH on this network. Use the faucet, then try again." };

  const candidates = [err?.data, err?.info?.error?.data, err?.error?.data, err?.info?.error?.data?.data, err?.revert?.data];
  for (const d of candidates) {
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) {
      try { const p = iface.parseError(d); if (p) return { code: p.name, message: ERRORS[p.name] || p.name }; } catch { /* next */ }
    }
  }
  const named = err?.revert?.name || err?.errorName;
  if (named) return { code: named, message: ERRORS[named] || named };
  const m = /custom error '?(\w+)/.exec(String(err?.message || "")) || /reverted with custom error '(\w+)/.exec(String(err?.shortMessage || ""));
  if (m && ERRORS[m[1]]) return { code: m[1], message: ERRORS[m[1]] };
  if (/network|timeout|failed to fetch|could not coalesce/i.test(String(err?.message || "")))
    return { code: "Network", message: "Could not reach the network. Check your connection and try again." };
  return { code: "Unknown", message: err?.shortMessage || err?.reason || "Something went wrong. Please try again." };
}
export { ERRORS };
