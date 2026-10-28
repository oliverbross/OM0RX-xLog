# Application code review — second verification, 29 October 2026

**Verification baseline:** clean canonical `main` at
`12824393f2799f21c223fadcb19d03305a5bf2f8`, fetched and fast-forward checked.
Application source is unchanged from the first-pass baseline
`4bd554a25951ddc995b4bef1715d3df12918a07b`; intervening work added review documents
only. Version declarations remain 1.3.60. Installed application identity was not inspected.

**Disposition: INCOMPLETE full-codebase manual review; second verification stage delivered.**
The ten original findings are retained, with corrected scope and stronger evidence.
Two additional export defects were found while continuing partial coverage:
**12 findings — 2 High, 9 Medium, 1 Low**. No severity change was warranted after
checking the reachable impact and working safeguards. No application code, existing
tests, dependencies or configuration was changed.

The second pass challenged callers, admission/ownership, rollback/replay, test
oracles and relevant React/Swift/SQLite/XML behavior. Root independently reran the
service timestamp, configured Host, real-module registry/fldigi, actual-source Rust
recorder, React and schema counterexamples. Loopback-TCI evidence was cross-checked against
the unchanged implementation and its bounded reviewer artifacts. This is source
and isolated-fixture evidence, without installed UI, provider-account or RF acceptance.

The cumulative exact coverage and remaining work are in
[REVIEW_COVERAGE.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REVIEW_COVERAGE.md). First-pass reports are recoverable at
`12824393`; [first-pass evidence](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-2026-10-28)
is unchanged. New scripts, results, logs, reviewer matrices and the cumulative
ledger are in [second-pass evidence](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/README.md). Older findings below
retain first-pass reproduction details and add explicitly dated verification.

## Second-pass disposition

| Finding | Result / severity | Caller, safeguard and test challenge |
| --- | --- | --- |
| CR-001 | Confirmed High | Actual `LiveLogbookMethods.handle` admits the manual draft; real SQLite Save, receipt replay and reopen preserve the wrong start. Existing 12-test draft suite passes because the manual case ends before Save. |
| CR-002 | Confirmed High; trigger narrowed | Actual compiled worker retires shared actors, leaving registry actors active; actual loopback TCI remains connected. Normal module switch has an output-idle veto, so active-PTT switch is excluded from the trigger. Ordinary Quit uses a different guard. |
| CR-003 | Confirmed Medium | Actual compiled actor sends `main.rx` in six never-configured/disabled/receive-only lifecycle cases; external-I/O-disabled controls send none. Process ownership does not establish external transmit ownership. |
| CR-004 | Confirmed Medium | Configured independent authority/client baseline works; exact imported change page fails after reopen. Authority/cursor guards and full compared-table rollback work but cannot translate the legitimate event. |
| CR-005 | Confirmed Medium | Configured master grants and durably replays imported serial 2; local control grants 3. Later `historical_serial_conflict` rejection prevents a duplicate database commit. No peer-transmit claim. |
| CR-006 | Confirmed Medium | Actual CW/SSB/RTTY scores and Cabrillo claims are 12 versus pinned-rule 6; portable /4 correction is a passing control. Pinned sponsor edition, not fresh sponsor certification. |
| CR-007 | Confirmed Medium | Real ESM-enabled, disabled-ESM Enter and LOGIT commits are misclassified; actual Rust store skips even a supplied marker and persists cursor 2. Contacts/audio remain retained. |
| CR-008 | Confirmed Medium | Valid canonical manual snapshots fail both Full→Simple and Full→Simple→Full display assertions in real React components; conditional component-type changes remount local state. Save is unnecessary to prove this finding. |
| CR-009 | Confirmed Medium | Exact production method body with chooser/model scaffolding repeats the real-core skip/duplicate defect; nil database also reports success. Modern importer has separate safeguards. |
| CR-010 | Confirmed Low | Source-labelled samples pass native-facing frontend validity checks; radio sample is mislabeled, amplifier control passes. No changed numeric power established. |
| CR-011 | New Medium | Unfiltered retained SwiftUI logbook 2,003 → loaded 2,000 → exported 2,000; toolbar/menu invoke the same unscoped method. Modern frozen-snapshot export is separate. |
| CR-012 | New Medium | Actual writer emits two names absent from the original official 3.1.7 record vocabulary. Original XSD compilation is blocked by an unrelated regex; bounded derived-schema control and exact-name comparison agree. |

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

