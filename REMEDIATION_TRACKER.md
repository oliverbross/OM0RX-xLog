# Defect remediation tracker

**Current Phase 5 follow-up — 29 October 2026:** All nine confirmed findings (two High, five Medium, two Low) are **Fixed and Verified within the recorded source/fixture scope**. Final application source is `f3f6e3dee40af29cb6801ef8ee422c521629e168`; ten logical repair commits are pushed. All 24 final local gates and all three exact-source CI workflows pass. Explicitly skipped runtime/package jobs, conditional Linux dependency risk and manual/hardware/provider limits remain open. See the follow-up section and [STABILITY_REPORT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/STABILITY_REPORT.md). Historical results retain their original source and limits.

**Historical Phase 4 disposition — 29 October 2026:** Eleven original findings retain Fixed and Verified status within their source/fixture limits. **CR-008 is reopened as Fixed but Unverified for clean build/integration acceptance**, linked to REG-P4-001; the original timestamp behavior still passes. Independent testing found one Medium build regression, two Low pre-existing compiler/harness defects, an unresolved NAQP browser failure and an overload observation. No application fixes were made in Phase 4. See [REGRESSION_TEST_REPORT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REGRESSION_TEST_REPORT.md) and the dated section below. Release acceptance is not met.

Started 29 October 2026 on clean canonical `main` at `530de4c4e4b23281ec60585cc7a2e5ca011476fb`, fetched and fast-forward checked. Scope: the twelve confirmed findings in CODE_REVIEW.md. The wider manual audit remains incomplete as recorded in REVIEW_COVERAGE.md.

Work proceeds by severity and shared dependencies: CR-001/008, CR-002, CR-003, contest replication/serial/scoring/recorder, retained imports/exports, ADX and power attribution. Each logical completed change is tested, committed and pushed immediately. No production data, installed application, live provider account or physical station is used. Source/build verification does not establish native UI, RF, external watchdog or sponsor submission acceptance. Review evidence directories remain immutable.

At the close of Phase 3, all twelve confirmed findings (2 High, 9 Medium, 1 Low) were recorded as **Fixed and Verified** within the source/fixture boundaries below. Phase 4 later reopened CR-008's build verification; the current Phase 5 disposition above closes that reopening. This does not claim an exhaustive defect-free application or retrospective repair of historical data.

## CR-001 — High

- **Status:** Fixed and Verified.
- **Root cause:** Save resets next-draft automatic provenance before resolving the current contact.
- **Files modified:** `Sources/XLogCore/LogbookDatabase.swift`; `Tests/XLogPrototypeTests/OperatorDraftTests.swift`; frontend files in CR-008.
- **Fix:** Resolve current Save from current.automaticStart, independently of the next blank's automatic provenance. Canonical forms submit unchanged start for automatic drafts so the pre-save replacement cannot accidentally clear the native flag. Transactions, revision fences, power and replay behavior retained.
- **Regression tests:** Extended automatic/manual persistence test through manual Save with explicit end, ADIF date/time, exact replay, fresh connection/readback, durable receipt and next automatic blank; existing automatic Save is the control.
- **Verification commands/results:** Before fix: extended Swift test failed four assertions and both React remount cases failed. After fix: `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'OperatorDraft|DraftPower|SpotDraft'` PASS 93 tests/10 suites; focused six-file Vitest run PASS 154; final validator/session rerun PASS 41 (overlap); `npm run build` PASS tsc/Vite/unchanged window-bundle budgets. Initial build exceeded Logbook budget by 26, then 4 bytes; equivalent compact validation restored the gate without raising it.
- **Remaining limitations:** Source/fixture verification only. No native/installed UI, provider, station or production-data operation. No retrospective rewrite of old contacts. Legacy renderer journals without provenance remain readable; production editors conservatively show their retained timestamp until a fresh native snapshot arrives.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/time-provenance).

## CR-002 — High

- **Status:** Fixed and Verified.
- **Root cause:** Worker startup/capture/shutdown targets shared actors instead of routed registry owners.
- **Files modified:** `Sources/XLogPrototypeSupport/LiveStationMethods.swift`, `LiveWorker.swift`, `LiveStationSession.swift`, `NativeDraftPowerGate.swift`; `Tests/XLogPrototypeTests/StationRadioRegistryTests.swift`, `LiveTCISessionTests.swift`.
- **Fix:** One registry now owns routing, power registration and concurrent terminal retirement for both slots and all three providers. Worker-scoped registry injection has no ownership of process-wide bridges/rotor. Production defaults to the actual routed registry; ordinary disposable workers cannot retire it. Power attachments/readiness are cached by radio and selected through the existing native radio_id, preventing another slot's connect/disconnect from replacing the active sample context. Existing output ownership/release/selection fences and module-idle veto are retained.
- **Regression tests:** Four new tests: both agents receive the exact worker capture gate and every slot/provider rejects connect/control after worker shutdown (including idempotent repeat); connected fake TCI closes with no controls; fake FLEX owned Tune is released while passive slot only stops transport; selected radio power context survives the other slot's attach/detach and rejects late detached-source callbacks. Reused existing fake transports; no physical/LAN/credential operations.
- **Verification commands/results:** `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'StationRadioRegistry|Native.*Power|WorkerTerminal|LiveFlexSession|LiveTCISession|LiveStationMethods'` PASS XCTest84 plus SwiftTesting16/3 suites. Swift compile/link includes the worker. `git diff --check` PASS. Initial compiler shadowing error and new fixture's disallowed documentation-network address were corrected; actual private-LAN validation was preserved, with the accepted address reaching only an injected fake.
- **Remaining limitations:** No real transmitter, provider watchdog, packaged EOF, OS shutdown or installed UI proof. Actual direct-agent release transport was not operated; its existing owned-release path is now reached through the correct actor and ownership tests remain green. Worker still awaits other service retirements in its existing order; stalled-provider/forced-termination acceptance is separate. Last accepted native selection governs the single normal-QSO power scope; radio sources cannot mix.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/station-owners).

## CR-003 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** Automatic fldigi lifecycle cleanup sends RX without a retained xLog transmit duty.
- **Files modified:** `Sources/XLogPrototypeSupport/LiveFldigiBridge.swift`; `Tests/XLogPrototypeTests/LiveFldigiBridgeTests.swift`.
- **Fix:** Record a process/session-scoped release duty before admitted TX can reach RPC; configuration alone grants no duty. Ordinary shutdown/workspace/disable cleanup sends RX only for that duty. Explicit Stop retains unconditional emergency RX. Retain pending/uncertain release until a matching RX acknowledgment after the send retires; block new output while sending/releasing/uncertain. Validate the complete action bundle before TX and recheck retirement after asynchronous text as well as TX, preventing later actions after Stop/context changes. Snapshot exposes release-required/uncertain state.
- **Regression tests:** Six new cases cover eight unowned lifecycle/config combinations, admitted TX followed by failed RX/retry, blocked output during uncertain release, pending TX shutdown and late final release, explicit Stop without prior ownership, pending text workspace retirement preventing the next TX, and invalid later action preventing partial output. Existing failed-TX, disable/Stop during TX, receive/recovery and disabled-external-I/O controls retained.
- **Verification commands/results:** New unowned matrix failed before the fix. `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'LiveFldigiBridge|StationRadioRegistry|WorkerTerminal'` PASS20 tests; after adding pending-text/bundle regressions, `--filter LiveFldigiBridgeTests` PASS15 (overlap). Swift worker compile/link and `git diff --check` pass. Fake RPC and receiver only.
- **Remaining limitations:** No external fldigi, actual engine restart, RX/RF readback, hardware or process-crash qualification. RPC acknowledgment is the bounded release evidence; duty is not persisted/replayed into a potentially unrelated future external engine. Explicit emergency Stop remains available. Forced process loss still requires the external engine/operator's independent safeguards.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/fldigi-ownership).

## CR-004 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** Historical-import audit lacks replication-compatible kind and identity images.
- **Files modified:** `python/contest_host/adif_import.py`, `host.py`; `python/tests/test_remediation_import_replica.py`.
- **Fix:** Persist the import's exact durable after-identity in its existing transaction. Project internal adif_import audit events as insertion-kind commit only in the authority change wire format, retaining distinct local import provenance/recorder exclusion. Old valid imports missing identity are projected from the first following mutation's before-identity, or the current identity only when there is no later mutation; missing evidence fails closed. No audit, import provenance, old operation receipt, cursor or contact is rewritten by compatibility projection.
- **Regression tests:** Four real configured paired-Host regressions: clean baseline then import/catch-up/exact replay/reopen/correction/delete; pre-fix unchanged import after reopen; pre-fix import followed by correction and deletion; missing identity rejection with full-table rollback and no invented provenance. Checks exact row/identity equivalence, outputActions empty and immutable authority audit. Existing client-write/authority, importer, recorder and coordination tests retained.
- **Verification commands/results:** Valid pre-fix fixture reproduced Replica change kind is invalid; initial temporary-root symlink setup was corrected by canonicalizing the disposable root. Focused Python command (`PYTHONPATH=python:python/tests XLOG_CONTEST_N1MM_UDP_ALLOWED=0 python3.12 -B -m unittest -v test_remediation_import_replica test_review_replica_authority test_wave5_adif_host test_review_adif_import test_recorder`) PASS24/11.098s; `test_multi_operator_host test_group_coordination` PASS16/4.662s. `git diff --check` PASS. A new test initially treated the legitimate read-operation receipt as an audit rewrite; its oracle now checks the audit rows themselves.
- **Remaining limitations:** No connected LAN/native UI or external outputs. Already cached pre-upgrade multi_changes receipts remain immutable; issue a fresh read request ID after upgrading. Irrecoverable legacy identity history still rejects explicitly rather than guessing; operator-reviewed recovery/rejoin is required. Original historical raw interchange/source metadata remains authority-local under the existing replica protocol; this fix guarantees the existing contact/identity stream, not a new full-backup replication format.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/import-replication).

