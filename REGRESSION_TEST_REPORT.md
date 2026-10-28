# Phase 4 independent application regression — 29 October 2026

**Assessment: ready for another remediation cycle; release acceptance is not met.** Broad source and isolated integration suites pass, but the clean frontend build fails its existing bundle gate. Complete Swift concurrency checking and the process-worker contest acceptance bootstrap also fail. NAQP simulated browser output fails three times and needs investigation. No application-code fixes, test-expectation changes, deployments, production-data operations or physical radio/RF operations were made in this phase.

The confirmed issues are **one Medium regression introduced during Phase 3 and two Low pre-existing compiler-check/test-harness defects**. The NAQP failure and CW overload observation are recorded separately; neither has established a production defect or remediation origin. CR-008's build/integration verification is reopened as **Fixed but Unverified**. Its original timestamp regression tests still pass. The other eleven original findings retain their bounded source/fixture verification; this is not exhaustive application acceptance.

## Source, environment and evidence

Validation started on clean canonical `main`, fetched and fast-forward checked at **26f795cb531c0b3c299e6a5dcc6d4a7f095b2058**, equal to `origin/main`. Version declarations remain **1.3.60**. All checks in this report ran anew during Phase 4. The source hash guard covers 1,819 application/support files and found zero changes; the final Git audit permits only these reports and new evidence. Existing review/remediation evidence is preserved.

| Environment | Recorded value |
| --- | --- |
| Host | macOS 27.0.1 / 26A434, arm64, 8 CPUs, 16 GiB RAM; 398 GiB initially free |
| Swift / C++ | Apple Swift 6.4, swiftlang 6.4.0.34.1; Apple clang 21.0.0; CMake 4.4.2 |
| Rust | rustc/cargo 1.98.0; clippy 0.1.98 |
| Frontend | Node 24.11.1, npm 11.6.3, committed package-lock.json; Vite 8.3.4 / TypeScript 5.9.3 |
| Python | 3.12.4 for application tests; Python 3.14 for CI's pinned corpus/generator checks; bundled scientific Python for the NumPy oracle |
| Browser | agent-browser 0.32.3, isolated headless browser sessions with Vite and an XCTest LiveWorker host |
| Time | 29 October in Australia/Darwin; exact UTC start/end times and elapsed durations are in each command receipt |

The durable [evidence directory](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/README.md) includes the [exact 61-command ledger](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/COMMANDS.md), environment, source/dependency hashes, exit codes, raw compressed logs, synthetic exports, browser observations, private-database integrity checks and reproduction scripts. [results.json](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/results.json) is the machine-readable execution summary; [SHA256SUMS](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/SHA256SUMS) verifies the archived bytes. Raw-log hashes refer to decompressed bytes. Counts below overlap between configurations and repeats and must not be added as unique tests.

Original node_modules and the CW build fixture were preserved before replacement and restored by directory inode. All **180 original dist files** were restored with exact hashes. Both fresh npm trees and task-generated outputs remain in separate ignored task paths. No candidate was packaged, signed, installed or version-bumped. The worker bootstrap below is a test-only CLI fixture, not a distributed application candidate.

## Builds, analysis and test executions

Commands are reproduced in full, with working directories and environment arguments, in COMMANDS.md. IDs below identify the corresponding receipt and raw log.

