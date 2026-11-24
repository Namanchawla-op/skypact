const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const P = require("../lib/pact");
const { replayLedger } = require("../lib/ledger");

const HOLD = P.ACTION.HOLD;
const MAN = P.ACTION.MANEUVER;
const Z = ethers.ZeroHash;

async function deployFixture(quorum = 2) {
  const [admin, opA, opB, opC, screener1, screener2, stranger] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("SkyPact");
  const pact = await Factory.deploy(30, 3600, quorum);
  await pact.waitForDeployment();

  await pact.addOperator(opA.address, "OPR-ALPHA");
  await pact.addOperator(opB.address, "OPR-BRAVO");
  await pact.addOperator(opC.address, "OPR-CHARLIE");
  await pact.addScreener(screener1.address);
  await pact.addScreener(screener2.address);

  await pact.connect(opA).registerSatellite("SAT-001"); // 1
  await pact.connect(opB).registerSatellite("SAT-002"); // 2
  await pact.connect(opC).registerSatellite("SAT-003"); // 3
  return { pact, admin, opA, opB, opC, screener1, screener2, stranger };
}
const deployQuorum1 = () => deployFixture(1);

/** Opens an event with commit +100s, reveal +200s, tca +300s from now. */
async function openEvent(f, satA = 1, satB = 2) {
  const now = await time.latest();
  const t = { commit: now + 100, reveal: now + 200, tca: now + 300 };
  await f.pact.connect(f.screener1).openConjunction(satA, satB, t.tca, t.commit, t.reveal, P.fingerprint({ cdm: now }), 250);
  const eventId = Number(await f.pact.conjunctionCount());
  return { eventId, t };
}

async function seal(f, signer, eventId, satId, action, tag = "plan") {
  const paramsHash = P.fingerprint({ tag, action });
  const salt = P.randomSalt();
  const hash = await f.pact.commitmentHash(eventId, satId, signer.address, action, paramsHash, salt);
  await f.pact.connect(signer).commit(eventId, hash);
  return { hash, paramsHash, salt, action, satId };
}
const open = (f, signer, eventId, s) => f.pact.connect(signer).reveal(eventId, s.action, s.paramsHash, s.salt);

/** Plays a complete event. a / b: HOLD | MAN | null (silent) | "withhold". mask null = nobody attests. */
async function play(f, { a, b, mask, miss = 200 }) {
  const { eventId, t } = await openEvent(f);
  const sealed = {};
  if (a) sealed.a = await seal(f, f.opA, eventId, 1, a === "withhold" ? HOLD : a);
  if (b) sealed.b = await seal(f, f.opB, eventId, 2, b === "withhold" ? HOLD : b);
  await time.increaseTo(t.commit);
  if (a && a !== "withhold") await open(f, f.opA, eventId, sealed.a);
  if (b && b !== "withhold") await open(f, f.opB, eventId, sealed.b);
  await time.increaseTo(t.tca);
  if (mask !== null && mask !== undefined) {
    await f.pact.connect(f.screener1).attest(eventId, mask, miss);
    const c = await f.pact.getConjunction(eventId);
    if (!c.finalized) await f.pact.connect(f.screener2).attest(eventId, mask, miss);
  } else {
    await time.increaseTo(Number((await f.pact.getConjunction(eventId)).attestDeadline) + 1);
    await f.pact.finalize(eventId);
  }
  return eventId;
}