## CR-005 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** Shared serial allocator omits the historical serial floor.
- **Files modified:** `python/contest_host/store.py`, `host.py`; `python/tests/test_remediation_import_replica.py`.
- **Fix:** Pass the validated session historical floor into the shared allocator and take the same maximum as local allocation inside the existing write transaction. Existing request IDs/reservations/receipts retain their exact issued numbers; only new grants advance past imported serials. Existing historical-conflict commit and scope/authority guards remain intact.
- **Regression tests:** Two new configured-master cases: import101 then grant102, replay/reopen the identical grant and successfully remote-commit it, next103; preserve a previously issued2 without renumbering; two independent Host connections concurrently allocate102/103. Existing per-scope/local/remote and replay-conflict tests retained.
- **Verification commands/results:** Before fix both new floor cases failed. `PYTHONPATH=python:python/tests XLOG_CONTEST_N1MM_UDP_ALLOWED=0 python3.12 -B -m unittest -v test_remediation_import_replica test_multi_operator_host test_review_adif_import` PASS30/12.657s. Initial concurrency fixture reused a thread-bound SQLite connection and was corrected to use an independent Host per thread, matching real authority connections; no database thread guard was weakened. `git diff --check` PASS.
- **Remaining limitations:** No physical exchange transmission or connected peer. Historical floor follows the same conservative global-floor policy as the existing local allocator, including band-scoped reservations. Previously issued conflicting receipts are immutable and still fail the existing commit guard; operator reconciliation/new request is required rather than silently changing an exchange that may already have been sent.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/shared-serial).

## CR-006 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** WAE extracts the first prefix digit instead of sponsor-defined Japanese numerical area.
- **Files modified:** `python/contest_host/wae.py`, `host.py`, `developer.py`; `python/tests/test_remediation_wae.py`, `test_wave5_developer_host.py`; `docs/contesting/WAE_NUMERICAL_AREA_REMEDIATION_2026-10-29.md`.
- **Fix:** Use the digit after Japanese national-prefix letters for digit-prefixed Japanese calls, retaining explicit portable-area precedence. New definition1.0.1 uses the corrected policy. Retained1.0.0 sessions keep their old numerical results on reads/reopen, visibly incomplete and barred from a new Cabrillo claim until the existing explicit Recalculate action transactionally adopts 1.0.1. ADIF remains available. New definition participates in authority identity so old-policy peers cannot silently share scoring authority; developer metadata follows the version constant.
- **Regression tests:** Independent JR4/7K4/7M4 arithmetic for actual CW/SSB/RTTY Hosts (3points×2multiplier=6), Cabrillo claim6, portable /9 correction12, restore/reopen6; prefix-family table controls; retained1.0.0 total12 marked incomplete with no implicit rewrite, ADIF available/Cabrillo blocked; explicit Recalculate/replay adopts6 while preserving contact identities and draft and changing authority digest. Unsupported arbitrary definition markers remain rejected.
- **Verification commands/results:** New arithmetic/migration tests fail before fix. `PYTHONPATH=python:python/tests XLOG_CONTEST_N1MM_UDP_ALLOWED=0 python3.12 -B -m unittest -v test_remediation_wae test_wave5_qtc_host test_multi_operator_host test_group_coordination test_wave5_developer_host` PASS26/8.168s. `git diff --check` PASS. First run exposed missing legacy Cabrillo gate; it was implemented rather than dropping the assertion.
- **Remaining limitations:** Pinned sponsor edition only; no new sponsor currency/submission acceptance. Existing operator data was not opened or migrated. Retained sessions require explicit review/adoption. Bound replicas need coordinated software/policy adoption and a fresh matching baseline session; no automatic destructive binding/history migration. Old cached receipts remain unchanged and are not fresh score projections.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/wae-numerical-area).

## CR-007 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** ESM/function-key local commits lose origin/admission metadata before recorder catch-up.
- **Files modified:** `python/contest_host/recorder.py`; `prototype/src-tauri/src/contest_recorder.rs`; `python/tests/test_recorder.py`, `test_remediation_import_replica.py`.
- **Fix:** Recognize genuine ESM and function-key commits as local in the authoritative audit projection. Native admission now records the same operation-time marker for direct commit, ESM and function-key routes, using the existing active-log/controlled-test/completion fences. Non-committing key events cannot create links because actual committed audits still drive reconciliation; imports, remote authority commits and replicas remain excluded.
- **Regression tests:** Three real Host ESM-enabled/disabled Enter/LOGIT regressions assert local commit provenance, exact operation replay without output, reopen and audit cursor continuity. Explicit import/replica/remote-exclusion assertions added. Rust test invokes the actual admission body with synthetic active archive and PCM, checks marker for all3 routes, actual-store bookmark/replay, and no marker for imported/remote/controlled-test paths. Existing recorder persistence/correction/deletion/audio-byte tests retained.
- **Verification commands/results:** New Python cases failed before fix. `PYTHONPATH=python:python/tests XLOG_CONTEST_N1MM_UDP_ALLOWED=0 python3.12 -B -m unittest -v test_recorder test_remediation_import_replica test_multi_operator_host` PASS26/6.562s. `cargo test --locked --manifest-path prototype/src-tauri/Cargo.toml contest_recorder -- --nocapture` PASS23/4.37s; native device helpers not started. `git diff --check` PASS.
- **Remaining limitations:** Synthetic PCM and fake capture state, no audio input/output device, native playback, hardware or installed UI acceptance. Existing previously skipped audit cursors/bookmarks are not silently rewound/backfilled: retained audio remains available for operator-reviewed recovery, and no retrospective association is invented. Replicated/remote contacts intentionally remain non-local.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/recorder-origin).

## CR-008 — Medium

- **Status:** Fixed and Verified — Phase 5 closes the Phase 4 clean build/integration reopening under REG-P4-001. CLOSE-FRONTEND-BUILD passes 405,194/405,200 bytes and CLOSE-FRONTEND passes 4,731/339 + 2 Node with the original timestamp/remount behavior intact. See the current Phase 5 section below.
- **Root cause:** Editor remounts derive time intent from new-versus-existing contact rather than canonical draft provenance.
- **Files modified:** `prototype/src/live/operatorDraftSession.ts`, `QSOEditorCore.tsx`, `OperatorDesk.tsx`, `DetachedQSOSurface.tsx`, `DetachedQSOSurface.test.tsx`, `OperatorDraftTime.test.tsx`; `prototype/src/LiveApp.tsx`.
- **Fix:** Carry optional canonical time provenance through validated snapshots and main/detached form props. Initialize/reset display mode from it; retain local unfinished time buffers. Native owns automatic Save time. Standalone forms without a native owner retain their prior callback-time contract.
- **Regression tests:** Full→Simple and Full→Simple→Full with acknowledged manual metadata and subsequent Save; automatic Save controls with no injected replacement; both actual form types submit retained canonical start; legacy/malformed provenance validation.
- **Verification commands/results:** Before fix: extended Swift test failed four assertions and both React remount cases failed. After fix: `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'OperatorDraft|DraftPower|SpotDraft'` PASS 93 tests/10 suites; focused six-file Vitest run PASS 154; final validator/session rerun PASS 41 (overlap); `npm run build` PASS tsc/Vite/unchanged window-bundle budgets. Initial build exceeded Logbook budget by 26, then 4 bytes; equivalent compact validation restored the gate without raising it.
- **Remaining limitations:** Source/fixture verification only. No native/installed UI, provider, station or production-data operation. No retrospective rewrite of old contacts. Legacy renderer journals without provenance remain readable; production editors conservatively show their retained timestamp until a fresh native snapshot arrives.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/time-provenance).
- **Phase 4 verification:** On clean source 26f795cb, both ordinary and ignore-scripts npm installs pass 4,721 Vitest + 2 Node tests, but the unchanged frontend build gate fails at 405,218 > 405,200 Logbook bytes. Current source with the original pnpm tree passes at 405,194. Identical clean-dependency Git-blob controls: pre-remediation 530de4c4=405,185/PASS; shared time-provenance commit 875b5254=405,224/FAIL; current=405,218/FAIL. Reopened build status is linked to **REG-P4-001 (Medium)**; timestamp validation and the budget were not changed. No fix was attempted during the independent testing phase. [Commands and evidence](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/COMMANDS.md).

