# Final application validation and release readiness — Phase 7

**Recommendation: NO-GO for production release/use of this remediated source.**

**Assessed:** 29 October 2026, Australia/Darwin. Canonical `main` at `b892663915cbc0768b26dc5a7bf7ec116869e409`, equal to fetched `origin/main`; final application inputs remain `f3f6e3dee40af29cb6801ef8ee422c521629e168`, version **1.3.60**. This phase validates and reports; it implements no application fixes and designates no release candidate.

Fresh clean builds and the existing mandatory automated test suites pass. However, **FA-010 remains an unresolved High safety defect and FA-011–FA-017 remain Medium defects**. Three audit counterexamples reproduce on this source. Required native, provider, hardware and recovery acceptance remains incomplete. Passing existing suites therefore satisfies only part of the documented release criteria; it cannot justify GO or CONDITIONAL GO.

No live RF, real radio/rotor/keyer operation, production-data mutation, account-bound provider operation, application installation or deployment occurred. Tests used disposable databases/defaults, fake transports, intercepted HTTP, test DOMs, isolated worker processes and explicitly model-1 loopback Hamlib daemons with transmit disabled. Package-registry and public advisory requests are separate from application provider operations. No installed app or native GUI was launched.

## Repository state and remediation scope

The checkout was clean before work, fetched and updated with fast-forward-only semantics. All **1,838 tracked application/support inputs** match the Phase 6 preservation manifest. The six historical reports remain byte-identical; this report supplies the current chronological disposition. No dependency lock, assertion, timeout, admission rule or production setting was changed for validation.

The remediation comparison `530de4c4..b8926639` spans **34 application/support/test/configuration commits and 79 changed inputs**; the most recent follow-up from `fd774aef` spans 32 inputs. There are **no deleted tracked inputs** in that scope. The [scope record](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/remediation-scope.json) retains exact commits, paths and manifest comparisons. Principal repairs were:

- Canonical QSO timestamp provenance, ordinary pre-flush form navigation, power source labels and native draft/receipt/replay handling.
- Actual routed radio-owner startup/retirement, active power authority fences, and FLEX unconfirmed-release propagation with bounded release-only recovery.
- fldigi owned-release/context handling, retaining pending/uncertain duty and preventing later actions after retirement.
- Historical-import replica identities, repeated-page country hydration, shared serial floors, pinned WAE area arithmetic and local recorder classification.
- Strict atomic retained ADIF import, complete frozen export beyond the display cap, and deprecated ADX fields preserved as USERDEF.
- Saved Wavelog destination/restore consent, unsaved-settings rejection and grid-only automatic persistence.
- Reproducible frontend toolchain, Swift actor-default construction, Windows wire primitives/durable publication, current Python worker acceptance, runtime provenance and CI test discovery.
- Reviewed compatible Rust dependency patches, four explicit patch floors and stronger regression/acceptance oracles.

Swift product names, Tauri configuration and runtime JavaScript dependency names remain unchanged. The only package-script change broadens Node test discovery. Current builds and regression suites cover the retained products. **This is not proof that every legitimate workflow was preserved:** the eight remaining defects themselves identify incomplete behavior, including hidden Stop recovery and missed power capture. No wholesale functionality removal was identified; WSJT-X Reply and unqualified automatic CW spotting/decoding boundaries were not newly enabled or disabled by this phase.

Original `node_modules` and CW directory inodes are preserved, and all **180 original dist files** were restored with identical hashes after fresh npm validation. New build products remain under the initially absent `.build/phase7-validation-20261029-b8926639`; no old build tree was cleaned or discarded. The [preservation receipt](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/preservation-validation.json) binds source, reports, fixture integrity, exports and process cleanup.

## Fresh clean builds, tests and analysis

Environment observed anew: Darwin 27.0.0 arm64; Apple Swift **6.4**, `swiftlang-6.4.0.34.1`, target `arm64-apple-macosx27.0.0`; Node **24.11.1**, npm **11.6.3**; explicit Homebrew Python **3.12.13** and generator Python **3.14.3**; Rust/Cargo **1.98.0**, Clippy **0.1.98**. The npm lock supplies TypeScript 5.9.3, Vite 8.3.4 and Vitest 5.0.3. All check receipts start/end at `b8926639` with an empty source diff.

