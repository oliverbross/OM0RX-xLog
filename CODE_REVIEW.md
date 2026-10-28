# Application code review — 28 October 2026

**Reviewed source:** clean canonical `main` at `4bd554a25951ddc995b4bef1715d3df12918a07b`.
`origin/main` was fetched and fast-forward checked before inspection. There were
no initial uncommitted changes. Application version declarations are 1.3.60;
installed application identity was not inspected.

**Disposition: INCOMPLETE full-codebase manual review; actionable review stage delivered.**
Ten findings follow: **2 High, 7 Medium, 1 Low**. Every promoted finding was
independently checked by the coordinating reviewer. Eight have isolated executable
reproductions; CR-002 is supported by a complete static ownership/lifecycle trace;
CR-009 reproduces the production core plus the caller's exact data-handling loop,
without invoking its native file chooser. No application code, existing tests,
dependencies or configuration were modified. Earlier review records are preserved.

The scope includes existing code, not just a commit diff. A complete tracked-file
inventory, inspection depth, exclusions and remaining work are in
[REVIEW_COVERAGE.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REVIEW_COVERAGE.md).
Durable reproduction sources, outputs, suite logs and subreview records are in
[the evidence directory](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-2026-10-28).

## Findings

### CR-001 — Saving a manually dated QSO replaces its date with the current time

**High — silent corruption of an explicitly entered contact timestamp. Confidence:
high. Verification: reproduced using the built, unmodified XLogCore and real SQLite,
including reopen and durable receipt lookup.**

Location: [LogbookDatabase.swift:1945](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogCore/LogbookDatabase.swift:1945),
`applyOperatorDraft`, especially lines 1899, 1912–1913 and 1939–1964.
The intended contract is explicit in
[OperatorDraft.swift:9](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogCore/OperatorDraft.swift:9).

After a `.replace` changes the timestamp, `current.automaticStart` correctly becomes
false. During `.save`, the same local variable is reset to true for the *next*
blank draft before it is tested to resolve the *current* contact's start. Thus
`resolved.start = now` runs for manual contacts too. The transaction and retry
receipt reliably preserve this wrong value.

Reproduction: acknowledge a historical draft with start epoch `1700000000` and
`automaticStart:false`; save with injected button time `1790000000`. The saved
row and receipt both contain `1790000000`, including after closing and reopening
the database. One row is committed. This affects the normal-logging shared draft
used by main and detached editors; it is separate from historical ADIF import.
Contact time feeds ADIF export, remote synchronization, duplicate/history queries
and date-based statistics, so this can propagate beyond the entry screen.

Existing safeguard checked: `OperatorDraftTests.automaticAndManualStartProvenance`
asserts the automatic Save, then asserts the manual draft's pre-save value; it
never saves the manual draft. The full portable Swift suite passes despite this.
Evidence: `reproductions/repro_manual_time.swift` and
`results/repro_manual_time.json` in the evidence directory.

**Fix:** use the current snapshot's time provenance when resolving the saved
contact; assign automatic provenance to the next blank separately. Preserve
transaction, revision, power-capture and operation-replay behavior.
**Regression:** extend the existing test through manual Save, receipt replay and
reopen. Assert stored/exported start and explicit end, with automatic blank/spot
Save as a control. Address CR-008 in the same manual-time acceptance journey.

### CR-002 — Worker lifecycle hooks target different radio instances from command routing

**High — the connected owners' existing release/retirement path is bypassed.
Confidence: high. Verification: supported by static cross-component analysis;
actual RF behavior was not tested.**

Locations: [LiveWorker.swift:374](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/LiveWorker.swift:374)
and [LiveWorker.swift:414](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/LiveWorker.swift:414),
`startPowerCapture` / `shutdownOutcome`;
[LiveStationMethods.swift:26](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/LiveStationMethods.swift:26),
`StationRadioRegistry` and `handle` lines 121–175.

