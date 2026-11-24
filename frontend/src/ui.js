import { h, icon, copyText, shortAddr, fmtDuration } from "./lib/dom.js";
import { PHASE_INFO, VERDICT_INFO, PLEDGE_INFO } from "./lib/pact.js";
import { explorerAddr, explorerTx, chainNow, operatorName } from "./lib/chain.js";
import { toast } from "./lib/toast.js";

export const badge = (text, tone = "grey") => h("span", { class: `badge ${tone}` }, text);
export const phaseBadge = (phase) => { const i = PHASE_INFO[phase] || { label: phase, tone: "grey" }; return badge(i.label, i.tone); };
export const verdictBadge = (v) => { const i = VERDICT_INFO[v] || VERDICT_INFO.PENDING; return badge(i.label, i.tone); };
export const pledgeBadge = (p) => { const i = PLEDGE_INFO[p] || PLEDGE_INFO.PENDING; return badge(i.label, i.tone); };

export function card(title, iconName, ...children) {
  return h("section", { class: "card" }, title ? h("h3", null, iconName ? icon(iconName) : null, title) : null, ...children);
}

export function btn(label, onClick, { variant = "", size = "", iconName, disabled = false, title } = {}) {
  const b = h("button", { class: `btn ${variant} ${size}`.trim(), type: "button", disabled, title }, iconName ? icon(iconName) : null, label);
  b.addEventListener("click", async (e) => {
    e.preventDefault();
    if (b.disabled || b.classList.contains("busy")) return;
    b.classList.add("busy"); b.disabled = true;
    try { await onClick(e); } catch (err) { if (!err?.friendly) { console.error(err); toast({ tone: "bad", title: "Something went wrong", text: err?.message || String(err) }); } }
    finally { b.classList.remove("busy"); b.disabled = disabled; }
  });
  return b;
}

export const field = (label, input, hint) => h("div", { class: "field" }, h("label", null, label), input, hint ? h("div", { class: "hint" }, hint) : null);
export const callout = (tone, iconName, ...children) => h("div", { class: `callout ${tone}` }, icon(iconName), h("div", null, ...children));

export function addrChip(addr, { name } = {}) {
  const n = name ?? operatorName(addr);
  const a = h("span", { class: "addr", title: addr + " (click to copy)", style: { cursor: "pointer" }, onClick: async () => { await copyText(addr); toast({ tone: "good", title: "Address copied" }); } }, shortAddr(addr));
  return h("span", { class: "row", style: { gap: "7px", display: "inline-flex" } }, n ? h("strong", null, n) : null, a);
}
export const txLink = (hash, text = "View transaction ↗") => (explorerTx(hash) ? h("a", { href: explorerTx(hash), target: "_blank", rel: "noopener" }, text) : h("span", { class: "mono" }, hash));
export const addrLink = (addr, text) => (explorerAddr(addr) ? h("a", { href: explorerAddr(addr), target: "_blank", rel: "noopener" }, text || shortAddr(addr)) : h("span", { class: "mono" }, text || shortAddr(addr)));

/** Live countdown; the global 1s ticker (main.js) updates every [data-target]. */
export function countdown(targetUnix, { done = "now", prefix = "" } = {}) {
  const el = h("span", { class: "mono", "data-target": targetUnix, "data-done": done, "data-prefix": prefix });
  tickCountdown(el);
  return el;
}
export function tickCountdown(el) {
  const left = Number(el.dataset.target) - chainNow();
  el.textContent = left <= 0 ? el.dataset.done : (el.dataset.prefix || "") + fmtDuration(left);
}

export function modal(contentBuilder) {
  const close = () => bg.remove();
  const bg = h("div", { class: "modal-bg", onClick: (e) => { if (e.target === bg) close(); } });
  bg.append(h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, contentBuilder(close)));
  document.body.append(bg);
  return close;
}

export function empty(title, text, action) {
  return h("div", { class: "card flat", style: { textAlign: "center", padding: "34px 22px" } }, h("h3", { style: { justifyContent: "center", marginBottom: "6px" } }, title), h("p", { class: "muted" }, text), action ? h("div", { style: { marginTop: "14px" } }, action) : null);
}