Every major build used a new named build root/profile: native tests, portable tests, strict Swift, native release, TSAN, pure IQ and release worker; Rust's first test compiled dependencies into a new target, with later Rust checks reusing only that target. Frontend used a fresh ordinary `npm ci`, followed by the unchanged test/build commands. These are fresh source builds, not `--skip-build` reuse of Phase 5 test binaries.

| Check | Actual fresh result | Evidence boundary |
| --- | --- | --- |
| Native Swift complete suite | **PASS**, 330 XCTest / zero XCTest skips; Swift Testing summary **340**, with 12 named disabled tests | Fresh build/test, 381.223 s. Swift Testing summary includes its skipped cases; not 340 additional executed passes. |
| Portable Swift complete suite on macOS | **PASS**, 1,191 XCTest including **6 skips**; Swift Testing summary **541**, with **7 disabled** | 776.434 s. Portable source configuration on macOS; no Linux/Windows GUI or hardware inference. |
| Complete frontend + Node | **PASS 4,742 Vitest / 339 files + 6 Node**, 850.310 s runner | Single unchanged complete run; no timeout/assertion weakening. Native bridge mocked in component tests. |
| Clean frontend build | **PASS** TypeScript, Vite and all 24 window graph/budget gates, 36.638 s | Fresh lock installation; Logbook **405,194 / 405,200 bytes**, only **6 bytes** headroom. |
| Complete Python | **PASS 558**, 415.692 s runner | Current isolated Host/store/parser/replica/scoring/recorder tests; includes seven security-policy cases. |
| Complete locked Rust | **PASS 924 unit + 31 integration**, 708.987 s | New target, zero reported ignored; two silent Hamlib opt-ins subsequently exercised explicitly. |
| Rust `contesting-test` binary | **PASS 931**, accepted R2 receipt, 32.127 s | Original attempt lacked completed runner receipt and is not accepted as a pass. |
| Explicit Hamlib dummy integration | **PASS 31 integration + selected two-slot case** | Model 1, loopback/private config, TX disabled. Installed Homebrew daemons, not packaged helpers or a physical rig. Counts overlap default suite. |
| Strict portable Swift concurrency build | **PASS exit 0**, 106.937 s | Complete checking/warnings enabled for the portable source configuration under current language mode; warnings remain below. |
| Strict native SwiftUI configuration | **PASS exit 0**, 53.742 s | Separate fresh native source build with the same complete-concurrency/warning flags; five source warnings, zero source errors. No native launch. |
| Native application release compile | **PASS**, `swift build -c release --product om0rx-xlog`, 125.023 s | New native-release tree; compile only, no signed/installed candidate or launch. |
| Rust release / Clippy | **PASS exits 0**, 600.335 / 155.853 s | Backend compile/static analysis, not complete Tauri packaging or warning-free acceptance. |
| Thread sanitizer | **PASS 71 XCTest + 21 Swift Testing**, 286.905 s including clean build | Selected ownership/power/restore/settings/sync paths; no finding in those paths, no general race-freedom claim. |
| Pure IQ portability slice | **PASS 15 XCTest**, 31.965 s | Source-slice check on this host, not a real DAX/TCI stream/device. |
| Fresh release worker + framing | **PASS** clean worker 276.234 s; framing **8 real process tests**, 1.779 s | Test-only CLI worker/bootstrap; no application GUI. |
| Current Python worker scenario | **PASS**, 81 JSONL exchanges, ordinary restart/replay, four exact ADIF/Cabrillo exports, 20.269 s | Actual Swift worker and application-relative staged Python **3.12.4** engine; **Rust host and native UI are not exercised**. |
| All current contests | **PASS 97 plugins**, 1,353 finite checks / 5 NOT APPLICABLE; **393** family tests | Fresh dynamic catalogue without fixture-cache consumption; family counts overlap Python. Per-plugin limitations below. |
| Append/rebuild, generator, corpus | **PASS 127**, corrected generator **42**, pinned corpus **94 upstream / 16 previews** | Retained initial generator setup failure; explicit corpus pin and environment restored without changing assertions. |
| Relocation / reviewed floors / ADX names | **PASS 12**, four patch floors, **179/179 names** | Narrow provenance/policy/vocabulary checks, not complete bundled-runtime security or full XSD scalar certification. |
| Fresh data integrity and exports | **PASS six private databases**, zero foreign-key violations; four worker exports match bytes/SHA | Four worker databases plus two real-Host counterexample databases, checked read-only. No production migration/crash test. |
| Security observations | npm audit: **zero advisories**; OSV queried **549 locked registry versions** with verified TLS | OSV retains conditional GLib and maintenance matches; command completion is not a clean security verdict. |

