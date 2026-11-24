import { h, icon, fmtDate, shortHash, download, copyText } from "../lib/dom.js";
import { S, readConjunctionFull, readStats, latestCommit, chainNow, operatorName } from "../lib/chain.js";
import { W, act } from "../lib/wallet.js";
import { store } from "../lib/store.js";
import { bus } from "../lib/bus.js";
import { toast } from "../lib/toast.js";
import { ACTION, PHASE_NAME, PHASE_INFO, VERDICT_INFO, PLEDGE_INFO, buildPlan, fingerprint, randomSalt, textFingerprint } from "../lib/pact.js";
import { badge, btn, callout, card, field, phaseBadge, verdictBadge, pledgeBadge, addrChip, countdown, txLink, empty } from "../ui.js";
import { openWalletModal } from "../walletui.js";
import { live } from "../lib/dom.js";
import { nextMilestone, scoreRing, repCounts } from "./shared.js";

const STEPS = [["COMMIT", "Seal"], ["REVEAL", "Reveal"], ["LOCKED", "Locked"], ["ATTEST", "Observe"], ["FINALIZED", "Judged"]];

/** Phase computed from the clock so the screen changes the instant a deadline passes. */
function phaseNow(ev) {
  if (ev.finalized) return "FINALIZED";
  const t = chainNow();
  if (t < ev.commitDeadline) return "COMMIT";
  if (t < ev.revealDeadline) return "REVEAL";
  if (t < ev.tca) return "LOCKED";
  return "ATTEST";
}

export default async function eventPage(root, [idStr], ctx) {
  const id = Number(idStr);
  const count = (await readStats()).conjunctions;
  if (!Number.isInteger(id) || id < 1 || id > count) {
    ctx.scene?.setMood("calm");
    root.append(h("div", { class: "wrap", style: { maxWidth: "720px" } }, empty("We could not find that event", `There ${count === 1 ? "is" : "are"} ${count} event${count === 1 ? "" : "s"} on this contract.`, h("a", { class: "btn sm", href: "#/events" }, "Browse events"))));
    return;
  }
  ctx.scene?.setMood("event");

  let ev = null;
  const secH = h("div"), trackH = h("div"), partiesH = h("div"), outcomeH = h("div"), actionsH = h("div"), logH = h("div"), errH = h("div");
  const note = h("div", { class: "scene-note" });
  const ctl = h("div", { class: "scene-ctl" }, btn("Replay approach", async () => ctx.scene?.replay(), { variant: "ghost", size: "sm" }));
  const left = h("div", { class: "stack" }, secH, trackH, partiesH, outcomeH, actionsH, errH, logH);
  root.append(h("div", { class: "wrap" }, h("div", { class: "split" }, left, h("div", { class: "side" }))), ctl, note);

  const redraws = [];
  const mk = (container, sigFn, renderFn) => redraws.push(live(container, sigFn, renderFn));

  mk(secH, () => JSON.stringify([ev.phase, ev.finalized, ev.verdict, ev.predictedMiss]), () => header(ev));
  mk(trackH, () => JSON.stringify([ev.phase, ev.finalized]), () => track(ev));
  mk(partiesH, () => JSON.stringify([ev.phase, ev.sideA, ev.sideB, ev.pledgeA, ev.pledgeB, ev.operatorA, ev.operatorB]), () => parties(ev));
  mk(outcomeH, () => JSON.stringify([ev.phase, ev.finalized, ev.attestations, ev.verdict, ev.observed]), () => outcome(ev));
  mk(actionsH, () => actionSig(ev), () => actions(ev, () => redraws.forEach((r) => r())));
  mk(errH, () => JSON.stringify([ev.errata, ev.opA]), () => errata(ev));
  mk(logH, () => JSON.stringify(ev.timeline.map((t) => t.tx + t.name)), () => timeline(ev));

  async function refresh() {
    const fresh = await readConjunctionFull(id);
    ev = { ...fresh, phase: phaseNow(fresh) };
    ctx.scene?.setEvent(ev);
    note.textContent = (ctx.scene?.basisText || "") + ". Illustration only: orbits and distances are not to scale.";
    redraws.forEach((r) => r());
  }
  await refresh();

  const offTick = bus.on("tick", refresh), offWallet = bus.on("wallet", () => redraws.forEach((r) => r()));
  const clock = setInterval(() => {
    if (!ev) return;
    const p = phaseNow(ev);
    if (p !== ev.phase) { ev = { ...ev, phase: p }; ctx.scene?.setEvent(ev); redraws.forEach((r) => r()); refresh().catch(() => {}); }
  }, 1000);
  return () => { offTick(); offWallet(); clearInterval(clock); };
}

