import { ethers } from "ethers";
import { h, icon, fmtDate, shortAddr, live, copyText, download, shortHash } from "../lib/dom.js";
import { S, readStats, readOperators, readConjunctions, satellitesFromLogs, screenersFromLogs, operatorName, chainNow, satLabel } from "../lib/chain.js";
import { W, act, refreshRoles } from "../lib/wallet.js";
import { bus } from "../lib/bus.js";
import { toast } from "../lib/toast.js";
import { buildCdm, sampleCdmFields, fingerprint } from "../lib/pact.js";
import { latestCommit, readConjunctionFull } from "../lib/chain.js";
import { badge, btn, callout, card, field, addrChip, empty, phaseBadge } from "../ui.js";
import { openWalletModal, roleBadges } from "../walletui.js";
import { eventItem, scoreRing, repCounts } from "./shared.js";

const DESKS = [["operator", "Operator desk"], ["screener", "Screener desk"], ["admin", "Admin desk"]];

export default async function consoleView(root, _a, ctx) {
  ctx.scene?.setMood("calm");
  let desk = null;
  const head = h("div"), tabs = h("div", { class: "row" }), body = h("div", { class: "stack" });
  root.append(h("div", { class: "wrap", style: { maxWidth: "980px" } }, h("div", { class: "stack" }, head, tabs, body)));

  let data = { stats: null, ops: [], events: [] };
  const available = () => DESKS.filter(([k]) => W.roles[k]);

  const drawHead = live(head, () => JSON.stringify([W.address, W.roles, W.balance?.toString()]), () => {
    if (!W.address) return h("div", null, h("span", { class: "eyebrow" }, "Console"), h("h1", { style: { fontSize: "2.2rem", marginTop: "6px" } }, "Take part"), h("p", { class: "muted" }, "Connect a wallet to act as an operator, a screener or the admin."));
    const bal = W.balance != null ? Number(ethers.formatEther(W.balance)) : null;
    return h("div", { class: "card row between" },
      h("div", null, h("div", { class: "row" }, h("strong", { style: { fontSize: "1.2rem" } }, W.roles.name || "Your wallet"), ...roleBadges(W.roles)), h("div", { class: "addr", style: { marginTop: "4px" } }, W.address, " ", bal != null ? `· ${bal.toFixed(4)} ${S.cfg.currency}` : ""), bal === 0 ? h("p", { class: "small", style: { color: "var(--amber)", margin: "6px 0 0" } }, "This wallet has no test ETH yet. Use the faucet from the hackathon channel, then come back.") : null),
      btn("Switch wallet", async () => openWalletModal(), { variant: "ghost", size: "sm", iconName: "key" }));
  });

  const drawTabs = live(tabs, () => JSON.stringify([W.address, W.roles, desk]), () => {
    const av = available();
    if (!av.find(([k]) => k === desk)) desk = av[0]?.[0] || null;
    return h("div", { class: "row" }, ...av.map(([k, l]) => h("button", { class: "chip" + (desk === k ? " on" : ""), onClick: () => { desk = k; drawTabs(); drawBody(); } }, l)));
  });

  const drawBody = live(body, () => JSON.stringify([W.address, W.roles, desk, data.stats?.satellites, data.stats?.conjunctions, data.ops.map((o) => [o.address, o.active, o.kept, o.broken, o.withheld, o.silent]), screenersFromLogs(), data.events.map((e) => [e.id, e.phase, e.finalized])]), () => {
    if (!W.address) return onboarding();
    if (!desk) return noRole();
    if (desk === "operator") return operatorDesk(data);
    if (desk === "screener") return screenerDesk(data);
    return adminDesk(data);
  });

  async function load() {
    const [stats, ops, events] = await Promise.all([readStats(), readOperators(), readConjunctions()]);
    data = { stats, ops, events };
    drawHead(); drawTabs(); drawBody();
  }
  await load();
  const offs = [bus.on("tick", load), bus.on("wallet", load)];
  return () => offs.forEach((o) => o());
}