| Check / command ID | Actual outcome |
| --- | --- |
| Fresh SwiftUI product build, CLEAN-NATIVE-BUILD-R2 | PASS; fresh native-r2 scratch, `swift build --product om0rx-xlog`, 47.624 s |
| SwiftUI release compile, NATIVE-RELEASE-COMPILE | PASS, 118.325 s; compilation only |
| NATIVE-FULL, `swift test --no-parallel` | Exit 0; 315 XCTest, zero XCTest skips; Swift Testing summary 340, with 12 named disabled cases separately recorded |
| PORTABLE-TESTS-R2, `XLOG_PORTABLE_ONLY=1 swift test --no-parallel` | Exit 0; 1,171 XCTest including 6 skips; Swift Testing summary 536, with 7 named disabled cases separately recorded |
| SWIFT-STRICT-PORTABLE and focused SWIFT-STRICT-R2 | FAIL, exit 1; actor-isolated default at LiveOpportunitiesMethods.swift:44; REG-P4-002 |
| SWIFT-TSAN | PASS; 82 Swift Testing cases across selected station-owner, fldigi, draft, power, contact and cluster paths; no sanitizer finding in these paths |
| RUST-TESTS-R2, locked/offline Cargo tests | PASS; 914 unit + 26 integration test functions. One opt-in Hamlib function initially returns early; actual daemon coverage was run separately |
| RUST-CONTESTING-FEATURE | PASS; 921 binary tests with `--features contesting-test`, including gated native admission/export/shutdown paths; overlaps default suite |
| RUST-CLIPPY, `--all-targets` | Exit 0 **with warnings**, including dead code and style/control-flow diagnostics; not warning-free or `-D warnings` acceptance |
| RUST-RELEASE-COMPILE | PASS, 418.083 s; backend compilation, not a complete Tauri package/build acceptance |
| CLEAN-NPM-INSTALL / CLEAN-NPM-STANDARD | Both fresh installs PASS; first used ignore-scripts, second ordinary lifecycle scripts. 8,907 installed-file hashes match with zero content changes |
| FRONTEND-FULL / FRONTEND-STANDARD-FULL | Both PASS; each 4,721 Vitest tests / 339 files + 2 Node tests; standard install run 415.809 s |
| FRONTEND-CLEAN-BUILD / FRONTEND-STANDARD-BUILD | Both FAIL after successful `tsc --noEmit` and Vite: Logbook 405,218 > 405,200 bytes; REG-P4-001 |
| ORIGINAL-TREE-BUILD | PASS, original mutable pnpm tree, Logbook 405,194 bytes. This does not qualify the committed npm lock |
| BUILD-WORKER-RELEASE | PASS; fresh release worker and resource/source hash manifest, 227.543 s |
| WORKER-PROTOCOL | PASS; 8 real child-process protocol tests with the fresh worker, private test identity/home and disabled station access |
| WORKER-BOOTSTRAP / WORKER-BOOTSTRAP-R2 | Both FAIL at first contest_catalog expectation; missing current Python runtime in test bootstrap, REG-P4-003 |
| PYTHON-FULL-R2 | PASS; 549 tests, 224.132 s test body; contest N1MM UDP disabled |
| ALL-CONTESTS | PASS; all 97 runtime catalogue plugins; 1,353 checks PASS, 5 NOT APPLICABLE, no fixture-cache shortcut |
| PINNED-CONTEST-CORPUS / CONTEST-GENERATOR-TESTS-R2 | PASS; exact upstream pin 7c8b499225a73f7f8f792246881bd7aefc05452f, 94 upstream plugins / 16 active previews; 42 generator tests on Python 3.14. This inventory denominator differs from the 97 runtime catalogue |
| CW-ASAN-CONFIGURE / BUILD / TESTS | PASS; fresh native Debug build, AddressSanitizer + UndefinedBehaviorSanitizer, 2 CTest executables; no finding |
| CW-PLAIN-CONFIGURE / BUILD / CW-WIRE-HARNESS | PASS; fresh RelWithDebInfo worker, 13 Swift child-wire tests including real synthetic IQ replay |
| CW-NUMPY-ORACLE-R2 | PASS; unchanged production feature extractor vs NumPy: silence/impulse error 0, random max absolute error 2.384185791015625e-07, tolerance 2e-6 |
| NPM-AUDIT | Exit 0; zero reported advisories in the npm graph at scan time; not a general security guarantee |
| OSV-RUST-ADVISORIES-R2 | Scan completed with TLS verification; advisory matches require the feature/caller triage below. cargo-audit itself was blocked by the tool allowlist |

Default skips were explicitly investigated. The native suite's 12 disabled Swift Testing cases are the award scale test and 11 FTP/FTPS live-server cases; all were subsequently exercised in AWARD-CATALOGUE-SCALE and DISPOSABLE-FTP-FTPS. Five of the portable suite's six XCTest skips were subsequently exercised: three merge benchmarks, browser acceptance and the public SCP download. Windows Credential Manager remains unverified. Six of its seven disabled Swift Testing cases were subsequently exercised: empty-log query, generated 100k log, durable save, 100k spots, public propagation and DXpedition feeds. The account-bound remote-history probe remains disabled because it reads a user workspace/Keychain token and contacts Wavelog. Default suite counts were not rewritten to hide skips.

