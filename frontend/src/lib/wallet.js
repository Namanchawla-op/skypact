import { ethers } from "ethers";
import { S, readRoles, sync, flushCache, explorerTx } from "./chain.js";
import { store } from "./store.js";
import { friendlyError } from "./pact.js";
import { bus } from "./bus.js";
import { toast } from "./toast.js";

export const W = {
  mode: null,          // 'metamask' | 'vault' | null
  address: null, signer: null, vaultId: null,
  roles: { admin: false, operator: false, screener: false, name: "" },
  balance: null,
};

const hex = (n) => "0x" + Number(n).toString(16);

async function ensureChain(eth) {
  const cfg = S.cfg;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(cfg.chainId) }] });
  } catch (e) {
    if (e?.code === 4902 || e?.code === -32603 || /unrecognized chain|not added/i.test(String(e?.message))) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex(cfg.chainId), chainName: cfg.chainName,
          nativeCurrency: { name: "Ether", symbol: cfg.currency || "ETH", decimals: 18 },
          rpcUrls: [cfg.rpcUrl], ...(cfg.explorerUrl ? { blockExplorerUrls: [cfg.explorerUrl] } : {}),
        }],
      });
    } else throw e;
  }
}

export const hasMetaMask = () => typeof window !== "undefined" && !!window.ethereum;

export async function refreshRoles() {
  if (!W.address) { W.roles = { admin: false, operator: false, screener: false, name: "" }; W.balance = null; bus.emit("wallet"); return; }
  try {
    W.roles = await readRoles(W.address);
    W.balance = await S.provider.getBalance(W.address);
  } catch (e) { console.warn("role refresh failed", e); }
  bus.emit("wallet");
}

export async function connectMetaMask({ silent = false } = {}) {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask, or use a test wallet from the vault.");
  const accounts = await eth.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
  if (!accounts?.length) return false;
  if (!silent) await ensureChain(eth);
  const bp = new ethers.BrowserProvider(eth);
  W.signer = await bp.getSigner();
  W.address = await W.signer.getAddress();
  W.mode = "metamask"; W.vaultId = null;
  store.setActive({ mode: "metamask" });
  await refreshRoles();
  return true;
}

export async function useVaultWallet(id) {
  const entry = store.vault().find((v) => v.id === id);
  if (!entry) throw new Error("That test wallet no longer exists.");
  W.signer = new ethers.Wallet(entry.key, S.provider);
  W.address = W.signer.address;
  W.mode = "vault"; W.vaultId = id;
  store.setActive({ mode: "vault", id });
  await refreshRoles();
}

export async function disconnect() {
  W.mode = null; W.address = null; W.signer = null; W.vaultId = null;
  store.setActive(null);
  await refreshRoles();
}

export async function restore() {
  const a = store.active();
  try {
    if (a?.mode === "vault") await useVaultWallet(a.id);
    else if (a?.mode === "metamask" && hasMetaMask()) await connectMetaMask({ silent: true });
  } catch (e) { console.warn("restore failed", e); }
  if (hasMetaMask()) {
    window.ethereum.on?.("accountsChanged", async () => { if (W.mode === "metamask") { try { (await connectMetaMask({ silent: true })) || (await disconnect()); } catch { await disconnect(); } } });
    window.ethereum.on?.("chainChanged", () => location.reload());
  }
}

// ---- Test-wallet vault (test networks only) ----------------------------------------------------
const normKey = (k) => { k = String(k).trim(); return k.startsWith("0x") ? k : "0x" + k; };
export const vault = {
  list: () => store.vault().map((v) => ({ id: v.id, label: v.label, address: v.address })),
  add(label, privateKey) {
    let w;
    try { w = new ethers.Wallet(normKey(privateKey)); } catch { throw new Error("That does not look like a valid private key."); }
    const list = store.vault();
    if (list.some((v) => v.address.toLowerCase() === w.address.toLowerCase())) throw new Error("That wallet is already in the vault.");
    const entry = { id: crypto.randomUUID(), label: label || "Test wallet", key: w.privateKey, address: w.address };
    store.setVault([...list, entry]);
    bus.emit("vault");
    return entry.id;
  },
  generate(label) { return this.add(label, ethers.Wallet.createRandom().privateKey); },
  remove(id) {
    store.setVault(store.vault().filter((v) => v.id !== id));
    if (W.vaultId === id) disconnect();
    bus.emit("vault");
  },
};

// ---- Transaction pipeline ------------------------------------------------------------------------
/** Checks with the contract first (free), then sends. Refusals come back as plain sentences. */
export async function act(label, method, args = [], { quiet = false } = {}) {
  if (!W.signer) { const e = new Error("Connect a wallet first."); e.friendly = { code: "NoWallet", message: e.message }; throw e; }
  const t = quiet ? null : toast({ tone: "info", title: label, text: "Checking with the contract…", sticky: true });
  try {
    if (W.mode === "metamask") {
      const net = await W.signer.provider.getNetwork();
      if (Number(net.chainId) !== S.cfg.chainId) await ensureChain(window.ethereum);
    }
    const c = S.contract.connect(W.signer);
    await c[method].staticCall(...args);                // free dry run: refusals surface here
    t?.update({ text: W.mode === "metamask" ? "Confirm in your wallet…" : "Sending…" });
    const tx = await c[method](...args);
    t?.update({ text: "Waiting for the network…", link: explorerTx(tx.hash) });
    const rc = await tx.wait();
    t?.update({ tone: "good", title: label + " ✓", text: "Confirmed on chain.", link: explorerTx(rc.hash), sticky: false });
    flushCache();
    await sync();
    await refreshRoles();
    bus.emit("tick");
    return rc;
  } catch (e) {
    const fe = e.friendly || friendlyError(e, S.iface);
    t?.update({ tone: "bad", title: "Not allowed", text: fe.message, link: null, sticky: false });
    if (quiet) toast({ tone: "bad", title: "Not allowed", text: fe.message });
    const err = new Error(fe.message); err.friendly = fe; throw err;
  }
}
