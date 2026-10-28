# Phase 3 defect remediation

**Current Phase 4 disposition — 29 October 2026:** Eleven original findings retain Fixed and Verified status within their source/fixture limits. **CR-008 is reopened as Fixed but Unverified for clean build/integration acceptance**, linked to REG-P4-001; the original timestamp behavior still passes. Independent testing found one Medium build regression, two Low pre-existing compiler/harness defects, an unresolved NAQP browser failure and an overload observation. No application fixes were made in Phase 4. See [REGRESSION_TEST_REPORT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REGRESSION_TEST_REPORT.md) and the dated section below. Release acceptance is not met.

Started 29 October 2026 on clean canonical `main` at `530de4c4e4b23281ec60585cc7a2e5ca011476fb`, fetched and fast-forward checked. Scope: the twelve confirmed findings in CODE_REVIEW.md. The wider manual audit remains incomplete as recorded in REVIEW_COVERAGE.md.

Work proceeds by severity and shared dependencies: CR-001/008, CR-002, CR-003, contest replication/serial/scoring/recorder, retained imports/exports, ADX and power attribution. Each logical completed change is tested, committed and pushed immediately. No production data, installed application, live provider account or physical station is used. Source/build verification does not establish native UI, RF, external watchdog or sponsor submission acceptance. Review evidence directories remain immutable.

At the close of Phase 3, all twelve confirmed findings (2 High, 9 Medium, 1 Low) were recorded as **Fixed and Verified** within the source/fixture boundaries below. Phase 4 supersedes CR-008's build-verification status as described above. This does not claim an exhaustive defect-free application or retrospective repair of historical data.

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

- **Status:** Fixed but Unverified — clean build/integration acceptance reopened in Phase 4. Original manual-time preservation tests continue to pass; no reproduced return of the original time-loss defect.
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
