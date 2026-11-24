// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/*
 ____  _          ____            _
/ ___|| | ___   _|  _ \ __ _  ___| |_
\___ \| |/ / | | | |_) / _` |/ __| __|
 ___) |   <| |_| |  __/ (_| | (__| |_
|____/|_|\_\\__, |_|   \__,_|\___|\__|
            |___/

SkyPact - sealed-bid maneuver pacts between satellite operators.

THE PROBLEM
  Two satellites are on course for a close approach. Each operator can
  burn to dodge, or hold and hope. If both wait to see what the other
  does, nobody moves (free-riding). If both move blindly, they can move
  into each other, and either way nobody can later prove who promised
  what, or when.

WHAT THIS CONTRACT DOES
  1. A screener (an independent conjunction-screening service approved
     by the admin) opens a Conjunction between two satellites.
  2. COMMIT   Each operator seals its decision (HOLD or MANEUVER) as a
              hash before the commit deadline. Nobody, including the
              other operator, can see it. Re-committing is allowed and
              appends a new entry; the old one stays on record.
  3. REVEAL   After commits close, each operator opens its seal. The
              contract rejects any reveal that does not match.
  4. ATTEST   After the time of closest approach, independent screeners
              report what they actually observed. When a quorum agree,
              the event finalizes on its own.
  5. FINALIZE The contract computes a coordination verdict from the
              sealed decisions and, per operator, whether it KEPT or
              BROKE its promise, stayed SILENT, or WITHHELD its reveal.
              Anyone may finalize after the attest window closes.
  6. REPUTATION Every operator has a public promise-keeping score that
              is computed by the contract, not asserted by anyone.

WHAT IT REFUSES (see custom errors)
  - a wallet committing for a satellite it does not operate
  - any commit after the commit deadline (no backdating)
  - a reveal before commits close, after reveals close, or that does
    not match the sealed hash (no changing your mind afterwards)
  - attestations from non-screeners, or before the closest approach
  - double reveals, double attestations, double finalization

APPEND-ONLY
  Nothing is edited or deleted. Corrections are new entries: a new
  commit supersedes an earlier one, an erratum is a new note. Every
  state change also extends a hash chain (ledgerHead) so an off-chain
  mirror can prove it is complete (see scripts/verify-ledger.js).

PRIVACY
  Only hashes and opaque IDs are stored. Orbital elements, burn plans
  and conjunction messages stay off-chain; only their fingerprints
  (cdmHash, paramsHash) are recorded. Satellite labels are fictional.
*/
contract SkyPact {
    // ---------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------

    enum Action { NONE, HOLD, MANEUVER }
    enum Verdict { PENDING, COORDINATED, DOUBLE_MANEUVER, UNMITIGATED, INCOMPLETE }
    enum Pledge { PENDING, KEPT, BROKEN, WITHHELD, SILENT, UNVERIFIED }
    enum Phase { NONE, COMMIT, REVEAL, LOCKED, ATTEST, FINALIZED }
    enum Kind {
        OPERATOR_ADDED, OPERATOR_REVOKED, SCREENER_ADDED, SCREENER_REVOKED,
        SATELLITE_REGISTERED, CONJUNCTION_OPENED, COMMITTED, REVEALED,
        ATTESTED, FINALIZED, ERRATUM, CONFIG
    }

    struct Operator {
        bool active;
        bool exists;
        string name;
    }

    struct Satellite {
        address operator;
        uint64 registeredAt;
        string label;
    }

    struct Conjunction {
        uint256 satA;
        uint256 satB;
        address opA;
        address opB;
        address screener;          // who opened it
        uint64 openedAt;
        uint64 tca;                // time of closest approach
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 attestDeadline;
        bytes32 cdmHash;           // fingerprint of the off-chain conjunction message
        uint32 predictedMissMeters;
        uint8 quorum;              // snapshot at open time
        bool finalized;
        bool attested;             // quorum reached
        uint8 observedMask;        // bit0: A maneuvered, bit1: B maneuvered
        uint32 observedMissMeters;
        Verdict verdict;
        Pledge pledgeA;
        Pledge pledgeB;
    }

    struct Commit {
        bytes32 hash;
        uint64 at;
    }

    struct Reveal {
        Action action;
        bytes32 paramsHash;        // fingerprint of the off-chain burn plan
        uint64 at;
    }

    struct Attestation {
        address screener;
        uint8 mask;
        uint32 missMeters;
        uint64 at;
    }

    struct Erratum {
        address by;
        bytes32 noteHash;
        uint64 at;
    }

    struct Reputation {
        uint32 kept;
        uint32 broken;
        uint32 withheld;
        uint32 silent;
    }

    // ---------------------------------------------------------------
    // Errors (the frontend maps these to friendly messages; see errors.json)
    // ---------------------------------------------------------------

    error NotAdmin();
    error NotOperator();
    error NotScreener();
    error ZeroAddress();
    error AlreadyOperator();
    error AlreadyScreener();
    error UnknownOperator();
    error UnknownScreener();
    error LabelInvalid();
    error LabelTaken();
    error UnknownSatellite();
    error UnknownConjunction();
    error SameSatellite();
    error SameOperator();
    error OperatorNotActive();
    error BadSchedule();
    error BadParams();
    error NotAParty();
    error CommitWindowClosed();
    error TooManyCommits();
    error RevealNotOpen();
    error RevealWindowClosed();
    error NoCommitment();
    error AlreadyRevealed();
    error InvalidAction();
    error HashMismatch();
    error TooEarlyToAttest();
    error AttestWindowClosed();
    error AlreadyAttested();
    error InvalidObservation();
    error AlreadyFinalized();
    error NotFinalizable();

    // ---------------------------------------------------------------
    // Events. Each state change emits its specific event, then Entry.
    // The Entry digest is keccak256(abi.encode(<the specific event's args>)).
    // ---------------------------------------------------------------

    event OperatorAdded(address operator, string name);
    event OperatorRevoked(address operator);
    event ScreenerAdded(address screener);
    event ScreenerRevoked(address screener);
    event SatelliteRegistered(uint256 satId, address operator, string label);
    event ConjunctionOpened(uint256 eventId, Conjunction snapshot);
    event Committed(uint256 indexed eventId, uint8 side, address operator, uint256 satId, uint32 revision, bytes32 commitment, uint64 at);
    event Revealed(uint256 indexed eventId, uint8 side, address operator, uint256 satId, Action action, bytes32 paramsHash, uint64 at);
    event Attested(uint256 indexed eventId, address screener, uint8 mask, uint32 missMeters, uint64 at, bool quorumReached);
    event Finalized(uint256 indexed eventId, Verdict verdict, Pledge pledgeA, Pledge pledgeB, uint8 observedMask, uint32 observedMissMeters, bool attested, uint64 at);
    event ErratumFiled(uint256 indexed eventId, address by, bytes32 noteHash, uint64 at);
    event ParamsSet(uint8 quorum, uint32 attestWindow);

    /// Hash-chain link. head = keccak256(abi.encode(prevHead, index, kind, digest)).
    event Entry(uint256 indexed index, Kind indexed kind, bytes32 digest, bytes32 head);

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    uint8 public constant MAX_COMMITS_PER_SIDE = 5;
    uint8 public constant MAX_QUORUM = 10;

    address public admin;
    uint32 public immutable minPhaseSeconds;   // minimum length of commit and reveal windows
    uint32 public attestWindowSeconds;         // how long after TCA screeners may attest
    uint8 public attestQuorum;                 // matching attestations needed

    uint256 public satelliteCount;
    uint256 public conjunctionCount;
    uint256 public entryCount;
    bytes32 public ledgerHead;

    mapping(address => Operator) private _operators;
    mapping(address => bool) public isScreener;
    mapping(uint256 => Satellite) private _satellites;
    mapping(bytes32 => uint256) private _satByLabel;
    mapping(uint256 => Conjunction) private _conjunctions;
    mapping(uint256 => Commit[]) private _commits;      // key = eventId * 2 + side
    mapping(uint256 => Reveal[2]) private _reveals;
    mapping(uint256 => Attestation[]) private _attestations;
    mapping(uint256 => mapping(address => bool)) private _hasAttested;
    mapping(uint256 => uint32[4]) private _votes;
    mapping(uint256 => Erratum[]) private _errata;
    mapping(address => Reputation) private _reputation;

    // ---------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------

    // Modifiers call shared internal checks (keeps the bytecode small without the optimizer).
    modifier onlyAdmin() { _checkAdmin(); _; }
    modifier onlyOperator() { _checkOperator(); _; }
    modifier onlyScreener() { _checkScreener(); _; }

    function _checkAdmin() internal view { if (msg.sender != admin) revert NotAdmin(); }
    function _checkOperator() internal view { if (!_operators[msg.sender].active) revert NotOperator(); }
    function _checkScreener() internal view { if (!isScreener[msg.sender]) revert NotScreener(); }

    constructor(uint32 minPhaseSeconds_, uint32 attestWindowSeconds_, uint8 attestQuorum_) {
        if (minPhaseSeconds_ == 0 || attestWindowSeconds_ == 0) revert BadParams();
        if (attestQuorum_ == 0 || attestQuorum_ > MAX_QUORUM) revert BadParams();
        admin = msg.sender;
        minPhaseSeconds = minPhaseSeconds_;
        attestWindowSeconds = attestWindowSeconds_;
        attestQuorum = attestQuorum_;
        emit ParamsSet(attestQuorum_, attestWindowSeconds_);
        _append(Kind.CONFIG, keccak256(abi.encode(attestQuorum_, attestWindowSeconds_)));
    }

    // ---------------------------------------------------------------
    // Admin: decides who is allowed
    // ---------------------------------------------------------------

    function addOperator(address operator, string calldata name) external onlyAdmin {
        if (operator == address(0)) revert ZeroAddress();
        if (_operators[operator].active) revert AlreadyOperator();
        if (bytes(name).length == 0 || bytes(name).length > 32) revert LabelInvalid();
        _operators[operator] = Operator({active: true, exists: true, name: name});
        emit OperatorAdded(operator, name);
        _append(Kind.OPERATOR_ADDED, keccak256(abi.encode(operator, name)));
    }

    function revokeOperator(address operator) external onlyAdmin {
        if (!_operators[operator].active) revert UnknownOperator();
        _operators[operator].active = false; // record and reputation are kept
        emit OperatorRevoked(operator);
        _append(Kind.OPERATOR_REVOKED, keccak256(abi.encode(operator)));
    }

    function addScreener(address screener) external onlyAdmin {
        if (screener == address(0)) revert ZeroAddress();
        if (isScreener[screener]) revert AlreadyScreener();
        isScreener[screener] = true;
        emit ScreenerAdded(screener);
        _append(Kind.SCREENER_ADDED, keccak256(abi.encode(screener)));
    }

    function revokeScreener(address screener) external onlyAdmin {
        if (!isScreener[screener]) revert UnknownScreener();
        isScreener[screener] = false;
        emit ScreenerRevoked(screener);
        _append(Kind.SCREENER_REVOKED, keccak256(abi.encode(screener)));
    }

    /// Applies to conjunctions opened after this call (each event snapshots its own quorum).
    function setParams(uint8 quorum, uint32 attestWindow) external onlyAdmin {
        if (quorum == 0 || quorum > MAX_QUORUM || attestWindow == 0) revert BadParams();
        attestQuorum = quorum;
        attestWindowSeconds = attestWindow;
        emit ParamsSet(quorum, attestWindow);
        _append(Kind.CONFIG, keccak256(abi.encode(quorum, attestWindow)));
    }

    // ---------------------------------------------------------------
    // Operator: registers satellites, seals and opens decisions
    // ---------------------------------------------------------------

    /// Label is a fictional identifier such as "SAT-001". Never a real catalogue number.
    function registerSatellite(string calldata label) external onlyOperator returns (uint256 satId) {
        uint256 len = bytes(label).length;
        if (len == 0 || len > 32) revert LabelInvalid();
        bytes32 key = keccak256(bytes(label));
        if (_satByLabel[key] != 0) revert LabelTaken();
        satId = ++satelliteCount;
        _satByLabel[key] = satId;
        _satellites[satId] = Satellite({operator: msg.sender, registeredAt: uint64(block.timestamp), label: label});
        emit SatelliteRegistered(satId, msg.sender, label);
        _append(Kind.SATELLITE_REGISTERED, keccak256(abi.encode(satId, msg.sender, label)));
    }

    /// Seal your decision. Calling again before the deadline appends a new
    /// commitment that supersedes the previous one; the old one stays on record.
    function commit(uint256 eventId, bytes32 commitment) external onlyOperator {
        Conjunction storage c = _get(eventId);
        uint8 side = _sideOf(c, msg.sender);
        if (block.timestamp >= c.commitDeadline) revert CommitWindowClosed();
        Commit[] storage history = _commits[eventId * 2 + side];
        if (history.length >= MAX_COMMITS_PER_SIDE) revert TooManyCommits();
        history.push(Commit({hash: commitment, at: uint64(block.timestamp)}));
        uint256 satId = _satOf(c, side);
        uint32 revision = uint32(history.length);
        emit Committed(eventId, side, msg.sender, satId, revision, commitment, uint64(block.timestamp));
        _append(Kind.COMMITTED, keccak256(abi.encode(eventId, side, msg.sender, satId, revision, commitment, uint64(block.timestamp))));
    }

    /// Open your seal. Must match your latest commitment exactly.
    function reveal(uint256 eventId, Action action, bytes32 paramsHash, bytes32 salt) external onlyOperator {
        Conjunction storage c = _get(eventId);
        uint8 side = _sideOf(c, msg.sender);
        if (block.timestamp < c.commitDeadline) revert RevealNotOpen();
        if (block.timestamp >= c.revealDeadline) revert RevealWindowClosed();
        Commit[] storage history = _commits[eventId * 2 + side];
        if (history.length == 0) revert NoCommitment();
        if (_reveals[eventId][side].action != Action.NONE) revert AlreadyRevealed();
        if (action != Action.HOLD && action != Action.MANEUVER) revert InvalidAction();
        uint256 satId = _satOf(c, side);
        if (commitmentHash(eventId, satId, msg.sender, action, paramsHash, salt) != history[history.length - 1].hash) {
            revert HashMismatch();
        }
        _reveals[eventId][side] = Reveal({action: action, paramsHash: paramsHash, at: uint64(block.timestamp)});
        emit Revealed(eventId, side, msg.sender, satId, action, paramsHash, uint64(block.timestamp));
        _append(Kind.REVEALED, keccak256(abi.encode(eventId, side, msg.sender, satId, action, paramsHash, uint64(block.timestamp))));
    }

    /// Append-only correction note (hash of an off-chain note). Never changes an outcome.
    function fileErratum(uint256 eventId, bytes32 noteHash) external {
        Conjunction storage c = _get(eventId);
        if (msg.sender != c.opA && msg.sender != c.opB && !isScreener[msg.sender]) revert NotAParty();
        _errata[eventId].push(Erratum({by: msg.sender, noteHash: noteHash, at: uint64(block.timestamp)}));
        emit ErratumFiled(eventId, msg.sender, noteHash, uint64(block.timestamp));
        _append(Kind.ERRATUM, keccak256(abi.encode(eventId, msg.sender, noteHash, uint64(block.timestamp))));
    }

    // ---------------------------------------------------------------
    // Screener: opens conjunctions and attests what was observed
    // ---------------------------------------------------------------

    function openConjunction(
        uint256 satA,
        uint256 satB,
        uint64 tca,
        uint64 commitDeadline,
        uint64 revealDeadline,
        bytes32 cdmHash,
        uint32 predictedMissMeters
    ) external onlyScreener returns (uint256 eventId) {
        if (satA == 0 || satB == 0 || satA > satelliteCount || satB > satelliteCount) revert UnknownSatellite();
        if (satA == satB) revert SameSatellite();
        address opA = _satellites[satA].operator;
        address opB = _satellites[satB].operator;
        if (opA == opB) revert SameOperator();
        if (!_operators[opA].active || !_operators[opB].active) revert OperatorNotActive();
        if (
            commitDeadline < block.timestamp + minPhaseSeconds ||
            revealDeadline < commitDeadline + minPhaseSeconds ||
            tca < revealDeadline
        ) revert BadSchedule();

        eventId = ++conjunctionCount;
        Conjunction memory snap;
        snap.satA = satA;
        snap.satB = satB;
        snap.opA = opA;
        snap.opB = opB;
        snap.screener = msg.sender;
        snap.openedAt = uint64(block.timestamp);
        snap.tca = tca;
        snap.commitDeadline = commitDeadline;
        snap.revealDeadline = revealDeadline;
        snap.attestDeadline = tca + attestWindowSeconds;
        snap.cdmHash = cdmHash;
        snap.predictedMissMeters = predictedMissMeters;
        snap.quorum = attestQuorum;
        _conjunctions[eventId] = snap;
        emit ConjunctionOpened(eventId, snap);
        _append(Kind.CONJUNCTION_OPENED, keccak256(abi.encode(eventId, snap)));
    }

    /// mask: bit0 = satellite A was seen maneuvering, bit1 = satellite B was.
    function attest(uint256 eventId, uint8 mask, uint32 missMeters) external onlyScreener {
        Conjunction storage c = _get(eventId);
        if (c.finalized) revert AlreadyFinalized();
        if (block.timestamp < c.tca) revert TooEarlyToAttest();
        if (block.timestamp > c.attestDeadline) revert AttestWindowClosed();
        if (_hasAttested[eventId][msg.sender]) revert AlreadyAttested();
        if (mask > 3) revert InvalidObservation();

        _hasAttested[eventId][msg.sender] = true;
        _attestations[eventId].push(Attestation({screener: msg.sender, mask: mask, missMeters: missMeters, at: uint64(block.timestamp)}));
        uint32 votes = ++_votes[eventId][mask];
        bool reached = votes >= c.quorum;
        emit Attested(eventId, msg.sender, mask, missMeters, uint64(block.timestamp), reached);
        _append(Kind.ATTESTED, keccak256(abi.encode(eventId, msg.sender, mask, missMeters, uint64(block.timestamp), reached)));

        if (reached) {
            c.attested = true;
            c.observedMask = mask;
            c.observedMissMeters = missMeters;
            _finalize(eventId, c);
        }
    }

    /// Anyone can close an event once the attest window is over without quorum.
    /// Silent and withheld operators are still recorded; kept/broken need an observation.
    function finalize(uint256 eventId) external {
        Conjunction storage c = _get(eventId);
        if (c.finalized) revert AlreadyFinalized();
        if (block.timestamp <= c.attestDeadline) revert NotFinalizable();
        _finalize(eventId, c);
    }

    // ---------------------------------------------------------------
    // Pure helper so anyone (Remix, a script, the UI) can build a commitment
    // ---------------------------------------------------------------

    /// Binds the decision to this contract, chain, event, satellite and operator,
    /// so a copied hash is useless to anyone else. `salt` must be random and secret.
    function commitmentHash(
        uint256 eventId,
        uint256 satId,
        address operator,
        Action action,
        bytes32 paramsHash,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), eventId, satId, operator, action, paramsHash, salt));
    }

    // ---------------------------------------------------------------
    // Public reader views (no wallet needed)
    // ---------------------------------------------------------------

    function getConjunction(uint256 eventId) external view returns (Conjunction memory) {
        if (eventId == 0 || eventId > conjunctionCount) revert UnknownConjunction();
        return _conjunctions[eventId];
    }

    function phaseOf(uint256 eventId) public view returns (Phase) {
        if (eventId == 0 || eventId > conjunctionCount) return Phase.NONE;
        Conjunction storage c = _conjunctions[eventId];
        if (c.finalized) return Phase.FINALIZED;
        if (block.timestamp < c.commitDeadline) return Phase.COMMIT;
        if (block.timestamp < c.revealDeadline) return Phase.REVEAL;
        if (block.timestamp < c.tca) return Phase.LOCKED;
        return Phase.ATTEST;
    }

    /// side 0 = satellite A's operator, side 1 = satellite B's operator.
    function getCommits(uint256 eventId, uint8 side) external view returns (Commit[] memory) {
        if (eventId == 0 || eventId > conjunctionCount || side > 1) revert UnknownConjunction();
        return _commits[eventId * 2 + side];
    }

    function getReveal(uint256 eventId, uint8 side) external view returns (Reveal memory) {
        if (eventId == 0 || eventId > conjunctionCount || side > 1) revert UnknownConjunction();
        return _reveals[eventId][side];
    }

    function getAttestations(uint256 eventId) external view returns (Attestation[] memory) {
        return _attestations[eventId];
    }

    function getErrata(uint256 eventId) external view returns (Erratum[] memory) {
        return _errata[eventId];
    }

    function satellite(uint256 satId) external view returns (Satellite memory) {
        if (satId == 0 || satId > satelliteCount) revert UnknownSatellite();
        return _satellites[satId];
    }

    function satelliteIdByLabel(string calldata label) external view returns (uint256) {
        return _satByLabel[keccak256(bytes(label))];
    }

    function operatorInfo(address operator) external view returns (Operator memory) {
        return _operators[operator];
    }

    /// scoreBps = kept / (kept + broken + withheld + silent) in basis points.
    /// `rated` is false until an operator has at least one judged event.
    function reputationOf(address operator) external view returns (Reputation memory rep, uint16 scoreBps, bool rated) {
        rep = _reputation[operator];
        uint256 total = uint256(rep.kept) + rep.broken + rep.withheld + rep.silent;
        if (total == 0) return (rep, 0, false);
        return (rep, uint16((uint256(rep.kept) * 10000) / total), true);
    }

    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------

    function _get(uint256 eventId) internal view returns (Conjunction storage c) {
        if (eventId == 0 || eventId > conjunctionCount) revert UnknownConjunction();
        c = _conjunctions[eventId];
    }

    function _satOf(Conjunction storage c, uint8 side) internal view returns (uint256) {
        return side == 0 ? c.satA : c.satB;
    }

    function _sideOf(Conjunction storage c, address who) internal view returns (uint8) {
        if (who == c.opA) return 0;
        if (who == c.opB) return 1;
        revert NotAParty();
    }

    function _finalize(uint256 eventId, Conjunction storage c) internal {
        Reveal storage ra = _reveals[eventId][0];
        Reveal storage rb = _reveals[eventId][1];

        Pledge pa = _judge(eventId, 0, ra.action, c.attested, c.observedMask);
        Pledge pb = _judge(eventId, 1, rb.action, c.attested, c.observedMask);
        _recordPledge(c.opA, pa);
        _recordPledge(c.opB, pb);

        Verdict v;
        if (ra.action == Action.NONE || rb.action == Action.NONE) {
            v = Verdict.INCOMPLETE;
        } else if (ra.action == Action.MANEUVER && rb.action == Action.MANEUVER) {
            v = Verdict.DOUBLE_MANEUVER;
        } else if (ra.action == Action.MANEUVER || rb.action == Action.MANEUVER) {
            v = Verdict.COORDINATED;
        } else {
            v = Verdict.UNMITIGATED;
        }

        c.finalized = true;
        c.verdict = v;
        c.pledgeA = pa;
        c.pledgeB = pb;
        emit Finalized(eventId, v, pa, pb, c.observedMask, c.observedMissMeters, c.attested, uint64(block.timestamp));
        _append(
            Kind.FINALIZED,
            keccak256(abi.encode(eventId, v, pa, pb, c.observedMask, c.observedMissMeters, c.attested, uint64(block.timestamp)))
        );
    }

    function _judge(uint256 eventId, uint8 side, Action revealed, bool attested, uint8 mask) internal view returns (Pledge) {
        if (_commits[eventId * 2 + side].length == 0) return Pledge.SILENT;
        if (revealed == Action.NONE) return Pledge.WITHHELD;
        if (!attested) return Pledge.UNVERIFIED;
        Action observed = ((mask >> side) & 1) == 1 ? Action.MANEUVER : Action.HOLD;
        return observed == revealed ? Pledge.KEPT : Pledge.BROKEN;
    }

    function _recordPledge(address operator, Pledge p) internal {
        Reputation storage r = _reputation[operator];
        if (p == Pledge.KEPT) r.kept++;
        else if (p == Pledge.BROKEN) r.broken++;
        else if (p == Pledge.WITHHELD) r.withheld++;
        else if (p == Pledge.SILENT) r.silent++;
    }

    function _append(Kind kind, bytes32 digest) internal {
        uint256 index = entryCount;
        bytes32 head = keccak256(abi.encode(ledgerHead, index, kind, digest));
        ledgerHead = head;
        entryCount = index + 1;
        emit Entry(index, kind, digest, head);
    }
}