Four initial long commands lost exit metadata when the command collector hit its 120-second limit. Their raw logs are retained, but they are not counted as clean passes; durable reruns supply the receipts above. Initial NumPy and OSV attempts failed due to missing NumPy/private Python certificate trust, and the first Hamlib invocation omitted required executable paths. The first generator invocation lacked CONTEST_SW_ROOT (42 tests, 12 fixture failures). Correctly configured repeats passed without altering application behavior or expected results. These are distinguished from application failures in [collector-incidents.json](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/collector-incidents.json).

## Functional coverage matrix

PASS means the stated source/fixture layer passed. PARTIAL means an additional acceptance boundary remains open; it does not imply that all user-visible behavior passed. The inventories contain 1,073 feature/source paths and 853 test/script paths used to map coverage. Existing per-file manual review depths remain unchanged.

| Implemented subsystem / workflow | Exercised evidence and result | Remaining acceptance boundary |
| --- | --- | --- |
| Startup, isolated workspace, worker lifecycle | PASS WorkerStartup, terminal/shutdown outcome, runtime-profile tests; 8 real process protocol cases including EOF drain, framing, malformed UTF-8/oversize and concurrent request IDs | PARTIAL: no current full packaged application/native-window launch or ordinary Dock Quit |
| State restoration and unfinished work | PASS frontend unfinishedEditors/workspace recovery, Rust durable station journal/restart/uncertain-receipt tests, Swift draft/reopen tests | PARTIAL: no native app force-quit, OS shutdown, power-loss or fsync durability proof |
| Logbook creation, selection and settings isolation | PASS Swift workspace/bootstrap/settings tests; private browser workspaces created/read; protected database metadata unchanged | PARTIAL: native file chooser and production workspace migration not operated |
| QSO Save / manual and automatic time | PASS OperatorDraft, OperatorDraftTime, detached/main remount controls and fresh SQLite/receipt readback in full suites; CR-001/008 mechanisms | PARTIAL: clean renderer build fails; native end-to-end Save/paint not measured |
| QSO editing, deletion, undo, conflicts | PASS contact revision fences, exact replay, soft delete/restore, closed DB and rollback tests; rapid/double submissions in frontend suites | PARTIAL: no production data; UI timing/native chooser paths unqualified |
| Callsign, frequency, band, mode and split | PASS typed validators, CAT/TCI encoding/parsing, draft radio-follow/QSY, Rust observation/admission and frontend split/receive-filter controls | PARTIAL: no real rig readback, country-specific operator-frequency acceptance or RF |
| Power capture and attribution | PASS selected-source ownership/detach fences, manual/fallback/persisted watts and radio/KPA500 label tests | PARTIAL: synthetic samples only; no meter calibration or actual amplifier |
| ADI import/export | PASS malformed/truncated/invalid UTF-8/bounded documents, whole-import rollback, repeats/dedup, field retention and frozen 2,003-row export beyond display cap; retained SwiftUI product compiles | PARTIAL: native chooser, large-file UI blocking/memory and power-loss filesystem behavior |
| ADX / USERDEF | PASS full frontend schema-vocabulary and round-trip matrices, deprecated-field USERDEF preservation and legacy import compatibility | PARTIAL: pinned ADIF 3.1.7 vocabulary only; original XSD's documented unrelated regex prevents full libxml2 XSD validation |
| Callsign lookup, CTY, QRZ, SCP and call history | PASS local lookup/reference/profile/cache/parser tests; SCP browser picker shim and real official download to disposable cache/reopen | PARTIAL: QRZ subscription credentials and native OS picker untested |
| Awards, aggregates and statistics | PASS catalogue/cache invalidation and evidence rules; independent 100k-contact award performance; contact correction/reopen controls | PARTIAL: no sponsor certification; generated fixtures do not establish all award/rule editions |
| Wavelog sync, reconciliation and deliveries | PASS mocked HTTP/error/timeout, identity/conflict/revision/replay and bounded merge tests; 68k unchanged/changed synthetic snapshots | PARTIAL: no account or live remote history; no user token accessed |
| DX cluster transports and reconnect | PASS portable socket/session/parser, filters/classification, telnet/boundary, disconnect/reconnect and timeout tests; frontend panel/filter controls | PARTIAL: no long-lived public cluster login, LAN outage or station network |
| Spot history | PASS append/query/migration/corrupt-health rollback tests and 100k archive benchmark | PARTIAL: synthetic observations; no multi-hour live feed soak |
| Band maps, world/DX maps, DXpeditions | PASS frontend rendering/filter/selection and opportunity-coordinate fixtures; live public provider comparison through the real service, including the unchanged assertions | PARTIAL: no native detached map interaction, visual/GPU qualification or exhaustive provider currency |
| Spot-to-radio and rotor activation | PASS LiveSpotBridge receipts, reservation/selection/ownership, stale-spot and no-double-dispatch controls; frontend activation fences | PARTIAL: fake endpoints only; no actual QSY, rotor movement or radio visual confirmation |
| CAT / Hamlib / remote agent | PASS protocol/adapters, default integration tests plus opt-in real loopback model-1 rigctld/rotctld test; 8-check dummy smoke PASS | PARTIAL: staged Hamlib 4.7.2 binaries hash-verified, not rebuilt; no physical device, serial port or non-dummy model |
| FLEX control and receive IQ/DAX integration | PASS LiveFlexSession, IQ identity/resource/subscription, spot forwarding, reconnect/ownership and selected-radio power tests | PARTIAL: fake transports/synthetic IQ; no FLEX discovery/network radio, real DAX stream/device or transmitter watchdog |
| SunSDR2 / TCI | PASS command encoder, WebSocket protocol/session, receive filter/split and scoped IQ subscription tests; worker registry shutdown/late-callback controls | PARTIAL: no physical SunSDR2/ExpertSDR server, actual audio stream or RF release/readback |
| CW output / keyer / WinKeyer / Stop | PASS Rust/Swift output ownership, profile/admission, abort/uncertainty/restart and serial-protocol fixtures; visible browser simulation | PARTIAL: no serial keyer or keying; no unattended RF; physical emergency-release latency untested |
| CW decoder / native worker | PASS sanitizers, 13 wire/child lifecycle tests, NumPy oracle, real synthetic IQ inference and bounded 60-second idle-load profile | PARTIAL: first overloaded profile misses pacing; no live audio/device, multi-hour soak or whole-app resource proof |
| CW decoding to log/spot | PASS native/client/bridge and UI fixture paths with source/session identity, stale/malformed IQ and delivery fences | PARTIAL: actual decoded-on-air text to radio/cluster/operator workflow untested |
| fldigi integration | PASS owned TX/RX lifecycle, uncertain release, explicit Stop, late text, invalid bundle and retirement tests, including TSAN subset | PARTIAL: no external fldigi process or actual RX/RF readback |
| WSJT-X integration | PASS LiveWSJTXBridge, activity/UDP parsing, logging/dedup and frontend controls in full suites | PARTIAL: no external WSJT-X instance/live station packets |
| Rotor, amplifier and station routing | PASS configuration migration/passive-read/ownership and dummy rotor readback, slot/scope/release controls | PARTIAL: no external hardware state changed |
| Settings, profiles, shortcuts, detached surfaces | PASS Swift/Rust persisted-version migration, frontend journal/layout/shortcut and recovery suites | PARTIAL: no native WebKit store, macOS focus/menu/dialog/display geometry or accessibility acceptance |
| All implemented contests | PASS current Python Host tests, 97-plugin fresh readiness and pinned-corpus/generator verification; scoring/dupe/multiplier/correction/reopen/export fixtures | PARTIAL: no all-97 production-engine UI run, sponsor upload or rule-currency certification |
| Contest browser workflows | PASS 8 operator cases, 14 family cases, 11 declarative cases and SCP workflow; actual isolated LiveWorker, SQLite and synthetic exports | FAIL NAQP first case in three runs. All these browser fixtures use the legacy typed Swift contest engine; they do not establish packaged Python/Not1MM UI parity |
| Contest process backend | PASS release compilation and direct Python Host integration; FAIL standalone bootstrap gate at first catalogue request | PARTIAL: current application-relative Python/framework/CA/Not1MM process path not accepted; REG-P4-003 |
| Multi-operator replication, serials and imports | PASS paired Host transactions, concurrent grants, import/catch-up/reopen/correction/delete, legacy identity projection and rollback; CR-004/005 | PARTIAL: no connected peer/LAN or exchange transmission; old issued receipts remain immutable |
| WAE policy migration / recalculation | PASS retained 1.0.0 session read safety, explicit adoption of 1.0.1, independent arithmetic, authority digest and Cabrillo gate; CR-006 | PARTIAL: no production session migrated or sponsor submission |
| Contest recorder, audio/bookmarks and provenance | PASS synthetic PCM/store/cursor, ESM/function-key admission, replay/reopen and import/remote exclusion; CR-007 | PARTIAL: no microphone/device/native playback or retrospective bookmark repair |
| Local/cloud backup and restore | PASS local archive, authorization, provider HTTP mocks, retention/scheduler and restore fences; real disposable FTP and trusted/untrusted FTPS success/failure matrix | PARTIAL: no live Dropbox/Google Drive/OneDrive account or production restore; only implemented configuration/transport paths asserted |
| Public conditions, weather, propagation and opportunities | PASS parsing/cache/stale/error service and UI fixtures; public propagation and DXpedition transport probes PASS | PARTIAL: weather/provider combinations and live HF overlays not exhaustively contacted; no account/provider quota/long-term reliability claim |
| Error recovery and user notifications | PASS frontend error/uncertainty/retry surfaces and worker timeout/failed persistence/retired callback tests | PARTIAL: native crash reporting and every alert/focus path not manually exercised |

