import { h } from "../lib/dom.js";
import { readOperators, screenersFromLogs, satellitesFromLogs } from "../lib/chain.js";
import { bus } from "../lib/bus.js";
import { badge, card, addrChip, empty } from "../ui.js";
import { scoreRing } from "./shared.js";

export default async function operators(root, _a, ctx) {
  ctx.scene?.setMood("calm");
  const body = h("div", { class: "stack" });
  root.append(h("div", { class: "wrap", style: { maxWidth: "980px" } }, h("div", { class: "stack" },
    h("div", null, h("span", { class: "eyebrow" }, "Reputation"), h("h1", { style: { fontSize: "2.2rem", marginTop: "6px" } }, "Operators and their record"),
      h("p", { class: "muted" }, "Scores are computed by the contract, never typed in by anyone. Score = promises kept ÷ promises judged. Staying silent or never opening a seal counts against you.")),
    body)));
  async function draw() {
    const ops = (await readOperators()).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const sats = satellitesFromLogs();
    const screeners = screenersFromLogs();
    body.replaceChildren(
      ops.length ? h("div", { class: "card", style: { padding: "8px 8px" } }, h("table", { class: "t" },
        h("thead", null, h("tr", null, ...["Operator", "Score", "Kept", "Broken", "Withheld", "Silent", "Satellites", "Status"].map((x) => h("th", null, x)))),
        h("tbody", null, ...ops.map((o) => h("tr", { class: "click", onClick: () => (location.hash = `#/operator/${o.address}`) },
          h("td", null, addrChip(o.address, { name: o.name })),
          h("td", null, h("div", { class: "row", style: { gap: "10px" } }, h("div", { class: "bar" }, h("i", { style: { width: (o.score ?? 0) + "%" } })), h("strong", null, o.rated ? Math.round(o.score) + "%" : "not rated"))),
          h("td", null, o.kept), h("td", null, o.broken), h("td", null, o.withheld), h("td", null, o.silent),
          h("td", null, sats.filter((s) => s.operator.toLowerCase() === o.address.toLowerCase()).length),
          h("td", null, o.active ? badge("Active", "green") : badge("Revoked", "grey"))))))) : empty("No operators approved yet", "The admin approves operators from the console.", h("a", { class: "btn sm", href: "#/console" }, "Open console")),
      card("Screeners", "radar", h("p", { class: "hint" }, "Independent services allowed to open conjunctions and report what they observed."), screeners.length ? h("div", { class: "row" }, ...screeners.map((a) => h("span", { class: "chip" }, h("span", { class: "addr" }, a)))) : h("p", { class: "muted" }, "None approved yet.")));
  }
  await draw();
  return bus.on("tick", draw);
}