// ------------------------------------------------------------------------------------------------ header
function header(ev) {
  const info = PHASE_INFO[ev.phase];
  return h("div", { class: "stack", style: { gap: "10px" } },
    h("a", { href: "#/events", class: "small" }, "← All events"),
    h("div", { class: "row" }, h("span", { class: "eyebrow" }, "Conjunction #" + ev.id), phaseBadge(ev.phase), ev.finalized ? verdictBadge(ev.verdict) : null),
    h("h1", { style: { fontSize: "clamp(1.9rem,4vw,2.8rem)", } }, h("span", { style: { color: "#fff" } }, ev.satelliteA.label), "  ×  ", h("span", { style: { color: "var(--violet)" } }, ev.satelliteB.label)),
    h("p", { class: "muted" }, info.blurb),
    h("div", { class: "row", style: { gap: "8px" } },
      h("span", { class: "chip" }, "Closest approach ", h("strong", { style: { color: "var(--ink)" } }, fmtDate(ev.tca)), ev.tca > chainNow() ? [" · in ", countdown(ev.tca)] : null),
      h("span", { class: "chip" }, "Predicted miss ", h("strong", { style: { color: "var(--ink)" } }, ev.predictedMiss + " m")),
      h("span", { class: "chip", title: "Fingerprint of the off-chain conjunction message" }, "CDM ", h("span", { class: "mono" }, shortHash(ev.cdmHash, 6))),
      verifier(ev.cdmHash, "conjunction message")));
}

function verifier(expected, what) {
  const out = h("span", { class: "small" });
  const input = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
  input.addEventListener("change", async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const ok = fingerprint(obj).toLowerCase() === expected.toLowerCase();
      out.replaceChildren(badge(ok ? "Matches the chain" : "Does NOT match", ok ? "green" : "red"));
    } catch { out.replaceChildren(badge("Not a valid JSON file", "red")); }
    input.value = "";
  });
  return h("span", { class: "row", style: { gap: "6px", display: "inline-flex" } }, input, h("button", { class: "chip", onClick: () => input.click(), title: `Check a file against the on-chain fingerprint of the ${what}` }, "Verify a file"), out);
}

// ------------------------------------------------------------------------------------------------ phase track
function track(ev) {
  const idx = STEPS.findIndex(([k]) => k === ev.phase);
  const times = { COMMIT: ev.commitDeadline, REVEAL: ev.revealDeadline, LOCKED: ev.tca, ATTEST: ev.attestDeadline };
  const m = nextMilestone(ev);
  return card(null, null,
    h("div", { class: "track" }, ...STEPS.map(([k, label], i) => h("div", { class: "tstep " + (i < idx || ev.finalized ? "done" : i === idx ? "now" : "") }, label, h("small", null, times[k] ? fmtDate(times[k]).replace(/^[A-Za-z]+ \d+, /, "") : "")))),
    m ? h("p", { class: "small", style: { marginTop: "10px" } }, icon("seal"), " ", m.label, countdown(m.at, { done: "any moment now" })) : null);
}

// ------------------------------------------------------------------------------------------------ parties
function parties(ev) {
  return h("div", { class: "grid2" }, party(ev, ev.sideA, ev.operatorA, "a", ev.pledgeA), party(ev, ev.sideB, ev.operatorB, "b", ev.pledgeB));
}