There is no inferred full application E2E capability: the available browser harness covers selected contest surfaces, and its current process-worker counterpart is broken. Actual implemented FLEX/TCI/CW/backup integrations are represented above at the layer tested; inaccessible hardware/account capabilities are not counted as passes. Windows/Linux workflow jobs, platform credential stores, installers, code signing/notarization, distribution metadata and complete bundled runtime acceptance were not executed on this macOS-only runner. CI's full package stages were not substituted with backend compilation.

## Failure, boundary and resource testing

| Boundary | Evidence / actual outcome |
| --- | --- |
| Invalid, truncated, malformed and incomplete input | PASS ADIF planning/atomic import, UTF-8/size limits, ADX vocabulary, worker framing, XML/protocol and provider parser fixtures; no prefix import accepted as whole-file success |
| Duplicates, exact repeats, stale revisions | PASS QSO/operation receipt, contact/serial/replica/spot dedup and replay controls; 68k unchanged merge produces zero QSO writes |
| Empty data | PASS empty workspaces/catalogues, contact/award/query paths; QUERY-BENCHMARK-COPY contains zero normal-log QSOs and is reported only as an empty-log control |
| Large data | PASS generated 100k log: import 34.619 s, list 5 ms, stats 18 ms, progress 207 ms, map 16 ms, catalogue 635 ms, history 261 ms; generated index migration 1.284 s. Row-local read p95 0.038 ms / edit p95 0.467 ms |
| Large awards and durable Save | PASS 100k awards, 5 samples, median 1.224 s/max 1.245 s. 68k worker Save, 50 samples, median 4.329 ms/p95 6.937 ms/max 13.360 ms with background projection deliberately held; excludes UI paint, transport and aggregate contention |
| Large spot archive | PASS 100k rows, ingest 24.893 s, exact-call p95 4.380 ms, recent query 2.431 ms, full stats 515.584 ms, reopen 2.701 ms; file 251,382,240 bytes |
| Concurrent merge / foreground work | PASS production bounded merge control: 68k merge 19.787/19.430 s, foreground reads 35.668/39.915 ms, one dirty conflict retained. Deliberate unbounded primitive control blocks reads 19.608/18.132 s; current SyncEngine uses 128-row steps, so that control is not a demonstrated production UI stall |
| Rapid actions / concurrent state | PASS revision/idempotency/admission/ownership tests, paired Host grants, frontend pending-work and late callback tests, TSAN selected 82 cases. This is not a general proof of race freedom |
| Network timeout, lost acknowledgment, partial transfer | PASS fake network failures and real loopback FTP: uncertain upload/replay refusal, control timeout, stalled transfer/120 s total deadline, oversize stream and object growth; trusted FTPS success, wrong CA/hostname/untrusted certificate fail closed |
| Radio loss/reconnect / owner retirement | PASS simulated providers and loopback dummy devices; selected radio, pending command, release-uncertain and stale sample fences. No hardware loss/reconnect or physical PTT release tested |
| Child termination / relaunch / recovery | PASS real private worker EOF/protocol cases; CW unexpected-exit/uncooperative-child watchdog/prepareStop; DB/journal reopen and native-owner retirement tests. Full app force-quit/power-loss and current Python process-contest persistence E2E remain open |
| Memory and undefined behavior | PASS targeted Swift TSAN and native CW ASAN/UBSAN; command max-RSS receipts retained. CW model, sidecar and ONNX runtime hashes match their recorded pins. Prebuilt ONNX internals were not rebuilt/instrumented |
| Sustained CW synthetic load | First run **semantic FAIL** under concurrent compiler load: 5.504/60 s delivered, lateness 255.246 ms, zero inferred tracks; profiler stops at its 250 ms bound even though exit 0. Identical repeat after compilers finish: PASS 60 s delivered, 8 inferred tracks, 424 events, pending max 6, zero coalesced/dropped, max lateness 161.829 ms, decode p95 572.552 ms, peak RSS 200.125 MiB |
| Long-running resources | PARTIAL: one bounded 60 s synthetic profile, not an application leak/soak test. No multi-hour UI/cluster/audio soak, Instruments/heap leak proof or simultaneous whole-process-tree RSS measurement |
| Production durability / station acceptance | NOT RUN: real account mutations, production migration/restore, OS shutdown, forced app termination, RF, serial devices, audio devices, transmitter and rotor operations |