Routing constructs independent agent, FLEX and TCI actors for radio1/radio2.
The `.shared` actors are separate allocations (`LiveStationSession.swift:199`,
`LiveFlexSession.swift:54`, `LiveTCISession.swift:14`). Shutdown terminates those
singletons instead of the registry objects that own the connections.

Trigger: use a routed direct-agent slot and acquire GUI PTT or carrier Tune, then
quit or retire the worker without explicit disconnect. Worker EOF invokes
`shutdownOutcome` (`Sources/XLogPrototypeWorker/main.swift:158–162`), but does not
reach that connected actor's `terminate` → `shutdown` → `stop` chain.
`LiveStationSession.swift:988–1008` contains the intended owned CW/Tune/PTT release
requests. This finding establishes an omitted application cleanup attempt; it
does **not** establish continued RF, a failed external watchdog, or damage.

Outer safeguards checked: Rust `main.rs:4321–4353` stops an existing CW owner and
eventually shuts down the worker. `station_selection.rs:922–933` only marks owners
stopped and expressly relies on Swift EOF. PTT/carrier/release owners do not add
a general shutdown/disconnect-all fallback. No registry-wide lifecycle call was
found. Explicit disconnect still reaches the correct actor; that does not cover
EOF retirement.

The same ownership error installs the measured-power gate on the unused shared
agent. Routed agents capture their own nil `powerCapture` in connect callbacks
(`LiveStationSession.swift:314–335`), so those callbacks cannot feed the installed
gate. This is one root cause with two consequences, not two findings.

**Fix:** expose registry-owned startup and bounded retirement over the actual
slot instances; register capture on the routed owner(s), and release only owned
obligations before retiring every slot/provider. Retain uncertainty and existing
radio-selection fences. **Regression:** inject two fake slot providers into the
real worker lifecycle; prove capture attachment reaches the routed instance,
owned releases run, receive-only observers send no controls, both slots become
terminal, and no replacement starts. Cover ordinary EOF, pending acquisition
and operating-module retirement. Hardware acceptance is a subsequent boundary.

### CR-003 — Ordinary shutdown sends fldigi receive control without xLog transmit ownership

**Medium — can interrupt an independently operating fldigi instance. Confidence:
high. Verification: reproduced with the actual unmodified bridge actor, fake RPC
and small neighboring-interface stubs; no real network or radio.**

Locations: [LiveFldigiBridge.swift:121](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/LiveFldigiBridge.swift:121),
`stopForShutdown` / `suspendForWorkspaceChange`, and `returnToReceive` at 289–292;
callers `LiveWorker.swift:393–396` and 603–615.

Both lifecycle methods always call `returnToReceive`. Its only guard is external
I/O availability; it sends XML-RPC `main.rx` without checking configuration, a
prior xLog transmit attempt, engine identity or a retained release obligation.
Every production process owner reaches the shutdown call, including normal
logging where fldigi was never configured. Create/restore reaches the suspension
call before the workspace mutation succeeds.

Reproduction: instantiate a bridge with a nonexistent configuration path and a
fake RPC, then call shutdown. Recorded calls: `["main.rx"]`. A second never-used
bridge called through workspace suspension records the same. Existing tests
exercise explicit Stop, TX errors and disabled external I/O, but omit this
never-configured lifecycle case. Evidence: `reproductions/fldigi/` and
`results/root-fldigi-repro.txt`.

**Fix:** retain a session-scoped output/release duty after admitting an xLog
transmit attempt, and perform lifecycle `main.rx` only for that duty. Preserve
uncertain release information. Define explicit operator emergency Stop separately.
**Regression:** never-configured, disabled and receive-only shutdown/workspace
changes send no XML-RPC controls; owned/pending transmit duties still release,
without affecting a replaced or unrelated engine instance.

### CR-004 — Historical contest import emits changes that replica catch-up cannot consume

**Medium — a successful authority-side import can block subsequent replica
catch-up. Confidence: high. Verification: reproduced with independent real Host
roots and synthetic SQLite stores.**