**Second verification:** [actual service result](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/manual-service.json)
uses the real mutation handler, a private empty workspace, matching revision and
generation, and no service stubs. Acknowledged `automaticStart:false` is ignored
at Save; replay/reopen retains one wrong row. With explicit historical end retained,
the resulting duration is negative. The renderer also refreshes automatic times
before flushing `.replace`, which can clear canonical provenance; remediation must
define one frontend/native time-intent contract, rather than merely moving a boolean.
See [caller analysis](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/frontend/VERIFICATION_REVIEW.md).

### CR-002 — Worker lifecycle hooks target different radio instances from command routing

**High — the connected owners' existing release/retirement path is bypassed.
Confidence: high. Verification: actual compiled-module lifecycle and connected
loopback-resource probes plus cross-component source analysis; RF was not tested.**

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
quit normally or reach worker EOF without explicit disconnect. Worker EOF invokes
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

**Second verification / scope correction:**
[full ownership and fallback challenge](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/native/verification-matrix.md)
records actual compiled-module results and a real WebSocket connected only to a
disposable loopback server. `shutdownOutcome == 0` leaves that routed TCI resource
open; explicit routed disconnect closes it. OS process exit would close the socket;
no leak beyond process exit or transmitter state was demonstrated. Passive TCI
disconnect remains admitted even after terminal state and is not itself diagnostic.

Rust `main.rs:2734–2769` vetoes operating-module switch while PTT/Tune/CW and other
output duties remain; **active PTT during a normally admitted module switch is not
a supported trigger**. Ordinary Quit's editor-flush route at 2710–2715 has no matching
general output-idle veto. Owned CW/voice shutdown does not cover every GUI PTT/Tune
session. Provider observation watchdog/transport stop is distinct from the owner's
explicit release calls; no destructor/registry-wide release fallback was found.
High remains appropriate for bypassing the existing owned-output cleanup attempt;
the physical consequence remains unverified.

### CR-003 — Ordinary shutdown sends fldigi receive control without xLog transmit ownership

**Medium — can interrupt an independently operating fldigi instance. Confidence:
high. Verification: reproduced with the actual unmodified bridge actor, fake RPC
and receiver only, with no neighboring-interface stubs; no real provider or radio.**

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

**Second verification:** [eight-case real-module matrix](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/native/fldigi-module.log.txt)
eliminates the first-pass neighboring-stub limitation. Six lifecycle/configuration
combinations send exactly `main.rx`; both disabled-external-I/O controls send none.
Fake RPC and receiver isolate the actor, so interruption of a real external fldigi
session is the reachable risk supported by the command contract, not an observed RF event.

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

**Second verification:** [configured caller/authority trace](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/contest/VERIFICATION.md)
and [independent Host rerun](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/contest-independent-py312.log.txt)
first establish successful baseline sync with a valid grant. The exact ordinary
import change page then fails before/after both Hosts reopen. Rejected apply leaves
all ten compared core tables and operation receipts unchanged; wrong authority
also rejects. UI and native gates prohibit clients, but admit master import and
preserve the event payload. The missing identity image is independently confirmed.

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

**Second verification:** configured-master grant 2 survives exact receipt replay
and reopen; the next fresh grant is3. A local allocator control advances to3 after
the same import. Rejected remote commit rolls back all compared tables. The finding
is the unusable authoritative grant and replay contract; CR-004 prevents assuming
ordinary peer catch-up/transmission succeeds. See
[configured Host results](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/contest/verification-results.json).

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

