import { h } from "../lib/dom.js";
import { readConjunctions, satLabel, operatorName } from "../lib/chain.js";
import { bus } from "../lib/bus.js";
import { empty } from "../ui.js";
import { eventItem } from "./shared.js";

export default async function events(root, _a, ctx) {
  ctx.scene?.setMood("calm");
  let filter = "all", query = "";
  const list = h("div", { class: "stack", style: { gap: "10px" } });
  const chips = h("div", { class: "row" });
  const search = h("input", { class: "input", placeholder: "Search by satellite or operator, e.g. SAT-001", style: { maxWidth: "380px" } });
  root.append(h("div", { class: "wrap", style: { maxWidth: "900px" } }, h("div", { class: "stack" },
    h("div", null, h("span", { class: "eyebrow" }, "Public record"), h("h1", { style: { fontSize: "2.2rem", marginTop: "6px" } }, "Conjunction events"), h("p", { class: "muted" }, "Every close approach ever raised on this contract. Open one to see who sealed what, when, and how it ended.")),
    h("div", { class: "row between" }, chips, search), list)));

  const FILTERS = [["all", "All"], ["open", "In progress"], ["COMMIT", "Sealing"], ["REVEAL", "Reveal"], ["ATTEST", "Observing"], ["FINALIZED", "Finalized"]];
  async function draw() {
    const evs = await readConjunctions();
    chips.replaceChildren(...FILTERS.map(([k, l]) => h("button", { class: "chip" + (filter === k ? " on" : ""), onClick: () => { filter = k; draw(); } }, l)));
    const q = query.toLowerCase();
    const shown = evs.filter((e) => {
      if (filter === "open" && e.finalized) return false;
      if (!["all", "open"].includes(filter) && e.phase !== filter) return false;
      if (q) { const hay = `${satLabel(e.satA)} ${satLabel(e.satB)} ${operatorName(e.opA) || ""} ${operatorName(e.opB) || ""} #${e.id}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
    list.replaceChildren(...(shown.length ? shown.map(eventItem) : [empty(evs.length ? "Nothing matches" : "No events yet", evs.length ? "Try a different filter." : "Events appear here as soon as a screener opens one.", null)]));
    ctx.scene?.setOverview({ satellites: (await import("../lib/chain.js")).satellitesFromLogs(), events: evs });
  }
  search.addEventListener("input", () => { query = search.value; draw(); });
  await draw();
  const off = bus.on("tick", draw);
  return off;
}
