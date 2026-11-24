import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles.css";
import { ethers } from "ethers";
import { h, icon, svg, shortAddr, $, $$ } from "./lib/dom.js";
import * as chain from "./lib/chain.js";
import { S } from "./lib/chain.js";
import { W, restore, refreshRoles } from "./lib/wallet.js";
import { bus } from "./lib/bus.js";
import { toast } from "./lib/toast.js";
import { SkyScene } from "./scene/sky.js";
import { btn, tickCountdown } from "./ui.js";
import { openWalletModal, roleBadges } from "./walletui.js";

const logo = () => svg('<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="5" fill="#fff"/><ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="#fff" stroke-width="1" transform="rotate(-28 16 16)"/><circle cx="27" cy="9.6" r="1.8" fill="#fff"/></svg>');

const ROUTES = {
  "": () => import("./views/home.js"),
  events: () => import("./views/events.js"),
  event: () => import("./views/event.js"),
  operators: () => import("./views/operators.js"),
  operator: () => import("./views/operator.js"),
  console: () => import("./views/console.js"),
  audit: () => import("./views/audit.js"),
  setup: () => import("./views/setup.js"),
};

const app = $("#app"), top = $("#top");
const ctx = { scene: null };
let cleanup = null, navToken = 0;

function parseHash() {
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
  return { name: parts[0] || "", args: parts.slice(1) };
}

function renderHeader() {
  const { name } = parseHash();
  const link = (to, label) => h("a", { href: "#/" + to, class: (name === to || (to === "events" && name === "event") || (to === "operators" && name === "operator")) ? "on" : "" }, label);
  const nav = h("nav", { class: "nav", id: "nav" }, link("", "Home"), link("events", "Events"), link("operators", "Operators"), link("audit", "Audit"), link("console", "Console"));
  nav.addEventListener("click", () => nav.classList.remove("open"));
  const net = S.cfg
    ? h("div", { class: "net", title: S.cfg.address }, h("span", { class: "dot" + (S.syncing ? " sync" : S.error ? " bad" : "") }), `${S.cfg.chainName} · block ${S.latest || "…"}`)
    : null;
  const wal = W.address
    ? h("button", { class: "btn ghost sm", onClick: openWalletModal }, icon("key"), shortAddr(W.address), ...roleBadges(W.roles).slice(0, 2))
    : S.cfg ? h("button", { class: "btn sm", onClick: openWalletModal }, icon("key"), "Connect wallet") : null;
  top.replaceChildren(...[
    h("a", { class: "brand", href: "#/" }, logo(), "SkyPact"),
    S.cfg ? nav : null, h("div", { class: "spacer" }), net, wal,
    S.cfg ? h("button", { class: "burger", "aria-label": "Menu", onClick: () => $("#nav").classList.toggle("open") }, "☰") : null].filter(Boolean));
}

async function route() {
  const token = ++navToken;
  const { name, args } = parseHash();
  cleanup?.(); cleanup = null;
  document.body.classList.toggle("calm", !["", "event"].includes(name));
  renderHeader();
  window.scrollTo(0, 0);
  const key = !S.cfg ? "setup" : ROUTES[name] ? name : "";
  app.replaceChildren(h("div", { class: "wrap" }, h("p", { class: "muted" }, "Loading…")));
  try {
    const mod = await ROUTES[key]();
    if (token !== navToken) return;
    app.replaceChildren();
    cleanup = (await mod.default(app, args, ctx)) || null;
  } catch (e) {
    console.error(e);
    app.replaceChildren(h("div", { class: "wrap", style: { maxWidth: "640px" } }, h("div", { class: "card" }, h("h3", null, "We could not load this page"), h("p", { class: "muted" }, e?.message || String(e)),
      h("div", { class: "row" }, btn("Try again", async () => route()), h("a", { class: "btn ghost", href: "#/" }, "Home")))));
  }
}

async function boot() {
  renderHeader();
  try { ctx.scene = new SkyScene($("#sky"), $("#labels")); }
  catch (e) { console.warn("WebGL unavailable", e); document.body.classList.add("no-webgl"); }
  window.__scene = ctx.scene;

  try {
    const r = await chain.init();
    if (r.needsSetup) { location.hash = "#/setup"; }
  } catch (e) {
    console.error(e);
    renderHeader();
    app.replaceChildren(h("div", { class: "wrap", style: { maxWidth: "680px" } }, h("div", { class: "card" },
      h("h3", null, "Could not connect to the contract"), h("p", { class: "muted" }, e?.message || String(e)),
      h("div", { class: "row" }, btn("Retry", async () => location.reload()), h("a", { class: "btn ghost", href: "#/setup" }, "Change contract")))));
    S.cfg && window.addEventListener("hashchange", () => {});
    if (location.hash === "#/setup") route();
    return;
  }

  if (S.cfg) await restore();
  window.addEventListener("hashchange", route);
  bus.on("wallet", renderHeader);
  await route();

  // live updates
  setInterval(async () => {
    if (document.hidden || !S.ready) return;
    try { await chain.sync(); chain.flushCache(); if (W.address) await refreshRoles(); bus.emit("tick"); updateTicker(); } catch (e) { console.warn("sync failed", e); }
    renderHeader();
  }, 7000);
  setInterval(() => $$("[data-target]").forEach(tickCountdown), 1000);
}

boot();

async function updateTicker() {
  try {
    const st = await chain.readStats();
    const el = document.getElementById("tick-text"); if (!el) return;
    const seg = `SKYPACT   /   ${S.cfg.chainName}   /   BLOCK ${S.latest}   /   ${st.satellites} SATELLITES   /   ${st.conjunctions} CONJUNCTIONS   /   ${st.entries} LEDGER ENTRIES   /   HEAD ${String(st.head).slice(0, 18)}…   /   FICTIONAL DATA · TESTNET ONLY   /   `;
    el.textContent = seg + seg;
  } catch {}
}
