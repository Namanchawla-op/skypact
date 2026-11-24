# SkyPact

**Sealed-bid maneuver pacts between satellite operators, on Base Sepolia.**

## Submission (HASH-IT-OUT 2026, Track 6: Open Innovation)

| Deliverable | Where |
|---|---|
| **Live app** (public, no wallet needed to read) | https://frontend-six-gules-40.vercel.app (allow ~10 s on first load while it reads the chain) |
| **Contract address** (Base Sepolia, chain 84532) | [`0xF098757650c0B0F57BBB1a30F458979Fb19e8EeD`](https://sepolia.basescan.org/address/0xF098757650c0B0F57BBB1a30F458979Fb19e8EeD) |
| **Tx 1**: Bravo seals MANEUVER (hash only on chain) | [`0x36e02be59af5c54a72854f4815b75e17d4771397328220e08a22d7d10f377e88`](https://sepolia.basescan.org/tx/0x36e02be59af5c54a72854f4815b75e17d4771397328220e08a22d7d10f377e88) |
| **Tx 2**: screener attests, contract finalizes the event as COORDINATED | [`0x807449d0e71fb2fc16876fe200bb005616cfd16af44870e76d0d242877f05565`](https://sepolia.basescan.org/tx/0x807449d0e71fb2fc16876fe200bb005616cfd16af44870e76d0d242877f05565) |
| Refused on chain (live rejection): reveal that does not match its seal, `HashMismatch` | [`0x795fedd02f751a935e5aac915fa2483df406436828edb83f74181299f41b45e1`](https://sepolia.basescan.org/tx/0x795fedd02f751a935e5aac915fa2483df406436828edb83f74181299f41b45e1) |
| **Who did what** | Naman Chawla (solo): idea, Solidity contract, deployment scripts and tests, frontend, and Base Sepolia deployment. |

Both proof transactions are event #2 on the live app: both promises KEPT, verdict COORDINATED. The Audit page recomputes the full 20-entry hash-chained ledger in the browser and matches the contract's `ledgerHead`. Fake data and testnet only.

### One-page note

#### 1. The user and their one task
A flight-dynamics engineer at a satellite operator who has just received a conjunction warning with another operator's satellite. Their one task: seal "hold or maneuver" before the deadline, and later prove, to the other operator and to anyone else, exactly what they committed to and when. (Stand-in users: Operator Alpha and Operator Bravo, fictional.)

#### 2. On the blockchain
Approved operators and screeners, satellite labels (fictional IDs such as SAT-001), conjunction events with their schedule and fingerprints of the off-chain conjunction message, every sealed commitment (hash only) with its history, every reveal, every screener observation, the computed verdict and per-operator outcome, each operator's reputation counters, and a hash chain (`ledgerHead`) over all of it.

#### 3. Only on the page
The live phase countdown, the plain-language verdict card, the operator's secret salt and plan (kept in their browser until reveal, with a downloadable backup), the commitment hash computed before signing, the full conjunction data message (only its fingerprint is on chain), and the 3D illustration of the two orbits (clearly marked as not to scale).

#### 4. What the contract refuses
- A wallet that does not operate either satellite cannot commit or reveal.
- No commitment after the commit deadline, so nobody can backdate a decision.
- A reveal that does not match the sealed hash is rejected, so nobody can change their mind afterwards. Copying another operator's hash is useless.
- Observations only from approved screeners and only after the closest approach; one vote each.
- Nothing is edited or deleted. Corrections are new entries.

#### 5. How to run it
Live app (no wallet needed to read): https://frontend-six-gules-40.vercel.app. Allow up to ten seconds on first load while it reads the chain. Open **Events**, then conjunction #2 to see the sealed decisions, the screener report and the contract's verdict (COORDINATED, both promises kept). Open **Audit** to recompute the whole ledger in your browser. To act as a role, open **Console**, add a test wallet or connect MetaMask on Base Sepolia, and use an approved operator, screener or admin wallet.
- Contract (Base Sepolia): `0xF098757650c0B0F57BBB1a30F458979Fb19e8EeD`
- Proof tx 1, Bravo seals MANEUVER (hash only on chain): `0x36e02be59af5c54a72854f4815b75e17d4771397328220e08a22d7d10f377e88`
- Proof tx 2, screener attests and the contract finalizes the event as COORDINATED: `0x807449d0e71fb2fc16876fe200bb005616cfd16af44870e76d0d242877f05565`
- Refused on chain, for example a reveal that does not match its seal (HashMismatch): `0x795fedd02f751a935e5aac915fa2483df406436828edb83f74181299f41b45e1`

#### 6. Path to real life
A spreadsheet or email thread lets either operator say "I told you first" after the fact; here the chain's timestamp and the sealed hash make that impossible, and the contract itself scores promise-keeping. Real orbital data, burn plans and company names would stay off chain: only a fingerprint of the conjunction message and of the burn plan is recorded. A space agency or an industry body would run the admin role (as a multisig), and independent tracking providers would be the screeners.

Two satellites are heading for a close approach. Each operator can burn to dodge or hold and hope. If both wait to see what the other does, nobody moves. If both move blindly, they can move into each other. Either way, nobody can later prove who promised what, or when.

SkyPact fixes the *coordination game*, not just the record keeping:

| Step | What happens | What the contract enforces |
|---|---|---|
| **Open** | An approved *screener* raises a conjunction between two satellites | only screeners; two different satellites of two different operators; sane schedule |
| **Commit** | Each operator seals `HOLD` or `MANEUVER` as a hash. Nobody, including the other operator, can see it | only the two operators; **no commits after the deadline (no backdating)**; re-commits append, never overwrite |
| **Reveal** | After commits close, each operator opens its seal | **must match the sealed hash**; wrong action, salt or plan fingerprint is refused; copying another operator's hash is useless |
| **Attest** | After closest approach, independent screeners report what they observed | only screeners; not before closest approach; one vote each; quorum of matching votes finalizes automatically |
| **Finalize** | The contract computes a **coordination verdict** and, per operator, **KEPT / BROKEN / WITHHELD / SILENT** | anyone can finalize once the window closes; silent and no-show operators are recorded even if nobody observed anything |
| **Reputation** | Every operator has a public promise-keeping score | computed on chain from outcomes, never asserted by anyone |

Nothing is edited or deleted. Corrections are new entries (a new commit supersedes an old one, an erratum is a new note). Every change also extends a **hash chain** (`ledgerHead`), and `scripts/verify-ledger.js` can re-derive it from raw logs, so any off-chain mirror can prove it is complete.

Only hashes and opaque IDs go on chain. Orbital data, burn plans and conjunction messages stay off-chain; only their fingerprints (`cdmHash`, `paramsHash`) are stored. All satellites and data here are fictional.

## Roles
- **Admin**: approves operators and screeners.
- **Operator**: registers satellites, seals and reveals decisions with their own wallet.
- **Screener**: an independent screening or tracking service that opens conjunctions and reports observations.
- **Public reader**: needs no wallet. Reads everything through the contract views, or through the read API.

## Quick start
```bash
npm install
npx hardhat test                 # 32 tests
npx hardhat run scripts/demo.js  # whole story on a local chain, ends with the ledger audit
```

## Deploy to Base Sepolia
1. Create 3 test-only MetaMask accounts (admin, Alpha, Bravo). Get free test ETH from the faucet link in the channel.
2. `cp .env.example .env` and paste the three private keys (test wallets only, never a key that holds real money).
3. `npm run deploy` writes `deployments/baseSepolia.json` and `abi/SkyPact.json`.
4. `npm run demo:testnet` walks the full story on the real test network (takes ~4 minutes because real time must pass). It prints every transaction, leaves **failed (refused) transactions visible on the explorer**, and writes `demo-output.baseSepolia.json` with `suggestedSubmissionTxs` for the form.

### Deploying from Remix instead
Open `contracts/SkyPact.sol` in remix.ethereum.org. Remix selects compiler **0.8.26** from the pragma. It fits under the 24 KB limit even with the optimizer off (24,433 bytes); turning optimization on (200 runs) shrinks it to ~14 KB, which is recommended. Constructor arguments: `30, 3600, 1` (minimum phase seconds, attest window seconds, quorum). Use *Injected Provider - MetaMask* on Base Sepolia.

## Read API (optional, for the frontend)
`NETWORK=baseSepolia npm run api` serves a read-only JSON API on port 8787. No database, no keys, no writes: each answer is read live from the chain.

`/stats` `/satellites` `/conjunctions` `/conjunctions/:id` `/operators` `/operators/:address` `/leaderboard` `/ledger` (audit) `/ledger/entries` `/errors` `/abi`

## Frontend (built, no mock data)
A static site in `frontend/` (Vite + three.js + ethers). It reads **everything live from the contract** over a public RPC, so readers need no wallet. The 3D sky shows only the satellites actually registered on chain; orbit shapes and distances are illustrative and labelled so.

**Pages:** Home (live stats, leaderboard) · Events · Event (phase track, sealed/opened decisions, verdict, role-aware actions, 3D replay, file verifier) · Operators · Audit (re-computes the hash chain in your browser) · Console (admin / operator / screener desks).

**Run locally**
```bash
cd frontend && npm install
npm run dev            # needs public/deployment.json (written by the deploy script)
```

**Ship it** (after deploying the contract, see below)
1. `npm run deploy` (from the repo root) writes `frontend/public/deployment.json` with the address, chain and RPC. For a hand-deployed contract copy `frontend/public/deployment.example.json` to `deployment.json` and fill it in. If the file is missing, the site shows a setup screen where an address can be pasted.
2. `cd frontend && npm run build`, then host `frontend/dist` anywhere static: Vercel and Netlify (config included), GitHub Pages (`.github/workflows/pages.yml`), or IPFS. Paths are relative, so any sub-path works.

**Wallets:** MetaMask (the site adds and switches to Base Sepolia for you), or the optional **test-wallet vault** (Connect wallet → add keys). The vault keeps private keys in this browser's localStorage so a presenter can switch between admin, Alpha, Bravo and screener in one click during a live demo. **Use it only with throwaway testnet keys.**

**Showing a live rejection:** `npm run demo:testnet` deliberately sends invalid operations (a late seal, a reveal that does not match, an outsider acting) and leaves the refused transactions on the explorer. The UI also pre-checks every action against the contract and explains a refusal in plain language before anything is sent.

**Live-demo flow (about 7 minutes of chain time):** Admin approves two operators and a screener → each operator registers a satellite → screener opens a conjunction with the "Live demo" schedule → both operators seal → reveal → screener reports → verdict and reputation appear.

**Secrets:** an operator's salt and plan are saved in the browser before sealing. The event page offers a backup download; import it to reveal from another device.

## Layout
```
contracts/SkyPact.sol     the contract
test/SkyPact.test.js      32 tests: every refusal, lifecycle, reputation math, ledger chain, tamper detection
lib/pact.js               commitment hash, synthetic data, secret salts, friendly errors
lib/ledger.js             independent ledger replay
scripts/                  deploy.js, demo.js, verify-ledger.js
api/server.js             read-only REST API
errors.json               error -> plain-language message
docs/ONE_PAGE_NOTE.md     the required one-page note
frontend/                 the web app (Vite + three.js + ethers), static, reads the chain live
```

## Design decisions worth knowing
- **Why seal at all?** Sealed simultaneous commitments remove the wait-and-see advantage, so neither operator can free-ride on the other's decision.
- **Why a salt?** There are only two possible actions, so an unsalted hash could be guessed. The hash also binds chain, contract, event, satellite and operator, so a copied hash is useless to anyone else.
- **Quorum ties**: each attestation votes for one observation (A moved / B moved / both / neither). The first outcome to reach the quorum wins; disagreeing votes do not combine.
- **Who can open events?** Only screeners. If any operator could, they could grief a rival into "SILENT" marks.
- **Known limits (prototype)**: the admin is a single wallet (a real deployment would use a multisig); screeners are trusted for observations, which is why a quorum is configurable; the miss distance on chain is the one reported by the attestation that completed the quorum.