## CR-009 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** Retained SwiftUI import bypasses shared preview, transactional deduplication and truthful result accounting.
- **Files modified:** `Sources/XLogCore/ADIF.swift`, `Sources/XLogApp/AppModel.swift`; `Tests/XLogPrototypeTests/LegacyADIFTransferTests.swift` (shared with CR-011).
- **Fix:** Retained SwiftUI import now rejects missing databases, reads bounded strict UTF-8, validates the complete document before writing, and uses the existing atomic/deduplicated importBatch transaction. Success reports actual imported and skipped duplicate counts. Invalid documents and later SQLite failures cannot leave a partial import; generic imports retain existing delivery exclusion and arbitrary ADIF fields.
- **Regression tests:** Four shared transfer regressions cover mixed valid/invalid records, malformed suffix, repeated imports and stable identity, preserved APP_TEST, closed database rejection, actual second-row SQLite trigger failure/rollback/retry, invalid UTF-8 and file bounds, and full frozen export beyond the display cap.
- **Verification commands/results:** `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'LegacyADIFTransfer|ADIFPlanning|ADIFImport|LogbookContact'` PASS16 tests/2 suites, 2.446s (four new transfer tests plus twelve contact lifecycle controls); `swift build --product om0rx-xlog` PASS52.22s, compiling the actual retained SwiftUI entry points. `git diff --check` PASS.
- **Remaining limitations:** No native file chooser or production workspace operated. Import intentionally rejects the entire invalid document instead of silently accepting a prefix; users must correct invalid records before retry. UTF-8 and 32 MiB limit match the modern transfer boundary. Retained SwiftUI path remains synchronous; large-file UI latency/memory and installed-app acceptance were not measured. Existing data is not rewritten.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/legacy-adif).

## CR-010 — Low

- **Status:** Fixed and Verified.
- **Root cause:** Captured-power description hardcodes an amplifier source label.
- **Files modified:** `prototype/src/live/QSOEditorCore.tsx`, `QSOEditorPower.test.tsx`.
- **Fix:** Build captured-output attribution from selectedSample.source: radio_output displays radio output; kpa500_output retains KPA500 output. Enabled/off suffixes, selected watts, manual/fallback handling and capture logic are unchanged.
- **Regression tests:** Four new on/off cases for both source types assert validDraftPower and validScopedSnapshot before rendering, correct source label and unchanged input/stored watts. Strengthened the existing captured KPA500 fixture with complete session/contact/context evidence. Existing manual, fallback, stale-contact, editing, detached and time-intent controls retained. Both radio-source cases failed before the fix; amplifier controls passed.
- **Verification commands/results:** `npx vitest run src/live/QSOEditorPower.test.tsx src/live/OperatorDraftTime.test.tsx src/live/DetachedQSOSurface.test.tsx` PASS64 tests/3 files,18.81s. `npm run build` PASS TypeScript, Vite and unchanged bundle budgets. `git diff --check` PASS.
- **Remaining limitations:** Synthetic valid snapshots and source build only; no meter, hardware, RF or installed UI qualification. The change corrects evidence attribution without claiming calibrated wattage or changing acquisition/persistence.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/power-attribution).

## CR-011 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** Retained SwiftUI export serializes only the display-capped array.
- **Files modified:** `Sources/XLogApp/AppModel.swift`; `Tests/XLogPrototypeTests/LegacyADIFTransferTests.swift` (shared with CR-009).
- **Fix:** Export uses the shared database adifExportSnapshot(.all) instead of the search/display-limited qsos collection. The chooser explicitly identifies all non-deleted logbook contacts as scope; count comes from the frozen snapshot and file replacement remains atomic. Missing database is an explicit error.
- **Regression tests:** Create2003 contacts, demonstrate the display fetch cap2000, compare every frozen export contact ID with the complete source set, add another contact after freezing and parse the original snapshot back to exactly2003 records with no late contact. Shared import and revision-fenced contact tests provide neighboring controls.
- **Verification commands/results:** Shared CR-009 command PASS16 tests/2 suites, including all four new transfer tests; actual `swift build --product om0rx-xlog` PASS52.22s. `git diff --check` PASS.
- **Remaining limitations:** No native chooser/installed app or production data used. All scope is explicit and preserves the existing exclusion of deleted contacts. Snapshot is one database read view; very large export UI latency/memory and filesystem power-loss durability are not qualified.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/legacy-adif).

## CR-012 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** ADX standard-field set contains two deprecated names absent from the declared official schema.
- **Files modified:** `prototype/src/live/adifTransfer.ts`, `adifTransfer.test.ts`, `adifTransfer.schema.test.ts`; pinned `prototype/tests/fixtures/adx317.xsd.gz` and provenance README.
- **Fix:** Remove deprecated GUEST_OP/VE_PROV from the 3.1.7 export element vocabulary so existing USERDEF declarations preserve both named values. Preserve backward-compatible import of the literal deprecated elements and their existing string validation. ADI remains unchanged; imported USERDEF metadata can be re-exported losslessly.
- **Regression tests:** New independent-schema regression pins the original official XSD hash, checks every emitted RECORD child against its vocabulary, verifies both USERDEF declarations/values, normal NAME control, metadata-bearing ADX re-export and unchanged ADI. It failed before the fix on GUEST_OP. Corrected an old assertion that required invalid literal export elements; its legacy-input checks remain, as do both string-family validation matrices.
- **Verification commands/results:** `npx vitest run src/live/adifTransfer.schema.test.ts src/live/adifTransfer.test.ts src/live/LogbookPanel.transfer.test.tsx` PASS1341 tests/3 files,13.47s. `npm run build` PASS TypeScript, Vite and unchanged window budgets. Initial export-only edit exposed five legacy-input test failures, corrected by retaining deprecated input support; a later old export assertion was corrected. Initial final build exceeded Logbook budget by2 bytes; equivalent anchored parser matching restored the existing budget without changing accepted names. `git diff --check` PASS.
- **Remaining limitations:** Pinned ADIF3.1.7.0 vocabulary verification, not sponsor submission acceptance or exhaustive XSD validation. Original official XSD has an unrelated NZ lookahead that libxml2 cannot compile; the fixture is unmodified and that pre-existing limitation remains documented. Already exported files are not rewritten.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/adx-schema).


## Historical Phase 3 completion and integration verification — 29 October 2026

All twelve confirmed, actionable findings are implemented and individually verified. Ten logical remediation commits, followed by the integration test readiness correction, were committed and pushed on canonical main. Application source is `11db003d35b9b16e7c4b80cfbe57cb556879951f`; the final test/source checkout is `d60895176bfb3b7fc0e27e94a39752860a73bf1d`. The subsequent closing commit adds documentation/evidence only. No candidate was packaged or installed, so the application version remains 1.3.60.

| Verification | Result |
| --- | --- |
| Full Python unittest discovery, contest UDP disabled | PASS 549 tests, 237.938s |
| All-catalogue readiness | PASS 97/97 plugins; 1,353 checks PASS, 5 NOT APPLICABLE |
| `swift test --no-parallel` | PASS 315 XCTest and 340 Swift Testing cases in the Phase 3 summary; see Phase 4 for explicit disabled-case accounting |
| Full portable Swift command from integration manifest | PASS 1,171 XCTest cases including 6 skips, plus 536 Swift Testing cases |
| Locked Rust test suite | PASS 914 unit and 26 integration tests |
| Final `npm test` | PASS 339 files/4,721 Vitest tests and 2 Node tests |
| Native product build | PASS `swift build --product om0rx-xlog`, 52.22s |
| Frontend static/build/budget checks | PASS `npm run build`; TypeScript, Vite and all unchanged window budgets |
| Evidence, reports and source provenance | PASS original review evidence unchanged, all stage hashes, twelve statuses, local report links and readiness source hashes |

Counts are executions in each suite, with overlap between normal and portable Swift. The six portable skips are three opt-in 68k benchmarks, browser/LiveWorker acceptance, live SCP download and Windows Credential Manager on macOS. They remain unverified. The initial full frontend run had 4,720 passes and one existing test readiness failure: the session title appeared before the callsign editor. Its unchanged file passed independently; commit `d6089517` awaits that same textbox before input, preserving all assertions. The focused file and entire final suite then passed. No test was disabled or budget raised. Full raw initial/final logs are retained.

Earlier integration runs identify earlier commits because Python, Rust and Swift checks began before the last renderer changes. The final audit verifies their component files and the readiness source hashes are identical to the final checkout. Current changed source/test/fixture hashes and all implementation commits are recorded in [integration evidence](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/integration).

### Remaining limitations and operator-facing compatibility

- No unresolved confirmed finding remains in this twelve-finding scope. The wider manual application audit remains incomplete as recorded in REVIEW_COVERAGE.md; passing suites do not upgrade its per-file semantic coverage.
- Existing WAE 1.0.0 sessions retain their old calculation until explicit Recalculate adopts 1.0.1; Cabrillo is blocked while adoption is required. Bound replicas need the documented matching-version rebaseline. No production migration/recalculation was performed. See `docs/contesting/WAE_NUMERICAL_AREA_REMEDIATION_2026-10-29.md`.
- Existing issued serial receipts, old cached change-page receipts, historical contacts and recorder cursors/bookmarks are preserved. Previously skipped recorder bookmarks are not automatically backfilled; conflicting old serial grants require reconciliation, and cached pre-upgrade change reads require a fresh request ID. Legacy imports without recoverable identity evidence still fail closed. Per-finding entries describe these boundaries.
- Retained SwiftUI import now rejects invalid documents atomically and enforces strict UTF-8/32 MiB; export explicitly includes the entire non-deleted logbook. Large-file UI latency/memory was not qualified. Existing exported files are not rewritten. ADX is verified against the pinned 3.1.7 vocabulary; the original XSD's unrelated regex compilation limitation remains.
- No production data/configuration, installed app, live provider account, real radio/audio device or RF operation was used. Forced process/OS termination, external watchdog/release behavior, station recovery and sponsor submission acceptance remain unverified. Source/build checks are not installed or hardware acceptance.