The [command ledger](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/COMMANDS.md), [results](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/results.json) and raw compressed logs retain exact argv, cwd, explicit environment, UTC boundaries, actual exits and SHA256. The 26 named standard local build/test/analysis/advisory commands all have successful completion receipts; additional probes, CI metadata fetches and failed setup attempts are separately classified. Counts overlap across targets, configurations and controls and are not a unique application-test total.

### Compiler warnings and static findings

No compiler error blocked the accepted builds. Strict portable Swift emits **119 source warning headers / 112 distinct path-line-column-message diagnostics**, chiefly non-Sendable dictionaries/tasks/results crossing actor boundaries, captured `self`, closure Sendability and sending values between actors. There is also an unused importer binding. The separate strict native SwiftUI build emits **five source warnings**: four Timer properties accessed from nonisolated deinitialization and one sending-closure diagnostic. Both configurations have zero source errors. Many diagnostics explicitly become errors in Swift 6 **language mode**; running Swift compiler 6.4 with this manifest is not Swift 6 language-mode certification. No diagnostic was suppressed. These warnings require concurrency migration/qualification; TSAN's bounded pass does not dispose of them. [Exact warning record](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/swift-qualification.json)

Clippy exits 0 under the existing policy with **62 emitted diagnostic headers** across target summaries, including duplicates: dead code, argument/type complexity, unnecessary borrows/clones, stylistic simplifications and a guarded unwrap/constant assertion. The release Rust build retains five unused/dead-code diagnostics. No `-D warnings` acceptance is claimed. Frontend retains a React unawaited-`act` fixture warning and Vite's large-chunk warning (Map approximately 1,089 kB); the explicit application bundle gates still pass. Six bytes of Logbook headroom remain a reproducibility risk across toolchains.

### Skips, unsuccessful attempts and environment boundaries

- Native Swift's 12 disabled cases are the generated award-scale test and 11 FTP/FTPS server cases. They were exercised in earlier Phase 4 evidence but **not freshly enabled here**.
- Portable XCTest skips comprise three synthetic merge benchmarks, browser/LiveWorker acceptance, live official SCP download and Windows Credential Manager. Its seven disabled Swift Testing cases cover optional query/large-log/durable-Save/spot benchmarks, public propagation, provider-comparison and account-bound remote history. These remain outside the fresh default pass; credentials were not read.
- Rust's default counts include two silent opt-in returns. The explicit dummy tests close only the model-1 loopback boundary, not physical or packaged-helper acceptance.
- The first generator run executed 42 cases with 10 failures because `CONTEST_SW_ROOT` was omitted. Correcting only that environment produces 42 passes. Both receipts remain. The incomplete first Rust feature log displays 931 passes but lacks an exit receipt; only R2 is accepted. Its disappearance cause is unproved.
- Some lean-ctx reads/dispatches hit a tool-layer 120-second timeout while durable tests continued. The outer Swift background status later expired; all nine individual Swift/process commands nevertheless have completed exit-0, source-bound receipts. No test pass is inferred from an expired job handle, and no incomplete log substitutes for an exit receipt.
- Previously blocked custom Swift proof executables and cargo-audit were not retried, wrapped or bypassed. No environment restriction was removed to obtain a passing result.

### Cross-platform CI

A fresh test-only [Contest portability run 40816487097](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40816487097) completes **SUCCESS on exact `b8926639`**: all three Swift OS jobs, all three native Rust OS jobs and the generator/security job pass independently. Each native job runs the bounded export/admission/passive-read/module/durable/restart/shutdown groups (24/7/1/16/3/6/7 cases); generator/security runs 42 generator and seven patch-policy cases. Swift jobs execute their declared source-slice/discovery/filter matrix. This is not a full desktop suite on every OS. Own job/step conclusions, complete fetched logs, annotations and source binding are retained in [platform validation](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/agents/platform/VALIDATION.md). Action-runtime deprecation and runner-capacity notices remain distinct from application failures.

