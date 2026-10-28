# Phase 3 defect remediation

Started 29 October 2026 on clean canonical `main` at `530de4c4e4b23281ec60585cc7a2e5ca011476fb`, fetched and fast-forward checked. Scope: the twelve confirmed findings in CODE_REVIEW.md. The wider manual audit remains incomplete as recorded in REVIEW_COVERAGE.md.

Work proceeds by severity and shared dependencies: CR-001/008, CR-002, CR-003, contest replication/serial/scoring/recorder, retained imports/exports, ADX and power attribution. Each logical completed change is tested, committed and pushed immediately. No production data, installed application, live provider account or physical station is used. Source/build verification does not establish native UI, RF, external watchdog or sponsor submission acceptance. Review evidence directories remain immutable.

Statuses use the requested vocabulary. `Not Fixed` means still pending in this active phase; it is not a decision to abandon the finding.

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

- **Status:** Not Fixed.
- **Root cause:** Historical-import audit lacks replication-compatible kind and identity images.
- **Files modified:** None yet. Planned scope: python/contest_host/adif_import.py; host.py; authority/replica tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-005 — Medium

- **Status:** Not Fixed.
- **Root cause:** Shared serial allocator omits the historical serial floor.
- **Files modified:** None yet. Planned scope: python/contest_host/store.py; host.py; multi-operator tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-006 — Medium

- **Status:** Not Fixed.
- **Root cause:** WAE extracts the first prefix digit instead of sponsor-defined Japanese numerical area.
- **Files modified:** None yet. Planned scope: python/contest_host/wae.py; WAE score/export tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-007 — Medium

- **Status:** Not Fixed.
- **Root cause:** ESM/function-key local commits lose origin/admission metadata before recorder catch-up.
- **Files modified:** None yet. Planned scope: python/contest_host/recorder.py; prototype/src-tauri/src/contest_recorder.rs; recorder tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-008 — Medium

- **Status:** Fixed and Verified.
- **Root cause:** Editor remounts derive time intent from new-versus-existing contact rather than canonical draft provenance.
- **Files modified:** `prototype/src/live/operatorDraftSession.ts`, `QSOEditorCore.tsx`, `OperatorDesk.tsx`, `DetachedQSOSurface.tsx`, `DetachedQSOSurface.test.tsx`, `OperatorDraftTime.test.tsx`; `prototype/src/LiveApp.tsx`.
- **Fix:** Carry optional canonical time provenance through validated snapshots and main/detached form props. Initialize/reset display mode from it; retain local unfinished time buffers. Native owns automatic Save time. Standalone forms without a native owner retain their prior callback-time contract.
- **Regression tests:** Full→Simple and Full→Simple→Full with acknowledged manual metadata and subsequent Save; automatic Save controls with no injected replacement; both actual form types submit retained canonical start; legacy/malformed provenance validation.
- **Verification commands/results:** Before fix: extended Swift test failed four assertions and both React remount cases failed. After fix: `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'OperatorDraft|DraftPower|SpotDraft'` PASS 93 tests/10 suites; focused six-file Vitest run PASS 154; final validator/session rerun PASS 41 (overlap); `npm run build` PASS tsc/Vite/unchanged window-bundle budgets. Initial build exceeded Logbook budget by 26, then 4 bytes; equivalent compact validation restored the gate without raising it.
- **Remaining limitations:** Source/fixture verification only. No native/installed UI, provider, station or production-data operation. No retrospective rewrite of old contacts. Legacy renderer journals without provenance remain readable; production editors conservatively show their retained timestamp until a fresh native snapshot arrives.
- **Evidence:** [stage logs](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/remediation-2026-10-29/time-provenance).

## CR-009 — Medium

- **Status:** Not Fixed.
- **Root cause:** Retained SwiftUI import bypasses shared preview, transactional deduplication and truthful result accounting.
- **Files modified:** None yet. Planned scope: Sources/XLogApp/AppModel.swift; shared import tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-010 — Low

- **Status:** Not Fixed.
- **Root cause:** Captured-power description hardcodes an amplifier source label.
- **Files modified:** None yet. Planned scope: prototype/src/live/QSOEditorCore.tsx; power description tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-011 — Medium

- **Status:** Not Fixed.
- **Root cause:** Retained SwiftUI export serializes only the display-capped array.
- **Files modified:** None yet. Planned scope: Sources/XLogApp/AppModel.swift; shared export tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.

## CR-012 — Medium

- **Status:** Not Fixed.
- **Root cause:** ADX standard-field set contains two deprecated names absent from the declared official schema.
- **Files modified:** None yet. Planned scope: prototype/src/live/adifTransfer.ts; independent vocabulary regression tests.
- **Fix:** Pending implementation.
- **Regression tests:** Pending.
- **Verification commands/results:** Not run for remediation yet; prior review evidence is not fix verification.
- **Remaining limitations:** Finding remains open. All production/provider/hardware boundaries above remain unverified.
