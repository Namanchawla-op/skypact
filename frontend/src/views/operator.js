import { h } from "../lib/dom.js";
import { ethers } from "ethers";
import { readOperator, readConjunctions, satellitesFromLogs } from "../lib/chain.js";
import { bus } from "../lib/bus.js";
import { badge, card, addrLink, empty } from "../ui.js";
import { scoreRing, repCounts, eventItem } from "./shared.js";

export default async function operatorPage(root, [addr], ctx) {
  ctx.scene?.setMood("calm");
  let address;
  try { address = ethers.getAddress(addr); } catch { root.append(h("div", { class: "wrap" }, empty("That is not a wallet address", "Check the link.", h("a", { class: "btn sm", href: "#/operators" }, "All operators")))); return; }
  const body = h("div", { class: "stack" });
  root.append(h("div", { class: "wrap", style: { maxWidth: "900px" } }, body));
  async function draw() {
    const [op, evs] = await Promise.all([readOperator(address), readConjunctions()]);
    const mine = evs.filter((e) => e.opA.toLowerCase() === address.toLowerCase() || e.opB.toLowerCase() === address.toLowerCase());
    const sats = satellitesFromLogs().filter((s) => s.operator.toLowerCase() === address.toLowerCase());
    body.replaceChildren(
      h("a", { href: "#/operators", class: "small" }, "← All operators"),
      h("div", { class: "card row", style: { gap: "22px", padding: "24px" } },
        scoreRing(op.score, 96),
        h("div", { style: { flex: 1, minWidth: "220px" } },
          h("h1", { style: { fontSize: "1.8rem" } }, op.name || "Unregistered wallet"),
          h("div", { class: "row", style: { margin: "6px 0" } }, op.known ? (op.active ? badge("Active operator", "green") : badge("Revoked", "grey")) : badge("Not an operator", "grey"), h("span", { class: "addr" }, address), addrLink(address, "explorer ↗")),
          op.rated ? repCounts(op) : h("p", { class: "muted" }, "Not rated yet. A score appears after this operator's first judged promise."))),
      card("Satellites", "radar", sats.length ? h("div", { class: "row" }, ...sats.map((s) => h("span", { class: "chip on" }, s.label))) : h("p", { class: "muted" }, "None registered.")),
      card("Conjunction history", "scale", mine.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...mine.map(eventItem)) : h("p", { class: "muted" }, "No events involve this operator yet.")));
  }
  await draw();
  return bus.on("tick", draw);
}