No operator packaging/release workflow was dispatched. macOS source builds, the worker bootstrap and the platform test matrix do not establish current Linux/Windows packaged GUI/runtime, signing, notarization or installed-candidate acceptance. Prior CI's skipped runtime/package jobs remain skipped, not passed.

## Remaining confirmed findings and unresolved High review

No confirmed Critical finding exists in the reviewed reports/current evidence. Original High roots CR-001 (manual Save provenance), CR-002 (wrong lifecycle owner), FA-001 (ordinary restore destination) and FA-008 (ordinary settings authority, including autofill bypass) remain repaired within their original source/fixture scope. Fresh transaction/draft/registry/restore/destination tests support that conclusion. Their adjacent new gaps are kept distinct.

| Finding | Severity / current status | Release implication and remaining evidence |
| --- | --- | --- |
| **FA-010** | **High — Not Fixed** | Explicit fldigi Stop can throw on configuration save before attempting `main.rx`. Current source rechecked at [save-before-RX](/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogPrototypeSupport/LiveFldigiBridge.swift:204). Existing writable-storage tests do not exercise it. Source-confirmed; deterministic runtime fault test still required. No physical RF consequence is claimed. **Release-blocking.** |
| FA-011 | Medium — Not Fixed | Direct-agent owned release failures are discarded, duty cleared and retirement reported clean. Correct owner routing/FLEX tests do not cover this producer. Source-confirmed; injected agent failure through EOF/outcome still required. |
| FA-012 | Medium — Not Fixed | Connect-before-registration permanently retains nil power callbacks; ordinary reconnect reuses them. Fail-closed capture gap, not demonstrated wrong-radio watts. Legal source interleaving; deterministic scheduling regression absent. |
| FA-013 | Medium — Not Fixed; reproduced | Automatic primary-prefix repair emits `reference_reconcile` with incompatible identities/kind; actual two-Host catch-up rejects it. Fresh proof retains full client dump unchanged. Blocks subsequent replica catch-up while rollback protects existing rows. |
| FA-014 | Medium — Not Fixed; reproduced | Reversing a timestamp edit restores automatic intent but Full retains historical display buffer. Three unique rendered requirements fail; Desk/remount controls pass. Native Save behavior is simulated from inspected source, not a new SQLite UI execution. |
| FA-015 | Medium — Not Fixed; runtime unverified | Separate component installers can read different valid packages from a concurrently replaced URL. Individual seals/rollback survive; external replacement is required. Source-confirmed; compiled prior driver remains unexecuted. |
| FA-016 | Medium — Not Fixed; runtime unverified | Native restore can be interrupted after DB publication and before new destination settings. Persisted sync pause is a safeguard, but later manual sync can use old authority. Source-confirmed; no crash/power-loss/provider reproduction. |
| FA-017 | Medium — Not Fixed; reproduced | Fulfilled unconfirmed fldigi Stop response is discarded; UI reports disarmed/hides its dedicated retry, and Main Escape reaches CW instead. Fresh actual component/owner test fails uncertainty assertion; confirmed-Off control passes. Backend still blocks new transmit; no RF claim. |

All eight remain the [Phase 6 findings](/Users/oliver/Documents/Projects/OM0RX-xLog/FINAL_CODE_AUDIT.md:21); this phase makes no new application-regression or repair claim. FA-013 uses actual current Python Hosts. FA-014/017 use actual React/session/owner code with source-bound native/backend fakes. **Three findings have executed counterexamples; five remain source-confirmed with runtime verification pending.** A successful checker exit for FA-013 means it observed the expected defect. Scratch intended-behavior failures were not converted into passing tests.

The fresh frontend selector `reversal.test.tsx` also includes the detached file; the later detached run repeats those cases. Across those timestamp/fldigi scratch files there are **seven unique executed cases: four failed requirements and three passing controls**. The 195 skipped old Not1MM cases in the narrow scratch run already pass in the complete suite. New counterexamples expose missing coverage rather than contradicting the bounded original repairs.