// ------------------------------------------------------------------------------------------------ onboarding
function onboarding() {
  const role = (ic, title, text) => card(title, ic, h("p", { class: "muted" }, text));
  return h("div", { class: "stack" },
    h("div", { class: "grid3" },
      role("seal", "Operator", "Runs satellites. Registers them, seals a hold-or-maneuver decision for each conjunction, then reveals it."),
      role("radar", "Screener", "An independent tracking service. Opens conjunction events and reports what was actually observed afterwards."),
      role("key", "Admin", "Decides which wallets are approved as operators and screeners, and sets how many matching observations finalize an event.")),
    card("Get started", "key", h("p", { class: "muted" }, "Connect MetaMask, or add test wallets to switch between roles instantly (handy for a live demo)."), btn("Connect or add a wallet", async () => openWalletModal(), { iconName: "key" })));
}

function noRole() {
  return h("div", { class: "stack" }, card("This wallet isn't approved for a role yet", "key",
    h("p", { class: "muted" }, "Only the admin can approve operators and screeners. Send them this address:"),
    h("div", { class: "row" }, h("code", { style: { fontSize: ".95rem" } }, W.address), btn("Copy address", async () => { await copyText(W.address); toast({ tone: "good", title: "Address copied" }); }, { size: "sm", variant: "ghost", iconName: "copy" })),
    h("p", { class: "hint", style: { marginTop: "10px" } }, "You can still read everything on the site without a role.")));
}

// ------------------------------------------------------------------------------------------------ operator desk
function operatorDesk({ events, ops }) {
  const me = W.address.toLowerCase();
  const mySats = satellitesFromLogs().filter((s) => s.operator.toLowerCase() === me);
  const myEvents = events.filter((e) => e.opA.toLowerCase() === me || e.opB.toLowerCase() === me);
  const myOp = ops.find((o) => o.address.toLowerCase() === me);
  const label = h("input", { class: "input", placeholder: "SAT-001", maxlength: 32 });
  const todo = myEvents.filter((e) => !e.finalized && ["COMMIT", "REVEAL"].includes(phaseOf(e)));

  return h("div", { class: "stack" },
    todo.length ? card("Needs your attention", "warn", h("div", { class: "stack", style: { gap: "10px" } }, ...todo.map(eventItem))) : null,
    h("div", { class: "grid2" },
      card("Register a satellite", "radar",
        h("p", { class: "muted" }, "Use a fictional identifier such as SAT-001. Never a real catalogue number. Labels are unique and permanent."),
        field("Satellite label", label),
        btn("Register satellite", async () => { const v = label.value.trim(); if (!v) { toast({ tone: "warn", title: "Enter a label first" }); return; } await act("Register " + v, "registerSatellite", [v]); label.value = ""; }, { iconName: "check" }),
        h("div", { style: { height: "12px" } }),
        mySats.length ? h("div", { class: "row" }, ...mySats.map((s) => h("span", { class: "chip on" }, s.label))) : h("p", { class: "hint" }, "You have no satellites yet.")),
      card("Your track record", "scale", myOp?.rated ? h("div", { class: "row", style: { gap: "18px" } }, scoreRing(myOp.score, 90), h("div", null, h("div", { class: "muted small" }, "Promises kept"), repCounts(myOp))) : h("p", { class: "muted" }, "You aren't rated yet. Your score appears after the first event you take part in is finalized."))),
    card("Your events", "radar", myEvents.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...myEvents.map(eventItem)) : h("p", { class: "muted" }, "No conjunctions involve your satellites yet. A screener opens them.")));
}

const phaseOf = (e) => { if (e.finalized) return "FINALIZED"; const t = chainNow(); return t < e.commitDeadline ? "COMMIT" : t < e.revealDeadline ? "REVEAL" : t < e.tca ? "LOCKED" : "ATTEST"; };

// ------------------------------------------------------------------------------------------------ screener desk
const PRESETS = {
  quick: { label: "Live demo (3 min seal · 2 min reveal)", commit: 180, reveal: 120, tca: 60 },
  short: { label: "Short (10 min · 10 min)", commit: 600, reveal: 600, tca: 300 },
  standard: { label: "Standard (2 h · 2 h)", commit: 7200, reveal: 7200, tca: 3600 },
  custom: { label: "Custom times" },
};

function screenerDesk({ events, stats }) {
  const me = W.address.toLowerCase();
  const sats = satellitesFromLogs();
  const waiting = events.filter((e) => !e.finalized && phaseOf(e) === "ATTEST");
  const late = waiting.filter((e) => chainNow() > e.attestDeadline);
  const form = h("div");
  buildOpenForm(form, sats, stats);
  return h("div", { class: "stack" },
    waiting.length ? card("Waiting for your observation", "eye", h("div", { class: "stack", style: { gap: "10px" } }, ...waiting.map(eventItem))) : null,
    card("Open a conjunction", "radar", form),
    late.length ? callout("warn", "warn", `${late.length} event${late.length > 1 ? "s are" : " is"} past the observation window and can be finalized from the event page.`) : null);
}