function party(ev, side, op, tag, pledge) {
  const lc = latestCommit(side);
  const afterReveal = ev.phase === "LOCKED" || ev.phase === "ATTEST" || ev.phase === "FINALIZED";
  let box;
  if (side.reveal) {
    box = h("div", { class: "sealbox open " + (side.reveal.action === "HOLD" ? "hold" : "") }, icon("eye"),
      h("div", null, h("strong", null, "Opened: ", side.reveal.action), h("div", { class: "small" }, "Plan fingerprint ", h("span", { class: "mono" }, shortHash(side.reveal.paramsHash, 6)), " ", verifier(side.reveal.paramsHash, "plan"))));
  } else if (lc && afterReveal) {
    box = h("div", { class: "sealbox open" }, icon("warn"), h("div", null, h("strong", null, "Sealed but never opened"), h("div", { class: "small" }, "The reveal window passed without this operator opening their seal.")));
  } else if (lc) {
    box = h("div", { class: "sealbox" }, icon("seal"), h("div", null, h("strong", null, "Sealed. Hidden until reveal."), h("div", { class: "small" }, `Seal #${lc.revision} placed ${fmtDate(lc.at)}. Not even the other operator can see it.`)));
  } else if (afterReveal || ev.phase === "REVEAL") {
    box = h("div", { class: "sealbox none" }, icon("warn"), h("div", null, h("strong", null, "Never sealed a decision"), h("div", { class: "small" }, "Nothing was committed before the deadline.")));
  } else {
    box = h("div", { class: "sealbox none" }, icon("seal"), h("div", null, h("strong", null, "Waiting to seal"), h("div", { class: "small" }, "No decision committed yet.")));
  }
  return h("div", { class: `party ${tag}` },
    h("div", { class: "who" }, badge(tag === "a" ? "Satellite A" : "Satellite B", tag === "a" ? "cyan" : "violet"), ev.finalized ? pledgeBadge(pledge) : null),
    h("div", { class: "sat" }, side.sat.label),
    h("div", { style: { margin: "2px 0 10px" } }, h("a", { href: `#/operator/${side.operator}`, style: { textDecoration: "none" } }, addrChip(side.operator, { name: op.name }))),
    box,
    h("div", { style: { height: "10px" } }),
    h("div", { class: "kv" }, h("span", null, "Seals placed"), h("span", null, side.commits.length ? `${side.commits.length}${side.commits.length > 1 ? " (latest counts)" : ""}` : "none")),
    h("div", { class: "kv" }, h("span", null, "Track record"), op.rated ? h("span", null, `${Math.round(op.score)}% kept`) : h("span", { class: "muted" }, "not rated yet")),
    ev.finalized && PLEDGE_INFO[pledge] ? h("p", { class: "small muted", style: { marginTop: "8px" } }, PLEDGE_INFO[pledge].text) : null,
    side.commits.length > 1 ? h("details", { style: { marginTop: "8px" } }, h("summary", { class: "small muted", style: { cursor: "pointer" } }, "Seal history (append-only)"),
      ...side.commits.map((c) => h("div", { class: "small", style: { padding: "3px 0" } }, `#${c.revision} · ${fmtDate(c.at)} · `, h("span", { class: "mono" }, shortHash(c.hash, 5)), c.superseded ? " · superseded" : " · current"))) : null);
}

// ------------------------------------------------------------------------------------------------ outcome
function outcome(ev) {
  if (!ev.finalized) {
    if (ev.phase !== "ATTEST") return h("div");
    const votes = {};
    for (const a of ev.attestations) { const k = `${a.aMan ? "A moved" : "A held"}, ${b(a)}`; votes[k] = (votes[k] || 0) + 1; }
    return card("Waiting for observations", "eye",
      h("p", { class: "muted" }, `Screeners report what they saw. The event finalizes automatically when ${ev.quorum} matching report${ev.quorum > 1 ? "s" : ""} arrive${ev.quorum > 1 ? "" : "s"}, or anyone can finalize after the window closes (`, h("strong", null, fmtDate(ev.attestDeadline)), ")."),
      ev.attestations.length ? h("div", { class: "stack", style: { gap: "6px" } }, ...Object.entries(votes).map(([k, n]) => h("div", { class: "kv" }, h("span", null, k), h("span", null, `${n} / ${ev.quorum} votes`)))) : h("p", { class: "hint" }, "No reports yet."));
  }
  const v = VERDICT_INFO[ev.verdict];
  const obs = ev.observed
    ? `Screeners observed: ${ev.satelliteA.label} ${ev.observed.aMan ? "maneuvered" : "held"}, ${ev.satelliteB.label} ${ev.observed.bMan ? "maneuvered" : "held"}. Reported miss distance ${ev.observed.miss} m.`
    : "No observation reached quorum, so only silent and withheld promises could be judged.";
  return h("div", { class: "stack", style: { gap: "12px" } },
    h("div", { class: "verdict " + v.tone }, h("div", { style: { fontSize: "2rem" } }, v.tone === "green" ? "✓" : v.tone === "red" ? "!" : "·"),
      h("div", null, h("h3", null, v.label), h("p", { class: "muted", style: { margin: "2px 0 8px" } }, v.text), h("p", { class: "small" }, obs))),
    ev.attestations.length ? card("Screener reports", "eye", h("div", { class: "stack", style: { gap: "6px" } }, ...ev.attestations.map((a) => h("div", { class: "kv" }, h("span", { class: "addr" }, a.screener.slice(0, 8) + "…"), h("span", null, `${a.aMan ? "A moved" : "A held"}, ${b(a)} · ${a.miss} m`))))) : null);
}
const b = (a) => (a.bMan ? "B moved" : "B held");