Fifteen retained disposable SQLite databases/copies were checked read-only: **integrity_check=ok, no foreign_key_check violations**. They include browser normal-log/contest databases and the empty-log benchmark copy; user_version/table receipts are retained. Suites additionally exercise schema/revision/settings/spot-history migration, malformed migration rollback, historical contest/serial compatibility and the generated 100k index migration. No production database or physical power-loss migration was tested. Browser assertions record unchanged protected production-database metadata; this is metadata evidence, not a byte-level audit of every user file.

## Confirmed issues and origin analysis

### REG-P4-001 — Medium — clean frontend build regression

**Failure:** ordinary clean `npm ci` followed by unchanged `npm run build` fails the Logbook startup budget: **405,218 versus 405,200 bytes**, an 18-byte excess. Both ordinary and ignore-scripts installs reproduce it. TypeScript, Vite and all frontend tests pass, so this is a release-gate failure rather than a demonstrated timestamp/UI failure.

**Attribution:** Git-blob-controlled Vite builds use the same clean dependencies/configuration/checker without editing the canonical source: pre-remediation **530de4c4 → 405,185/PASS**; first shared CR-001/008 time-provenance commit **875b5254 → 405,224/FAIL**; current **26f795cb → 405,218/FAIL**, exactly matching the official build. The original mutable pnpm tree passes the current source at **405,194**, but differs from the npm lock in React/ReactDOM, Tauri API/CLI and user-event versions. Phase 3 therefore verified a dependency tree that did not establish clean-lock reproducibility.