function buildOpenForm(root, sats, stats) {
  if (sats.length < 2) { root.replaceChildren(h("p", { class: "muted" }, "Two satellites from two different operators must be registered first. Operators register their own from the Operator desk.")); return; }
  const opt = (s) => h("option", { value: s.id }, `${s.label} · ${operatorName(s.operator) || shortAddr(s.operator)}`);
  const A = h("select", { class: "select" }, ...sats.map(opt)), B = h("select", { class: "select" }, ...sats.map(opt));
  B.selectedIndex = Math.min(1, sats.length - 1);
  const preset = h("select", { class: "select" }, ...Object.entries(PRESETS).map(([k, v]) => h("option", { value: k }, v.label)));
  const dt = (secs) => { const d = new Date((chainNow() + secs) * 1000); d.setSeconds(0, 0); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const cIn = h("input", { class: "input", type: "datetime-local", value: dt(3600) }), rIn = h("input", { class: "input", type: "datetime-local", value: dt(7200) }), tIn = h("input", { class: "input", type: "datetime-local", value: dt(10800) });
  const custom = h("div", { class: "grid3", style: { display: "none" } }, field("Seals close", cIn), field("Reveals close", rIn), field("Closest approach", tIn));
  preset.addEventListener("change", () => (custom.style.display = preset.value === "custom" ? "" : "none"));
  const miss = h("input", { class: "input", type: "number", min: "0", value: "300" }), speed = h("input", { class: "input", type: "number", min: "0", value: "12000" }), prob = h("input", { class: "input", value: "2.5e-4" }), sigma = h("input", { class: "input", type: "number", min: "0", value: "55" });
  const times = () => {
    if (preset.value === "custom") return { commit: Math.floor(new Date(cIn.value).getTime() / 1000), reveal: Math.floor(new Date(rIn.value).getTime() / 1000), tca: Math.floor(new Date(tIn.value).getTime() / 1000) };
    const p = PRESETS[preset.value]; const now = chainNow();
    return { commit: now + p.commit, reveal: now + p.commit + p.reveal, tca: now + p.commit + p.reveal + p.tca };
  };
  const cdmFor = (tcaUnix) => buildCdm({ labelA: satLabel(Number(A.value)), labelB: satLabel(Number(B.value)), tcaUnix, fields: { missDistanceMeters: Number(miss.value), relativeSpeedMetersPerSec: Number(speed.value), collisionProbability: Number(prob.value), sigmaRadialMeters: Number(sigma.value) } });
  const fp = h("div", { class: "hint" });
  const showFp = () => { try { fp.textContent = "Message fingerprint stored on chain: " + shortHash(fingerprint(cdmFor(times().tca)), 8); } catch { fp.textContent = ""; } };
  [A, B, preset, miss, speed, prob, sigma, cIn, rIn, tIn].forEach((i) => i.addEventListener("input", showFp)); showFp();

  root.replaceChildren(
    h("p", { class: "muted" }, "Flag two satellites on a collision course, set the schedule, and attach the conjunction data message. Only its fingerprint goes on chain; the message stays with you."),
    h("div", { class: "grid2" }, field("Satellite A", A), field("Satellite B", B)),
    field("Schedule", preset, `Minimum window length on this contract: ${stats.minPhase} seconds.`), custom,
    h("div", { class: "divider" }), h("strong", null, "Conjunction data message"), h("p", { class: "hint" }, "Fictional values only."),
    h("div", { class: "grid2", style: { marginTop: "10px" } }, field("Predicted miss distance (m)", miss), field("Relative speed (m/s)", speed), field("Collision probability", prob), field("Radial uncertainty, 1σ (m)", sigma)),
    fp, h("div", { style: { height: "12px" } }),
    h("div", { class: "row" },
      btn("Open conjunction", async () => {
        const t = times();
        if (A.value === B.value) { toast({ tone: "warn", title: "Pick two different satellites" }); return; }
        if (!(t.commit > chainNow() && t.reveal > t.commit && t.tca >= t.reveal)) { toast({ tone: "warn", title: "Check the schedule", text: "Seals must close before reveals, and reveals before the closest approach." }); return; }
        const cdm = cdmFor(t.tca);
        await act("Open conjunction", "openConjunction", [Number(A.value), Number(B.value), t.tca, t.commit, t.reveal, fingerprint(cdm), Math.round(Number(miss.value))]);
        const id = Number((await readStats()).conjunctions);
        download(`skypact-cdm-event${id}.json`, JSON.stringify(cdm, null, 2));
        toast({ tone: "info", title: "Message file saved", text: "Keep it: anyone can verify it against the on-chain fingerprint." });
        location.hash = "#/event/" + id;
      }, { iconName: "radar" }),
      btn("Use sample values", async () => { const f = sampleCdmFields(satLabel(Number(A.value)), satLabel(Number(B.value)), times().tca); miss.value = f.missDistanceMeters; speed.value = f.relativeSpeedMetersPerSec; prob.value = f.collisionProbability; sigma.value = f.sigmaRadialMeters; showFp(); }, { variant: "ghost" })));
}

// ------------------------------------------------------------------------------------------------ admin desk
function adminDesk({ ops, stats }) {
  const opAddr = h("input", { class: "input", placeholder: "0x… operator wallet" }), opName = h("input", { class: "input", placeholder: "Name, e.g. OPR-ALPHA", maxlength: 32 });
  const scAddr = h("input", { class: "input", placeholder: "0x… screener wallet" });
  const quorum = h("input", { class: "input", type: "number", min: "1", max: "10", value: stats.quorum }), win = h("input", { class: "input", type: "number", min: "1", value: stats.attestWindow });
  const validAddr = (v) => { try { return ethers.getAddress(v.trim()); } catch { throw Object.assign(new Error("That is not a valid wallet address."), { friendly: { code: "x" } }); } };
  const guard = (fn) => async () => { try { await fn(); } catch (e) { if (!e.friendly) throw e; if (e.friendly.code === "x") toast({ tone: "warn", title: "Check the address", text: e.message }); } };
  const screeners = screenersFromLogs();
  return h("div", { class: "stack" },
    h("div", { class: "grid2" },
      card("Approve an operator", "seal", field("Wallet address", opAddr), field("Operator name", opName), btn("Approve operator", guard(async () => { if (!opName.value.trim()) { toast({ tone: "warn", title: "Give the operator a name" }); return; } await act("Approve operator", "addOperator", [validAddr(opAddr.value), opName.value.trim()]); opAddr.value = opName.value = ""; }), { iconName: "check" })),
      card("Approve a screener", "radar", field("Wallet address", scAddr), h("p", { class: "hint" }, "Screeners open conjunctions and report what they observe."), btn("Approve screener", guard(async () => { await act("Approve screener", "addScreener", [validAddr(scAddr.value)]); scAddr.value = ""; }), { iconName: "check" }))),
    card("Approved operators", "seal", ops.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...ops.map((o) => h("div", { class: "item" }, h("div", { class: "main" }, addrChip(o.address, { name: o.name })), o.active ? badge("Active", "green") : badge("Revoked", "grey"), o.active ? btn("Revoke", async () => act("Revoke operator", "revokeOperator", [o.address]), { variant: "danger", size: "sm" }) : null))) : h("p", { class: "muted" }, "None yet.")),
    card("Approved screeners", "radar", screeners.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...screeners.map((a) => h("div", { class: "item" }, h("div", { class: "main" }, h("span", { class: "addr" }, a)), btn("Revoke", async () => act("Revoke screener", "revokeScreener", [ethers.getAddress(a)]), { variant: "danger", size: "sm" })))) : h("p", { class: "muted" }, "None yet.")),
    card("Protocol settings", "scale",
      h("p", { class: "muted" }, "Applies to events opened after the change. Each event keeps the quorum it was opened with."),
      h("div", { class: "grid2" }, field("Matching observations needed to finalize", quorum), field("Observation window after closest approach (seconds)", win)),
      btn("Update settings", async () => act("Update settings", "setParams", [Number(quorum.value), Number(win.value)]), { variant: "ghost" }),
      h("p", { class: "hint", style: { marginTop: "8px" } }, `Minimum seal and reveal window: ${stats.minPhase} s (fixed at deploy).`)));
}