// ------------------------------------------------------------------------------------------------ actions
function myContext(ev) {
  const me = W.address?.toLowerCase();
  const side = !me ? -1 : me === ev.opA.toLowerCase() ? 0 : me === ev.opB.toLowerCase() ? 1 : -1;
  return { me, side: side >= 0 && W.roles.operator ? side : -1, screener: W.roles.screener };
}

function actionSig(ev) {
  const c = myContext(ev);
  const sd = c.side === 0 ? ev.sideA : c.side === 1 ? ev.sideB : null;
  const lc = sd ? latestCommit(sd) : null;
  const hasSecret = lc && W.address ? !!store.secretForHash(S.cfg.chainId, S.cfg.address, ev.id, W.address, lc.hash) : null;
  const attested = c.screener ? ev.attestations.some((a) => a.screener.toLowerCase() === c.me) : null;
  const late = !ev.finalized && chainNow() > ev.attestDeadline;
  return JSON.stringify([ev.phase, ev.finalized, W.address, W.roles, c.side, sd?.commits.length, !!sd?.reveal, hasSecret, attested, late, ev.errata.length, ev.attestations.length, store.secrets(S.cfg.chainId, S.cfg.address, ev.id, W.address || "0x0").length]);
}

function actions(ev, redrawAll) {
  if (!W.address) {
    return card("Take part", "key", h("p", { class: "muted" }, "Anyone can read this event. To seal a decision, report an observation or file a correction, connect a wallet that has been approved for that role."), btn("Connect wallet", async () => openWalletModal(), { iconName: "key" }));
  }
  const c = myContext(ev);
  const out = [];
  const sd = c.side === 0 ? ev.sideA : ev.sideB;

  if (c.side >= 0) {
    if (ev.phase === "COMMIT") out.push(sealForm(ev, c.side, sd, redrawAll));
    else if (ev.phase === "REVEAL") out.push(revealPanel(ev, c.side, sd, redrawAll));
    else if (!ev.finalized) out.push(card("Your decision is locked", "seal", h("p", { class: "muted" }, sd.reveal ? `You opened your seal (${sd.reveal.action}). Nothing more to do until the closest approach has been observed.` : latestCommit(sd) ? "The reveal window has closed and your seal was never opened. This will be recorded as withheld." : "You did not seal a decision in time. This will be recorded as silent.")));
  }

  if (c.screener && ev.phase === "ATTEST" && !ev.finalized) out.push(attestPanel(ev, c));

  if (!ev.finalized && chainNow() > ev.attestDeadline) {
    out.push(card("This event can be closed", "scale", h("p", { class: "muted" }, "The observation window is over without enough matching reports. Anyone can finalize now. Silent and withheld promises are still judged."), btn("Finalize event", async () => { await act("Finalize event", "finalize", [ev.id]); }, { iconName: "check" })));
  }

  if (c.side >= 0 || c.screener) out.push(correctionForm(ev));

  if (!out.length) {
    out.push(card("You are watching", "eye",
      h("p", { class: "muted" }, "This wallet doesn't operate either satellite in this event, so there is nothing for it to do here."),
      h("div", { class: "row" }, ...[W.roles.admin ? badge("Admin", "amber") : null, W.roles.operator ? badge("Operator " + (W.roles.name || ""), "cyan") : null, W.roles.screener ? badge("Screener", "violet") : null, !W.roles.admin && !W.roles.operator && !W.roles.screener ? badge("No role", "grey") : null]),
      h("p", { class: "hint", style: { marginTop: "8px" } }, "Switch wallet from the button in the header to act as one of the two operators.")));
  }
  return h("div", { class: "stack" }, ...out);
}