## Phase 4 independent regression — 29 October 2026

Testing baseline: clean canonical main at **26f795cb531c0b3c299e6a5dcc6d4a7f095b2058**, fetched and fast-forward checked. Application code, tests, expected results, configuration and lockfiles were unchanged. Original dependency/CW fixture directories and all 180 original dist files were restored by identity/hash. Current test evidence is separate from the immutable earlier review/remediation artifacts.

| New issue / observation | Severity / origin | Status and evidence |
| --- | --- | --- |
| REG-P4-001: clean npm Logbook bundle gate | Medium; introduced by shared Phase 3 frontend provenance changes with the committed npm dependency tree | **Not Fixed** in this testing-only phase; CR-008 build verification reopened as **Fixed but Unverified**. Root cause/evidence and reproducibility controls are above and in the report. Preserve provenance validation and existing budgets |
| REG-P4-002: actor-isolated default callback under complete concurrency checking | Low; pre-existing, affected source unchanged since pre-remediation | **Not Fixed**; full and focused strict Swift builds fail at LiveOpportunitiesMethods.swift:44. Standard builds/tests and selected TSAN pass. No runtime race established; resolve callback isolation/Sendability in another remediation cycle |
| REG-P4-003: process acceptance bootstrap omits Python/CA/Not1MM runtime | Low; pre-existing test-harness defect | **Not Fixed**; fresh release worker builds, standalone acceptance fails twice at contest_catalog. Does not establish a shipping bundle defect. Update the fixture to the current backend without bypassing runtime/isolation guards |
| INV-P4-001: NAQP first simulated CQ absent | Severity/origin unassigned; unresolved acceptance failure | **Not Fixed / investigate**; three traces, both clean npm and original pnpm, fail after unchanged 10-second wait with no simulated output. Arming/focus/edit-generation cause unestablished; no production-radio defect or remediation origin claimed |
| INV-P4-002: overloaded CW synthetic pacing | Resource-boundary observation; no established code regression | First profile stops at 5.504/60 s with stable=false under compiler load; identical idle-load repeat passes 60 s. Keep overload/soak acceptance open; exit 0 was not counted as semantic success |

Fresh Phase 4 suites pass within their recorded layers: frontend 4,721 + 2 Node; Python 549; runtime readiness 97 plugins / 1,353 PASS / 5 NOT APPLICABLE; pinned generator 42; Rust 914 + 26 default and 921 contesting-feature tests with overlap; native Swift 315 XCTest and Swift Testing summary 340; portable Swift 1,171 XCTest including 6 skips and Swift Testing summary 536. Native Swift Testing also disables 12 opt-in cases and portable disables 7; these are explicitly enumerated in the report, rather than subsumed by the older "no skips" wording. The native opt-ins and all portable opt-ins except account-bound remote history/Windows credentials were subsequently exercised. Browser NAQP/process bootstrap/strict compiler/clean frontend failures remain failures despite the broad suite passes.

Additional verification includes 82 selected TSAN cases, CW ASAN/UBSAN and 13 child-wire cases, NumPy oracle, bounded 60-second synthetic inference, 68k merge/Save and 100k log/spot/award fixtures, 15 read-only disposable database integrity checks, real loopback Hamlib model-1 and FTP/FTPS, and public SCP/propagation/DXpedition feeds. No production credentials, data, installed app, physical station or RF was used. No full packaged native/current-engine UI acceptance, multi-hour soak, force-quit/power-loss or Windows/Linux native acceptance is claimed. Dependency advisory matches are qualified by feature/caller triage; a version match is not treated as an established application exploit.

**Next cycle:** resolve the clean build and current-process fixture, repair strict callback isolation, diagnose NAQP output admission, review dependency patches, then repeat these gates and qualify an isolated native candidate with explicit provider/hardware limits. [Full report](/Users/oliver/Documents/Projects/OM0RX-xLog/REGRESSION_TEST_REPORT.md), [command ledger](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/COMMANDS.md), [confirmed issues](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/findings.json), [open investigations](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/open-investigations.json).

## Phase 5 iterative repair and validation — 29 October 2026

Source entry: clean `721e070561c1e2ce068e1dc118e5d0db47a374f0`; final repaired source/tools: `58da5d49359f7333852b04037a134ab04167be7b`. All thirteen logical repair and coverage commits were pushed immediately. The dated Phase 4 section above is preserved as history; this section supplies the current statuses. No production data/configuration, installed application, account credential or physical station was operated.

### REG-P4-001 / CR-008 — Medium — Fixed and Verified

- **Root cause:** clean committed npm resolution used Rolldown 1.2.13 and matching native bindings, emitting a 405,218-byte Logbook graph; the original pnpm tree used 1.2.15 and emitted 405,194. The renderer's correct provenance validation exposed an 18-byte gate failure. A rejected React/ReactDOM/Tauri version-alignment control still failed and was restored.
- **Files modified:** `prototype/package-lock.json`; `prototype/src/live/OperatorDraftTime.test.tsx`.
- **Fix:** update the integrity-checked transitive Rolldown/native-binding/type lock entries to the validated release. Keep package.json, app validation and the 405,200-byte gate unchanged.
- **Regression tests:** strengthen canonical automaticStart true/false/omitted and malformed/null/boxed-boolean cases; retain the unchanged graph/budget regression gate and all manual timestamp/remount tests.
- **Verification:** BASE-FRONTEND-BUILD exit 1 before; ITER1-BUNDLER-TESTS 122/5 files pass; FINAL-CLEAN-NPM-CI and FINAL-CLEAN-FRONTEND-BUILD pass at **405,194**. CLOSE-FRONTEND passes **4,731/339 + 2 Node** (487.181 s); CLOSE-FRONTEND-BUILD passes at 405,194 bytes. Full current-source Swift draft/persistence suites pass. CR-008's Phase 4 build-verification reopening is closed.
- **Limits:** six bytes of remaining Logbook headroom; dependency upgrades still require a clean build. No installed/native editor or retrospective rewrite of historical contacts.

### REG-P4-002 — Low — Fixed and Verified

- **Root cause:** actor-isolated retained-cluster callback was constructed as a nonisolated initializer default argument, rejected by complete concurrency checking.
- **Files modified:** `Sources/XLogPrototypeSupport/LiveOpportunitiesMethods.swift`; `Tests/XLogPrototypeTests/LiveOpportunitiesMethodsTests.swift`.
- **Fix:** retain optional injection; construct the default passive reader inside initialization. Snapshot reads cannot initiate cluster/radio output; terminal shutdown remains enforced.
- **Regression test:** actual default service against a private logbook, passive snapshot and post-shutdown rejection; existing injected-feed/history controls retained.
- **Verification:** BASE-STRICT-SWIFT fails before; ITER2-STRICT and 24 focused Swift Testing cases pass; FINAL-STRICT-SWIFT fresh full build passes with complete-concurrency flags; CLOSE-STRICT-BUILD and the full CLOSE-PORTABLE suite pass; selected TSAN (9 XCTest + 95 Swift Testing summary) pass.
- **Limits:** pre-existing non-Sendable callback/capture warnings remain. This is supported-language compiler acceptance, not full Swift 6 language mode or proof of race freedom.

### REG-P4-003 — Low — Fixed and Verified

- **Root cause:** process fixture omitted relocated Python/CA/Not1MM and spoke the obsolete typed Swift contest API. macOS path aliases also conflicted with the existing exact private-root guards.
- **Files modified:** `prototype/scripts/accept-contesting-worker-process.mjs`, `contesting-worker-current-scenario.mjs`, `relocate-contest-python.py`, `test-contest-python-relocation.py`.
- **Fix:** stage the existing pinned runtime dependency closure in a strictly bounded test bundle, use a canonical repository .build private root, then exercise the actual current Not1MM protocol. Preserve production bundle/output/signature restrictions, TLS trust validation and external-I/O denial. Catalogue availability before a normal workspace is intentional; normal draft operations still require explicit workspace creation.
- **Regression tests:** 12 relocation/path/identity/provenance/CA boundary cases; exact 78-operation current-engine ledger, receipt/hash controls, independent WW/WPX arithmetic, serials, stale revisions, correction/deletion, pending-draft retention, restart/replay and four exact-byte exports. Legacy correction helper tests remain intact.
- **Verification:** repeated current-engine process runs pass; CLOSE-WORKER-BUILD produces a fresh 58da5d49 universal release worker; CLOSE-PROCESS passes all 78 real exchanges in 30.738 s with two ordinary exits, unchanged staged hashes and protected production metadata. CLOSE-PROTOCOL passes eight cases; ITER6 relocation and Node gates pass 12 and 10.
- **Limits:** worker/test bundle acceptance only; not packaged current-engine native UI, installed application, provider-account or hardware acceptance. Exact canonical path restrictions remain in force.

### INV-P4-001 — severity unassigned — resolved as test harness defects