describe("SkyPact", () => {
  describe("who is allowed (admin)", () => {
    it("only the admin can add operators, screeners and change settings", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.pact.connect(f.stranger).addOperator(f.stranger.address, "X")).to.be.revertedWithCustomError(f.pact, "NotAdmin");
      await expect(f.pact.connect(f.stranger).addScreener(f.stranger.address)).to.be.revertedWithCustomError(f.pact, "NotAdmin");
      await expect(f.pact.connect(f.stranger).setParams(1, 100)).to.be.revertedWithCustomError(f.pact, "NotAdmin");
      await expect(f.pact.connect(f.stranger).revokeOperator(f.opA.address)).to.be.revertedWithCustomError(f.pact, "NotAdmin");
    });

    it("validates inputs", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.pact.addOperator(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(f.pact, "ZeroAddress");
      await expect(f.pact.addOperator(f.opA.address, "again")).to.be.revertedWithCustomError(f.pact, "AlreadyOperator");
      await expect(f.pact.addOperator(f.stranger.address, "")).to.be.revertedWithCustomError(f.pact, "LabelInvalid");
      await expect(f.pact.setParams(0, 100)).to.be.revertedWithCustomError(f.pact, "BadParams");
      await expect(f.pact.setParams(11, 100)).to.be.revertedWithCustomError(f.pact, "BadParams");
      await expect(f.pact.addScreener(f.screener1.address)).to.be.revertedWithCustomError(f.pact, "AlreadyScreener");
    });

    it("rejects bad constructor params", async () => {
      const Factory = await ethers.getContractFactory("SkyPact");
      await expect(Factory.deploy(0, 100, 1)).to.be.revertedWithCustomError(Factory, "BadParams");
      await expect(Factory.deploy(30, 100, 0)).to.be.revertedWithCustomError(Factory, "BadParams");
    });
  });

  describe("satellites", () => {
    it("only approved operators register, labels are unique and bounded", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.pact.connect(f.stranger).registerSatellite("SAT-009")).to.be.revertedWithCustomError(f.pact, "NotOperator");
      await expect(f.pact.connect(f.opA).registerSatellite("SAT-001")).to.be.revertedWithCustomError(f.pact, "LabelTaken");
      await expect(f.pact.connect(f.opA).registerSatellite("")).to.be.revertedWithCustomError(f.pact, "LabelInvalid");
      await expect(f.pact.connect(f.opA).registerSatellite("x".repeat(33))).to.be.revertedWithCustomError(f.pact, "LabelInvalid");
      const s = await f.pact.satellite(1);
      expect(s.operator).to.equal(f.opA.address);
      expect(s.label).to.equal("SAT-001");
      expect(await f.pact.satelliteIdByLabel("SAT-002")).to.equal(2);
    });
  });

  describe("opening a conjunction", () => {
    it("only screeners, with valid satellites and schedule", async () => {
      const f = await loadFixture(deployFixture);
      const now = await time.latest();
      const ok = [now + 100, now + 200, now + 300];
      const open = (s, a, b, tca, c, r) => f.pact.connect(s).openConjunction(a, b, tca, c, r, Z, 100);

      await expect(open(f.opA, 1, 2, ok[2], ok[0], ok[1])).to.be.revertedWithCustomError(f.pact, "NotScreener");
      await expect(open(f.screener1, 1, 1, ok[2], ok[0], ok[1])).to.be.revertedWithCustomError(f.pact, "SameSatellite");
      await expect(open(f.screener1, 1, 9, ok[2], ok[0], ok[1])).to.be.revertedWithCustomError(f.pact, "UnknownSatellite");
      await expect(open(f.screener1, 0, 2, ok[2], ok[0], ok[1])).to.be.revertedWithCustomError(f.pact, "UnknownSatellite");
      // commit window shorter than the minimum
      await expect(open(f.screener1, 1, 2, ok[2], now + 10, ok[1])).to.be.revertedWithCustomError(f.pact, "BadSchedule");
      // reveal window shorter than the minimum
      await expect(open(f.screener1, 1, 2, ok[2], ok[0], ok[0] + 5)).to.be.revertedWithCustomError(f.pact, "BadSchedule");
      // closest approach before reveals end
      await expect(open(f.screener1, 1, 2, ok[1] - 1, ok[0], ok[1])).to.be.revertedWithCustomError(f.pact, "BadSchedule");
      await open(f.screener1, 1, 2, ok[2], ok[0], ok[1]);
      expect(await f.pact.conjunctionCount()).to.equal(1);
    });

    it("refuses two satellites of one operator and inactive operators", async () => {
      const f = await loadFixture(deployFixture);
      await f.pact.connect(f.opA).registerSatellite("SAT-004"); // 4, also opA
      const now = await time.latest();
      await expect(f.pact.connect(f.screener1).openConjunction(1, 4, now + 300, now + 100, now + 200, Z, 1)).to.be.revertedWithCustomError(f.pact, "SameOperator");
      await f.pact.revokeOperator(f.opB.address);
      await expect(f.pact.connect(f.screener1).openConjunction(1, 2, now + 300, now + 100, now + 200, Z, 1)).to.be.revertedWithCustomError(f.pact, "OperatorNotActive");
    });
  });

  describe("commit (the seal)", () => {
    it("only the operators of the two satellites can commit", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId } = await openEvent(f);
      await expect(f.pact.connect(f.stranger).commit(eventId, Z)).to.be.revertedWithCustomError(f.pact, "NotOperator");
      await expect(f.pact.connect(f.opC).commit(eventId, Z)).to.be.revertedWithCustomError(f.pact, "NotAParty");
      await expect(f.pact.connect(f.screener1).commit(eventId, Z)).to.be.revertedWithCustomError(f.pact, "NotOperator");
      await expect(f.pact.connect(f.opA).commit(99, Z)).to.be.revertedWithCustomError(f.pact, "UnknownConjunction");
    });

    it("refuses any commit after the deadline: no backdating", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      await time.increaseTo(t.commit);
      await expect(f.pact.connect(f.opA).commit(eventId, Z)).to.be.revertedWithCustomError(f.pact, "CommitWindowClosed");
    });

    it("re-commit appends a new entry and the old one stays on record", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId } = await openEvent(f);
      await seal(f, f.opA, eventId, 1, HOLD);
      const second = await seal(f, f.opA, eventId, 1, MAN);
      const history = await f.pact.getCommits(eventId, 0);
      expect(history.length).to.equal(2);
      expect(history[1].hash).to.equal(second.hash);
      expect(history[0].hash).to.not.equal(history[1].hash);
    });

    it("caps re-commits", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId } = await openEvent(f);
      for (let i = 0; i < 5; i++) await f.pact.connect(f.opA).commit(eventId, ethers.id("c" + i));
      await expect(f.pact.connect(f.opA).commit(eventId, ethers.id("c6"))).to.be.revertedWithCustomError(f.pact, "TooManyCommits");
    });

    it("a revoked operator can no longer commit", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId } = await openEvent(f);
      await f.pact.revokeOperator(f.opA.address);
      await expect(f.pact.connect(f.opA).commit(eventId, Z)).to.be.revertedWithCustomError(f.pact, "NotOperator");
    });
  });

  describe("reveal (opening the seal)", () => {
    it("is refused before commits close and after reveals close", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      const s = await seal(f, f.opA, eventId, 1, HOLD);
      await expect(open(f, f.opA, eventId, s)).to.be.revertedWithCustomError(f.pact, "RevealNotOpen");
      await time.increaseTo(t.reveal);
      await expect(open(f, f.opA, eventId, s)).to.be.revertedWithCustomError(f.pact, "RevealWindowClosed");
    });

    it("must match the sealed hash: no changing your mind", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      const s = await seal(f, f.opA, eventId, 1, HOLD);
      await time.increaseTo(t.commit);
      // claim MANEUVER instead of HOLD
      await expect(f.pact.connect(f.opA).reveal(eventId, MAN, s.paramsHash, s.salt)).to.be.revertedWithCustomError(f.pact, "HashMismatch");
      // wrong salt
      await expect(f.pact.connect(f.opA).reveal(eventId, HOLD, s.paramsHash, P.randomSalt())).to.be.revertedWithCustomError(f.pact, "HashMismatch");
      // wrong plan fingerprint
      await expect(f.pact.connect(f.opA).reveal(eventId, HOLD, ethers.id("other"), s.salt)).to.be.revertedWithCustomError(f.pact, "HashMismatch");
      await open(f, f.opA, eventId, s);
    });

    it("copying the other operator's hash is useless", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      const a = await seal(f, f.opA, eventId, 1, MAN);
      // B copies A's exact commitment hash
      await f.pact.connect(f.opB).commit(eventId, a.hash);
      await time.increaseTo(t.commit);
      await expect(f.pact.connect(f.opB).reveal(eventId, MAN, a.paramsHash, a.salt)).to.be.revertedWithCustomError(f.pact, "HashMismatch");
      await open(f, f.opA, eventId, a); // the original still opens
    });

    it("a superseded commitment cannot be revealed", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      const first = await seal(f, f.opA, eventId, 1, HOLD);
      await seal(f, f.opA, eventId, 1, MAN);
      await time.increaseTo(t.commit);
      await expect(open(f, f.opA, eventId, first)).to.be.revertedWithCustomError(f.pact, "HashMismatch");
    });

    it("needs a commitment, valid action, and only once", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      const b = await seal(f, f.opB, eventId, 2, HOLD);
      await time.increaseTo(t.commit);
      await expect(f.pact.connect(f.opA).reveal(eventId, HOLD, Z, Z)).to.be.revertedWithCustomError(f.pact, "NoCommitment");
      await expect(f.pact.connect(f.opB).reveal(eventId, P.ACTION.NONE, b.paramsHash, b.salt)).to.be.revertedWithCustomError(f.pact, "InvalidAction");
      await expect(f.pact.connect(f.opC).reveal(eventId, HOLD, Z, Z)).to.be.revertedWithCustomError(f.pact, "NotAParty");
      await open(f, f.opB, eventId, b);
      await expect(open(f, f.opB, eventId, b)).to.be.revertedWithCustomError(f.pact, "AlreadyRevealed");
    });

    it("the JS helper computes the same hash as the contract", async () => {
      const f = await loadFixture(deployFixture);
      const salt = P.randomSalt();
      const ph = ethers.id("plan");
      const onChain = await f.pact.commitmentHash(1, 1, f.opA.address, MAN, ph, salt);
      const offChain = P.commitmentHash({
        chainId: (await ethers.provider.getNetwork()).chainId,
        contract: await f.pact.getAddress(), eventId: 1, satId: 1,
        operator: f.opA.address, action: MAN, paramsHash: ph, salt,
      });
      expect(offChain).to.equal(onChain);
    });
  });

  describe("attest and finalize", () => {
    it("attestations: screeners only, after TCA, valid, once each", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      await expect(f.pact.connect(f.screener1).attest(eventId, 1, 100)).to.be.revertedWithCustomError(f.pact, "TooEarlyToAttest");
      await time.increaseTo(t.tca);
      await expect(f.pact.connect(f.stranger).attest(eventId, 1, 100)).to.be.revertedWithCustomError(f.pact, "NotScreener");
      await expect(f.pact.connect(f.opA).attest(eventId, 1, 100)).to.be.revertedWithCustomError(f.pact, "NotScreener");
      await expect(f.pact.connect(f.screener1).attest(eventId, 4, 100)).to.be.revertedWithCustomError(f.pact, "InvalidObservation");
      await f.pact.connect(f.screener1).attest(eventId, 1, 100);
      await expect(f.pact.connect(f.screener1).attest(eventId, 1, 100)).to.be.revertedWithCustomError(f.pact, "AlreadyAttested");
      expect((await f.pact.getConjunction(eventId)).finalized).to.equal(false); // quorum is 2
    });

    it("refuses attestations after the window", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId } = await openEvent(f);
      const c = await f.pact.getConjunction(eventId);
      await time.increaseTo(Number(c.attestDeadline) + 1);
      await expect(f.pact.connect(f.screener1).attest(eventId, 1, 100)).to.be.revertedWithCustomError(f.pact, "AttestWindowClosed");
    });

    it("finalizes by itself when the quorum agrees; disagreeing votes do not count together", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      await time.increaseTo(t.tca);
      await f.pact.connect(f.screener1).attest(eventId, 1, 100);
      await f.pact.connect(f.screener2).attest(eventId, 2, 100); // disagrees
      expect((await f.pact.getConjunction(eventId)).finalized).to.equal(false);
      const atts = await f.pact.getAttestations(eventId);
      expect(atts.length).to.equal(2);
    });

    it("finalize is refused during the window, and after it is allowed to anyone", async () => {
      const f = await loadFixture(deployFixture);
      const { eventId, t } = await openEvent(f);
      await time.increaseTo(t.tca);
      await expect(f.pact.connect(f.stranger).finalize(eventId)).to.be.revertedWithCustomError(f.pact, "NotFinalizable");
      const c = await f.pact.getConjunction(eventId);
      await time.increaseTo(Number(c.attestDeadline) + 1);
      await f.pact.connect(f.stranger).finalize(eventId);
      await expect(f.pact.finalize(eventId)).to.be.revertedWithCustomError(f.pact, "AlreadyFinalized");
      await expect(f.pact.connect(f.screener1).attest(eventId, 1, 1)).to.be.revertedWithCustomError(f.pact, "AlreadyFinalized");
    });
  });

  describe("verdicts and promises", () => {
    it("COORDINATED: A holds, B maneuvers, both observed as promised -> both KEPT", async () => {
      const f = await loadFixture(deployFixture);
      const id = await play(f, { a: HOLD, b: MAN, mask: 2 });
      const c = await f.pact.getConjunction(id);
      expect(P.VERDICT_NAME[c.verdict]).to.equal("COORDINATED");
      expect(P.PLEDGE_NAME[c.pledgeA]).to.equal("KEPT");
      expect(P.PLEDGE_NAME[c.pledgeB]).to.equal("KEPT");
      expect(c.attested).to.equal(true);
      expect(P.PHASE_NAME[Number(await f.pact.phaseOf(id))]).to.equal("FINALIZED");
    });

    it("BROKEN: A promised HOLD but was seen maneuvering", async () => {
      const f = await loadFixture(deployFixture);
      const id = await play(f, { a: HOLD, b: HOLD, mask: 1 });
      const c = await f.pact.getConjunction(id);
      expect(P.VERDICT_NAME[c.verdict]).to.equal("UNMITIGATED");
      expect(P.PLEDGE_NAME[c.pledgeA]).to.equal("BROKEN");
      expect(P.PLEDGE_NAME[c.pledgeB]).to.equal("KEPT");
    });

    it("DOUBLE_MANEUVER: both promise to move", async () => {
      const f = await loadFixture(deployFixture);
      const id = await play(f, { a: MAN, b: MAN, mask: 3 });
      expect(P.VERDICT_NAME[(await f.pact.getConjunction(id)).verdict]).to.equal("DOUBLE_MANEUVER");
    });

    it("SILENT and WITHHELD are judged even with no observations", async () => {
      const f = await loadFixture(deployFixture);
      const id = await play(f, { a: "withhold", b: null, mask: null });
      const c = await f.pact.getConjunction(id);
      expect(P.VERDICT_NAME[c.verdict]).to.equal("INCOMPLETE");
      expect(P.PLEDGE_NAME[c.pledgeA]).to.equal("WITHHELD");
      expect(P.PLEDGE_NAME[c.pledgeB]).to.equal("SILENT");
      expect(c.attested).to.equal(false);
    });

    it("UNVERIFIED: revealed but nobody observed -> no reputation change", async () => {
      const f = await loadFixture(deployFixture);
      const id = await play(f, { a: MAN, b: HOLD, mask: null });
      const c = await f.pact.getConjunction(id);
      expect(P.PLEDGE_NAME[c.pledgeA]).to.equal("UNVERIFIED");
      const [rep, , rated] = await f.pact.reputationOf(f.opA.address);
      expect(rated).to.equal(false);
      expect(rep.kept).to.equal(0);
    });
  });

  describe("reputation", () => {
    it("is computed on chain from outcomes and survives revocation", async () => {
      const f = await loadFixture(deployFixture);
      await play(f, { a: HOLD, b: MAN, mask: 2 });   // A kept, B kept
      await play(f, { a: HOLD, b: MAN, mask: 3 });   // A broken, B kept
      await play(f, { a: MAN, b: null, mask: 1 });   // A kept, B silent
      await play(f, { a: HOLD, b: HOLD, mask: 0 });  // both kept

      let [repA, scoreA, ratedA] = await f.pact.reputationOf(f.opA.address);
      expect([repA.kept, repA.broken, repA.withheld, repA.silent].map(Number)).to.deep.equal([3, 1, 0, 0]);
      expect(scoreA).to.equal(7500);
      expect(ratedA).to.equal(true);

      let [repB, scoreB] = await f.pact.reputationOf(f.opB.address);
      expect([repB.kept, repB.broken, repB.withheld, repB.silent].map(Number)).to.deep.equal([3, 0, 0, 1]);
      expect(scoreB).to.equal(7500);

      await f.pact.revokeOperator(f.opA.address);
      [, scoreA] = await f.pact.reputationOf(f.opA.address);
      expect(scoreA).to.equal(7500);
      const info = await f.pact.operatorInfo(f.opA.address);
      expect(info.active).to.equal(false);
      expect(info.exists).to.equal(true);
    });

    it("unrated operators report no score", async () => {
      const f = await loadFixture(deployFixture);
      const [, score, rated] = await f.pact.reputationOf(f.opC.address);
      expect(score).to.equal(0);
      expect(rated).to.equal(false);
    });
  });

  describe("append-only corrections", () => {
    it("errata are new entries and change no outcome", async () => {
      const f = await loadFixture(deployFixture);
      const id = await play(f, { a: HOLD, b: MAN, mask: 2 });
      const before = await f.pact.getConjunction(id);
      await f.pact.connect(f.opA).fileErratum(id, ethers.id("burn log attached"));
      await f.pact.connect(f.screener1).fileErratum(id, ethers.id("tracking recheck"));
      await expect(f.pact.connect(f.opC).fileErratum(id, Z)).to.be.revertedWithCustomError(f.pact, "NotAParty");
      await expect(f.pact.connect(f.stranger).fileErratum(id, Z)).to.be.revertedWithCustomError(f.pact, "NotAParty");
      const errata = await f.pact.getErrata(id);
      expect(errata.length).to.equal(2);
      const after = await f.pact.getConjunction(id);
      expect(after.verdict).to.equal(before.verdict);
      expect(after.pledgeA).to.equal(before.pledgeA);
    });
  });

  describe("phases", () => {
    it("moves COMMIT -> REVEAL -> LOCKED -> ATTEST -> FINALIZED", async () => {
      const f = await loadFixture(deployQuorum1);
      const { eventId, t } = await openEvent(f);
      const phase = async () => P.PHASE_NAME[Number(await f.pact.phaseOf(eventId))];
      expect(await phase()).to.equal("COMMIT");
      await time.increaseTo(t.commit);
      expect(await phase()).to.equal("REVEAL");
      await time.increaseTo(t.reveal);
      expect(await phase()).to.equal("LOCKED");
      await time.increaseTo(t.tca);
      expect(await phase()).to.equal("ATTEST");
      await f.pact.connect(f.screener1).attest(eventId, 0, 300);
      expect(await phase()).to.equal("FINALIZED");
      expect(P.PHASE_NAME[Number(await f.pact.phaseOf(77))]).to.equal("NONE");
    });
  });

  describe("hash-chained ledger", () => {
    it("replaying the logs independently reproduces the on-chain head", async () => {
      const f = await loadFixture(deployFixture);
      await play(f, { a: HOLD, b: MAN, mask: 2 });
      await play(f, { a: MAN, b: null, mask: 1 });
      await play(f, { a: HOLD, b: "withhold", mask: null });
      const report = await replayLedger(f.pact);
      expect(report.problems).to.deep.equal([]);
      expect(report.ok).to.equal(true);
      expect(report.entries).to.equal(Number(await f.pact.entryCount()));
      expect(report.head).to.equal(await f.pact.ledgerHead());
    });

    it("detects a missing log (a mirror that dropped an entry)", async () => {
      const f = await loadFixture(deployFixture);
      await play(f, { a: HOLD, b: MAN, mask: 2 });
      // Simulate a tampered mirror: wrap the provider so one Entry log disappears.
      const provider = f.pact.runner.provider;
      const real = provider.getLogs.bind(provider);
      provider.getLogs = async (...args) => {
        const logs = await real(...args);
        const idx = logs.findIndex((l) => l.topics[0] === f.pact.interface.getEvent("Entry").topicHash && BigInt(l.topics[1]) === 7n);
        return logs.filter((_, i) => i !== idx);
      };
      const report = await replayLedger(f.pact);
      provider.getLogs = real;
      expect(report.ok).to.equal(false);
      expect(report.problems.length).to.be.greaterThan(0);
    });
  });
});