Locations: [adif_import.py:131](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/adif_import.py:131),
`apply`; [host.py:2190](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/host.py:2190),
`coordinate(multi_changes)`; [host.py:2358](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/host.py:2358),
`apply_replica`, also line 2372.

The reviewed importer inserts a real contact and emits audit kind `adif_import`
without `afterIdentity`. The authority's normal change stream forwards it.
Replica apply accepts only `commit`, `correct`, `delete`, then requires durable
identity data. The producer and consumer contracts disagree at both checks.

Reproduction: pair empty master/replica fixtures, import one valid historical
contact on the master, request its ordinary change page and apply it on the
replica. The page contains `adif_import` / null after-identity; apply rejects
“Replica change kind is invalid”. Master retains one contact; replica retains
zero. The rejection is fail-closed and preserves data, but leaves catch-up
blocked on an event that was legitimately produced. Merely widening the kind
allowlist is insufficient because the identity image is also missing.

Safeguards checked: replica-side import is correctly blocked by the authority
guard; that does not stop authority-side imports. No documented master-import
exclusion or matching native admission restriction was found. Source/type
validation and receipt replay do not translate this audit event. If the intended
product policy is to forbid this combination, that policy needs explicit
enforcement before import and a clear recovery path.

Evidence: `reproductions/repro_import_replica.py` and matching result JSON.
**Fix:** emit replication-compatible insert/identity images while retaining
historical provenance separately, or explicitly gate the unsupported workflow
and provide reviewed resnapshot/rejoin recovery. Preserve remote/import exclusion
from local output and recorder attribution. **Regression:** paired Host import,
catch-up, repeat/restart and later correction/deletion; assert identical contacts,
cursor continuity and zero replayed output actions.

### CR-005 — Shared serial allocation ignores historical imports

**Medium — authority can issue a valid-looking serial already used in its log.
Confidence: high. Verification: real Host reproduction; later commit rejection
was also verified. No physical transmission was performed.**

Locations: [store.py:376](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/store.py:376),
`reserve_shared_serial`, and [host.py:2121](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/host.py:2121),
`coordinate`; compare local `reserve_serial` at 3643–3658 and import floor at
`adif_import.py:128`.

Import records `historicalSerialFloor`, and the local allocator takes its maximum
with existing reservations. The shared allocator considers only `xlog_serial`.
Historical contacts intentionally have no live draft reservations, so their sent
serials do not participate in that query.

Reproduction: WPX fixture imports historical sent serial 2. A new
`contest_multi_serial_reserve` returns authoritative serial 2 / sent exchange
`002`, already present in DXLOG. `multi_contact_apply` then rejects it with
`historical_serial_conflict`. That guard prevents a duplicate committed QSO;
it does not make a serial previously handed to an operator usable. Scope,
authority identity and result shape all validate. CR-004 separately limits replica
catch-up after import; this reproduction establishes the authority allocator and
commit disagreement, not that a peer transmitted the exchange.

Evidence: `reproductions/repro_import_shared_serial.py` and matching result JSON.
**Fix:** make shared and local allocation enforce the same reviewed historical
floor inside the existing write transaction and serial scope. Preserve original
reservations/receipts, including uncertain ones; do not silently renumber sent
exchanges. **Regression:** historical import followed by multiple local/shared
allocations, request replay, reopen, concurrent peers and applicable per-band
scopes; every new allocation exceeds the appropriate floor and commits correctly.

### CR-006 — WAE multiplier extraction mistakes a national-prefix digit for the call area

**Medium — incorrect authoritative scores reported as complete. Confidence:
high. Verification: real Host reproduction plus hash-verified retained official
rule evidence.**

Location: [wae.py:40](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/wae.py:40),
`multiplier`, lines 40–46.

The first digit anywhere in the callsign is used as the numerical area. For
Japanese 7K4/7M4 calls this is 7 from the prefix, whereas the pinned sponsor rule
groups them with JR4 in JA4. The `/digit` portable override does not fix ordinary
calls that carry no such suffix. Correct CTY identity is already available.