**Recommended correction:** restore the existing clean-lock build gate using equivalent validated code and a reproducible package-manager/dependency policy. Preserve timestamp provenance validation and the existing budget. Do not raise the threshold or drop assertions to pass. CR-008's build/integration acceptance is reopened; the original manual-time failure has not returned. [Controls and receipts](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/findings.json).

### REG-P4-002 — Low — pre-existing strict concurrency check failure

**Failure:** both complete and focused portable Swift builds with `-strict-concurrency=complete -warn-concurrency` fail at [LiveOpportunitiesMethods.swift:44](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/LiveOpportunitiesMethods.swift:44): actor-isolated default value in a nonisolated context. The default clusterSpots closure awaits LiveClusterMethods.shared from a nonisolated default-argument context. Additional stricter warnings identify callback Sendability/capture work.

**Origin/impact:** the affected source/callback is unchanged since the pre-remediation baseline. Standard Swift builds/tests and selected TSAN tests pass; no runtime data race is demonstrated. This blocks the stronger compiler check and remains a compatibility/concurrency-hardening defect.

**Recommended correction:** make callback isolation/Sendability explicit or create it in the correct actor context, then rerun opportunities/cluster/strict checks. Preserve the diagnostic. [Repeated compiler receipts](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/logs/SWIFT-STRICT-R2.json).