## Database, configuration and critical workflow matrix

PASS means the stated automated boundary passed. PARTIAL/FAIL/UNVERIFIED is preserved at the product boundary; none means physical integration passed.

| Workflow | Current automated evidence | Product-level result / remaining requirement |
| --- | --- | --- |
| Startup/shutdown/module switching/state recovery | Fresh startup/profile/admission/child lifecycle, EOF/restart, receipt/journal and native routing tests | **PARTIAL:** FA-011/012; no actual native Quit/unsaved-work guards, cancelled restart or OS interruption. |
| QSO create/edit/delete/undo and concurrency | Fresh SQLite transactions, revision/replay/rollback, detached/session and worker correction/delete/restart tests | **PARTIAL:** FA-014 display/Save discrepancy; native Main/detached cross-window interaction and crash/scale UI remain unqualified. |
| Import/export/data preservation | Fresh malformed/truncated/UTF-8/duplicate/atomic rollback and retained 2,003-row export; actual worker four exact exports; 179-name ADX check | **PARTIAL:** native choosers/very large file responsiveness, full XSD scalar and downstream-tool acceptance; no production rewrite. |
| Database migrations and legacy formats | Current Python interrupted-upgrade/serial ledger, Swift v1/v2 session/QSO/reservation/counter/receipt migration, rollback/read-only snapshots/reopen tests | **PASS fixture compatibility**, not arbitrary real-world migration/power-loss certification. Missing historical identity still fails closed; issued receipts remain immutable. |
| Settings/profiles/sync destination | Fresh legacy-mode/default/invalid-mode and six restore/nine destination cases, including tombstones, unavailable DB and grid-only writer; intercepted history | **PARTIAL:** FA-015/016; no native interrupted restore, installed UserDefaults/Keychain/provider or production data. |
| Replica/serial/scoring/recorder | Complete Python, paired peers, floor/replay/reopen/country hydration, WAE and recorder tests; real worker exact receipts | **FAIL:** FA-013 blocks supported catch-up. Existing divergent peers/old conflicting serial receipts need reviewed recovery, not silent history rewrite. |
| All catalogue contests, awards/lookup/analytics | All 97 finite lifecycles and 393 overlapping family cases; normal lookup/award fixtures and UI tests | **PARTIAL:** 26 country and 10 zone view dimensions across 27 plugins UNVERIFIED; all 97 retain unverified current sponsor/category coverage, packaged GUI and submission acceptance. |
| DX cluster, band/DX maps, spot-to-radio | Fresh parser/session/filter/map/spot/ownership/admission suites and pure IQ/source checks | **PARTIAL:** no public cluster session, physical QSY/rotor, detached native map/GPU or sustained live feed. |
| CAT/remote agent/FLEX/TCI and power | Fresh fake-provider, selected-authority/release/readback/late callback tests plus explicit model-1 dummy daemons | **PARTIAL:** FA-011/012; no real frequency/mode/split/watchdog/reconnect/sleep, FLEX DAX/IQ identity or SunSDR2/ExpertSDR stream. |
| fldigi/digital/CW output and Stop | Fresh fake RPC/ownership/pending/uncertainty and native acquisition/admission fixtures | **FAIL:** FA-010/017. No real engine instance, receiver/PTT state or emergency-release latency measured. |
| CW decoding/audio/logging/spot integration | Existing deterministic worker/parser/bridge/UI regression suites, TSAN and pure IQ slice | **UNVERIFIED operationally:** no live audio/device, held-out whole-call corpus, false-spot calibration or 8–24-hour loaded soak. Prior sanitizer/oracle/60-second profiles are dated evidence, not fresh full resource acceptance. |
| External services/security/errors | Fresh mocked HTTP/TLS/recovery/notification/admission paths, npm/OSV observations and four patch floors | **PARTIAL:** no Wavelog/QRZ/LoTW/Club Log/cloud/FTP account or OS credential acceptance; UI uncertainty gap remains. |

