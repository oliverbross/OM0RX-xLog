# Contest core contract

Status: Astra-approved fixture-scoped P1/P2 foundation at `71f71b2`, with the full-UUID persistence contract incorporated in approved store commit `c105b61` and the integrated worker/UI fixture contract approved at `603b770`. This is source and focused-test evidence, not completed cross-platform acceptance or current CQ sponsor approval.

## Boundary

`XContestCore` is a Foundation-only Swift target. It has no UI, AppKit, SwiftUI, radio, network, credential, clock, UUID-generation or filesystem side effects. Callers supply immutable session and QSO snapshots. The evaluator sorts by UTC timestamp and UUID string, then performs a full replay. A caller represents an edit by replacing the QSO snapshot and a deletion by omitting it; scoring the surviving snapshots is therefore the same operation as a full rescore.

A session pins:

- session UUID and a full UUID workspace generation (separate from the unsigned aggregate revision);
- exact rule ID, implementation version, source edition and source revision;
- reference-data version;
- start/end and immutable station callsign, entity and sent-exchange snapshot.

A QSO preserves raw and normalized sent/received exchanges, source provenance/source identity, resolved entity, operator/location, band/mode/frequency and UTC time. Missing or semantically invalid entity data, invalid CW RST, mismatched sent exchange and malformed received exchanges fail closed for the two pilot rules: they award no points or multipliers and do not occupy a duplicate key. Duplicate QSO identities and nonfinite timestamps reject the entire replay before ordering.

## Rule and score API

`ContestRule` exposes immutable metadata and pure evaluation. Evaluation returns validation reasons, a duplicate key, points and multiplier candidates. `ContestEngine.score` verifies the pinned rule identity, rejects cross-session QSOs, orders input deterministically, awards duplicate/multiplier state only to valid accepted contacts, and uses checked integer addition/multiplication.

`ContestRuleRegistry.pilots` resolves only exact versioned identities. The initial entries are:

- `cq-ww-cw` / `1.0.0-source-spike` / `source-26.10.11` / `7c8b499225a73f7f8f792246881bd7aefc05452f`;
- `cq-wpx-cw` / `1.0.0-source-spike` / `source-26.10.11` / `7c8b499225a73f7f8f792246881bd7aefc05452f`.

Both accept CW on 160, 80, 40, 20, 15 and 10 metres and use a callsign-plus-band duplicate key scoped to the session. Frequency must match the recorded band.

CQ WW CW validates a received CQ zone from 1 through 40. It scores source-derived same-country/same-continent/North-America/different-continent points and awards country plus received-zone multipliers per band. CQ WPX CW validates positive sent and received serials, applies the pinned source's high/low-band geography points and awards each source-derived WPX prefix once per session.

These rules were translated from Not1MM by Michael Bridak, licensed GPL-3.0-or-later, through the pinned read-only `oliverbross/contest-sw` commit `7c8b499225a73f7f8f792246881bd7aefc05452f`. Exact source paths are `not1mm/plugins/cq_ww_cw.py`, `not1mm/plugins/cq_wpx_cw.py`, `not1mm/lib/ham_utility.py`, multiplier queries in `not1mm/lib/database.py`, and duplicate dispatch in `not1mm/__main__.py`. Translation attribution is also recorded in the repository `NOTICE`.

`Tests/XContestCoreTests/SourceFixtures/probe_wpx_prefix.py` extracts and executes only the pinned helper function after verifying that exact Git SHA. Its captured differential fixtures include source edge behavior: `K1ABC/P/QRP` becomes `P0`, `K1ABC/MM/QRP` becomes `MM0`, and `3ABC` becomes `3A0`. Those surprising outputs are deliberately retained for P2 source parity and documented as source behavior requiring sponsor/semantic review; they are not silently corrected in this spike. Fixture arithmetic is independently stated in Swift tests. Sponsor editions and any differences from the source remain a separate rules review.

## Cabrillo foundation

`CabrilloExporter` emits Cabrillo 3.0 with CRLF endings, deterministic QSO ordering, UTC date/time and fixed-width pilot QSO fields. It rejects unsafe header characters, missing/oversized required QSO fields, invalid rule/QSO/session combinations and any score that does not equal a fresh replay. The output is an exact foundation for the two source-derived pilot layouts; sponsor submission acceptance, category completeness and encoding/platform file workflows remain open.

## Persistence protocol boundary

Mutations carry `sessionID`, full-UUID `workspaceGeneration`, `requestID`, unsigned `expectedRevision`, optional `draftID` and a correlation digest. The durable implementation compares and retains the canonical structured operation payload; the digest is not trusted as proof of payload equality. The same request ID and same payload returns the original typed-result receipt, while the same ID with a different payload fails as a conflict. Receipt and full-draft lookup are explicit so an uncertain response is resolved with the same stable request identity.

Session UUIDs are allocated outside the evaluator before create and appear in both the create payload and mutation scope, so an uncertain create has a stable receipt key even before a session row is known to be committed. Create expects revision zero. Every later mutation compares and advances one session aggregate revision; draft and serial values report the session revision at which they were returned. Durable replay checks request identity plus canonical payload before expected revision so a valid retry returns its original receipt after the aggregate has advanced.

Serial reservations are draft-bound, explicitly scoped to session/band/transmitter, and expose guarded reserved, transmitted, uncertain, committed and void transitions. `XContestStore` now implements the approved pilot SQLite boundary, transactions, migrations, durable receipts and close/reopen recovery in `c105b61`; its detailed constraints and remaining P3 gates are recorded in `STORE_CONTRACT.md`.

## Current verification limits

The corrected focused suite has 16 native tests covering per-band duplicates, CQ WW country/zone multipliers, CQ WPX unique prefixes and source arithmetic (including the North American branch), same-country zero-point multipliers, edit/delete replay equivalence, deterministic tie-breaking, duplicate identities, nonfinite timestamps, checked arithmetic, semantic geography, exchange/RST validation, serial transitions, and exact/rejected Cabrillo output. All 16 passed after the UUID contract change. The corresponding portable-manifest command exited zero, but its executed-test count was elided, so this checkpoint does not claim a counted portable rerun. Workflow run `39029076031` at `de458e7` does not establish three-OS acceptance: macOS failed during manifest type-checking, Linux failed in session tests excluded from the portable implementation target, and Windows failed on an unconditional `CoreFoundation` import. The manifest repair and TCI guard were approved at `2366341`; hosted rerun `39029612842` is pending, and the Windows import repair remains under review. Sponsor-rule reconciliation, test packaging and integrated UI/runtime acceptance remain separate gates.