- **Root cause/evidence:** the Arm button was above the viewport; the purported click delivered no pointer/click event and the panel remained Disarmed. After fixing that, a new session title preceded its Operating style field.
- **Files modified:** `prototype/scripts/accept-contest-naqp-operator-browser.mjs`; `prototype/src/contesting/ContestOperatorPanel.test.tsx`.
- **Fix:** scroll the observed exact button into view before the semantic click; await Armed and the actual enabled select before input. Retain timeouts, output admission and all export/scoring assertions. Preserve optional video and failure snapshots.
- **Tests/results:** 53 panel tests including new blank-NAQP CW/SSB StrictMode controls pass. ITER4-NAQP-READINESS passes the original full workflow (64.017 s); FINAL-BROWSER-NAQP passes unchanged (67.270 s); its component inputs are identical at the final source, including six cases, RTTY boundary and 14 export assertions.
- **Limits:** no production CQ/RF defect was demonstrated; legacy typed Swift backend and simulated output only.

### REG-P5-001 — Low test-tool regression — Fixed and Verified

- **Root cause:** the initial REG-P4-003 fix expanded the production packaging source-name set, violating an existing source-level invariant even though runtime root guards still blocked production misuse.
- **Files modified:** `prototype/scripts/relocate-contest-python.py`, `test-contest-python-relocation.py`.
- **Fix:** restore the exact two-entry production set; use a separate explicit acceptance-only provenance branch behind matching root/script identity. No test assertion was weakened.
- **Tests/results:** FINAL-NODE-CHECKS correctly fails 1/10 before correction. ITER6-NODE-CHECKS passes 10/10; ITER6-RELOCATION-TESTS passes 12/12, including both directions of production/test script separation. CLOSE-NODE-CHECKS passes 10 cases; all 12 relocation cases pass and the final staged current Python process also passes after the correction.
- **Limits:** test-tool policy scope only; production release packaging still requires its independent version/signature/provenance acceptance.

### DEP-P5-001 — reviewed advisory risks, no application severity assigned — patch levels Fixed and Verified

- **Root cause:** Cargo locked reviewed stable dependencies below their maintainer patch floors; Phase 4 qualified the applicable feature/caller risks without establishing an application exploit.
- **Files modified:** `prototype/src-tauri/Cargo.lock`, `tools/check_reviewed_security_patches.py`, `python/tests/test_reviewed_security_patches.py`, `.github/workflows/contest-portability.yml`.
- **Fix:** rustls 0.23.46, rustls-webpki 0.103.16 and tokio 1.53.3; add an explicit narrow patch-floor guard to the existing CI generator job. No TLS setting or validation is weakened.
- **Regression tests/results:** seven policy cases pass; the old committed lock fails all three floors. Full locked Rust suites, feature tests, clean release compile and Clippy pass (warnings retained). Fresh npm audit has zero advisories. OSV queried 549 locked package versions; the only selected-macOS match is block-buffer 0.10.4, excluded by the maintainer's affected range >=0.11.0,<0.12.1.
- **Limits:** narrow release-line policy and current advisory snapshot; not a comprehensive security proof. Cargo-audit execution is blocked by the tool allowlist; other platforms, vendored/native prebuilts and future advisories need separate checks.


### REG-P5-002 — Medium — Fixed and Verified (portable IQ build)

- **Root cause:** the explicit non-macOS Package.swift source slice omitted four Foundation-only IQ types required by unconditional parser/resource tests. Real Linux and Windows discovery failed before any test execution. The affected source list predates Phase 5.
- **Files modified:** `Package.swift`, `tools/check_portable_iq_sources.py`, `.github/workflows/contest-portability.yml`.
- **Fix:** include TCIIQFrame, FlexIQTransport, FlexIQResources and FlexIQSubscription; keep live socket/radio owners outside the portable slice. Add a guard that builds the actual manifest-selected source slice, rather than a substituted implementation.
- **Regression tests:** the guard compiles three existing unchanged test files and executes 15 parser/continuity/resource cases. CI also requires real platform discovery and runs the CW/cluster boundary controls.
- **Verification:** ITER9-PORTABLE-IQ-BEFORE fails with missing types; ITER9-PORTABLE-IQ-AFTER passes 15 cases. Exact-source Linux and Windows CI discovery passes. The final CLOSE-PORTABLE receipt provides complete current-host verification.
- **Limits:** portable compilation/tests do not enable live radio features or establish full Linux/Windows GUI/package operation.

### REG-P5-003 — Medium — Fixed and Verified (Windows preference/restart persistence)

- **Root cause:** module selection and restart-intent transactions used Unix directory fsync after publishing files on Windows. Actual Windows tests returned Access Denied after replacing preferences. Both callers shared the same unsupported durability operation; the source predates Phase 5.
- **Files modified:** `prototype/src-tauri/src/durable_file.rs`, `main.rs`, `operating_module.rs`, `module_restart_intent.rs`; `.github/workflows/contest-portability.yml`.
- **Fix:** shared same-parent publication flushes the temporary file before replacement. Unix retains atomic rename and directory sync. Windows uses MoveFileExW with REPLACE_EXISTING and WRITE_THROUGH, preserving long/Unicode paths and propagating failures. Journal consumption durably retires its logical name before removing the retired file. Validation, expected destination checks, restart/admission fences and rollback remain.
- **Regression tests:** three direct primitive cases plus module two-way reopen and replacement/consumption coverage (five added test functions in total); Unicode/exact bytes, rejected destinations and cleanup are included. Existing mode/restart/shutdown cases remain.
- **Verification:** ITER9-WINDOWS-PUBLICATION-MAC-CONTROL passes 926 feature tests. Real Windows affected paths pass on 0b47; exact source 58da native jobs pass on Windows, Linux and macOS, including shared helper, mode, intent and all seven shutdown cases. CLOSE-RUST and CLOSE-RUST-FEATURE verify the complete final suites.
- **Limits:** ordinary CI filesystem semantics, not physical power-loss durability, production profile migration or installed-app acceptance. A crash after logical retirement can leave an inert uniquely named tombstone; it cannot replay as an active intent.

### REG-P5-004 — Low — Fixed and Verified (shutdown discovery gate)

- **Root cause:** Phase 3 commit 85d894ff added a seventh shutdown regression, while the Windows CI count guard still required exactly six. Windows ran the affected persistence tests successfully then failed this stale gate.
- **Files modified:** `.github/workflows/contest-portability.yml`.
- **Fix:** require exactly seven discovered shutdown tests. No test or assertion is removed.
- **Regression tests:** all seven existing shutdown cases execute; the exact discovery count remains an assertion.
- **Verification:** ITER10-SHUTDOWN-TESTS passes seven cases in 1.546 s; all exact source 58da native platform jobs pass the discovery and execution step.
- **Limits:** CI discovery/simulated worker lifetime scope; physical station release/watchdog acceptance remains separate.

### REG-P5-005 — Medium — Fixed and Verified (Windows CW compilation and strict primitives)

- **Root cause:** CWComputeWire unconditionally imported CoreFoundation, which Windows Swift does not supply. After the earlier IQ repair, actual Windows discovery reached this pre-existing compile error.
- **Files modified:** `Sources/XCWCore/CWComputeWire.swift`, `Tests/XCWCoreTests/CWComputeWirePrimitiveTests.swift`; related discovery/execution paths in `.github/workflows/contest-portability.yml`.
- **Fix:** conditional import; retain the original CF type-ID fast path where available, and use the backend's established canonical Foundation NSNumber boolean identities elsewhere. Do not coerce numeric 0/1, Int8/UInt8 or strings into wire booleans. Numeric fields continue to reject booleans.
- **Regression tests:** three new direct/final-event admission cases cover raw JSON booleans, explicit boxed numeric types, null/strings and ready/track fields. The fallback is tested directly on the current host and exercised natively on Windows.
- **Verification:** ITER10-CW-BOOLEAN-TESTS passes three XCTest cases; exact source 58da Windows discovery and explicit CW/cluster step13 pass, as does Linux step12. CLOSE-PORTABLE includes all new cases. The separate unchanged IQ child deadline observation is INV-P5-004, not silently counted as this compile fix's pass.
- **Limits:** no wire schema or range limit changed; Windows compilation/primitive tests do not establish real audio, child-worker packaging or live station qualification.

### REG-P5-006 — Low — Fixed and Verified (cluster fixture portability and CI reach)

- **Root cause:** three tests referenced the real Mac/Darwin SpotForwardBroker even where that owner is deliberately absent. An initial new oracle also assumed cleanup-before-forward and unchanged publication as a new delivery; independent review found its off-Mac forwarding assumption invalid. CI path filters omitted the CW/cluster files and therefore did not invoke the required portability job.
- **Files modified:** `Tests/XLogPrototypeTests/LiveClusterMethodsTests.swift`; `.github/workflows/contest-portability.yml`.
- **Fix:** scope all three real-broker fixtures to macOS while retaining every original supported-path assertion. Add an always-portable actual-method test of first-admission cleanup time and single cleanup. On macOS verify independent delivery/order; off macOS require hard zero-output/capability-denied counters and no injected forwarding/removal callbacks. Add relevant source/test/helper path filters and explicit three-CW/one-admission discovery and execution on each OS.
- **Regression tests:** all 26 Mac cluster cases remain; the new portable test checks the actual unavailable capability instead of enabling it for a fixture.
- **Verification:** failed ITER10-CLUSTER-PORTABILITY oracle retained; corrected ITER10-CLUSTER-PORTABILITY-R2 and independently corrected AGENT-CLUSTER-FINAL pass 26 Mac cases (20.354 s for the latter). Current Linux and Windows explicit portable admission steps pass; CLOSE-PORTABLE provides complete final-host verification. Generator CI also executes all seven security policy cases.
- **Limits:** no production radio capability changed; full cluster suite has other intentional native assumptions and is not claimed as a complete off-Mac live-radio qualification.