The [data/configuration matrix](/Users/oliver/Documents/Projects/OM0RX-xLog/docs/reviews/release-readiness-2026-10-29/agents/data/migration-data-config-compatibility.json) and per-reviewer reports preserve concrete tests and boundaries. Automatic consent is paused/retired by ordinary restore safeguards; this does not solve cross-component identity or interrupted native publication. No bulk timestamp correction, receipt rewrite, automatic replica rebaseline, linked-ID stripping or station-profile migration was performed.

## Security and data integrity risks

Fresh npm audit reports zero known advisories for its graph at query time. Fresh verified-TLS OSV queries cover 549 locked registry package versions and return six package matches/seven raw IDs. Triage is:

- **Conditional Linux GLib 0.18.5 risk — DEP-P5-003 remains Blocked.** Its VariantStrIter implementations fall in the affected range; the fixed line starts at 0.20, incompatible with the current GTK dependency API. Direct application use was not found and affected transitive reachability remains unproved. This does not establish a macOS exploit or qualify Linux GTK runtime safety. [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- **block-buffer 0.10.4 is outside the current maintainer affected range** (>=0.11.0,<0.12.1); retain the raw OSV match without counting it as an application vulnerability. [Maintainer advisory](https://github.com/RustCrypto/utils/security/advisories/GHSA-qwgh-2vcv-g2f7)
- proc-macro-error, zbus_names, zvariant and zvariant_derive retain maintenance notices/upstream migration debt. No seven-vulnerability application count is inferred from the raw alias-inclusive results.

The four reviewed Rust patch floors pass. Dependency observations do not cover every native binary, CPython/ONNX/model, OS library, credential path or supply-chain/license question. Linux stack migration or a qualified upstream backport needs its own affected-caller, build and GUI tests. macOS/Windows observations do not close that blocker.

Data risks remain concretely represented by FA-013–016: catch-up unavailable, UI time discrepancy, mixed backup component acceptance and restored data under the wrong saved authority after interruption. Recovery copies and transaction rollback reduce loss but do not eliminate those mechanisms. No physical-crash durability or production-configuration compatibility claim follows from clean fixture integrity checks.

## Accuracy of previous reports

| Report | How its result is used now |
| --- | --- |
| [CODE_REVIEW.md](/Users/oliver/Documents/Projects/OM0RX-xLog/CODE_REVIEW.md) | Original 12 root causes/second-pass evidence; its 58da5d49 successes are historical, not current blanket release acceptance. |
| [REVIEW_COVERAGE.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REVIEW_COVERAGE.md) | Frozen 2,347-file inventory remains incomplete. Passing execution does not upgrade partial/scanned/unreviewed files; Phase 6's 79-input scope is separate. |
| [REMEDIATION_TRACKER.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REMEDIATION_TRACKER.md) | Original and nine follow-up scoped repairs hold. Its “unconditional emergency RX” description is contradicted by FA-010; all-fixed wording applies to that historical set, not FA-010–017. |
| [REGRESSION_TEST_REPORT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REGRESSION_TEST_REPORT.md) | Phase 4 failures, setup issues and resource observations are retained. Build/concurrency/bootstrap defects later repaired are not presented as current failures; later data/radio findings supersede its earlier bounded assessment. |
| [STABILITY_REPORT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/STABILITY_REPORT.md) | Source-bound prior builds/24 local gates/CI and known limits remain valid dated evidence. Its broad convergence conclusion is superseded by the later eight findings and reproduced failures. |
| [FINAL_CODE_AUDIT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/FINAL_CODE_AUDIT.md) | Current eight findings remain open. Its distinction between three executed counterexamples and five source-only runtime-unverified mechanisms is preserved; compile-only/stale/blocked binaries never become passes here. |

All six reports were reviewed and their hashes preserved. Fresh receipts distinguish actual process exits from tool timeouts/orphan logs, skip/early-return counts from executed acceptance, and standard passing tests from deliberately failing new requirements. No report is rewritten to erase a failed historical run. No confirmed new application regression was identified during this source-unchanged phase.

## Release criteria and next steps

| Documented criterion | Phase 7 disposition |
| --- | --- |
| Current clean canonical source and provenance | **PASS:** exact main/origin at entry; source hashes and new clean roots recorded. This is source/build provenance, not an accepted installed candidate. |
| Clean builds and mandatory automated test suites | **PASS in recorded scope:** complete local suites/builds and the fresh seven-job OS portability matrix succeed; warning/skip and platform runtime boundaries remain explicit. New acceptance requirements still fail. |
| No unresolved release-blocking Critical/High | **FAIL:** FA-010 High remains. No Critical defect established. |
| All safely fixable defects/regressions addressed | **FAIL:** eight open findings; this phase applies no fixes. Prior specific repairs remain verified. |
| Data/configuration compatibility and no unintended behavior loss | **PARTIAL/FAIL:** legacy fixture compatibility passes, but FA-013–016 and incomplete native acceptance prevent full confirmation. |
| Complete required validation matrix | **FAIL:** installed/native, real providers/hardware/RF, interruption, resource and platform runtime qualification incomplete. |
| Security/runtime/distribution acceptance | **INCOMPLETE:** conditional Linux GLib, warning migration, native/runtime supply-chain, signing/notarization/installer/update/rollback acceptance remain. |

Before production use:

1. Return FA-010/017 to Phase 5 first: release attempts must survive settings failure, and uncertainty/retry must reach the UI without enabling new transmission. Then repair agent retirement/registration (FA-011/012), replica event compatibility (FA-013), immutable restore/recovery authority (FA-015/016) and timestamp reversal (FA-014). Add their precise missing regressions and rerun affected/full checks on the repaired exact source.
2. Qualify native launch/quit/module transitions, preserved unfinished work, cross-window Save/edit/delete/Undo and native import/export/restore/settings using disposable roots. Verify exact process/isolation coordinates before GUI binding as required by AGENTS.md. Add controlled interruption/relaunch tests on private copies; never use production data for destructive trials.
3. Complete operator-supervised receive-only radio/provider checks: both slots, CAT frequency/mode/split, disconnection/reconnect/sleep, FLEX identity/DAX/IQ, SunSDR2/TCI dual receiver and engine identity. Output/release/readback and watchdog acceptance require a separately authorized controlled station setup; no physical transmit safety is certified here.
4. Complete account/credential and external-consumer validation, decoder corpus/calibration and combined 8–24-hour resource/latency/cleanup soak. Retain disabled or unavailable capabilities honestly until their own criteria are met. Finish Windows/Linux runtime/credential/GUI and conditional GTK security qualification.
5. After repairs and matrix completion, create one explicitly designated candidate from clean canonical source with an advanced unique version and exact build provenance, then complete signing/notarization, package/runtime/license/update/rollback and separately authorized installation acceptance. No current test executable or worker bootstrap is a production release candidate.

This phase adds validation evidence and this readiness report; it resolves no application defect. The earlier remediation substantially improves tested behavior, and current source builds reproducibly in the tested configurations, but the unresolved safety/data/UI defects and incomplete qualification require **NO-GO**. The recommendation does not claim the application is flawless or that remaining untested paths are defective.

## Implementation follow-up — batch A, 29 October 2026

The assessment above is preserved at its original source. The implementation follow-up starts from clean canonical `main` at `86a971e0338a7ce6432607f5648dfc1c23ec2a68`, application baseline `f3f6e3dee40af29cb6801ef8ee422c521629e168`. It does not operate or promote the earlier `0c572702` candidate or any existing 1.3.60 bundle.

**Current recommendation remains NO-GO.** FA-010 and FA-017 now have implemented repairs and demonstrated targeted regressions: independent RX despite storage failure, memory revocation, retained pending-release duty and truthful UI recovery. The backend negative control executes and fails before correction; the promoted UI counterexample and affected frontend/native schema tests pass afterward. [Tracker](REMEDIATION_TRACKER.md) and [source-bound command evidence](docs/reviews/remediation-fa010-fa017-2026-10-29/COMMANDS.md) give the scope and failures, rather than treating the earlier green suites as current acceptance.

FA-011–FA-016 remain open at this batch boundary. Final coherent-source builds, mandatory regression gates and relevant disposable native workflows are pending. RPC acknowledgement does not establish physical RF state. A cold failed WSJT-X snapshot still makes the combined setup dialog unavailable, while independently retained main/operator fldigi recovery remains available. Compiler/concurrency warnings, the six-byte Logbook budget margin, conditional Linux dependency risk, hardware/provider/recovery and platform/distribution qualification remain explicit release limits. Production, installed applications, configuration, backups and recovery artifacts have not been operated; no package/install/release has occurred.

### Replica reconciliation repair — implementation follow-up

FA-013 now has a demonstrated repair: new events retain full identities, historical events use validated audit evidence for conservative wire projection, and actual paired Hosts complete catch-up, later mutations, replay and reopen. Closing targeted verification passes 62 cases, including ten new regressions. The original rejection and an intermediate incomplete fallback are preserved in [command evidence](docs/reviews/remediation-fa010-fa017-2026-10-29/COMMANDS.md); the [tracker](REMEDIATION_TRACKER.md) records the exact scope.

Historical audit/receipt bytes remain unchanged. An already-issued old page still replays its old result; a fresh request at the same cursor is needed for compatible publication. Missing historical proof produces a specific recovery diagnostic and cannot be skipped or silently rebaselined. FA-011/012, FA-015/016 and final FA-014 acceptance remain outstanding. **NO-GO remains in force** with the earlier hardware/provider/native/distribution/security qualifications and the pending coherent-source gates.

### Timestamp display/Save repair and frozen component gates

FA-014 now has the one-line editor repair, eight rendered reversal regressions and three executed native SQLite/handler cases (two functions). Automatic display returns to the live clock after reversal; real Save retains automatic button-time semantics, manual historical time, OTHER metadata, receipt replay and reopen. The [tracker](REMEDIATION_TRACKER.md) distinguishes separate rendered/native layers from unperformed live GUI acceptance.

Fresh-lock frontend verification passes 4,760 Vitest cases across 339 files plus the Node helper suite, unchanged build/window budgets and npm audit with zero reported npm vulnerabilities. All 794 component inputs remain identical throughout; original dependencies and 180 generated files are restored. The complete Python suite passes 568 tests on its frozen repaired component. These component results can be reused only while their input hashes remain unchanged; remaining Swift repairs and whole-application closing gates are still pending. **NO-GO remains in force.** No package/install/promotion, live provider action or physical-radio qualification follows from these results.

### Agent retirement and registration repair

FA-011/012 now propagate real-client release uncertainty through the actual registry/worker, retain the original release owner, seal replacement/acquisition, and attach late power registration to the existing connection. Ten maintained real-client/intercepted-transport tests pass, including both slots, held acquisition, strict recovery admission and measured-packet chronology. The [tracker](REMEDIATION_TRACKER.md) records the executed original failures, an intermediate power assertion failure, deterministic wire-clock controls and the remaining causal qualification for that earlier run.

Closing focused verification passes 59 XCTest cases (one helper skip) plus 37 Swift Testing functions. This is protocol/native-code verification, not a physical release or power-meter certification. EOF exit74 still requires station inspection and has no post-exit recovery channel. Restore repairs are awaiting their final source commit/whole-application checks; **NO-GO remains in force** with the outstanding native, hardware/provider, security and distribution criteria.

### Immutable restore and interrupted-authority repair

FA-015/016 now have implemented and executed repairs through the actual native restore owner and modern handler. Source replacement no longer mixes DB/contest/reference components. Staged SQLite binds its selected destination; a durable incomplete journal blocks startup and automatic/manual sync before requests, including overlapping remote IDs. Controlled child interruption, matching sync, guarded unlinked rebind, linked rejection and recovery retention are tested. A newly introduced >512MiB legacy capture rejection was reproduced against a passing old streamed control and corrected with an owned file-backed snapshot; legacy integrity limits and sealed/remote bounds are retained. The suspected absent-reference path was already guarded and is recorded as a passing control.

The latest focused command passes59 XCTest cases (one helper skip) and37 Swift Testing functions. All eight FA-010–FA-017 mechanisms now have demonstrated scoped repairs in the [tracker](REMEDIATION_TRACKER.md), with exact failures and commands retained in [evidence](docs/reviews/remediation-fa010-fa017-2026-10-29/COMMANDS.md). **NO-GO remains in force:** final source-frozen clean builds, full Swift/native checks and relevant worker/resource/analysis gates are pending; GUI, physical-radio/provider/recovery, conditional Linux security and distribution criteria are not inferred from focused success. No packaging, installation or release has been performed.
