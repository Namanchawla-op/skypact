import { h, icon } from "../lib/dom.js";
import { store } from "../lib/store.js";
import { BASE_SEPOLIA } from "../lib/chain.js";
import { btn, callout, card, field } from "../ui.js";

export default async function setup(root, _args, ctx) {
  ctx.scene?.setMood("calm");
  const cur = store.getCfg() || {};
  const addr = h("input", { class: "input", placeholder: "0x… SkyPact contract address", value: cur.address || "" });
  const chainId = h("input", { class: "input", value: cur.chainId || BASE_SEPOLIA.chainId });
  const rpc = h("input", { class: "input", value: cur.rpcUrl || BASE_SEPOLIA.rpcUrl });
  const explorer = h("input", { class: "input", value: cur.explorerUrl ?? BASE_SEPOLIA.explorerUrl });
  const block = h("input", { class: "input", placeholder: "Optional. Leave empty to detect automatically", value: cur.deployBlock || "" });
  root.replaceChildren(h("div", { class: "wrap", style: { maxWidth: "760px" } }, h("div", { class: "stack" },
    h("div", null, h("span", { class: "eyebrow" }, "One-time setup"), h("h1", { style: { fontSize: "2.2rem", marginTop: "8px" } }, "Connect SkyPact to your contract")),
    callout("info", "chain", "This app reads everything live from a deployed SkyPact contract. Deploy it (see the README), then paste its address here. If you deploy with ", h("code", null, "npm run deploy"), ", this step is filled in for you automatically."),
    card("Contract", "chain",
      field("Contract address", addr, "The address shown by Remix or the deploy script."),
      h("div", { class: "grid2" }, field("Chain ID", chainId, "84532 is Base Sepolia."), field("Deploy block", block)),
      field("RPC URL", rpc), field("Block explorer URL", explorer),
      h("div", { class: "row" },
        btn("Save and connect", async () => {
          if (!/^0x[0-9a-fA-F]{40}$/.test(addr.value.trim())) throw Object.assign(new Error("That is not a valid contract address."), {});
          store.setCfg({ address: addr.value.trim(), chainId: Number(chainId.value), rpcUrl: rpc.value.trim(), explorerUrl: explorer.value.trim(), ...(block.value ? { deployBlock: Number(block.value) } : {}) });
          location.hash = "#/"; location.reload();
        }, { iconName: "check" }),
        store.getCfg() ? btn("Forget saved contract", async () => { store.clearCfg(); location.reload(); }, { variant: "ghost" }) : null)))));
}