### REG-P4-003 — Low — pre-existing process acceptance fixture defect

**Failure:** the freshly compiled release worker's standalone acceptance script fails twice at its first contest_catalog request: **contest_host_unavailable**, expected **workspace_required**. [accept-contesting-worker-process.mjs](/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/scripts/accept-contesting-worker-process.mjs) stages native bundles but omits the Python framework/interpreter, regular CA file and Not1MM assets required by [PythonContestHostConfiguration.bundled](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/Contesting/PythonContestLane.swift:30). The process-owning worker selects that backend.

**Origin/impact:** selection predates Phase 3 (6b2787e4, 20 October), and the examined bootstrap/configuration code is unchanged since 530de4c4. This is a test-harness defect that prevents current process-worker persistence/restart/export acceptance. It does not prove that a shipping bundle lacks its runtime. Legacy in-process browser passes do not close the gap.

**Recommended correction:** stage the verified application-relative Python framework, CA and pinned Not1MM assets in the test-only bootstrap and rerun the current backend's workflow. Retain isolation/workspace guards; do not substitute user PATH Python or accept engine unavailability as success. [Failure evidence](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/worker-bootstrap-r2/evidence/acceptance.json).

### Unresolved observations

**INV-P4-001:** NAQP CW Run fails at acceptance-script line 299 in three independent runs: two clean npm runs and an original-pnpm control. After the unchanged 10-second polling loop, simulated output is `[]` instead of `['CQ']`; each trace has 19 worker frames and no simulated output, and later planned cases are not reached. The last draft advertises canSendCQ=true. Simulation dispatches directly to a browser callback, so the absence of a native operator RPC does not establish a bug. Arming, keyboard focus and edit-generation/context retirement need instrumentation. Examined UI/script/lock paths are unchanged since the pre-remediation baseline, but historical UI execution was not performed; origin remains unproved. No guard or expected result was changed. This is a legacy typed-engine fixture failure, not established production-radio/CQ failure. [Three traces and investigative limits](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/open-investigations.json).

**INV-P4-002:** the first CW profile's overload failure remains recorded despite the idle-load repeat passing. The profiler's intentional deadline break explains the early end; production under-load responsiveness, recovery and multi-hour resource behavior remain unqualified. No new application defect or remediation attribution was established.

## Dependency and security assessment

`npm audit --json` reports zero known vulnerabilities at scan time. The isolated cargo-audit installation succeeded, but direct execution was denied by lean-ctx's command allowlist; it was not retried through another executor or an allowlist change. A separate scan used the public [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/) with system curl and TLS verification, querying **549 locked registry package versions** and distinguishing the selected macOS graph. The first Python TLS trust failure is retained as an environment failure, not an application TLS defect.

There were 18 raw advisory identifiers; 4 selected macOS packages matched 7 unique advisories after alias grouping. These are **not seven confirmed application vulnerabilities**. Caller/features/primary-advisory triage is retained in [security-triage.json](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/regression-2026-10-29/security-triage.json):

