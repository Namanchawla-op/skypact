import { h, icon, shortHash } from "../lib/dom.js";
import { readStats, readConjunctions, readOperators, satellitesFromLogs, S } from "../lib/chain.js";
import { W } from "../lib/wallet.js";
import { bus } from "../lib/bus.js";
import { btn, card, empty, addrLink } from "../ui.js";
import { openWalletModal } from "../walletui.js";
import { eventItem, scoreRing, repCounts, animateNumber } from "./shared.js";

export default async function home(root, _a, ctx) {
  ctx.scene?.setMood("overview");
  const wrap = h("div", { class: "wrap" });
  root.append(wrap);
  let last = "";

  async function draw() {
    const [stats, events, ops] = await Promise.all([readStats(), readConjunctions(), readOperators()]);
    const sats = satellitesFromLogs();
    ctx.scene?.setOverview({ satellites: sats, events });
    const sig = JSON.stringify([stats, events.map((e) => [e.id, e.phase, e.verdict]), ops.map((o) => [o.address, o.kept, o.broken, o.withheld, o.silent]), W.address, W.roles]);
    if (sig === last) return;
    last = sig;

    const judged = events.filter((e) => e.finalized);
    const kept = ops.reduce((n, o) => n + o.kept, 0);
    const broke = ops.reduce((n, o) => n + o.broken + o.withheld + o.silent, 0);
    const tile = (n, label) => { const v = h("div", { class: "n", "data-v": 0 }, "0"); setTimeout(() => animateNumber(v, n), 50); return h("div", { class: "card stat" }, v, h("div", { class: "l" }, label)); };
    const ranked = ops.filter((o) => o.rated).sort((a, b) => b.score - a.score).slice(0, 3);
    const mine = W.address && (W.roles.admin || W.roles.operator || W.roles.screener);

    wrap.replaceChildren(
      h("div", { class: "split" }, h("div", { class: "stack hero" },
        h("span", { class: "eyebrow" }, icon("seal"), "Verifiable records · ", S.cfg.chainName),
        h("h1", null, "Orbital promises, ", h("span", { class: "grad" }, "sealed before they can be broken.")),
        h("p", { class: "lead" }, "When two satellites are on course for a close approach, each operator seals its decision on chain without seeing the other's. Afterwards, a smart contract checks what really happened and scores who kept their word."),
        h("div", { class: "row cta" },
          h("a", { class: "btn big", href: "#/events" }, "Watch live events"),
          mine ? h("a", { class: "btn ghost big", href: "#/console" }, "Open my console") : btn("Connect a wallet", async () => openWalletModal(), { variant: "ghost", size: "big", iconName: "key" }),
          h("a", { class: "btn ghost big", href: "#/audit" }, "Audit the ledger")),
        h("p", { class: "hint", style: { marginTop: "14px" } }, "No wallet needed to read anything. Every number on this site is read live from the contract.")),
        h("div", { class: "side" })),

      h("div", { class: "grid5", style: { marginTop: "46px" } },
        tile(stats.satellites, "Satellites registered"), tile(stats.conjunctions, "Conjunctions opened"), tile(kept, "Promises kept"), tile(broke, "Promises broken or missed"), tile(stats.entries, "Ledger entries")),

      h("h2", { style: { margin: "50px 0 14px", fontSize: "1.6rem" } }, "How a conjunction plays out"),
      h("div", { class: "grid5" },
        step(1, "radar", "Open", "An approved screener flags two satellites on a collision course and sets the schedule."),
        step(2, "seal", "Seal", "Each operator commits to hold or maneuver as a hash. Nobody can see it. Deadline is final."),
        step(3, "eye", "Reveal", "Seals open. The contract refuses any answer that doesn't match what was sealed."),
        step(4, "radar", "Observe", "Independent screeners report what they actually saw after closest approach."),
        step(5, "scale", "Judge", "The contract scores every promise and updates each operator's public record.")),

      h("div", { class: "grid2", style: { marginTop: "34px" } },
        card("Latest events", "radar",
          events.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...events.slice(0, 4).map(eventItem), events.length > 4 ? h("a", { href: "#/events", class: "small" }, `See all ${events.length} events →`) : null)
            : empty("No conjunctions yet", "A screener opens the first one from the console.", h("a", { class: "btn sm", href: "#/console" }, "Open console"))),
        card("Promise-keeping leaderboard", "scale",
          ranked.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...ranked.map((o) => h("a", { class: "item", href: `#/operator/${o.address}` }, scoreRing(o.score, 54), h("div", { class: "main" }, h("div", { class: "title" }, o.name || "Operator"), h("div", { class: "sub" }, repCounts(o)))))) 
            : empty("Nobody is rated yet", "Scores appear once an event has been finalized.", null))),

      h("div", { class: "grid3", style: { marginTop: "16px" } },
        card("Can't backdate", "seal", h("p", { class: "muted" }, "A seal after the deadline is refused by the contract. The block's timestamp is the only clock that counts.")),
        card("Can't change your mind", "scale", h("p", { class: "muted" }, "A reveal must hash to exactly what was sealed. Corrections are new entries; nothing is edited or deleted.")),
        card("Not a spreadsheet", "chain", h("p", { class: "muted" }, "In a shared sheet either side can say \"I told you first\". Here the contract scores promise-keeping itself, and anyone can audit the whole history."))),

      contractCard(stats));
  }

  function contractCard(stats) {
    const c = card("Contract", "chain",
      h("div", { class: "row between" },
        h("div", null, h("div", { class: "small muted" }, S.cfg.chainName), h("div", null, h("span", { class: "mono" }, S.cfg.address), "  ", addrLink(S.cfg.address, "Open in explorer ↗"))),
        h("div", { class: "small muted" }, "Ledger head ", h("span", { class: "mono" }, shortHash(stats.head, 10)), " · ", h("a", { href: "#/audit" }, "verify it yourself"))),
      h("p", { class: "hint", style: { marginTop: "10px" } }, "All satellites, operators and data in this demo are fictional. Test network only; no real money."));
    c.style.marginTop = "16px";
    return c;
  }

  await draw();
  const off = bus.on("tick", draw), off2 = bus.on("wallet", draw);
  return () => { off(); off2(); };
}

const step = (n, ic, title, text) => h("div", { class: "card step" }, h("span", { class: "no" }, n), icon(ic), h("h4", null, title), h("p", null, text));