### DEP-P5-002 — alternate-target trust-list risk — Fixed and Verified

- **Root cause:** webpki-root-certs 1.0.9 retained the distrusted emSign root. The verifier uses this list only in its wasm32 branch, which has no implemented product target; no shipping macOS bypass was established.
- **Files modified:** `prototype/src-tauri/Cargo.lock`, `tools/check_reviewed_security_patches.py`, `python/tests/test_reviewed_security_patches.py`.
- **Fix:** compatible update to 1.0.10; extend the fourth reviewed patch floor and old-version test subcase. Cargo re-resolves one existing cssparser-macros syn edge; no other crate version changes in this patch.
- **Regression tests:** seven policy functions, including four old-floor subcases; preceding lock fails the new floor.
- **Verification:** ITER8-ROOTS-NEGATIVE fails as expected; ITER8-ROOTS-POSITIVE and policy tests pass. CLOSE-PATCH-FLOORS, complete Python/Rust/default/feature, release and Clippy checks pass; current generator CI passes. Fresh OSV re-scan is retained.
- **Limits:** advisory/version snapshot and patch-floor policy, not comprehensive native/OS/security qualification. Reference: [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html).

### DEP-P5-003 — conditional Linux GLib risk — Blocked

- **Root cause:** GLib 0.18.5 VariantStrIter unsoundness ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)); patched >=0.20 conflicts with current GTK 0.18.2's 0.18 API requirement.
- **Files modified / fix / regression test:** none for this item; an incompatible override or unqualified vendor backport is not a safe completed repair.
- **Verification:** exact dependency manifests/feature triage and direct application caller search are recorded in alternate-platform-dependency-triage.json. No direct application VariantStrIter call found; transitive affected-function reachability unproven. Local WebKitGTK 4.1 is missing and Docker daemon unavailable. Actual Linux native/portable CI now passes, but does not exercise the affected iterator or qualify the GTK GUI dependency.
- **Required corrective approach:** coordinated GTK/WebKit/Tauri migration or reviewed upstream backport with Linux compilation, GUI/runtime and affected-caller qualification.
- **Limits:** conditional Linux risk, application severity unassigned; no established macOS exploit. Four maintenance notices (proc-macro-error, zbus_names, zvariant, zvariant_derive) remain upstream migration debt.

### Remaining investigations and acceptance limits

| Item | Status / evidence / next boundary |
| --- | --- |
| INV-P4-002 | **Blocked** for full resource qualification. Fresh sanitizers/oracle and 60-second/eight-track/zero-drop profile pass, peak RSS 207.484 MiB. Retain earlier overload miss; multi-hour/live-audio/whole-app/physical timing remains unqualified |
| INV-P5-002 | **Not Fixed**, deeper cause/origin unassigned. Two SCP browser input failures remain; temporary diagnostic passes and is restored, unchanged clean R3 passes in 22.399 s. Actual response matches actual request. Capture input/event delivery without perturbing timing before a production repair |
| INV-P5-003 | **Not Fixed** as an overloaded resource observation. STABLE-FRONTEND fails two five-second voice-intent cases with 4,729 passes during compilation; unchanged two-case idle control passes in 8.990 s. Final complete idle CLOSE-FRONTEND passes 4,731/339 + 2 Node in 487.181 s. No deadlines/assertions changed; no voice/RF regression established |
| INV-P5-004 | **Not Fixed** as an overloaded resource observation. CLOSE-CW-WIRE passes 12/13, one staleInput rejection at unchanged 250 ms enqueue age guard; process, contract, fixture and IQ serializer unchanged since entry. Exact unchanged idle CLOSE-CW-WIRE-IDLE passes 13/13 in 14.239 s. Precise delay source uninstrumented; preserve guard and failure rather than infer general real-time readiness |

**CI environment boundary — Blocked overall workflow acceptance:** exact source 58da prototype 40774897702 exceeds its 40-minute job budget and is cancelled; all executed steps, including application tests/builds, inventory, upload, cache save and cleanup, report success. No application failure observed; no application code fix inferred. Separate CI and all seven portability jobs succeed. Own cancelled-job log and timeout annotation remain. Future qualification should split infrastructure stages or review their allocation while preserving product test deadlines; overall prototype success is not claimed.

Full manual review remains **INCOMPLETE**. Physical CAT/Flex/DAX/TCI/fldigi/CW/audio/RF, installed/native/current-Python UI, account-bound providers/Keychain, forced termination/power loss, production migration/restore and long soak remain outside this evidence. All original compatibility and historical-data recovery limits above still apply. cargo-audit execution remains blocked by the tool allowlist; no bypass was attempted; OSV and npm checks retain their own stated scope.

The final complete suites and 32 current-source gates pass within their recorded boundaries. All twelve original findings and safely compatible confirmed Phase 4/5 application/build/harness defects are repaired and verified; the conditional Linux risk and intermittent/timing observations remain explicitly open. This is qualified tested-source stability, not a bug-free application or complete operator-release acceptance. [Iteration history and full validation](/Users/oliver/Documents/Projects/OM0RX-xLog/STABILITY_REPORT.md), [exact commands](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/stability-2026-10-29/COMMANDS.md), [evidence index](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/stability-2026-10-29/README.md).

### Exact-source CI outcome

Frozen snapshot: **2026-10-28T22:29:20.241Z**, source **58da5d49359f7333852b04037a134ab04167be7b**. Each row retains its own actual conclusion.

| Workflow / job | Actual outcome |
| --- | --- |
| [CI 40774897787](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897787) | completed / success |
| [test-and-package 123121514769](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897787/job/123121514769) | completed / success |
| [Cross-platform prototype 40774897702](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897702) | completed / cancelled |
| [prototype (macos-14) 123121514872](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897702/job/123121514872) | completed / cancelled |
| [Linux runtime-only container acceptance 123139744274](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897702/job/123139744274) | completed / skipped |
| [Windows fresh-runner runtime acceptance 123139744909](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897702/job/123139744909) | completed / skipped |
| [Contest portability 40774897700](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700) | completed / success |
| [Contest definition generator 123121515230](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515230) | completed / success |
| [Contest tests (windows-2022) 123121515648](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515648) | completed / success |
| [Contest native tests (macos-14) 123121515650](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515650) | completed / success |
| [Contest tests (ubuntu-24.04) 123121515676](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515676) | completed / success |
| [Contest tests (macos-14) 123121515881](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515881) | completed / success |
| [Contest native tests (windows-2022) 123121515944](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515944) | completed / success |
| [Contest native tests (ubuntu-24.04) 123121515952](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40774897700/job/123121515952) | completed / success |

The main Swift CI job has a fresh checkout without a build-cache step and passes test/package/resource checks. Contest portability verifies three Swift, three native and one generator/security job. Prototype push gates build a desktop executable; operator-release packaging is workflow_dispatch-only. No hosted package is designated as an installed operator release. Earlier exact failed-job and no-runner histories remain preserved. Any incomplete/failed row above remains a limit regardless of another workflow passing.

Archived 224 command receipts; 19 disposable databases pass read-only integrity/foreign-key checks; 136 export artifacts across runs match their receipt byte counts and SHA. Original fixtures/source were restored and checked before archive verification. All original historical-data/recovery/compatibility limits remain.

## Post-Phase-6 Phase 5 follow-up — 29 October 2026

Entry source: clean canonical `main`, `fd774aef41f196e5f3b7da627a1b221af6594ba7`, fetched/fast-forward checked. The independent audit remains an immutable historical record. Its seven findings were reconfirmed against current callers; follow-up checks found another High application defect (FA-008) and a Low asynchronous test-harness defect (FA-009). Evidence: [follow-up archive](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/stability-followup-2026-10-29/README.md), [commands](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/stability-followup-2026-10-29/COMMANDS.md), and [iteration history](/Users/oliver/Documents/Projects/OM0RX-xLog/STABILITY_REPORT.md). Counts below overlap between configurations and reruns; tests using injected transports do not operate a real station.

**Original finding reconciliation:** FA-003 closes the specific pre-flush scope for which Phase 6 correctly rejected CR-008's unqualified Fixed status. FA-002 closes the repeated-import scoring/catch-up omission adjacent to CR-004. FA-004/005 qualify and repair the selection/retirement assurances adjacent to CR-002. The other original mechanisms remain covered by the complete current component suites and their existing historical-data/acceptance limits. None of these statements turns an original specific root-cause repair into a whole-subsystem or physical-radio certification.

### FA-001 — High — Fixed and Verified