// ---- seal ------------------------------------------------------------------------------------------------
function sealForm(ev, side, sd, redrawAll) {
  const sat = sd.sat;
  const previously = latestCommit(sd);
  let action = "HOLD";
  const dv = h("input", { class: "input", type: "number", step: "0.01", min: "0.01", value: "0.10" });
  const dir = h("select", { class: "select" }, ...["prograde", "retrograde", "radial-out", "radial-in", "normal", "anti-normal"].map((x) => h("option", { value: x }, x)));
  const hrs = h("input", { class: "input", type: "number", step: "0.5", min: "0.1", max: "72", value: "6" });
  const why = h("textarea", { class: "textarea", placeholder: "Optional note, e.g. risk is below our threshold." });
  const detail = h("div"); const holdBtn = h("button", { type: "button", class: "on hold" }, h("strong", null, "HOLD"), h("span", null, "Stay on the current orbit. Someone else may move.")); const manBtn = h("button", { type: "button" }, h("strong", null, "MANEUVER"), h("span", null, "Burn to raise the miss distance. You take the risk off the table."));
  const fp = h("div", { class: "hint" });
  const planOf = () => buildPlan({ label: sat.label, action, deltaV: dv.value, direction: dir.value, hoursBefore: hrs.value, rationale: why.value.trim(), tcaUnix: ev.tca });
  const refresh = () => {
    holdBtn.className = action === "HOLD" ? "on hold" : ""; manBtn.className = action === "MANEUVER" ? "on man" : "";
    detail.replaceChildren(action === "MANEUVER"
      ? h("div", { class: "grid3" }, field("Delta-v (m/s)", dv), field("Direction", dir), field("Burn starts (hours before closest approach)", hrs))
      : field("Why hold? (stays in your browser)", why));
    try { fp.textContent = "Fingerprint that goes on chain with your reveal: " + shortHash(fingerprint(planOf()), 8) + ". The plan itself never leaves your browser."; } catch { fp.textContent = ""; }
  };
  holdBtn.addEventListener("click", () => { action = "HOLD"; refresh(); }); manBtn.addEventListener("click", () => { action = "MANEUVER"; refresh(); });
  [dv, dir, hrs, why].forEach((i) => i.addEventListener("input", refresh));
  refresh();

  const secrets = store.secrets(S.cfg.chainId, S.cfg.address, ev.id, W.address);
  return card(previously ? "Update your seal" : "Seal your decision", "seal",
    h("p", { class: "muted" }, `You operate ${sat.label}. Choose what you will do. It is hashed with a secret salt, so nobody, including ${side === 0 ? ev.satelliteB.label : ev.satelliteA.label}'s operator, can see it until reveals open. You can change your mind until `, h("strong", null, fmtDate(ev.commitDeadline)), "."),
    previously ? callout("info", "seal", "You already sealed a decision. A new seal replaces it, but the old one stays on the public record as superseded.") : null,
    h("div", { style: { height: "10px" } }),
    h("div", { class: "choice" }, holdBtn, manBtn), h("div", { style: { height: "14px" } }), detail, fp, h("div", { style: { height: "12px" } }),
    h("div", { class: "row" },
      btn(previously ? "Seal new decision" : "Seal on chain", async () => {
        const plan = planOf();
        if (action === "MANEUVER" && !(Number(dv.value) > 0)) { toast({ tone: "warn", title: "Check your plan", text: "Delta-v must be greater than zero." }); return; }
        if (action === "MANEUVER" && !(Number(hrs.value) > 0)) { toast({ tone: "warn", title: "Check your plan", text: "The burn must start before the closest approach." }); return; }
        const paramsHash = fingerprint(plan);
        const salt = randomSalt();
        const satId = sat.id;
        const hash = await S.contract.commitmentHash(ev.id, satId, W.address, ACTION[action], paramsHash, salt);
        store.saveSecret(S.cfg.chainId, S.cfg.address, ev.id, W.address, { action, plan, paramsHash, salt, hash, savedAt: chainNow() });
        await act(`Seal ${action}`, "commit", [ev.id, hash]);
      }, { iconName: "seal" }),
      secrets.length ? btn("Download secret backup", async () => download(`skypact-secret-event${ev.id}-${W.address.slice(0, 8)}.json`, JSON.stringify(store.exportSecrets(S.cfg.chainId, S.cfg.address, ev.id, W.address), null, 2)), { variant: "ghost", iconName: "download" }) : null),
    secrets.length ? callout("good", "check", "Your secret is saved in this browser and is needed to reveal. Download the backup if you might switch device.") : null);
}

