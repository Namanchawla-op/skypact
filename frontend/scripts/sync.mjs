// Copies the contract ABI and the friendly-error catalogue from the backend into the frontend bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const out = path.join(here, "..", "src", "data");
fs.mkdirSync(out, { recursive: true });
const pairs = [["abi/SkyPact.json", "abi.json"], ["errors.json", "errors.json"]];
for (const [from, to] of pairs) {
  const src = path.join(root, from);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, to));
  else if (!fs.existsSync(path.join(out, to))) { console.error("Missing " + from + ". Run `npx hardhat compile` and `npm run deploy` (or copy abi/SkyPact.json) in the project root."); process.exit(1); }
}
console.log("synced abi + errors");