**Second verification:** all three WAE modes produce `scoringComplete:true`,
score 12 and Cabrillo `CLAIMED-SCORE: 12`; explicit /4 corrections produce 6. Ordinary
call correction, exact replay and reopen retain the corresponding outcome. Bundled
CTY recognizes all three calls as Japan. The retained sponsor bytes again match
the tracked reference hash; current sponsor currency was not re-certified.
See [mode/export/control results](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/contest/verification-results.json).

### CR-007 — ESM-logged contacts are classified as remote for recorder bookmarks

**Medium — ordinary Enter/ESM contacts miss automatic audio links. Confidence:
high. Verification: real Host commits and actual unchanged Rust store with
synthetic PCM. Physical audio capture and native playback were not exercised.**

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

**Second verification:** real configured Host paths cover enabled ESM, disabled
ESM Enter and F12 LOGIT, with exact replay/reopen. The
[actual-source Rust probe](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/native/verify_recorder_store.rs)
supplies synthetic PCM and a valid marker even for `local:false`; no link is made,
while a direct `local:true` control links. Cursor2 survives reopen/replay and later
reclassification of the consumed sequence cannot repair the omission. This excludes
missing marker or fallback alone as the explanation. Root independently reran
the offline Cargo harness and asserted the printed state with `root/assert_results.py`. See
[consumer result](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/native/recorder-store.log.txt).

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

**Second verification:** [independent React run](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/frontend-independent.log.txt)
confirms both directions with a snapshot accepted by `validScopedSnapshot`, correct
manual start and canonical flag. React remounts the different component types;
initial state/effects use `!isEditing`, and props omit the canonical flag. Existing
historical-contact edit tests exercise `isEditing:true`, a different path. The
main-submit automatic refresh/native-replace interaction is a remediation dependency
shared with CR-001, not an additional promoted timestamp defect.

### CR-009 — Legacy SwiftUI import silently skips records and duplicates repeated imports

**Medium — misleading success and avoidable duplicate contacts in a retained
application product. Confidence: high. Verification: actual XLogcore/SQLite with
the exact production method body with chooser/model scaffolding; native GUI
was not launched.**

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

**Second verification:** [exact-method results](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/legacy-methods.json)
executes the unchanged extracted `importADIF` body, including success-banner logic,
against real core/SQLite. Only native chooser and surrounding model scaffolding are
substituted; [source/extract hashes](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/legacy-method-source.json) preserve
the boundary. Mixed input stores 1/announces 2; repeating stores 2; nil database still
announces 2 because optional chaining performs no write and throws no error. No
whole-batch transaction, duplicate policy or outer caller guard repairs this route.

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

**Second verification:** source and context labels are aligned so both radio
and amplifier samples pass `validDraftPower` and `validScopedSnapshot`. The amplifier
label is a passing control; radio still receives KPA500. This remains Low because
the defect is source attribution, with no numeric or transmit behavior established.
See [independent formatter/component run](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/frontend-independent.log.txt).

### CR-011 — Retained SwiftUI ADIF export silently stops at the 2,000-row view cap

**Medium — incomplete interchange file from an unfiltered logbook export.
Confidence: high. Verification: exact production export method, real SQLite/core,
native chooser and surrounding model scaffolding substituted.**

Locations: [AppModel.swift:1015](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogApp/AppModel.swift:1015),
`exportADIF`, and `reload/searchChanged` at 406/419.
The array being exported is loaded with `database.fetch(limit: 2_000, search: search)`.
The exporter serializes only `qsos`; it never requests remaining contacts. Both
the toolbar at `WorkspaceViews.swift:31` and application menu at
`OM0RXXLogApp.swift:55` call this method with an unscoped “Export ADIF…” label.
No cap warning, explicit current-page scope or follow-up page load was found.

Reproduction: a disposable database contains 2,003 contacts and an empty search.
The actual reload query loads 2,000; the extracted unchanged export method writes
2,000 records and reports “Exported 2000 QSOs”, omitting 3. This survives a possible
filtered-export interpretation because the reproduction is unfiltered. The count
banner reports what was written but does not disclose incomplete database coverage.
Source contacts remain intact; this is incomplete export, not database deletion.
The modern React/Tauri exporter uses a separate frozen-snapshot/page contract and
is not implicated. [Results](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/legacy-methods.json) and
[exact-source fixture generator](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/prepare_legacy_method_probe.py).