Reproduction: three 20m contacts JR4AAA, 7K4ABC, 7M4XYZ yield JA4, JA7, JA7,
3 points and weighted multiplier 4: total **12**, `scoringComplete:true`.
Expected from the reviewed rule is one area, weighted multiplier 2: total **6**.
The all-catalog lifecycle checker uses a simpler WAE seed and misses the case.

The retained official DARC page matches SHA-256
`9693e5e843a6bfb054deafe2004d55384c0224a764816c66248f5f13e54c668c`
in `docs/contesting/WAE_2026_RULE_REFERENCE.json` (edition 2025-06-17, 2026 events).
Live retrieval of the [current rules URL](https://www.darc.de/der-club/referate/conteste/wae-dx-contest/en/wae-rules/)
returned HTTP 403, so this is scoped to that pinned edition. The same numerical
example is independently corroborated by
[DARC's historical official rule PDF](https://www.darc.de/fileadmin/filemounts/referate/conteste/contest/waedc/results/heft_erg_2016.pdf).
The rule concerns numerical area, not geographic district.

Evidence: `reproductions/repro_wae_call_area.py`, result JSON and
`sources/wae-rule-evidence.json`. **Fix:** use a country-aware numerical-area policy
with explicit portable overrides and sponsor exceptions. Decide compatibility for
existing WAE sessions before rescoring. **Regression:** JR4/7K4/7M4 equivalence,
distinct areas, portable calls, missing evidence, corrections, reopen and Cabrillo
claimed-score output for CW/SSB/RTTY.

### CR-007 — ESM-logged contacts are classified as remote for recorder bookmarks

**Medium — ordinary Enter/ESM contacts miss automatic audio links. Confidence:
high. Verification: real Host reproduction and static Rust consumer trace. Audio
capture itself and native playback were not exercised.**

Locations: [recorder.py:28](/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/recorder.py:28),
`changes`; [contest_recorder.rs:88](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/src/contest_recorder.rs:88),
`admission`; [contest_recorder_store.rs:682](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/src/contest_recorder_store.rs:682),
`reconcile`.

The audit projection marks local commits only for an operation-method allowlist
that omits `esm` and `function_key`, even though these operations can commit
contacts. Rust admission also recognizes only `contest_qso_commit`.
Reconciliation creates a new QSO bookmark only for `kind=commit && local=true`,
then advances the durable cursor, so it does not later revisit the skipped event.

Reproduction: real SSB ESM commit produces a genuine `commit` audit event with
`local:false`; a direct `qso_commit` control produces `local:true`. Rust's timestamp
fallback is inside the local-commit branch and cannot rescue the ESM event.
Recorded audio segments remain; this finding is missing contact-to-audio
association, not loss of the QSO or proof of missing audio.

Evidence: `reproductions/repro_recorder_esm.py` and result JSON.
**Fix:** carry verified commit-origin provenance through all local commit paths,
including matching native admission markers, while keeping imports and replicated
contacts excluded. **Regression:** recorder-enabled ESM and LOGIT commits,
admission/catch-up/restart/replay, correction/delete and remote/import controls;
assert one link at the correct recording location with no duplicate or replayed
transmit intent.

### CR-008 — Editor remounts discard acknowledged manual-time display intent

**Medium — the UI misrepresents the retained timestamp and can submit a live
time after navigation. Confidence: high. Verification: actual React components
in jsdom with an explicit canonical `automaticStart:false` fixture.**

Locations: [OperatorDesk.tsx:43](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/OperatorDesk.tsx:43),
`DeskQSO`, and [QSOEditorCore.tsx:123](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/QSOEditorCore.tsx:123),
`QSOEditor`; reset effects at 46 / 159; snapshot type in
`operatorDraftSession.ts:18`; mode switch in `DetachedQSOSurface.tsx:173`.

Each editor initializes automatic time as `!isEditing`. A shared new-QSO draft
remains a new draft after a deliberate historical date edit, so changing Full to
Simple mounts a fresh component in automatic mode. The canonical Swift snapshot
already carries the correct provenance, but it is absent from the typed editor
contract and is not consumed. Valid acknowledged fields pass the existing
unfinished-input switch guard.

Reproduction with injected current UTC `2026-10-28T12:34:56Z`: enter and acknowledge
`2026-10-20T10:15:30Z`, assert canonical `automaticStart:false`, then switch modes.
The draft still holds October 20, but Simple displays October 28 / 12:34:56.
The expected preservation assertion fails. This assertion runs before Save and
is independent of CR-001. Both editor submit handlers can also supply the live
time; backend and frontend repairs therefore need joint acceptance.

Evidence: `reproductions/frontend/` and `results/root-ui-reproductions.txt`.
**Fix:** propagate and consume canonical automatic/manual provenance through
snapshot/session/editor props; retain valid local edits during transitions.
**Regression:** Full↔Simple, main Desk↔full editor, detached reopen and process
restart, asserting display and final stored time for manual and automatic drafts.

### CR-009 — Legacy SwiftUI import silently skips records and duplicates repeated imports

**Medium — misleading success and avoidable duplicate contacts in a retained
application product. Confidence: high. Verification: actual XLogCore/SQLite with
the caller's exact import loop; native chooser/banner were inspected statically.**

Location: [AppModel.swift:993](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogApp/AppModel.swift:993),
`importADIF`, especially 1000–1006. This is the SwiftUI `om0rx-xlog` product built
by default `swift build` and `scripts/package-app.sh`; the current Tauri importer
uses a different, validated path.

The loop converts each parser record with `if let`, silently skips failures,
saves every accepted record under a new UUID and announces `records.count` as
imported. It bypasses `ADIFImportPreview` and transactional semantic deduplication
in `LogbookDatabase.importBatch`. Earlier successful rows remain if a later save
fails, making a retry duplicate them.

Reproduction: one valid record and one malformed five-digit TIME_ON parse as two
records. The loop saves one, while the banner claims “Imported 2 ADIF records”.
Repeating the same import creates a second copy of the valid QSO. The existing
strict preview reports the invalid record. This does not establish affected
production logs or apply to the modern import screen. It is included because
the requested scope explicitly includes the entire repository's first-party app.

Evidence: `reproductions/repro_core_interpreted.swift` and `results/repro_core.json`.
**Fix:** route the retained SwiftUI product through the shared validated preview,
import transaction and duplicate policy, reporting actual committed/skipped/error
counts. Preserve the original input and diagnostics rather than claiming a
partial import succeeded completely. **Regression:** mixed valid/invalid records,
repeat import, mid-batch SQLite failure/rollback, malformed suffix and nil/closed
database; assert correct counts, preserved original records and idempotent retry.

### CR-010 — Captured radio power is labeled as KPA500 amplifier output

**Low — incorrect source attribution; no numeric power corruption established.
Confidence: high. Verification: actual frontend formatter reproduction.**

Location: [QSOEditorCore.tsx:111](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/QSOEditorCore.tsx:111),
`draftPowerDescription`. The allowed sample sources include `radio_output` and
`kpa500_output` in `operatorDraftSession.ts:5`.

A matching contact with any selected sample receives a hard-coded KPA500 label.
For a `radio_output` sample, the actual function returns “Captured KPA500 output”.
Both enabled/disabled branches misattribute the source. The observed numeric value
is unchanged. CR-002 separately prevents the current routed agent capture hookup;
correct source presentation is needed when handling retained or newly connected
samples, particularly when that hookup is repaired.

Evidence: the second isolated regression in `results/root-ui-reproductions.txt`.
**Fix:** derive the label from the retained sample source, without guessing from
the current station configuration. **Regression:** both allowed sources in
enabled/disabled states and unknown-source behavior.

## Architecture and trust boundaries

The current desktop product is a bundled React interface with many independent
window entry points, a Rust/Tauri shell and a persistent Swift worker over bounded,
ID-correlated newline-delimited JSON. The shell enforces window-role and operating
module admission, owns retained control receipts and radio/rotor selection, and
supervises process generations/deadlines. Frontend types are not authorization.
Tauri CSP and capabilities restrict renderer access; sensitive actions still
require native caller checks. The separate retained SwiftUI product shares
XLogCore but has different orchestration and release metadata.

Swift owns normal logging, SQLite persistence, reference/enrichment services,
online-log delivery, backup planning/transport and provider adapters. A workspace
has its own database and identity-bound defaults/Keychain service. Contacts,
drafts, revisions, operation receipts, sync state, layouts and prospective upload
enrollment are durable. JSON/local-storage journals retain renderer input and
uncertain operations; they do not replace the database. Spot history is a
separate indexed SQLite archive. Backup packages seal payload content, stage
SQLite snapshots and retain rollback; the seal is integrity evidence, not
authentication or encryption. Cloud/FTP backup transports add separate destination,
credential and trust policies.

Active contests use the bundled isolated Python host and pinned Not1MM-derived
corpus. The catalog has 97 definitions: 94 pinned plugin definitions and three
first-party WAE definitions. Each session has SQLite contact/identity/audit/serial/
receipt state. Serialized revision-fenced mutations invoke reviewed plugin
callbacks and return output *intents*, not physical-output proof. Master/replica
coordination and durable audit cursors cross machine/store ownership boundaries.
Swift contest core/store also remain in the repository and require review even
where they are historical or inactive. Rust owns recorder audio files/bookmarks
and their audit consumption.

Station services include direct Remote Station Agent/xCat, FLEX, TCI and managed
Hamlib radio/rotor helpers, independent rotor and WinKeyer lifetimes, and optional
CAT listeners. CW decoding has a separately staged DeepCW/ONNX helper and bounded
IQ/output queues. WSJT-X uses bounded UDP ingress and explicit instance/destination
selection. fldigi has loopback UDP completion intake and opt-in XML-RPC output.
Loopback reachability alone is not sender identity or transmit ownership.

External network/data boundaries include Wavelog synchronization, QRZ/HamQTH
lookup, QRZ/Club Log delivery, LoTW, CTY/reference directories, cluster/RBN,
Open-Meteo and propagation/map sources. Credentials use platform vaults; cache
identities, receipts and logs should contain metadata rather than secrets.

## End-to-end workflows examined

| Journey | Examined path and result |
| --- | --- |
| Normal QSO entry | React buffers/journal → shared draft revision → Swift mutation validation → contact/draft/receipt transaction → reopen/replay. CR-001 and CR-008 break manual-time fidelity. |
| ADIF import/export | Modern bounded preview/duplicate plan/generation/SQLite import; retained SwiftUI parser loop; Python historical mappings/rebuild/serial floor/audit. CR-004/005/009 expose different integration omissions. Complete ADX/export codecs remain partial. |
| Synchronization | Wavelog JSON+ADIF snapshot joins, stable metadata/ID checks, held ambiguity groups, merge/deletion steps, pending writes, post-write verification and submitted-snapshot acknowledgements. No live provider operation; deeper join/restore/failure matrix remains incomplete. |
| Backup/restore | Sealed package capture, staged SQLite verification, pre-restore recovery copy, edit-generation retirement, incomplete-restore marker, component replacement/rollback and disabled prospective delivery. Actual restore checked by existing disposable tests; no personal backup was opened. |
| Contest logging | Plugin-derived draft/ESM → transactional audit/receipt → score/export and recorder audit consumer. All catalog lifecycle fixtures exercised; CR-006/007 survive those checks. |
| Multi-operator | Authority request/replay/serial allocation → change page → independent replica validation/apply; CR-004/005 reproduced. No connected physical topology acceptance. |
| Radio/CW/rotor lifecycle | Native owner/admission → worker generation → selected provider → owned release/EOF. CR-002/003 identify lifetime/authority disagreements. Physical I/O not exercised. |
| Multiwindow recovery | Canonical snapshots, local journals, pending receipts, input/close barriers and editor mode remount. React component checks executed; no native AX/installed-window check. |

## Checks and actual results

Commands ran from the repository root unless a working directory is shown. Full
captured output is retained under the evidence directory's `checks/`; normal
ignored build output was produced, but nothing was packaged or installed.

| Command | Actual result / boundary |
| --- | --- |
| `git fetch origin main`; `git merge --ff-only origin/main` | Already current; clean baseline `4bd554a`. |
| `swift test --no-parallel` | PASS. XCTest 227; Swift Testing runs 332 and 8. Targets overlap the portable run; do not add counts as unique coverage. |
| `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel` | PASS. See complete target-level XCTest and Swift Testing summaries in `checks/swift-portable.txt`; Swift Testing runs 524 and 8. Opt-in hardware/vault tests are not enabled by implication. |
| `PYTHONPATH=python python3.12 -B -m unittest discover -s python/tests -v` | PASS, 537 tests, 239.907 seconds. |
| `python3.12 -B tools/check_all_contests_readiness.py --output /tmp/xlog-review-20261028-4bd554a/contest/all-contests-readiness.json` | PASS for all 97 definitions: 1,353 PASS / 5 NOT APPLICABLE. `--family-tests` omitted; Python suite already ran separately. Fixture lifecycle consistency is not all sponsor-rule/category acceptance. |
| `cargo test --locked --manifest-path prototype/src-tauri/Cargo.toml` | PASS, 913 unit + 26 integration-crate tests. Opt-in Hamlib daemon exercise returns early without `XLOG_TEST_*` paths; these counts do not prove daemon/device operation. |
| `npm test` in `prototype` | **FAIL initial full run:** 4,705 passed / 2 failed, 336 of 337 files passed. Both failures were 5-second timeouts in contest voice-intent cases. |
| Targeted rerun of those two tests; then `Not1MMContestWorkspace.test.tsx` | PASS 2/2 and 195/195 respectively. Initial full-suite failure remains recorded; no later all-green full-suite claim. |
| `npm run build` in `prototype` | PASS: TypeScript no-emit check, Vite build and window-bundle checker. No separate lint script is declared. |
| `npm audit --json` in `prototype` | PASS, zero advisories reported for the resolved lock at query time. This is not a source audit of transitive dependencies. |
| `cargo audit --version` | Unavailable, exit 101 (`no such command: audit`). No tool/dependency installed; Rust advisory assessment remains open. |
| `bash -n` on Mac package/install/build/notarize scripts; `zsh -n` on retained package/notarize scripts | PASS syntax checks only; release scripts not executed. |
| `git diff --check` | PASS at review stage; repeated for final reports. |
| Isolated reproductions | See findings and evidence README. Python probes assert the observed defects and exit 0; UI probes assert intended behavior and fail, as expected. SQLite probes confirm wrong stored values rather than merely inspecting strings. |

The two frontend timeouts are both at `Not1MMContestWorkspace.test.tsx:2377`, for
CQ WPX SSB and ARRL Sweepstakes Phone simulated voice-keyer intent. Focused/file
reruns passing supports a timing-sensitive check issue; it does not prove an
application defect or establish the environmental cause. Preserve both outcomes.

Toolchain observations: Swift 6.4 / arm64 macOS, Node 24.11.1, Python 3.12.4,
Cargo 1.98.0. This was a local macOS source/build check, not the CI macOS-14 image
or a Windows/Linux run. Some lean-ctx background jobs/reads stalled; CLI fallbacks
and explicit working directories were used. Custom harness executable invocation
was blocked by tooling; permitted Swift interpreter fixtures supplied the same
core/actor checks without changing tool policy. Initial missing-module/Vite
fixture-resolution errors were harness setup failures, corrected before counting
the final probes; they are not application test failures.

## False-positive audit and verification limits

- A preliminary mocked detached-Save test showed stale automatic time. It was
  withdrawn: the fake backend omitted native automatic-time stamping. CR-001 was
  subsequently reproduced against real SQLite, and CR-008 asserts pre-save UI
  behavior with explicit canonical provenance. The old mock failures are not
  promoted as an additional defect.
- A suspected request/newline bound disagreement was rejected after checking the
  Swift line reader's byte accounting.
- An ordinary-reopen fldigi completion-generation hypothesis was rejected: the
  Host generation is persistent/deterministic, not a per-process UUID.
- A possible fldigi TX-before-context-recheck race remains a verification question;
  outer admission and switch timing were not sufficiently established for a finding.
- Wavelog create/TIME_OFF concerns were not promoted as local data loss:
  `mergeRemoteFields` deliberately preserves local end time, and create has a
  documented narrower supported-field contract. Full provider fidelity remains
  a separate acceptance gap.
- Swift store transaction/revision/serial/replay and snapshot paths examined in
  the continued contest review had effective rollback and identity fences; no
  additional defect was asserted. Inactive >100 GHz VHF definition/store-limit
  differences remain a compatibility question, not an active-product bug.
- Earlier R01–R08 review repairs were checked as historical context; these are not
  re-reported as still-open defects.

No claim is made that all security weaknesses have been found. Most files were
only scanned or remain unreviewed. Whole-file pattern matches identify areas to
inspect, not verified vulnerabilities. No source analysis establishes installation,
provider-account behavior, production data integrity, microphone/audio correctness,
RF, physical-radio safety, power-loss durability, OS-shutdown behavior or sponsor
submission acceptance.

Additional dependencies needed for complete qualification include the pinned
`oliverbross/contest-sw` source corpus at
`7c8b499225a73f7f8f792246881bd7aefc05452f`, external xCat/Remote Station Agent
implementations/configuration and real FLEX/TCI/Hamlib/WinKeyer environments.
Those additional repositories were not cloned or modified. Hamlib/libusb recipes
pin archives; packaged CPython/DeepCW/ONNX/model provenance has only partial
independent review. Real Wavelog/QRZ/Club Log/LoTW/cloud-backup accounts and private
station data were not accessed. The official current WAE page was inaccessible
live (403); the finding is grounded in the hash-matched retained edition.

## Prioritized remediation and remaining review

1. Repair CR-001 and CR-008 together, preserving manual time through editor
   navigation, real Save, export, receipts and reopen. Do not bulk-normalize
   historical rows: this review does not identify which past contacts were affected.
2. Repair CR-002 against a registry-backed lifecycle fixture before any new
   connected-radio acceptance. Repair CR-003's release ownership independently;
   retain emergency Stop and uncertain-release behavior.
3. Reconcile historical-import contracts with multi-operator audit/identity and
   serial allocation (CR-004/005). Preserve existing sent exchanges, reservations,
   receipts and rollback; qualify paired-host replay/catch-up before deployment.
4. Repair WAE numerical areas with a deliberate existing-session compatibility
   decision (CR-006), and recorder commit provenance across Python/Rust (CR-007).
5. Bring the retained SwiftUI importer onto shared validation (CR-009), or make
   an explicit product-support decision; do not silently exclude its current
   default-build product from maintenance. Correct CR-010's source label.
6. Complete the semantic-review backlog listed per file and by subsystem in
   REVIEW_COVERAGE.md. Resolve test timing and Rust/native dependency-advisory
   gaps. Native UI/provider/hardware qualification follows only under AGENTS.md's
   isolated-launch/process-verification rules and the appropriate operator scope.

Optional maintainability work: large dispatch/controllers make cross-layer
contracts easy to miss, but complexity is not itself a defect. Once the behavioral
fixes have regression oracles, consolidate registry lifecycle APIs, time-provenance
types, serial allocation and audit-event vocabulary at their existing owners.
Update stale overlapping README/status release descriptions so current product
and historical acceptance can be identified reliably. These improvements are
separate from the ten defects above.