| Match | Disposition |
| --- | --- |
| block-buffer 0.10.4 / GHSA-qwgh-2vcv-g2f7 | Version false positive: current maintainer affected range is >=0.11.0,<0.12.1; selected version is outside it. [Maintainer advisory](https://github.com/RustCrypto/utils/security/advisories/GHSA-qwgh-2vcv-g2f7) |
| rustls 0.23.45 / RUSTSEC-2026-0348 | Affected non-default Brotli feature is absent from the selected graph. [RustSec conditions](https://rustsec.org/advisories/RUSTSEC-2026-0348.html) |
| rustls / RUSTSEC-2026-0346 and 0347 | Debug-secret/ECH conditional paths: no direct app secret Debug formatting or ECH configuration found. Not established app leaks; transitive behavior is not exhaustively excluded |
| rustls / RUSTSEC-2026-0349 | Open patch review: AWS-LC and an HTTPS client are selected, but cache-downgrade exploitability is not demonstrated. [Advisory](https://rustsec.org/advisories/RUSTSEC-2026-0349.html) |
| rustls-webpki 0.103.15 / RUSTSEC-2026-0382 | No confirmed macOS chain-validation bypass: inspected reqwest 0.13.5 defaults to platform verifier 0.7.1 / Apple's SecTrust, with no app custom webpki chain setup. Other platform paths remain unverified; review the patched release. [Advisory](https://rustsec.org/advisories/RUSTSEC-2026-0382.html) |
| tokio 1.53.2 / RUSTSEC-2026-0386 | Informational AsyncFd unsoundness: no direct app constructor use found; transitive reachability remains open. No app use-after-free demonstrated. [Advisory](https://rustsec.org/advisories/RUSTSEC-2026-0386.html) |

The direct app reqwest caller examined is the HF propagation client; source/feature inspection supports the qualified conclusions, not exploit proof. Native prebuilt ONNX, model, bundled Python/native libraries and OS frameworks were not comprehensively advisory-scanned. Python host and generator tests verify behavior/provenance, not a complete bundled-runtime security assessment. No credential/account penetration, provider authorization audit, general SBOM certification or claim of security-free dependencies is made.

## Original finding verification and next cycle

| Original finding | Phase 4 result |
| --- | --- |
| CR-001 / CR-008 | Native automatic/manual Save, frontend remount/time controls and fresh receipt/database paths pass. CR-008 build verification reopened by REG-P4-001; original time-loss defect not reproduced |
| CR-002 | Registry-owned slot/provider shutdown, selected-radio power context and fake release/late callback tests pass; physical watchdog/release remains unverified |
| CR-003 | fldigi owned-release, unowned lifecycle, pending text/TX/Stop, uncertain retry and invalid-bundle tests pass; actual fldigi/RF remains unverified |
| CR-004 / CR-005 | Paired Host historical-import replication/reopen/correction/delete and concurrent serial-floor/replay tests pass; old cached/issued receipts retain documented limits |
| CR-006 | Independent WAE arithmetic and explicit legacy-policy adoption/replay/export gate pass; no production adoption or new sponsor currency claim |
| CR-007 | Python local ESM/function-key audit and Rust recorder admission/bookmark fixtures pass; no real audio capture/backfill |
| CR-009 / CR-011 | Retained import atomicity/rollback/dedup/limits and complete frozen export beyond 2,000-row UI cap pass; retained app compiles; native chooser/latency remains open |
| CR-010 | Both captured radio/KPA500 output on/off attribution controls pass; no meter calibration |
| CR-012 | Pinned schema-vocabulary/deprecated USERDEF round trips and legacy-input controls pass; full-XSD limitation retained |

The source/fixture results support continued development, with no reproduced return of an original functional defect in the exercised paths. They do not support release readiness. Next remediation should restore the reproducible clean frontend build, repair the process bootstrap for the current contest engine, resolve strict actor-default checking and investigate NAQP arming/keyboard admission. Review dependency patches and repeat these gates before qualifying a fresh isolated native candidate. Native UI shutdown/recovery, current-engine browser integration, long-running resources and operator-supervised physical station/provider acceptance remain separate work.

No tested feature was removed, validation weakened, expected result changed or failure concealed. [REMEDIATION_TRACKER.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REMEDIATION_TRACKER.md) records the reopened verification. The wider manual audit in REVIEW_COVERAGE.md remains incomplete; execution coverage does not upgrade its frozen per-file review depth.
