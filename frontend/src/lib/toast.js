import { h } from "./dom.js";

let root;
function ensureRoot() {
  if (!root) { root = h("div", { class: "toasts", "aria-live": "polite" }); document.body.append(root); }
  return root;
}

/** toast({ tone: 'info'|'good'|'bad'|'warn', title, text, link, sticky }) -> { update, close } */
export function toast(opts) {
  const el = h("div", { class: "toast" });
  let timer;
  const handle = {
    update(next) { Object.assign(opts, next); draw(); },
    close() { clearTimeout(timer); el.classList.add("out"); setTimeout(() => el.remove(), 250); },
  };
  function draw() {
    el.className = `toast ${opts.tone || "info"}`;
    el.replaceChildren(
      h("div", { class: "toast-dot" }),
      h("div", { class: "toast-body" },
        h("strong", null, opts.title || ""),
        opts.text ? h("p", null, opts.text) : null,
        opts.link ? h("a", { href: opts.link, target: "_blank", rel: "noopener" }, "View on explorer ↗") : null),
      h("button", { class: "toast-x", "aria-label": "Dismiss", onClick: () => handle.close() }, "×"));
    clearTimeout(timer);
    if (!opts.sticky) timer = setTimeout(() => handle.close(), opts.tone === "bad" ? 9000 : 5500);
  }
  ensureRoot().append(el);
  draw();
  return handle;
}