- **Root cause:** retained restore could replace the database while retaining settings for another Wavelog URL/station; later component failure could retain incorrect authority. Package selection was also not bound to the later installed preview.
- **Files modified:** `Sources/XLogCore/BackupManager.swift`, `Sources/XLogApp/AppModel.swift`, `Sources/XLogPrototypeSupport/LiveLogbookMethods.swift`, paired `Tests/XLogCoreTests/BackupRestoreAuthorityTests.swift` and `Tests/XLogPrototypeTests/BackupRestoreAuthorityTests.swift`.
- **Fix:** shared preview/settings policy rejects missing identity and keep-settings destination mismatch before replacement. Installation re-inspects and compares the full expected preview and verifies staged database bytes. Retained restore saves disabled automatic-sync consent before closing/replacing the logbook, and selects the installed destination before later reference operations can fail. Modern restore uses the same policy. Commit `a00365e6`.
- **Regressions:** six cases in each core configuration cover URL/station mismatch, missing settings, same-destination preservation and consent, explicit backup settings, linked identifiers/recovery, and replacing a selected package with another valid package. Existing modern restore tests retain their own consent/data controls.
- **Verification:** focused tests and subsequent complete native/portable suites pass; supported application release and complete-concurrency builds pass. Exact commands/exits and source hashes are archived.
- **Limits:** no production restore, forced-termination/power-loss or physical preference/database crash-atomicity qualification. Existing historical-data recovery requirements remain. A same-destination restore is deliberately still supported.

### FA-002 — Medium — Fixed and Verified

- **Root cause:** replica scoring rebuilt all contacts using only the current page's enrichment, discarding durable country facts on earlier imported contacts.
- **Files modified:** `python/contest_host/host.py`, `python/tests/test_remediation_import_replica.py`.
- **Fix:** replica rebuild hydrates call-country facts from each retained durable contact identity through the existing validator before scoring the complete projection. No authority history or issued receipt is rewritten. Commit `e15c6008`.
- **Regressions:** native-shaped station-only fixture; two added cases independently check separately enriched import pages, earlier-row scoring (12 rather than 6), correction/replay/reopen, immutable authority history, and malformed-country rollback followed by a valid retry.
- **Verification:** baseline scoring failure reproduced; 33 focused tests plus eight final import tests pass (overlap). Complete Python suite passes 558 tests; append-equivalence and catalogue gates pass.
- **Limits:** already-diverged replicas still fail their before-image guard and need an operator-reviewed matching baseline. This repair does not silently reconcile incompatible historical identities or replicate all authority-local raw import metadata.

### FA-003 — Medium — Fixed and Verified

- **Root cause:** switching editors before the pending patch flushed used acknowledged base provenance for an unsent locally manual timestamp. The newly mounted form could display automatic current time and alter the date on a follow-on edit.
- **Files modified:** `prototype/src/LiveApp.tsx`, `prototype/src/live/DetachedQSOSurface.tsx`, new `prototype/src/live/operatorDraftTimeIntent.ts`, `prototype/src/live/operatorDraftSession.test.ts`, `prototype/src/live/DetachedQSOSurface.test.tsx`.
- **Fix:** both forms derive effective local time intent through the same helper and semantic UUID/start/end comparison. Save flush and native provenance validation remain. The helper lives in an editor module to preserve existing bundle budgets. Commit `8f47b19c`.
- **Regressions:** three rendered DetachedQSOSurface Full/Simple pre-flush switches; subsequent time-only edit; direct Save; journal recovery; pending/reversed edits; equivalent ISO/UUID spelling and automatic controls. MainLiveApp wiring is source-reviewed and uses the shared helper; no new rendered main-window pre-flush case is claimed. An intermediate uncommitted helper incorrectly compared UUID spelling bytewise; the final helper normalizes UUID case and reuses semantic timestamp comparison.
- **Verification:** original rendered/UUID failures retained; 168 targeted cases and 96 after module isolation pass (overlap). Complete 4,742-test frontend suite plus six Node tests pass. Clean-lock build passes at 405,194 bytes against the unchanged 405,200-byte Logbook limit; initial 405,353-byte failure is retained.
- **Limits:** no installed native editor or uncontrolled process-loss acceptance. Legacy journal compatibility remains conservative; no historical contacts are rewritten. The six-byte budget margin remains small.

### FA-004 — Medium — Fixed and Verified

- **Root cause:** power publication from an inactive slot could replace selected-radio capture authority; direct backend Hamlib TX reacquisition did not share the routing transition guard.
- **Files modified:** `Sources/XLogPrototypeSupport/NativeDraftPowerGate.swift`, `LiveStationMethods.swift`, `LiveWorker.swift`; `Tests/XLogPrototypeTests/NativeDraftPowerAdmissionTests.swift`, `NativeDraftPowerCaptureTests.swift`, `NativePowerSelectionTests.swift`, `StationRadioRegistryTests.swift`; `prototype/src-tauri/src/radio_slots.rs`, `station_selection.rs`, `main.rs`.
- **Fix:** retain per-slot metadata separately from explicit monotonic active authority. Native routing acknowledges a nil capture fence before persistence, does not hold the routing lock over worker IPC, and republishes safely on retry/failure. Normal/bootstrap selections are stamped with native authority; backend lease reacquisition uses the shared transition guard. Commit `7ba6ccc7`.
- **Regressions:** inactive publication and late callbacks; current active scope/readiness/generation; switch/failure/retry; worker and database capture; routing/TX denial during transition; existing ownership controls retained.
- **Verification:** the combined focused Swift run passes 83 cases (55 radio and 28 sync/restore controls); Rust passes 68 functions (8 routing, 53 selection, 7 shutdown). Complete native/portable Swift and default/feature Rust suites and Clippy pass. Selected thread-sanitizer tests pass. A staging-only partial-patch error was corrected before commit; tested working sources and pushed commits did not contain it.
- **Limits:** no real radio/RF, external watchdog, native GUI switch latency or physical telemetry acceptance. Startup capture-install ordering and same-target TCI readiness observations remain unverified audit concerns, not proven defects closed by these tests.

### FA-005 — Medium — Fixed and Verified

- **Root cause:** a failed owned FLEX release could be retired as a successful terminal shutdown, hiding uncertainty at the native boundary.
- **Files modified:** `Sources/XLogPrototypeSupport/LiveFlexSession.swift`, `LiveStationMethods.swift`, `LiveWorker.swift`; `Tests/XLogPrototypeTests/StationRadioRegistryTests.swift`; `prototype/src-tauri/src/worker.rs`.
- **Fix:** owner retirement returns structured unconfirmed radio IDs; the failed owner retains release duty and admits only release/disconnect recovery while its channel is open. Worker reports nonrestartable exit 74 and native shutdown presents the specific uncertainty. Existing runtime-profile external-I/O denials remain. Commit `9a003a2b`.
- **Regressions:** fake owned release fails, remains uncertain, denies new acquisition, and can complete a release-only retry in process; native exit 71/74 propagation is checked inside the existing seven shutdown functions.
- **Verification:** targeted Swift/Rust controls above and complete default/feature suites pass; actual worker framing and terminal behavior pass with injected providers.
- **Limits:** production EOF closes stdin, attempts shutdown once and exits 74 on uncertainty. It provides no post-EOF retry channel. Physical state requires external/operator verification; no automatic reconnect, transmit replay or RF-off claim is introduced. Forced process loss remains outside acceptance.

### FA-006 — Medium — Fixed and Verified

- **Root cause:** native detached-window allowlisting denied the editor's implemented duplicate-advisory request.
- **Files modified:** `prototype/src-tauri/src/worker.rs`, `prototype/src/live/DetachedQSOSurface.test.tsx`.
- **Fix:** add `logbook_duplicate` only to the `log-qso` role; all unrelated role denials remain. Commit `095f8fa8`.
- **Regressions:** actual native allow/deny gate and rendered duplicate advisory, preserving intentional duplicate Save and journal/authority behavior. These are separate Rust and React fake-transport fixtures, not one end-to-end native IPC test.
- **Verification:** pre-fix native control fails; focused Rust/frontend tests and complete frontend/default/feature suites pass.
- **Limits:** advisory is intentionally non-blocking. Installed native-window interaction remains unqualified.

### FA-007 — Low — Fixed and Verified

- **Root cause:** acceptance reported stale-generation rejection without sending a stale generation, conflating it with a revision test.
- **Files modified:** `prototype/scripts/contesting-worker-current-scenario.mjs`, `accept-contesting-worker-process.mjs`, new `contesting-worker-current-scenario.node-test.mjs`, `prototype/package.json`.
- **Fix:** execute a valid generation-bound network-context read, stale-generation read and stale-revision correction; assert exact independent rejection codes and unchanged persisted projection. Each report field derives from its own observed evidence; the combined bit requires both. Ledger advances from 78 to 81 exchanges. Commit `9dc6772e`.
- **Regressions:** six Node cases (four new/current-scenario and two retained legacy helper tests), including deliberately missing/incorrect rejection evidence.
- **Verification:** all Node cases pass; real freshly built worker acceptance passes all 81 exchanges on a canonical private `.build` root, including ordinary restart/replay and four byte/hash-verified exports. Earlier `/tmp`/`/private/tmp` lexical-identity preflight failures are retained; no isolation assertion was weakened.
- **Limits:** stale-generation evidence covers the implemented generation-bound network-context read, not every mutation. This CLI worker profile denies external I/O and does not exercise the Rust GUI host or installed application.

### FA-008 — High — Fixed and Verified

