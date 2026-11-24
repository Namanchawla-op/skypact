# SkyPact: one-page note

**1. The user and their one task**
A flight-dynamics engineer at a satellite operator who has just received a conjunction warning with another operator's satellite. Their one task: seal "hold or maneuver" before the deadline, and later prove, to the other operator and to anyone else, exactly what they committed to and when. (Stand-in users: Operator Alpha and Operator Bravo, fictional.)

**2. On the blockchain**
Approved operators and screeners, satellite labels (fictional IDs such as SAT-001), conjunction events with their schedule and fingerprints of the off-chain conjunction message, every sealed commitment (hash only) with its history, every reveal, every screener observation, the computed verdict and per-operator outcome, each operator's reputation counters, and a hash chain (`ledgerHead`) over all of it.

**3. Only on the page**
The live phase countdown, the plain-language verdict card, the operator's secret salt and plan (kept in their browser until reveal, with a downloadable backup), the commitment hash computed before signing, the full conjunction data message (only its fingerprint is on chain), and the 3D illustration of the two orbits (clearly marked as not to scale).

**4. What the contract refuses**
- A wallet that does not operate either satellite cannot commit or reveal.
- No commitment after the commit deadline, so nobody can backdate a decision.
- A reveal that does not match the sealed hash is rejected, so nobody can change their mind afterwards. Copying another operator's hash is useless.
- Observations only from approved screeners and only after the closest approach; one vote each.
- Nothing is edited or deleted. Corrections are new entries.

**5. How to run it**
Open the app link, connect MetaMask on Base Sepolia, and open the conjunction page (public, no wallet needed). Repo README has the exact steps and the contract address.

**6. Path to real life**
A spreadsheet or email thread lets either operator say "I told you first" after the fact; here the chain's timestamp and the sealed hash make that impossible, and the contract itself scores promise-keeping. Real orbital data, burn plans and company names would stay off chain: only a fingerprint of the conjunction message and of the burn plan is recorded. A space agency or an industry body would run the admin role (as a multisig), and independent tracking providers would be the screeners.