**Fix:** choose and disclose the intended export scope, freeze the matching database
set and serialize all bounded pages independently of the view's display limit.
**Regression:** unfiltered and explicitly filtered logs above 2,000 contacts,
including exact boundary, export count/identity equality and safe cancellation.

### CR-012 — ADX export emits deprecated field names outside its declared schema

**Medium — schema-enforcing consumers can reject an ordinary export containing
retained older fields. Confidence: high for vocabulary mismatch; exact validator
limitations are explicit below.**

Locations: [adifTransfer.ts:93](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/adifTransfer.ts:93),
`:106`, `ADIFExportDocument.append:354` and `finish:393`.
The `standardADXFields` set includes `GUEST_OP` and `VE_PROV` and writes them as
literal RECORD child elements while declaring ADIF 3.1.7. Neither name appears in
the 179 allowed RECORD element names of the [official 3.1.7 XSD](https://adif.org/317/adx317.xsd);
the application set contains 181, with exactly these two extras. Imported extra
fields survive `QSO.adifRecord` (`QSOADIF.swift:145–147`), so the export route is reachable.
The default USERDEF preservation path and metadata guards do not run for these
names because they are incorrectly classified as standard.

Actual writer fixtures produce NAME (control), GUEST_OP and VE_PROV documents.
All roundtrip through the app's decoder, explaining why mirrored acceptance tests
miss the mismatch. Root independently retrieved identical official bytes:
SHA-256 `ce7a86832f7be4a232d2c1ae7432925feb2be8506cba24345b7e3ad994a87331`.
Exact original-XSD validation with xmllint is **blocked at schema compilation** by
an unrelated New Zealand regex lookahead, including for NAME. A derived schema
removing exactly that unused pattern facet, without changing any field declaration,
validates NAME and rejects both legacy elements. None of these fixtures uses the
relaxed subdivision field. This is bounded structural validation, not an unqualified
original-XSD validation pass; direct name comparison uses the original schema.
See [vocabulary comparison](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/frontend/schema-check.json),
[original validator failure](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/frontend/schema-validation-results.json) and
[independent bounded validation](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/root/schema-independent.log.txt).

Original contacts are retained. ADI is a fallback for applicable records; no external
consumer rejection was exercised. **Fix:** use the declared ADX version's exact
vocabulary and a deliberate lossless conversion/extension policy for deprecated
fields; do not silently discard them. **Regression:** independent official-schema
vocabulary oracle, both legacy fields, valid standard/USERDEF controls and explicit
version/conversion behavior, rather than writer/reader roundtrip alone.

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
| ADIF import/export | Modern bounded preview/duplicate plan/generation/SQLite import; retained SwiftUI parser loop; Python historical mappings/rebuild/serial floor/audit. CR-004/005/009 expose different integration omissions. The completed codec pass adds CR-012; retained SwiftUI export adds CR-011. |
| Synchronization | Wavelog JSON+ADIF snapshot joins, stable metadata/ID checks, held ambiguity groups, merge/deletion steps, pending writes, post-write verification and submitted-snapshot acknowledgements. No live provider operation; deeper join/restore/failure matrix remains incomplete. |
| Backup/restore | Sealed package capture, staged SQLite verification, pre-restore recovery copy, edit-generation retirement, incomplete-restore marker, component replacement/rollback and disabled prospective delivery. Actual restore checked by existing disposable tests; no personal backup was opened. |
| Contest logging | Plugin-derived draft/ESM → transactional audit/receipt → score/export and recorder audit consumer. All catalog lifecycle fixtures exercised; CR-006/007 survive those checks. |
| Multi-operator | Authority request/replay/serial allocation → change page → independent replica validation/apply; CR-004/005 reproduced. No connected physical topology acceptance. |
| Radio/CW/rotor lifecycle | Native owner/admission → worker generation → selected provider → owned release/EOF. CR-002/003 identify lifetime/authority disagreements. Physical I/O not exercised. |
| Multiwindow recovery | Canonical snapshots, local journals, pending receipts, input/close barriers and editor mode remount. React component checks executed; no native AX/installed-window check. |

## First-pass checks and actual results

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

## Second-pass checks and actual results

These checks ran against unchanged application source at `12824393`. Full suites,
build/audits and the 97-definition lifecycle sweep above are **first-pass** results;
they were not repeated or replaced by focused successes.

| Check / command | Actual result and limit |
| --- | --- |
| `git fetch origin main`; fast-forward-only merge; source diff `4bd554a`→`12824393` | Already current; clean start; application diff empty. |
| `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter OperatorDraftTests` | PASS 12. Existing suite misses manual Save. |
| Same command, `--filter "RemoteBackup(Owner\|Scheduler\|Authorization\|RetentionReview)"` | PASS 37 in 4 suites, 0.944s. Earlier narrower selector ran only 8 retention tests; not counted as additional unique tests. Fake sources/executors, no cloud operation. |
| Configured real-Host `verify_contracts.py` with Python 3.12 | PASS defect/control assertions, independently rerun; authority baseline, full compared-table rollback, receipt/reopen and mode/export checks. System Python 3.9 initially failed importing UTC before the probe; corrected interpreter, preserved setup failure. |
| Focused existing Python tests listed in [command record](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/contest/commands-and-results.md) | PASS 41, 19.224s; whole 537-test suite not repeated. |
| Five existing frontend codec/logbook/draft/contact/mutation files | PASS 1408; all five files listed in frontend verification record. |
| Strengthened isolated React/writer/submit checks, independent `-t VERIFY` rerun | 3 expected regression failures (CR-008 twice, CR-010 radio), 6 passes (amp control, 3 writer fixtures, 2 modeled submit probes), 45 skipped. Failures assert intended behavior; passes generating invalid XML are not product-correctness claims. |
| Actual compiled Swift registry/fldigi probes | PASS counterexample assertions, root independently rerun. Production objects linked into temporary module; no neighboring actor stubs. |
| Routed TCI loopback resource; actual-source offline Rust recorder | PASS bounded counterexample assertions. Handshake/close only; synthetic PCM, no physical device/playback. |
| Exact service Save/reopen and extracted legacy methods | PASS counterexample assertions; actual service has no stubs, legacy methods have declared chooser/model scaffolding. |
| Official ADX schema retrieval, original/derived structural checks | Identical schema hashes. Original xmllint compile blocked; original-name comparison plus bounded one-facet-derived validation confirms two unsupported tags. |

All sources/results and exact build/interpreter commands are in
[the second-pass evidence index](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/full-code-review-verification-2026-10-29/README.md). First-pass timing failures,
missing cargo-audit, provider limits and setup diagnostics remain visible.

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
- The broad active-output module-switch interpretation of CR-002 was corrected:
  the actual idle veto prevents that trigger. The wrong lifecycle owner remains
  reachable through ordinary Quit/EOF and is independently reproduced.
- A new suspected duplicate-update extension-sidecar loss was rejected for the
  exposed route: renderer/native editable-field whitelists exclude arbitrary
  APP/USERDEF names, and the planner retains/validates target metadata. A direct
  helper accepting arbitrary names is insufficient to establish caller reachability.
- The main-submit automatic timestamp/provenance mismatch is recorded as a joint
  CR-001/008 remediation dependency, not counted as a third timestamp finding.
- Backup sidecar-removal concerns were not promoted: reviewed restore callers
  close the database first; staged verification/rollback remains present. Complete
  crash/transport/provider combinations remain open.
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
   default-build product from maintenance. Correct CR-010's source label. Repair the retained exporter cap (CR-011) and
    ADX vocabulary/conversion policy (CR-012) with independent export oracles.
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
separate from the twelve defects above.
