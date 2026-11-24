import { h } from "../lib/dom.js";
import { satLabel, operatorName } from "../lib/chain.js";
import { badge, phaseBadge, verdictBadge, countdown } from "../ui.js";

export function nextMilestone(ev) {
  switch (ev.phase) {
    case "COMMIT": return { label: "Seals close in ", at: ev.commitDeadline };
    case "REVEAL": return { label: "Reveals close in ", at: ev.revealDeadline };
    case "LOCKED": return { label: "Closest approach in ", at: ev.tca };
    case "ATTEST": return { label: "Observation window closes in ", at: ev.attestDeadline };
    default: return null;
  }
}

export function eventItem(ev) {
  const m = nextMilestone(ev);
  return h("a", { class: "item", href: `#/event/${ev.id}` },
    h("div", { style: { color: "var(--faint)", minWidth: "34px" } }, "#" + ev.id),
    h("div", { class: "main" },
      h("div", { class: "title" }, h("span", { style: { color: "#fff" } }, satLabel(ev.satA)), "  ×  ", h("span", { style: { color: "var(--violet)" } }, satLabel(ev.satB))),
      h("div", { class: "sub" }, `${operatorName(ev.opA) || "Operator"} vs ${operatorName(ev.opB) || "Operator"} · predicted miss ${ev.predictedMiss} m`,
        m ? [" · ", m.label, countdown(m.at, { done: "any moment" })] : null)),
    ev.finalized ? verdictBadge(ev.verdict) : phaseBadge(ev.phase));
}

export function scoreRing(score, size = 74) {
  const pct = score == null ? 0 : score;
  return h("div", {
    style: { width: size + "px", height: size + "px", borderRadius: "50%", display: "grid", placeItems: "center", flex: "none",
      background: score == null ? "rgba(255,255,255,.16)" : `conic-gradient(#fff ${pct * 3.6}deg, rgba(255,255,255,.16) 0)` },
  }, h("div", { style: { width: size - 14 + "px", height: size - 14 + "px", borderRadius: "50%", background: "#000", display: "grid", placeItems: "center", fontSize: size > 60 ? "1.05rem" : ".85rem" } }, score == null ? "n/a" : Math.round(pct) + "%"));
}

export function repCounts(op) {
  return h("div", { class: "row", style: { gap: "6px" } }, badge(`${op.kept} kept`, "green"), op.broken ? badge(`${op.broken} broken`, "red") : null, op.withheld ? badge(`${op.withheld} withheld`, "amber") : null, op.silent ? badge(`${op.silent} silent`, "red") : null);
}

export function animateNumber(el, to) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  if (from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 700); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