- **Root cause:** retained SwiftUI settings are editable live. Pre-Save timer/manual sync and backup capture could treat pending Wavelog URL/station B as authority for linked database A. Ordinary Save also allowed relabeling linked history. A rotor-grid automatic writer persisted the entire editable object and bypassed the first repair.
- **Files modified:** `Sources/XLogCore/Settings.swift`, `Sources/XLogCore/BackupManager.swift`, `Sources/XLogApp/AppModel.swift`, `Sources/XLogPrototypeSupport/LiveLogbookMethods.swift`, paired `Tests/XLogCoreTests/WavelogDestinationAuthorityTests.swift` and `Tests/XLogPrototypeTests/WavelogDestinationAuthorityTests.swift`.
- **Fix:** shared literal URL/station comparison; guarded Save checks linked rows including tombstones and fails closed without a usable database **for destination changes**. Unchanged-destination edits remain allowed without a database. Sync captures one validated configuration, and reference refresh uses the same captured URL/token. Backup/recovery capture rejects unsaved destination while preserving the draft. Restore and modern Save reuse the comparator. Initial commit `afe1cadf` was incomplete; `f3f6e3de` closes the automatic writer by accepting only a grid string and applying it solely to an empty grid in the saved snapshot. Other reviewed writers use validated restore snapshots or initialize a fresh isolated workspace from saved preferences with automatic sync disabled.
- **Regressions:** nine paired private-store/SQLite cases cover linked/tombstoned rows, missing/closed database, unlinked and non-destination controls, literal URL changes, zero transport on rejection and valid synchronization; an explicit unguarded counterexample proves the failure mechanism. The automatic-writer case verifies pending URL/station/operator/power preservation through grid autofill, saved-grid preservation, zero transport and linked-row survival.
- **Verification:** independent pre-fix driver uses valid complete history from B (remote ID84), tombstoning clean A42 for both station and URL changes; saved-A control preserves the row. All requests are intercepted; no real service or write is used. First repair's 14 focused cases were insufficient and are retained. Final targeted destination/restore15, complete native330 XCTest plus Swift Testing summary340, portable1,191 XCTest including six skips plus summary541, strict/release, thread-sanitized destination/restore15 and fresh worker/81-exchange checks pass. Source is frozen at `f3f6e3de` through those final checks.
- **Limits:** changes to a linked destination now require an explicit matching history/settings recovery path; no silent reassignment or historical relinking occurs. Existing raw SyncEngine callers must establish their authority before construction. Physical preference crash durability and installed settings UI remain unqualified.

### FA-009 — Low — Fixed and Verified (test harness)

- **Root cause:** detached editor test considered rendered controls sufficient readiness even though the passive native-event subscription effect had not registered; exact-source hosted CI observed one listener instead of two.
- **Files modified:** `prototype/tests/detached-logbook.test.tsx`.
- **Fix:** use the existing bounded wait helper for the exact two-listener subscription state and exact one-listener cleanup state. Existing final zero-listener, authority, recovery, conflict, journal and intentional-Save assertions remain. No timeout is increased. Commit `fd2fc49e`.
- **Regressions / verification:** four focused tests and closing complete 4,742-test frontend suite pass; the previously failing exact hosted step passes on `fd2fc49e` and final `f3f6e3de`. Listener counts refer to the mocked event bridge registered by the real editor effect, not a live native event service. The original 4,741/4,742 CI failure and skipped later steps are preserved rather than attributed to application behavior.
- **Limits:** synchronizes this fixture's actual effect readiness; does not establish absence of every UI timing issue. Earlier SCP input-delivery and overloaded timing investigations remain open within their recorded limits.

### Follow-up verification and residual acceptance boundaries

All 24 named final local gates pass: final affected Swift/native/worker checks plus unchanged component-verified frontend/Python/Rust suites, builds, analysis, catalogue/runtime and dependency checks. Twelve disposable databases pass read-only integrity/foreign-key checks; twelve export artifacts match recorded bytes and SHA. All 1,838 application inputs and 180 original dist files match, and original node_modules/CW directory inodes are preserved. No task build/test/worker process remains. Exact main CI, all seven portability jobs and the prototype Mac job pass; Linux/Windows runtime acceptance and operator packaging are skipped. Own run/job logs and archival verification are recorded in STABILITY_REPORT.md. Conditional Linux GLib risk DEP-P5-003 remains **Blocked** for the same incompatible GTK API/dependency reason. Historical SCP and overloaded scheduling observations remain **Not Fixed** investigations, with passing unchanged controls; they are not recast as confirmed new application failures.

The frozen manual inventory remains **INCOMPLETE**. Real CAT/FLEX/DAX/TCI/fldigi/CW/audio/RF, provider/Keychain accounts, installed/native/current-engine GUI, forced termination/power loss and long soak remain unqualified. Production data and station configuration were not operated. No operator release/install candidate was created; version remains 1.3.60.

## FA-010–FA-017 implementation follow-up — 29 October 2026

Entry: clean canonical `main` at `86a971e0338a7ce6432607f5648dfc1c23ec2a68`, fetched/fast-forward checked once. Assessed application baseline: `f3f6e3dee40af29cb6801ef8ee422c521629e168`, not the earlier candidate. This append supersedes only the dispositions explicitly updated below; earlier reports, counterexamples and qualification limits remain historical evidence. [Evidence and limits](docs/reviews/remediation-fa010-fa017-2026-10-29/README.md) and [exact commands/results](docs/reviews/remediation-fa010-fa017-2026-10-29/COMMANDS.md).

### FA-010 — High — Fixed and Verified (targeted; closing acceptance pending)

- **Root cause:** explicit Stop read/wrote settings before RX; failed storage skipped release and left cached transmit consent enabled.
- **Files modified:** `Sources/XLogPrototypeSupport/LiveFldigiBridge.swift`, `Tests/XLogPrototypeTests/LiveFldigiBridgeTests.swift`; FA-017 supplies its visible error/recovery consumers.
- **Fix:** revoke receive/transmit consent in memory and retire the generation first; attempt explicit RX independently of settings I/O. Persist the resulting current configuration afterward and expose a separate bounded `configuration_error`. Retain duty, uncertainty and pending-send final release until the existing acknowledgement criteria hold. Acknowledgement text does not certify physical RF state.
- **Regressions:** four new maintained tests cover completed send with storage failure, RX success/failure/both errors, unreadable configuration, denied profile, fresh retry and pending-send final release. Fake RPC and disposable files only. Existing passive-owner/emergency/generation controls retained.
- **Verification:** `A-FLDIGI-NEGATIVE` executed four tests before the production change: exit1/31 assertion failures. `A-FLDIGI-POSITIVE`: exit0/28 tests, including all 19 fldigi tests plus registry/terminal controls. Exact argv and hashes are in the command ledger. Existing concurrency and unused-binding warnings remain.
- **Remaining limits:** no physical engine/RF state or release latency certification; final coherent-source gates and native acceptance remain closing work. No package/install or production operation.

### FA-017 — Medium — Fixed and Verified (targeted; closing acceptance pending)

- **Root cause:** bounded snapshots, setup ownership and operator projection discarded release evidence; fulfilled Stop fabricated Off, hid retry after disabling TX and could route Escape to a different output owner.
- **Files modified:** `prototype/src/contesting/Not1MMContestWorkspace.tsx`, `DetachedContestSurface.tsx`, `DetachedContestDigitalDialog.tsx`, `contestSetupDialogs.ts`, `contestSurfaceProtocol.ts`, their maintained tests (including `DetachedContestSetupDialog.test.tsx`), and `prototype/src-tauri/src/contest_surface.rs` with its native validator regression.
- **Fix:** preserve strict bounded release flags, status and storage errors; publish the fresh setup snapshot before its completion receipt. Retain fldigi independently of WSJT-X read failure, fence stale reads and coalesce Stop. Keep dedicated release retry and Stop/Escape routed to the retained owner across disabled TX/mode/lane changes. Pending/uncertain release blocks new acquisition without disabling ordinary manual logging or normal owned send chains. Neither UI nor backend invents Off.
- **Regressions:** promote the executed uncertain-Stop counterexample into maintained tests; cover confirmed/unconfirmed/pending release, settings-only and combined errors, fresh reads, detached retry, setup receipt ordering, SSB/dual-lane owner retention, strict old/new wire schemas and malformed fields.
- **Verification:** actual rendered/fake-transport tests, whole affected frontend files, TypeScript and 37 Rust schema tests pass; overlapping runs and selector skips are identified in receipts. `A-FRONTEND-BUILD` passes unchanged TypeScript/Vite/window gates, with Logbook 405,194/405,200 bytes and exact original generated files restored. Original and intermediate failing evidence is retained.
- **Remaining limits:** separate React/fake-RPC and real Rust validator tests are not a live GUI-to-engine acceptance. A cold failed WSJT-X read still prevents opening its combined setup dialog; retained main/operator fldigi recovery remains available. Hardware/provider/distribution/soak and final-source checks remain outstanding.

### Remaining batch disposition

FA-011/012 (agent retirement/registration), FA-013 (replica reconciliation), FA-015/016 (immutable restore/interruption authority) and FA-014 (timestamp reversal) remain **Not Fixed** at this append. Owners have reconfirmed and planned their deterministic triggers. No fixed status is inferred from earlier passing suites. Readiness remains **NO-GO**; no installation, release, version relabelling or further general audit is authorized by this follow-up.
