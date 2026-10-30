# Final application validation and release readiness — Phase 7

> **Current closeout — 30 October 2026: scoped macOS baseline 1.3.63 INSTALLED AND VERIFIED**, exact source `19508f4f58eeadea381bc589c56d9bd0a29b2afe`. **Public/all-platform release remains NO-GO**; hardware/provider restrictions and failed/unverified qualifications remain. See [final disposition](#review-closeout--30-october-2026).

**Separately authorized CW completion — 30 October:** the existing W16 /
NL-06–NL-10 programme is active under its unchanged two-span/32-track Mac scope.
Retained work is integrated in main `f99fc51d`; `e5788759` repairs actual Flex
per-band settings/RX handling. [The single completion checklist](docs/cw/COMPLETION.md)
owns remaining core gates and frozen acceptance targets. The user authorizes
package/notarization/installation after those gates pass. No CW candidate is
installed or production capability enabled by this checkpoint; the accepted
1.3.63 bundle and its preservation/rollback record below remain unchanged.

31 October timed-RF follow-up: diagnostic offsets no longer authorize RF actions;
actual carrier samples, receive-relative ages and immutable track capture clocks
are enforced. Focused session/policy 35/35, native CTest 2/2 and view/projection
25/25 pass. The first timed-RF real-child suite is **18/19**, with replay input
279.6405 ms late against the unchanged 250-ms limit. After byte-identical binary
IQ framing improvements, the latest complete suite passes **20/20**, including
the real-rate replay. No installed or full-scope CW acceptance
is inferred from these checks. Bounded startup batching remains a failed private
experiment; its strict load failures are retained in CW diagnostics.

The source-fault follow-up retains bounded Flex/TCI reasons, avoids retrying
operator-required faults and fences awaited old-lease cleanup after a new Start.
All 70 focused native/provider/session checks and 30 view/projection checks pass,
with frontend/window budgets passing. This preserves separate hardware, strict
capacity, real-corpus, elapsed-soak and exact-package gates in the CW checklist.

Independent span Stop/restart now preserves the other receiver and shared child,
binds session/source identities and waits for held lease cleanup. TCI cancellation
is checked before/after IQ sends; canceled acquisition cannot cancel its own Stop
send. All 79 focused Swift, four native authority/timeout/isolation and 32 view
checks pass, with frontend/window budgets passing. Live resource release remains
unverified; no production capability or installed version changes.

31 October CW source progress: durable original draft-action reconciliation,
actual slow-client isolation and offline relocated component-payload checks pass.
CPU, bounded static-CoreML, GPU and tensor-preserving attention-fusion candidates
retain strict capacity failures; diagnostics preserve each measured result.
Native callsign actions now require fresh qualified RF (`b307a624`); a child RSS
guard releases receive leases without automatic reacquisition after memory faults.
Replay deadline misses remain recorded; the later 18-case real-child harness
and enhanced call-RF replay pass with the original 250-ms deadline. Spots now
retain timed self-ID carrier measurements and exact queued-payload proof;
32 focused session/policy cases pass. These do not qualify real RF or capacity.
Overload now invalidates affected
text revisions and queued-publication proof, with focused regressions recorded in
the CW checklist. AetherSDR has native TCP access, while a raw five-second UDP
4992 probe receives zero discovery datagrams. Actual radio spans/RF, held-out
quality, 8h/24h elapsed stability, exact application package
and installed CW acceptance remain open within this scope.
The source-level external-client protocol slice now passes using installed GNU
Telnet 2.2: two isolated loopback sessions, live synthetic fractional/slash output,
original UTC history and reconnect. This is separate from exact-app acceptance.

**Historical 29 October banner (superseded only by this authorized closeout):**

> **Current status — 29 October 2026: NO-GO. FA-010–FA-017 and NA-001–NA-005 are repaired within their documented scopes.** The [latest everyday logging disposition](#everyday-logging-native-acceptance--29-october-2026) records final tested source c09ecfdd: Normal file export and Edit last pass after narrow repairs; exact native timestamp reversal remains unverified. Older open-finding and acceptance sections are dated historical evidence. No installation, candidate packaging or release promotion is authorized.

**Historical Phase 7 assessment of `f3f6e3d` follows.** Its then-open findings and failed evidence are retained, not the current finding disposition.

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

### First closing iteration — failures preserved

Clean native/release/concurrency builds, complete locked Rust (925 unit/31 integration; feature configuration932), Clippy, optimized restore/Save and fresh worker acceptance pass on their recorded inputs. The complete portable suite and hosted prototype independently fail a late-acknowledgement/closed-database case: the new FA-016 validator masks `syncRunChanged` with a SQLite error. A locked guard and explicit regression now pass focused sync/restore controls. Two timestamp test assertions also required compatibility with CI's older macro expansion. The sanitizer child required loading its existing instrumentation runtime at process startup; one corrected controlled-child case executes successfully. All failed and setup-only runs remain archived. The exact-source full closing rerun is pending; **NO-GO remains in force**. Automatic hosted CI package steps are separate from an explicitly designated operator candidate; no operator packaging workflow was dispatched and no existing1.3.60 bundle was installed or promoted.

## Final implementation disposition — 29 October 2026

**Current recommendation: NO-GO for production release or promotion. FA-010–FA-017 are individually Fixed and Verified in their documented test scopes.** The earlier open-finding tables are historical assessments of `f3f6e3d`; this section and the [tracker](REMEDIATION_TRACKER.md) supersede their current disposition, while preserving all failed evidence.

Final application/test inputs: `c8cc1a134ee7fdacfb4b389f1648b47e18a059a1`. Final clean validation HEAD: `280f6db21c2bc7ccbf465cfa90beaa1a13af1bcb` (documentation-only difference). The [1,843-input manifest](docs/reviews/remediation-fa010-fa017-2026-10-29/final-source-280f6db2-sha256.json) still matches; 35 inputs changed since entry, with no deleted tracked inputs or dependency-lock changes. Later report commits do not designate new application inputs or candidates. Version remains **1.3.60 source**, with no installed/promoted/relabelled bundle. An eventual candidate requires a new unused version and exact-source acceptance.

The fixes preserve truthful fldigi release/storage state and visible recovery, exact direct-agent retirement and late power attachment, conservative compatible replica history, one immutable restore envelope, durable restore/destination fencing and automatic timestamp reversal. Full-suite verification found and corrected an adjacent closed-database validator regression; CI found a test-macro compatibility error; sanitizer execution found a child runtime bootstrap error. No expected application result, test deadline, security admission, ownership fence or sanitizer instrumentation was weakened.

### Accepted final verification

| Check | Actual result and source boundary |
| --- | --- |
| Clean native complete suite | **PASS:**330 XCTest/zero XCTest skips; Swift Testing332+8 summaries include12 disabled cases. Fresh build,316.800s, exact clean280f. |
| Clean portable complete suite on macOS | **PASS:**1,219 XCTest including7 skips; Swift Testing536+8 summaries include7 disabled cases. Fresh build,749.746s, exact clean280f. |
| Clean native release compile | **PASS:**221.307s, exact clean280f; compile only, no candidate package/launch. |
| Complete concurrency checks | **PASS exits0:** fresh native/portable strict builds earlier, affected closing rebuilds on280f. Existing diagnostics remain qualified below. |
| Selected thread sanitizer | **PASS:**93 XCTest including1 helper skip plus24 Swift Testing,108.911s on280f. Owned interruption child executes with the same startup-loaded runtime. No general race-freedom claim. |
| Optimized restore/Save/reconciliation | **PASS:**24 XCTest including1 helper skip plus5 Swift Testing functions,368.426s on280f. Includes large legacy capture/lifetime and actual SQLite Save. |
| Fresh release worker and acceptance | **PASS:**517.451s build;81 real JSONL operations/restart/replay/exports in42.020s;8 framing process tests in2.146s. Exact280f worker/resources/private roots; no GUI/Rust-host/physical-radio acceptance inferred. |
| Complete frontend and build | **PASS:**4,760 Vitest/339 files plus6 Node helpers;777.887s tests and30.304s build. Fresh ordinary npm ci. All794 frontend inputs remain identical through final source; old dependency/dist inodes and180 original files were restored. |
| Complete Python | **PASS568**,273.585s. Repaired component frozen since its recorded source; final source/catalogue hashes confirm reuse is valid. |
| Locked Rust, feature, release and Clippy | **PASS:**925 unit+31 integration; feature932; release453.173s; Clippy126.050s. Fresh target initially; recorded4ec11 source/build tag is retained. Only three later Swift/test files differ, so Rust/frontend inputs are identical. This is reused component evidence, not a relabelled final candidate. Two default Hamlib opt-in early returns are not physical-radio passes. |
| Catalogue/append compatibility | **PASS:**all97 current plugins,1,353 finite PASS checks/5 NOT APPLICABLE; no fixture cache. Family tests are not rerun by this catalogue invocation (complete Python is separately recorded). Append/rebuild127 cases pass. |
| Dependency/security observations | **PASS** existing four reviewed patch floors and npm audit with0 reported npm advisories. Locks unchanged. Prior conditional Linux GLib/maintenance risk remains; blocked cargo-audit was not bypassed or represented as passing. |
| Retained data and export evidence | **PASS23** disposable SQLite integrity/foreign-key checks on exact working copies;8 original-byte exports match their own issued receipts. Independent scenarios have fresh QSO UUIDs; Cabrillo bytes match across runs and ADIF differs only at that deliberate ID. |

These are22 accepted local/component gates, with83 completed command receipts including negative controls, setup failures and overlapping focused runs. Full raw logs, exact argv/cwd/environment/UTC/exit/source boundaries and hashes are retained in the [ledger](docs/reviews/remediation-fa010-fa017-2026-10-29/COMMANDS.md), [results](docs/reviews/remediation-fa010-fa017-2026-10-29/results.json) and [qualification inventory](docs/reviews/remediation-fa010-fa017-2026-10-29/qualification.json). No incomplete job handle or compiled-only probe is counted as a pass.

Native disabled cases remain the award-scale and11 FTP/FTPS cases. Portable skips include the prior benchmark/browser/live-SCP/Windows-vault boundaries plus the parent-only interruption helper; seven Swift Testing performance/public/provider cases remain disabled. Fresh full strict builds retain **five native** warning headers and **119 portable headers/112 distinct diagnostics**. Closing incremental builds do not erase them. Complete-concurrency checking under the current Swift language mode is not Swift6-language-mode qualification; Clippy, Vite and the six-byte Logbook budget margin also remain qualified. No warning was suppressed and no budget was raised.

### Independent CI and remaining release criteria

[Exact280f CI](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40846367663) passes, and [exact280f Contest portability](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40846611492) passes all seven own jobs. The [automatic prototype run](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40846092150) uses actual `c8cc1a13`, whose application/test/workflow inputs equal280f; its full portable job directly shows the original late-ack test passing. Its source is not relabelled. Operator packaging/upload and Linux/Windows runtime acceptance are skipped; automatic native CI package/resource checks are separate test artifacts. [Own job evidence](docs/reviews/remediation-fa010-fa017-2026-10-29/agents/final-ci-r2/report.md) retains each actual conclusion and the corrected packaging-status interpretation. Earlier5644 macro compilation and4ec11 late-ack failures remain historical failures.

| Release criterion | Current disposition |
| --- | --- |
| Confirmed release-blocking Critical/High roots | **PASS in reviewed scope:** no Critical established; FA-010 High is repaired and demonstrated. Earlier scoped High repairs remain covered. Physical release confirmation is still required. |
| Requested safely fixable defects and regressions | **PASS:**all eight IDs fixed with executed triggers/regressions; closing validator and harness regressions corrected. Individual limits remain in the tracker. |
| Executable mandatory automated checks and supported build | **PASS in recorded configurations:**22 accepted component/local gates and independent CI evidence, with explicit skips/early returns. |
| Data/configuration compatibility | **PASS for exercised cases:**linked identities, matching destinations, legacy large backups, immutable components, manual/automatic interruption admission and recovery retention. Physical crash and live GUI/provider recovery remain unverified. |
| Required native/hardware/provider/resource matrix | **INCOMPLETE:**live GUI-to-engine/SQLite, both-slot hardware CAT/frequency/mode/split/disconnect/sleep, FLEX/DAX, SunSDR2/TCI, fldigi physical release/readback/watchdog, audio/decoder calibration, credentials/providers and8–24h combined soak are unperformed. |
| Security/platform/distribution acceptance | **INCOMPLETE:**DEP-P5-003 conditional Linux risk, warning migration, platform GUI/runtime, signing/notarization, installers/updates and rollback acceptance remain. |

The operational qualifications remain: acknowledgement does not certify RF Off; terminal process loss has no in-process release retry; unsupported replica history needs reviewed recovery; immutable old receipts require a fresh request at the same cursor; legacy v1 gains no invented authentication. Interrupted restore retains journal and recovery copies for review. A cold WSJT-X failure still prevents its combined setup dialog opening, while independently retained main/operator fldigi retry remains visible. Separate rendered/native tests are not one live GUI workflow. Earlier intermittent/timing investigations retain their causal uncertainty.

Before production use, complete the remaining disposable native/manual, supervised hardware/provider and resource matrix, resolve or explicitly qualify security/platform risks, then separately authorize one new uniquely versioned exact-source candidate and its distribution/installation acceptance. This implementation batch stops here. No production data/settings, installed app, recordings, backups, rollback bundle or recovery reference was discarded or promoted; no live RF/PTT/radio/rotor/audio action or production provider write/sync/retry occurred. The evidence supports improved tested-source stability, **not GO or a bug-free application**.

## Bounded offline native acceptance — 29 October 2026

**Latest disposition: NO-GO. All eight FA-010–FA-017 findings remain repaired in their documented scopes.** This authorized native task found and repaired three adjacent defects; it did not begin another general audit, install an application or promote a bundle. The [acceptance matrix and command/evidence index](docs/reviews/offline-native-acceptance-2026-10-29/README.md) and [selected real-window observations](docs/reviews/offline-native-acceptance-2026-10-29/native-observations.md) are the current qualification record. The older open-finding sections above remain dated historical evidence.

Entry checkpoint was clean `6e8bc944870279941c6a9e675037d004c4f9649f`, reconciled once with fast-forward-only semantics. Entry application/test inputs were `c8cc1a134ee7fdacfb4b389f1648b47e18a059a1`. Final tested application/test source is **`e6cab56f50953798f08df8d16142bfc90fd193b1`**: seven assessed inputs changed, none deleted, locks unchanged. Repair commits `e1570231`, `1cb92f8f` and `e6cab56f` were individually pushed. Subsequent acceptance-report commits do not change those application inputs or designate a candidate.

One clean Rust development host was built from6e8 with unchanged Rust inputs through final source. Initial profileA native cases used the verified c8-equivalent worker and e157 frontend. The final entry cases used a fresh universal worker with SHA256 `b3c984c5a38b39f563be7ee45179738fe9d12af34aa647d06a244e946a79a71e`, whose frozen Swift inputs match final source, and the final frontend. The worker's actual earlier build HEAD plus patch is retained, not relabelled. A separate private development layout preserves the earlier one; no retained signed1.3.60bundle was used as repaired code. Source version remains1.3.60; any eventual candidate must have a new unused version.

| Required workflow | Actual result | Remaining boundary |
| --- | --- | --- |
| Normal/Full/Desk/detached entry, Save, replay/reopen | **Native PASS for exercised cases:** final Desk and detached rapid input retains automatic intent and saves at button time; Full manual12:25:08Z survives navigation/remount and SQLite Save. Three UI-issued Save mutations replay through the actual worker without duplicates; native reopen shows exactly3QSOs and separate K5KEEP draft. Original K1UNFIN survives profileA windows/switches/restore/reopen with exact UUID/text. Backend ADIF times agree exactly. | Matching full-canonical timestamp reversal before flush remains **component-only**. The90ms native date-only reversal used an advanced visible clock, produced a different full timestamp and became manual; it is not an automatic-restoration pass. Normal Blob-download persistence is unverified; actual backend export is not that download receipt. |
| Workspace switching and unfinished work | **Native PASS, profileA/e157:** one usable Normal→Contesting→Normal roundtrip, one successful restart per direction, legitimate unfinished-edit refusal, same worker usable after refusal, text retained, native Save resolution, ordinary Quit/reopen. | Exceptional lifecycle regressions reused. Later Normal draft changes have their separate final-source native proof; the whole roundtrip is not claimed rerun after them. One Main Logging “Edit last” attempt did not open a visible editor; the separate inline correction path passed. |
| fldigi Stop, warning, release-only retry, Stop/Escape | **Unavailable native provider qualification.** Restricted output denial was visible. | Offline policy cannot acquire owned fldigi TX duty or return fake Stop responses. Existing fake-RPC/rendered/owner-chain evidence remains component-only; no bypass or production provider used. Protocol acknowledgement never certifies physical RX. |
| Backup/restore and destination authority | **Native PASS for complete Tauri path, profileA/e157:** inspected exact package, all3component options, actual restore/recovery package, usable Desk and ordinary reopen. Seals and main/contest/settings identity pass; no incomplete marker remains. Actual destination is local/stationID0 with automatic sync disabled and no dispatch. | Empty reference cache only; nonempty references, independent live preference readback, incomplete-recovery GUI, linked/overlapping-ID GUI cases and separately retained SwiftUI restore window remain unverified. Earlier controlled-child/component authority tests are reused, not replaced by this unconfigured positive case. |
| Contest reviewed import, correction, native export and replica visibility | **Native PASS, profileA/e157:** reviewed315-byte Historical ADIF import, contact correction and real NSSavePanel export.1853bytes exactly match the contemporaneous reviewed revision6 counterpart, preserving IDs. | No issued native prepared-cache receipt retained; comparison is an independent snapshot export. Log-tools Import reached its chooser without an established import outcome. Native replica catch-up/unsupported-history presentation remains unverified on the local-primary fixture; paired-Host evidence is not two-machine qualification. |

The three new Medium defects are **Fixed and Verified in the demonstrated scopes**; [tracker entries NA-001–NA-003](REMEDIATION_TRACKER.md#bounded-offline-native-acceptance-follow-up--29-october-2026) record their roots and repairs. NA-001 rejected valid native rotor bands and blocked Normal hydration. NA-002 lost automatic intent on whole-second serialization of fractional native dates. NA-003 retained an old automatic date in a second edit queued during acknowledgement. Actual native failures and deterministic failing regressions preceded their corrections. No application functionality, manual timestamp, power chronology, ownership/generation fence, safety admission or recovery record was removed to obtain a pass.

Fresh targeted checks pass:74related frontend tests and TypeScript for startup;98Swift Testing+18XCTest for precision/Save/power/restore (one interruption-helper entry skips); final150frontend tests/9files and TypeScript; one fresh universal worker build; final actual `npm run build` with unchanged window graph/budget checks. Counts overlap. A test-only TypeScript failure and the initial405347-byte Logbook budget failure remain archived. Deduplicating the existing power-field selector retains all guards and passes three added controls; final Logbook is405170/405200bytes, a30-byte margin. Original dist inode and all180files are restored after every attempt.32copied-database checks pass integrity/foreign keys, split between24profileA/package copies and8final-entry copies. [Exact-source verification](docs/reviews/offline-native-acceptance-2026-10-29/final-entry-verification.json) and the290-artifact manifest preserve original bytes, command/source boundaries and failures.

This run does **not** claim a new complete historical-suite/CI/TSAN result at e6. Earlier full gates remain bound to their recorded sources; unchanged component evidence is reused only with that qualification. Compiler/concurrency warnings and language-mode migration, conditional Linux DEP-P5-003/security and unavailable audit tooling, supported-platform runtime, hardware/provider/watchdog/audio, actual power loss, resource soak and distribution/signing/notarization/installation/rollback requirements remain under their existing owners. The native matrix remains incomplete, so GO and CONDITIONAL GO are not supported.

All private app/worker processes ended through ordinary Quit after usable runs; failed pre-binding launch cleanups are separately identified. The exact owned loopback development server is stopped. No production app/path binding, credentials/account/provider write, sync/upload, RF/PTT/radio/rotor/audio, installation, release promotion, old-bundle overwrite or recovery-ref cleanup occurred. Private data/layouts and recovery copies remain retained. **Offline native acceptance is complete within this finite recorded scope; work stops before production installation/release or another batch.**

## Everyday logging native acceptance — 29 October 2026

**Latest disposition: NO-GO.** This one bounded follow-up is complete. The [same acceptance record, exact source/components, three-check matrix, failures and remaining qualifications](docs/reviews/offline-native-acceptance-2026-10-29/everyday/RESULTS.md) supersedes only the relevant earlier everyday gaps. It does not upgrade earlier restore/provider/replica evidence or begin another general audit.

Entry documentation was clean **b755f3fd062f87af1658a2475b9708cb5e8b1a32**, with all1,843 application/test inputs equal **e6cab56f50953798f08df8d16142bfc90fd193b1**. Current tested application/test source is **c09ecfdd5f9eec9834733f7dff3ae3bccffa8be7**, including individually pushed6ed87f3c (NA-004) and c09ecfdd (NA-005). Seven assessed inputs changed, none deleted,1,836 unchanged; no version or dependency-lock change. The existing worker/resources match and retain their original build provenance. Final native host SHA256 is **00a205f54fc8a8259f0ddf1729eaca7e1ec091353d3e2d33ac97aee76ff409f0**; existing worker remains **b3c984c5a38b39f563be7ee45179738fe9d12af34aa647d06a244e946a79a71e**. No old signed1.3.60bundle was treated as repaired code; all private development layouts remain retained.

| Everyday requirement | Final actual disposition | Evidence boundary |
| --- | --- | --- |
| Normal log export reaches a real file; cancellation preserves data | **Native end-to-end PASS after NA-005.** Actual Export all→NSSavePanel Cancel leaves all3contacts/full K9KEEP draft identical; next real Save writes729bytes to the explicit private destination. | Saved ADIF parses as K8AUTO/K6NITE/K7MAN, exact UTC starts/ends, midnight date, reports/frequency/Unicode text agree with reviewed input and SQLite. SHA256 **8e705b8bc3c1eda721886599fec3c75323e4e3db5b261c9d4a4b00c124e1527a**. Actual bundled-worker parse reports3records with unchanged stats/draft. No final prepared-hash receipt exists on this route and none is invented. ADX/filtered/selected/detached dispatch is component evidence, not an additional native pass. |
| Main Logging Edit last | **Native end-to-end PASS after NA-004.** Actual dedicated editor, known last QSO identity, one correction Save, reopening and Cancel preserve occupied unrelated draft, count1 and complete serial ledger. | One `correct` audit follows original `commit`; only intended Comment changes. Final c09 restart→Edit last reopens that same correction. No inline-editor substitute. |
| Exact complete canonical timestamp reversal before replacement flush | **UNVERIFIED native precondition.** Canonical draft9D8F0A53-6728-4066-855A-9ECD8DD897ED/revision7/automaticStart=true, native13:56:31.633669Z/end=nil (wire13:56:31Z/end=nil), was captured before the sequence. Live display had advanced to13:57:40; exposed AX value writing did not provide a reliable actual complete-pair edit/reversal. | No date-only reversal, timing-loop substitute, flag/storage patch, clock freeze or debounce change. Existing rendered Full/Desk/detached/native-handler evidence remains scoped component evidence; FA-014 is not reopened on an unestablished precondition. K4REV remains an unchanged unfinished draft, not a QSO. |

Independent final-source controls pass: rapid Desk non-time input retains automatic intent, ordinary Full navigation and actual form Save write **13:53:22.728236Z** within recorded button bounds. Genuine keyboard manual **13:54:27Z** survives Full→Desk→Full/remount and actual Save. Ordinary Quit/reopen shows exactly2logged controls and separate retained K4REV with identical ID/revision/full canonical pair. A usable final-source **Normal57683/57724→Contesting57818/57820→Normal57892/57901** roundtrip preserves K9KEEP and K1KEEP/received315/sent002. Fresh process/executable/private-root/WebKit proof precedes every binding.

The task directly reproduced and repaired two Medium mechanisms: native opener denied Main Logging’s legitimate Edit last after the owner retained an edit (NA-004); the old Normal Blob route later blocked the app’s main thread in a WebKit sandbox download-destination call and persisted no second file (NA-005). The initial earlier Blob export really did persist once; it is not concealed, and the later failure is not causally attributed to the unrelated Edit last fix. The corrected Normal route reuses the existing native chooser/dialog lease/atomic writer, bounds callers/filename/ADI-ADX/32MiB, awaits saved/cancelled/error, and preserves frozen ADIF assembly plus browser fallback. [Individual tracker updates](REMEDIATION_TRACKER.md#everyday-logging-native-acceptance--29-october-2026).

Focused verification passes: Edit last executed negative then Rust1/UI211/owner1 and TypeScript; native export Rust8, six UI/codec/Analytics suites1406 at the initial repair, final shared-helper92 then final presentation60 and TypeScript (counts overlap, untouched codecs reused). Two actual startup-budget failures405524 and405356 remain archived. Necessary existing-helper/presentation reuse passes the unchanged gate **405195/405200bytes**, only **5bytes** headroom. Final affected-host build passes142.231s. All180original dist files/inode603456013 are restored. Thirty copied SQLite checks pass integrity/foreign keys; these are not30independent workflows. [202-artifact manifest](docs/reviews/offline-native-acceptance-2026-10-29/everyday/MANIFEST.json) and [final source/SQLite/receipts](docs/reviews/offline-native-acceptance-2026-10-29/everyday/everyday-native-final-verification.json.gz) retain actual source/build tags, original bytes, negative tests, tooling failures and no unexecuted-probe passes.

Final usable runs quit normally and process-only checks confirm app/worker/server stopped. The earlier positively identified hung test pair50965/50973 required SIGTERM after preserving private snapshots/sample; it is explicitly **not ordinary Quit**, no escalation or production fallback. Private data, existing synthetic Downloads export, installed binaries/settings/drafts, recordings, backups, rollback bundles and recovery refs were retained. No real provider/account/sync/upload, radio/PTT/RF/rotor/audio, production UI, packaging, installation or promotion occurred.

**Remaining requirements are unchanged:** native exact-pair reversal qualification; owned fldigi warning/retry/physical RX/watchdog; replica status/unsupported history; incomplete restore GUI and separate SwiftUI caller, nonempty references/live preference readback; compiler/concurrency/Swift-language-mode warnings; conditional Linux DEP-P5-003/security/tooling; supported-platform runtime, both-slot CAT/TCI/Flex/DAX/engine/audio/provider/credential/disconnect/sleep tests; physical power loss;8–24h combined resource soak; signing/notarization/installers/updates/rollback; final exact-source mandatory release gates. Earlier full-suite/CI/TSAN results remain attached to their actual source. Five-byte bundle headroom remains a risk. Any eventual candidate needs a new unused version and separate authorization. Work stops here: no GO, installation, release promotion or automatic next batch.

## Review closeout — 30 October 2026

**Scoped personal Apple Silicon macOS operating/development baseline: GO — installed and verified. Public/all-platform release: NO-GO.** This is the human-authorized final closeout, which supersedes the earlier stop-before-install instructions only for this delivery. It does not certify optional hardware/provider capabilities or every historical test. No further audit, cleanup, qualification campaign or feature batch follows.

Installed **1.3.63**, exact application/test source **`19508f4f58eeadea381bc589c56d9bd0a29b2afe`**, at `/Applications/OM0RX-xLog.app`. Developer ID Oliver Bross (`4WCMQ4U946`), hardened runtime/trusted timestamp, all **98 Mach-O signatures** and **3553 file/link manifest entries** verified. Main SHA256 **`d2f58767023246fd99f55fbca60a68669cd1b55d7f62810e426afeb082f4769c`**; worker SHA256 **`5b1cc3d5f408077d709c56ce1fd1ef01d51b3503fefbb5ce96e71785761afc6d`**. Minimum macOS 14.0; current Apple Silicon host accepted. Source/provenance, 31 Python sources, 92 Python Mach-Os/CA/resources, architecture and relocated complete bundle are verified; CW experimental capability stays disabled. No older 1.3.60 bundle was relabelled.

Apple accepted submission **`bb6fe5ba-95e4-4fe1-82d3-f4d9681c53d3`**, ZIP SHA256 `0158b1431a526e001b7de41a9ab0c3fc69499bafcd7a160bf91bff1abe109dad`; fresh Gatekeeper assessment exits0, `Notarized Developer ID`. The earlier pending/rejected assessment remains recorded. The accepted frozen candidate was installed without rebuilding or altering it; no stapled-ticket/offline-distribution claim or security override is made. 1.3.61 and 1.3.62 were retained, never installed: actual Desk input and recovery-banner defects respectively justified uniquely versioned replacements.

### Repairs and actual verification

All accepted CR/FA, **FA-010–FA-017 and NA-001–NA-005** remain repaired in their documented scopes. Closeout adds the fail-closed installer live-owner guard (CL-001), Desk per-key MHz buffer acknowledgement correction (CL-002), persistent workspace-load/recovery diagnostic ownership (CL-003), and safe existing lazy boundaries for country preview/follow-up. No export engine, filesystem permission expansion, dependency/framework migration or useful functionality removal was introduced.

| Delivered check | Actual outcome / evidence boundary |
| --- | --- |
| Clean final package | **PASS**, clean canonical source before/after, unchanged 1,732 package inputs ; 682.568 s. Stable TypeScript/Vite/Rust/native/resource/signing build, all 24 bundle gates. Logbook **396,705 / 405,200 bytes**, **8,495 bytes headroom**; budget unchanged. Original 180 dist files/inode restored. |
| Exact-source complete frontend | **PASS 4,808 tests / 339 files + 6 Node**, zero failed/skipped; actual macOS CI `npm test && npm run build` step. Whole later desktop CI job was cancelled; local final packaging passes. Earlier local failures are preserved. |
| Final repair regression | Executed negative reproduces banner loss after cluster failure. Final **50/50 LiveApp** plus TypeScript pass; repeated background failures, Dismiss, failed Retry and successful reload covered. A single non-executable comment change during local checks is hash-qualified; stable final package/CI compile current source. |
| Qualified unchanged components | Swift portable 1,219 XCTest includes7 skips; Swift Testing summaries 537 + 8 include7 disabled, not545 executed passes. Strict portable119 warning headers/112 distinct and separate SwiftUI5 warnings remain; no source errors/suppression/Swift6-language-mode claim. Rust 927 + 31 integration / feature 934, Clippy, Python 568 / catalogue 97 / 1,353 checks, installer12 contracts/six actual helper paths and runtime relocation12 retain exact original execution/source equivalence. Counts overlap. |
| Actual final packaged Normal workflow | **PASS** Desk keys1→14→14.250; Full automatic and genuine manual Save, manual Full→Desk→Full retention, durable SQLite/issued receipts and ordinary reopen. Two logged contacts remain distinct from W4KEEP unfinished draft. Exact native complete-pair pre-flush reversal remains **UNVERIFIED**, not retried or manufactured. |
| Real final native files | Normal **444bytes**, SHA256 `7d74c96c44e6c44090c968205088b7fc227c1725fe0ad8c425fc86d3edbb1f44`, two reviewed records; Contest **551bytes**, SHA256 `bdedaf0760e8b7190da98e0acaf930028a212319a96205f4bb7d77def58ef413`, one reviewed record. Actual NSSavePanel persistence, byte parser/SQLite comparison and Normal Cancel pass. Normal route has no final prepared digest receipt; Contest in-memory prepared receipt was not captured; none is invented. |
| Contest/lifecycle/recovery | Actual Main Logging Edit last opens the right contact; Cancel preserves unrelated draft/count/serials/audits. Normal→Contesting→Normal and ordinary reopen preserve exact drafts/receipts/data. Final actual recovery warning survives periodic failures/Dismiss/failed Retry; marker, DB and sidecars remain byte-identical through ordinary Quit. This is Tauri fence/presentation, not successful recovery or separate SwiftUI certification. |
| Bounded combined software load | Actual 1.3.62 / 83d2 full signed app-copy worker:1,024 classified spots, 4 Analytics reads, generated 8,000 PCM frames, 24.530 s body, no device capture/output/production access; native synthetic QSO timestamp falls inside body. Source-qualified reuse after UI-only banner repair; not a fresh 1.3.63 combined or multi-hour/hardware certification. |

### Installation, preservation and observed automatic effects

Exact installed identities: Normal **87048/87083** → Contesting **87279/87285** → returned Normal **87465/87473** (app/worker), matching default WebKit processes verified before each binding. Read-only Settings, preserved contest chooser, Main Logging and active Log Display open; active contest shows 775 contacts. No synthetic production contact, import, rescore, restore, test serial, manual sync/retry/provider write, radio/PTT/RF/rotor or physical audio control was requested. Saved automatic connections/sync were allowed. Ordinary Quit completed; app/worker/owned runtime are stopped. A final post-smoke full installed-tree/mode/signature comparison also matches the frozen candidate exactly. One restart each way is observed; exact-once preparation remains established regression evidence, not an invented native counter.

Final fresh current-state backup: **`/Users/oliver/Documents/Backups/OM0RX-xLog/Review-Closeout-1.3.63-before-install-20261030T120908+0930`**; manifest SHA256 `c65a802c0b73cc30f6867973400011a06b2b1e9a7dc705d7d3e0ad6dfd70e712`. **4,440 files/links, 10,146,190,734 bytes** across the five established roots plus preferences; **170 SQLite checks pass, one private WebKit IDBKEY store exact-byte verified only**. All regular in-root recordings are included; external volumes/symlink target contents are excluded. The initial preservation copy preceded final disposable UI, so it and its test-profile/Save-panel-bookmark comparison failures were retained. The final post-acceptance backup passes strict whole-root/preferences equality without exceptions.

Immediate signed rollback: **`/Users/oliver/Documents/Backups/OM0RX-xLog/Review-Closeout-1.3.63-before-install-20261030T120908+0930/Applications-Rollback/OM0RX-xLog-1.3.60.app`**. The installer's exact prior 1.3.60 app is additionally archived alongside it as `Installer-retained-1.3.60.app`; older backups/bundles/recovery refs/stashes/unique work remain. No database restore occurred.

Closed installed comparison passes **62 coherent stores, zero protected table/work-key differences**: **69,457 SQL rows = 69,456 active QSOs + 1 retained tombstone**, original draft identity and revision 3100, contact and Save receipts, contest sessions/audits/serials and recovery retained. All saved configurations/OS preferences match; **681 recording-media entries / 7,583,244,437 bytes** and recorder capture index are exact. The only schema addition is empty `xlog_restore_authority` (0 rows), supporting app-only rollback for this demonstrated no-restore state only. Nonempty authority/incomplete restore would require a hard stop; no older database restoration is authorized.

Permitted automatic effects are explicit: three saved `connect:acknowledged` receipts replace three **old confirmed manual_tune history entries** under the pre-existing 256-entry terminal/non-latest-lifecycle policy; no new tune occurred and all unresolved/retained receipts are exact. Two automatic sync runs are **cancelled**, with explicit uploadAttempts 0 and confirmed create/update/delete 0; two old completed runs expire under the existing 100-run policy. No completed sync or remote-account/effect certification is claimed. Cluster/reference caches update normally. Map camera differs only by sub-1e-12 rounding; a new context-scoped spot workflow is empty. The blanket file checker’s no-history-eviction assertion remains **FAIL**; independent precise preservation assessment accepts these exact permitted terminal-history effects without changing product behavior or assertions.

### Remaining qualifications and stopping point

No demonstrated unresolved A-class defect remains for this delivered Mac baseline. **Public/all-platform NO-GO** and the all-fresh ledger remain: the synthetic partial-bootstrap missing-profile refusal fails in three 1.3.62 attempts before the 81-operation body (cause unproved); framing’s initial 7/8 plus focused EOF pass remain distinct; Windows checkout/path failures and unqualified Linux/Windows runtime remain. These are disclosed source/tooling/platform boundaries, not relabelled passes.

Existing owners retain Swift concurrency/language-mode migration, conditional Linux DEP-P5-003/security tooling, physical CAT/TCI/Flex/DAX/fldigi/CW/WSJT-X/watchdog/provider/credential/disconnect/sleep acceptance, replica deployment, separate SwiftUI/special recovery and physical power loss, exact native timestamp reversal, and 8–24 h resource soak. Earlier restore/provider/replica/TSAN evidence keeps its original source. Hardware/provider restrictions remain unchanged; RPC acknowledgements do not certify physical RX/RF. The software is not declared bug-free.

[Source-bound closeout evidence (lossless gzip JSON)](docs/reviews/offline-native-acceptance-2026-10-29/closeout-1.3.63-evidence.json.gz); actual synthetic [Normal ADIF](docs/reviews/offline-native-acceptance-2026-10-29/closeout-1.3.63-normal.adi.gz) and [Contest ADIF](docs/reviews/offline-native-acceptance-2026-10-29/closeout-1.3.63-contest.adi.gz). Full private logs/manifests/SQLite copies stay under `.build/mac-closeout-20261030` and the protected backup. Final application source remains 19508f4f; subsequent closeout commits change documentation/evidence only. Canonical main is synchronized by the closing commit; no next batch is started.
