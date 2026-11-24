import { ethers } from "ethers";
import { h, icon, shortAddr } from "./lib/dom.js";
import { W, connectMetaMask, disconnect, hasMetaMask, useVaultWallet, vault, refreshRoles } from "./lib/wallet.js";
import { S, readRoles } from "./lib/chain.js";
import { toast } from "./lib/toast.js";
import { badge, btn, callout, modal, field } from "./ui.js";
import { bus } from "./lib/bus.js";

export function roleBadges(roles) {
  const out = [];
  if (roles.admin) out.push(badge("Admin", "amber"));
  if (roles.operator) out.push(badge(roles.name ? `Operator · ${roles.name}` : "Operator", "cyan"));
  if (roles.screener) out.push(badge("Screener", "violet"));
  if (!out.length) out.push(badge("No role yet", "grey"));
  return out;
}

export function openWalletModal() {
  modal((close) => {
    const body = h("div");
    const render = async () => {
      const list = vault.list();
      const rows = await Promise.all(list.map(async (v) => {
        let roles = { admin: false, operator: false, screener: false, name: "" }, bal = null;
        try { roles = await readRoles(v.address); bal = await S.provider.getBalance(v.address); } catch { /* offline */ }
        const active = W.mode === "vault" && W.vaultId === v.id;
        return h("div", { class: "item", style: active ? { borderColor: "#fff" } : {} },
          h("div", { class: "main" },
            h("div", { class: "title" }, v.label, " ", ...roleBadges(roles)),
            h("div", { class: "sub" }, h("span", { class: "addr" }, shortAddr(v.address)), bal != null ? `  ·  ${Number(ethers.formatEther(bal)).toFixed(4)} ${S.cfg.currency}` : "")),
          active ? badge("In use", "green") : btn("Use", async () => { await useVaultWallet(v.id); toast({ tone: "good", title: `Now acting as ${v.label}` }); close(); }, { size: "sm" }),
          btn("×", () => { vault.remove(v.id); render(); }, { variant: "ghost", size: "sm", title: "Remove from vault" }));
      }));
      body.replaceChildren(
        h("h2", { style: { fontSize: "1.3rem", marginBottom: "6px" } }, W.address ? "Switch wallet" : "Connect a wallet"),
        h("p", { class: "muted" }, "Reading SkyPact needs no wallet at all. You only need one to take an action."),
        h("div", { class: "divider" }),
        h("h3", { style: { fontSize: "1rem", marginBottom: "8px" } }, "Browser wallet"),
        hasMetaMask()
          ? h("div", { class: "row" },
              btn(W.mode === "metamask" ? "Reconnect MetaMask" : "Connect MetaMask", async () => { await connectMetaMask(); toast({ tone: "good", title: "Wallet connected" }); close(); }, { iconName: "key" }),
              W.address ? btn("Disconnect", async () => { await disconnect(); close(); }, { variant: "ghost" }) : null)
          : callout("info", "warn", "No browser wallet detected. Install MetaMask, or use a test wallet below."),
        h("div", { class: "divider" }),
        h("h3", { style: { fontSize: "1rem", marginBottom: "4px" } }, "Test wallets (this browser only)"),
        callout("warn", "warn", h("strong", null, "Test networks only. "), "Keys you add here are stored in this browser. Never paste a key that holds real money. They let you switch between admin, operator and screener instantly, for example during a live demo."),
        h("div", { style: { height: "10px" } }),
        ...(rows.length ? rows : [h("p", { class: "hint" }, "No test wallets yet.")]),
        h("div", { style: { height: "10px" } }),
        addForm(render),
        h("div", { style: { height: "6px" } }),
        h("div", { class: "row between" }, h("span", { class: "hint" }, `Network: ${S.cfg.chainName}`), btn("Close", close, { variant: "ghost", size: "sm" })));
    };
    render();
    const off = bus.on("vault", render);
    return body;
  });
}

function addForm(rerender) {
  const label = h("input", { class: "input", placeholder: "Label, e.g. Operator Alpha" });
  const key = h("input", { class: "input", placeholder: "Private key (test wallet)", type: "password", autocomplete: "off" });
  return h("div", { class: "card flat", style: { padding: "14px" } },
    h("div", { class: "grid2" }, field("Label", label), field("Private key", key)),
    h("div", { class: "row" },
      btn("Add test wallet", async () => { vault.add(label.value.trim(), key.value); label.value = key.value = ""; rerender(); }, { size: "sm" }),
      btn("Generate a new one", async () => { vault.generate(label.value.trim() || "New test wallet"); label.value = ""; rerender(); toast({ tone: "info", title: "Wallet created", text: "Fund it from the faucet before using it." }); }, { size: "sm", variant: "ghost" })));
}