// ---- reveal ------------------------------------------------------------------------------------------------
function revealPanel(ev, side, sd, redrawAll) {
  const lc = latestCommit(sd);
  if (sd.reveal) return card("Revealed", "eye", callout("good", "check", `You opened your seal: ${sd.reveal.action}. It matched what you sealed.`));
  if (!lc) return card("Nothing to reveal", "eye", callout("warn", "warn", "You never sealed a decision for this event, so there is nothing to open. You will be recorded as silent."));
  const secret = store.secretForHash(S.cfg.chainId, S.cfg.address, ev.id, W.address, lc.hash);
  if (!secret) {
    const input = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
    input.addEventListener("change", async () => {
      try { store.importSecrets(JSON.parse(await input.files[0].text())); toast({ tone: "good", title: "Backup imported" }); redrawAll(); } catch (e) { toast({ tone: "bad", title: "Could not import", text: e.message }); }
      input.value = "";
    });
    return card("Reveal your decision", "eye",
      callout("warn", "warn", "This browser doesn't have the secret for your latest seal, and without it the contract will refuse the reveal. If you sealed from another browser or device, import the backup file you downloaded there."),
      h("div", { style: { height: "10px" } }), input, btn("Import secret backup", async () => input.click(), { iconName: "download" }));
  }
  return card("Reveal your decision", "eye",
    h("p", { class: "muted" }, "Seals are locked. Open yours now. The contract will check it matches exactly what you sealed, so nobody can change their mind."),
    h("div", { class: "sealbox open " + (secret.action === "HOLD" ? "hold" : "") }, icon("seal"), h("div", null, h("strong", null, "Your sealed decision: ", secret.action), h("div", { class: "small" }, secret.action === "MANEUVER" ? `Δv ${secret.plan.deltaVMetersPerSec} m/s ${secret.plan.direction}` : (secret.plan.rationale || "")))),
    h("div", { style: { height: "12px" } }),
    btn(`Reveal ${secret.action}`, async () => { await act(`Reveal ${secret.action}`, "reveal", [ev.id, ACTION[secret.action], secret.paramsHash, secret.salt]); }, { iconName: "eye" }),
    h("p", { class: "hint", style: { marginTop: "8px" } }, "Reveals close at ", fmtDate(ev.revealDeadline), "."));
}

