// Independent replay of the SkyPact hash chain from raw logs.
// Anyone can run this against any RPC: it trusts nothing but the chain's logs.
const { ethers } = require("ethers");

const coder = ethers.AbiCoder.defaultAbiCoder();
const KIND = [
  "OPERATOR_ADDED", "OPERATOR_REVOKED", "SCREENER_ADDED", "SCREENER_REVOKED",
  "SATELLITE_REGISTERED", "CONJUNCTION_OPENED", "COMMITTED", "REVEALED",
  "ATTESTED", "FINALIZED", "ERRATUM", "CONFIG",
];

async function fetchLogs(provider, address, fromBlock, toBlock, step = 190) {
  const all = [];
  for (let from = fromBlock; from <= toBlock; from += step) {
    const to = Math.min(from + step - 1, toBlock);
    all.push(...(await provider.getLogs({ address, fromBlock: from, toBlock: to })));
  }
  return all.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}

/**
 * Recomputes every digest and every link of the chain from the logs and compares
 * the final head with the contract's own ledgerHead().
 */
async function replayLedger(contract, fromBlock = 0) {
  const provider = contract.runner.provider;
  const address = await contract.getAddress();
  const iface = contract.interface;
  const latest = await provider.getBlockNumber();
  const logs = await fetchLogs(provider, address, fromBlock, latest);

  const problems = [];
  const entries = [];
  let head = ethers.ZeroHash;
  let expectedIndex = 0;
  let lastSpecific = null; // { txHash, parsed }

  for (const log of logs) {
    let parsed;
    try { parsed = iface.parseLog({ topics: log.topics, data: log.data }); } catch (_) { continue; }
    if (!parsed) continue;

    if (parsed.name !== "Entry") { lastSpecific = { txHash: log.transactionHash, parsed }; continue; }

    const index = Number(parsed.args.index);
    const kind = Number(parsed.args.kind);
    const digest = parsed.args.digest;
    const claimedHead = parsed.args.head;

    if (index !== expectedIndex) problems.push(`gap or reorder: expected entry ${expectedIndex}, saw ${index}`);
    expectedIndex = index + 1;

    // 1. digest must match the specific event that produced it
    if (!lastSpecific || lastSpecific.txHash !== log.transactionHash) {
      problems.push(`entry ${index}: no matching event log in the same transaction`);
    } else {
      const frag = lastSpecific.parsed.fragment;
      const recomputed = ethers.keccak256(coder.encode(frag.inputs, [...lastSpecific.parsed.args]));
      if (recomputed !== digest) problems.push(`entry ${index}: digest does not match ${frag.name} log`);
    }

    // 2. chain link
    const recomputedHead = ethers.keccak256(coder.encode(["bytes32", "uint256", "uint8", "bytes32"], [head, index, kind, digest]));
    if (recomputedHead !== claimedHead) problems.push(`entry ${index}: head does not match recomputed chain`);
    head = claimedHead;

    entries.push({
      index, kind: KIND[kind], digest, head: claimedHead,
      event: lastSpecific?.parsed.name, block: log.blockNumber, tx: log.transactionHash,
    });
    lastSpecific = null;
  }

  const onChainHead = await contract.ledgerHead();
  const onChainCount = Number(await contract.entryCount());
  if (onChainHead !== head) problems.push(`final head ${head} differs from on-chain ledgerHead ${onChainHead}`);
  if (onChainCount !== entries.length) problems.push(`replayed ${entries.length} entries but contract reports ${onChainCount}`);

  return { ok: problems.length === 0, entries: entries.length, head, onChainHead, problems, list: entries };
}

module.exports = { replayLedger, KIND };
