// Browser-side storage: operator secrets (salts), notes, the optional test-wallet vault, contract override.
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("storage failed", e); } };

const SECRETS = "skypact.secrets.v1";
const NOTES = "skypact.notes.v1";
const VAULT = "skypact.vault.v1";
const CFG = "skypact.cfg.v1";
const ACTIVE = "skypact.active.v1";

const skey = (chainId, contract, eventId, operator) => `${chainId}:${contract.toLowerCase()}:${eventId}:${operator.toLowerCase()}`;

export const store = {
  // Secrets: { action, plan, paramsHash, salt, hash, revision }
  saveSecret(chainId, contract, eventId, operator, rec) {
    const all = read(SECRETS, {});
    const key = skey(chainId, contract, eventId, operator);
    const list = all[key] || [];
    list.push(rec);
    all[key] = list;
    write(SECRETS, all);
  },
  secrets(chainId, contract, eventId, operator) { return read(SECRETS, {})[skey(chainId, contract, eventId, operator)] || []; },
  secretForHash(chainId, contract, eventId, operator, hash) {
    return this.secrets(chainId, contract, eventId, operator).find((s) => s.hash.toLowerCase() === hash.toLowerCase());
  },
  exportSecrets(chainId, contract, eventId, operator) {
    return { skypact: "secret-backup", version: 1, chainId, contract, eventId, operator, entries: this.secrets(chainId, contract, eventId, operator) };
  },
  importSecrets(backup) {
    if (backup?.skypact !== "secret-backup" || !Array.isArray(backup.entries)) throw new Error("That is not a SkyPact backup file.");
    const all = read(SECRETS, {});
    const key = skey(backup.chainId, backup.contract, backup.eventId, backup.operator);
    const have = new Set((all[key] || []).map((s) => s.hash.toLowerCase()));
    all[key] = [...(all[key] || []), ...backup.entries.filter((e) => e?.hash && !have.has(e.hash.toLowerCase()))];
    write(SECRETS, all);
    return backup;
  },

  saveNote(hash, text) { const n = read(NOTES, {}); n[hash.toLowerCase()] = text; write(NOTES, n); },
  note(hash) { return read(NOTES, {})[hash.toLowerCase()]; },

  vault() { return read(VAULT, []); },
  setVault(list) { write(VAULT, list); },

  getCfg() { return read(CFG, null); },
  setCfg(cfg) { write(CFG, cfg); },
  clearCfg() { localStorage.removeItem(CFG); },

  active() { return read(ACTIVE, null); },
  setActive(v) { v ? write(ACTIVE, v) : localStorage.removeItem(ACTIVE); },
};