// ---- attest ------------------------------------------------------------------------------------------------
function attestPanel(ev, c) {
  if (ev.attestations.some((a) => a.screener.toLowerCase() === c.me)) return card("Your report is in", "eye", callout("good", "check", `You already reported. ${ev.attestations.length} of ${ev.quorum} matching report${ev.quorum > 1 ? "s" : ""} needed to finalize.`));
  let a = false, bm = false;
  const miss = h("input", { class: "input", type: "number", min: "0", step: "1", placeholder: "Closest observed distance in meters" });
  const tog = (label, get, set) => { const el = h("button", { type: "button", class: "chip", style: { padding: "10px 16px" } }, ""); const r = () => { el.textContent = `${label}: ${get() ? "MANEUVERED" : "held"}`; el.className = "chip" + (get() ? " on" : ""); }; el.addEventListener("click", () => { set(!get()); r(); }); r(); return el; };
  return card("Report what you observed", "eye",
    h("p", { class: "muted" }, "The closest approach has passed. Tell the contract what your tracking actually showed. When ", String(ev.quorum), " screener" + (ev.quorum > 1 ? "s agree" : " reports"), ", the event finalizes and every promise is judged."),
    h("div", { class: "row" }, tog(ev.satelliteA.label, () => a, (v) => (a = v)), tog(ev.satelliteB.label, () => bm, (v) => (bm = v))),
    h("div", { style: { height: "12px" } }), field("Observed miss distance (m)", miss),
    btn("Report observation", async () => {
      if (miss.value === "" || Number(miss.value) < 0) { toast({ tone: "warn", title: "Add the miss distance", text: "Enter the closest distance you observed, in meters." }); return; }
      await act("Report observation", "attest", [ev.id, (a ? 1 : 0) | (bm ? 2 : 0), Math.round(Number(miss.value))]);
    }, { iconName: "check" }));
}

// ---- corrections ------------------------------------------------------------------------------------------
function correctionForm(ev) {
  const text = h("textarea", { class: "textarea", placeholder: "Describe the correction or clarification. Only its fingerprint goes on chain." });
  return card("File a correction", "scale",
    h("p", { class: "muted" }, "Records are never edited. If something needs clarifying, add a new dated note. Its fingerprint is stored on chain; the text stays with you."),
    text, h("div", { style: { height: "10px" } }),
    btn("File correction note", async () => {
      const t = text.value.trim();
      if (!t) { toast({ tone: "warn", title: "Write the note first" }); return; }
      const hash = textFingerprint(t);
      store.saveNote(hash, t);
      await act("File correction", "fileErratum", [ev.id, hash]);
      text.value = "";
    }, { variant: "ghost" }));
}

function errata(ev) {
  if (!ev.errata.length) return h("div");
  return card("Corrections on record", "scale", h("div", { class: "stack", style: { gap: "10px" } }, ...ev.errata.map((e) => {
    const local = store.note(e.noteHash);
    return h("div", { class: "party" }, h("div", { class: "small muted" }, fmtDate(e.at), " · ", operatorName(e.by) || shortHash(e.by, 4), " · ", h("span", { class: "mono" }, shortHash(e.noteHash, 6))), local ? h("p", null, local) : h("p", { class: "hint" }, "Note text isn't stored in this browser. Only its fingerprint is on chain."));
  })));
}

// ---- timeline ------------------------------------------------------------------------------------------------
function timeline(ev) {
  const row = (t) => {
    const a = t.args;
    const who = (addr) => operatorName(addr) || shortHash(addr, 4);
    switch (t.name) {
      case "ConjunctionOpened": return [fmtDate(Number(a.snapshot.openedAt)), `Opened by a screener between ${ev.satelliteA.label} and ${ev.satelliteB.label}`];
      case "Committed": return [fmtDate(Number(a.getValue("at"))), `${who(a.operator)} sealed a decision (seal #${Number(a.revision)}). Hidden.`];
      case "Revealed": return [fmtDate(Number(a.getValue("at"))), `${who(a.operator)} opened their seal: ${["", "HOLD", "MANEUVER"][Number(a.action)]}`];
      case "Attested": return [fmtDate(Number(a.getValue("at"))), `Screener ${shortHash(a.screener, 4)} reported ${(Number(a.mask) & 1) ? "A moved" : "A held"}, ${(Number(a.mask) & 2) ? "B moved" : "B held"}, miss ${Number(a.missMeters)} m${a.quorumReached ? " (quorum reached)" : ""}`];
      case "Finalized": return [fmtDate(Number(a.getValue("at"))), "Contract finalized the event and judged every promise"];
      case "ErratumFiled": return [fmtDate(Number(a.getValue("at"))), `${who(a.by)} filed a correction note`];
      default: return [null, t.name];
    }
  };
  return card("On-chain history", "chain", h("ul", { class: "tl" }, ...ev.timeline.map((t) => { const [time, text] = row(t); return h("li", null, h("div", null, text), h("div", { class: "t" }, time, " · ", txLink(t.tx, "tx ↗"))); })));
}
