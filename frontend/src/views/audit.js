import { h, icon, shortHash, download } from "../lib/dom.js";
import { auditLedger, sync, S, explorerTx, flushCache } from "../lib/chain.js";
import { btn, callout, card } from "../ui.js";

export default async function audit(root, _a, ctx) {
  ctx.scene?.setMood("calm");
  const result = h("div", { class: "stack" });
  const blocks = h("div", { class: "chainview" });
  let report = null;

  root.append(h("div", { class: "wrap", style: { maxWidth: "1000px" } }, h("div", { class: "stack" },
    h("div", null, h("span", { class: "eyebrow" }, icon("chain"), "Trust nothing"), h("h1", { style: { fontSize: "2.2rem", marginTop: "6px" } }, "Audit the whole ledger yourself"),
      h("p", { class: "muted", style: { maxWidth: "720px" } }, "Every change to SkyPact extends a hash chain. This page downloads the raw logs from the network, recomputes every fingerprint and every link in your browser, and compares the result with the head the contract reports. If any entry was dropped, reordered or forged, it fails.")),
    h("div", { class: "row" },
      btn("Run independent audit", () => run(false), { iconName: "check" }),
      btn("Re-download all logs first", () => run(true), { variant: "ghost", iconName: "download" })),
    result, blocks,
    callout("info", "chain", "Prefer the command line? ", h("code", null, "NETWORK=baseSepolia node scripts/verify-ledger.js"), " does the same check with no website involved."))));

  async function run(full) {
    result.replaceChildren(h("p", { class: "muted" }, full ? "Downloading every log from the RPC and replaying…" : "Replaying…"));
    blocks.replaceChildren();
    flushCache();
    if (full) await sync({ full: true }); else await sync();
    report = await auditLedger();
    const ok = report.ok;
    result.replaceChildren(h("div", { class: "verdict " + (ok ? "green" : "red") },
      h("div", { style: { fontSize: "2.2rem" } }, ok ? "✓" : "✗"),
      h("div", { style: { flex: 1 } },
        h("h3", null, ok ? "Ledger verified" : "Ledger check FAILED"),
        h("p", { class: "muted" }, ok ? `All ${report.entries.length} entries recomputed from raw logs. The replayed head matches the contract.` : "At least one entry did not check out."),
        h("div", { class: "kv" }, h("span", null, "Replayed head"), h("span", { class: "mono" }, shortHash(report.head, 14))),
        h("div", { class: "kv" }, h("span", null, "Contract's ledgerHead"), h("span", { class: "mono" }, shortHash(report.onChainHead, 14))),
        h("div", { class: "kv" }, h("span", null, "Entries (replayed / reported)"), h("span", null, `${report.entries.length} / ${report.onChainCount}`)),
        report.problems.length ? h("ul", null, ...report.problems.map((p) => h("li", { class: "small" }, p))) : null,
        h("div", { class: "row", style: { marginTop: "10px" } }, btn("Download evidence (JSON)", async () => download(`skypact-audit-${S.latest}.json`, JSON.stringify({ contract: S.cfg.address, chainId: S.cfg.chainId, block: S.latest, ok, replayedHead: report.head, onChainHead: report.onChainHead, entries: report.entries }, null, 2)), { variant: "ghost", size: "sm", iconName: "download" })))));
    // animate the chain lighting up block by block
    const els = report.entries.map((e) => h("div", { class: "blk" }, h("b", null, `#${e.index} ${e.kind.replaceAll("_", " ").toLowerCase()}`), h("div", { class: "h" }, shortHash(e.head, 6)), explorerTx(e.tx) ? h("a", { href: explorerTx(e.tx), target: "_blank", rel: "noopener" }, "tx ↗") : null));
    blocks.replaceChildren(...els);
    report.entries.forEach((e, i) => setTimeout(() => els[i]?.classList.add(e.ok ? "ok" : "bad"), Math.min(i * 45, 2500)));
  }
  await run(false);
}
