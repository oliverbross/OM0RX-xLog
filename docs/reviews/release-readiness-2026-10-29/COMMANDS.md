# Phase 7 exact command ledger

Canonical source b892663915cbc0768b26dc5a7bf7ec116869e409; unchanged application f3f6e3dee40af29cb6801ef8ee422c521629e168. See results.json and checks/<ID>.json for argv/cwd/UTC/env/log sizes/hashes. No live radio/provider/production data operation.

| ID | Exit | Seconds | Command |
| --- | ---: | ---: | --- |
| FRONTEND-BUILD | 0 | 36.638 | `npm run build` |
| FRONTEND-FA014-DETACHED | 1 | 2.416 | `node /Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/vitest/vitest.mjs run --config /tmp/xlog-phase7-20261029-b8926639/agents/frontend/scratch/vitest.config.mjs --configLoader native --cache false --maxWorkers 1 detached-reversal.test.tsx` |
| FRONTEND-FA014-FORMS | 1 | 4.222 | `node /Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/vitest/vitest.mjs run --config /tmp/xlog-phase7-20261029-b8926639/agents/frontend/scratch/vitest.config.mjs --configLoader native --cache false --maxWorkers 1 reversal.test.tsx` |
| FRONTEND-FA017-STOP | 1 | 4.29 | `node /Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/vitest/vitest.mjs run --config /tmp/xlog-phase7-20261029-b8926639/agents/frontend/scratch/vitest.config.mjs --configLoader native --cache false --maxWorkers 1 fldigi-stop.test.tsx --testNamePattern 'fresh fldigi uncertain Stop'` |
| FRONTEND-FULL-TEST | 0 | 850.31 | `npm test` |
| FRONTEND-NPM-AUDIT | 0 | 7.413 | `npm audit --json` |
| FRONTEND-NPM-CI | 0 | 10.315 | `npm ci` |
| FRONTEND-TOOLCHAIN | 0 | 1.325 | `/opt/homebrew/bin/python3.12 /tmp/xlog-phase7-20261029-b8926639/frontend_toolchain.py` |
| P7-ADX-SCHEMA | 0 | 0.174 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/agents/data/schema_compare.py` |
| P7-CATALOGUE | 0 | 348.873 | `/opt/homebrew/bin/python3.12 -B tools/check_all_contests_readiness.py --family-tests --output /tmp/xlog-phase7-20261029-b8926639/all-contests-readiness.json` |
| P7-CLEAN-WORKER | 0 | 276.234 | `node prototype/scripts/build-contesting-worker-process.mjs --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/worker-clean --output /tmp/xlog-phase7-20261029-b8926639/worker-build-manifest.json` |
| P7-CORPUS | 0 | 8.141 | `/opt/homebrew/bin/python3.14 -B tools/contest_plugin_generator/verify_pinned_corpus.py --upstream /Users/oliver/Documents/Projects/contest-sw --ledger docs/contesting/contest-acceptance-ledger.json --inventory docs/contesting/generated/python-plugin-inventory.json` |
| P7-CURRENT-PROCESS | 0 | 20.269 | `node prototype/scripts/accept-contesting-worker-process.mjs --build-manifest /private/tmp/xlog-phase7-20261029-b8926639/worker-build-manifest.json --output /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/process-acceptance --expected-head b892663915cbc0768b26dc5a7bf7ec116869e409` |
| P7-DATA-INTEGRITY | 0 | 0.331 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/agents/data/evidence_summary.py --integrity` |
| P7-EQUIVALENCE | 0 | 152.023 | `/opt/homebrew/bin/python3.12 -B tools/check_contest_append_equivalence.py` |
| P7-FA013 | 0 | 4.285 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/agents/data/probe_country_reconcile.py` |
| P7-FRAMING | 0 | 1.779 | `node Tests/XLogPrototypeTests/worker-process.test.mjs /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/worker-clean/apple/Products/Release/xlog-prototype-worker` |
| P7-GENERATOR-R2 | 0 | 16.103 | `/opt/homebrew/bin/python3.14 -B -m unittest discover -s tools/contest_plugin_generator/tests -v` |
| P7-GENERATOR | 1 | 5.541 | `/opt/homebrew/bin/python3.14 -B -m unittest discover -s tools/contest_plugin_generator/tests -v` |
| P7-JOB-123258658626-ANNOTATIONS | 0 | 0.655 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658626 annotations` |
| P7-JOB-123258658626-LOG | 0 | 2.569 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658626 log` |
| P7-JOB-123258658808-ANNOTATIONS | 0 | 0.842 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658808 annotations` |
| P7-JOB-123258658808-LOG | 0 | 3.372 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658808 log` |
| P7-JOB-123258658872-ANNOTATIONS | 0 | 0.714 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658872 annotations` |
| P7-JOB-123258658872-LOG | 0 | 3.346 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658872 log` |
| P7-JOB-123258658889-ANNOTATIONS | 0 | 0.888 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658889 annotations` |
| P7-JOB-123258658889-LOG | 0 | 2.272 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658889 log` |
| P7-JOB-123258658907-ANNOTATIONS | 0 | 0.825 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658907 annotations` |
| P7-JOB-123258658907-LOG | 0 | 3.167 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658907 log` |
| P7-JOB-123258658908-ANNOTATIONS | 0 | 0.77 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658908 annotations` |
| P7-JOB-123258658908-LOG | 0 | 4.647 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658908 log` |
| P7-JOB-123258658911-ANNOTATIONS | 0 | 0.815 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658911 annotations` |
| P7-JOB-123258658911-LOG | 0 | 3.619 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/platform_fetch.py 123258658911 log` |
| P7-NATIVE-RELEASE | 0 | 125.023 | `swift build -c release --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/native-release --jobs 2 --product om0rx-xlog` |
| P7-NATIVE | 0 | 381.223 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/native --no-parallel` |
| P7-OSV-LOCK | 0 | 7.613 | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase7-20261029-b8926639/query_osv.py` |
| P7-PORTABILITY-DISPATCH | 0 | 2.567 | `gh workflow run contest-portability.yml --repo oliverbross/OM0RX-xLog --ref main` |
| P7-PORTABILITY-FINAL | 0 | 2.586 | `gh run view 40816487097 --repo oliverbross/OM0RX-xLog --json databaseId,workflowName,headSha,status,conclusion,url,event,createdAt,updatedAt,jobs` |
| P7-PORTABILITY-JOBS-001 | 0 | 0.955 | `gh api 'repos/oliverbross/OM0RX-xLog/actions/runs/40816487097/jobs?per_page=100'` |
| P7-PORTABILITY-JOBS-FINAL | 0 | 0.887 | `gh api 'repos/oliverbross/OM0RX-xLog/actions/runs/40816487097/jobs?per_page=100'` |
| P7-PORTABILITY-SNAPSHOT-001 | 0 | 1.68 | `gh run view 40816487097 --repo oliverbross/OM0RX-xLog --json databaseId,workflowName,headSha,status,conclusion,url,event,createdAt,updatedAt,jobs` |
| P7-PORTABILITY-SNAPSHOT-002 | 0 | 1.875 | `gh run view 40816487097 --repo oliverbross/OM0RX-xLog --json databaseId,workflowName,headSha,status,conclusion,url,event,createdAt,updatedAt,jobs` |
| P7-PORTABILITY-SNAPSHOT-003 | 0 | 2.033 | `gh run view 40816487097 --repo oliverbross/OM0RX-xLog --json databaseId,workflowName,headSha,status,conclusion,url,event,createdAt,updatedAt,jobs` |
| P7-PORTABILITY-WATCH | 0 | 637.131 | `gh run watch 40816487097 --repo oliverbross/OM0RX-xLog --interval 60 --exit-status` |
| P7-PORTABLE | 0 | 776.434 | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/portable --no-parallel` |
| P7-PURE-IQ | 0 | 31.965 | `/opt/homebrew/bin/python3.12 -B tools/check_portable_iq_sources.py --repository /Users/oliver/Documents/Projects/OM0RX-xLog --output /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/pure-iq` |
| P7-PYTHON | 0 | 415.692 | `/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -v` |
| P7-RELOCATION | 0 | 0.962 | `/opt/homebrew/bin/python3.12 -B prototype/scripts/test-contest-python-relocation.py -v` |
| P7-SECURITY-FLOOR | 0 | 0.177 | `/opt/homebrew/bin/python3.12 -B tools/check_reviewed_security_patches.py` |
| P7-STRICT-NATIVE | 0 | 53.742 | `swift build --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/strict-native --jobs 2 -Xswiftc -strict-concurrency=complete -Xswiftc -warn-concurrency` |
| P7-STRICT | 0 | 106.937 | `swift build --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/strict --jobs 2 -Xswiftc -strict-concurrency=complete -Xswiftc -warn-concurrency` |
| P7-TSAN | 0 | 286.905 | `swift test --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/tsan --jobs 2 --sanitize thread --no-parallel --filter 'StationRadioRegistryTests\|NativePowerSelectionTests\|NativeDraftPowerCaptureTests\|NativeDraftPowerAdmissionTests\|AutomaticSyncTests\|RestoreAtomicityTests\|LiveFlexSessionTests\|BackupRestoreAuthorityTests\|WavelogDestinationAuthorityTests'` |
| RUST-CLIPPY | 0 | 155.853 | `cargo clippy --locked --jobs 2 --all-targets` |
| RUST-FEATURE-R2 | 0 | 32.127 | `cargo test --locked --jobs 2 --bin xlog-prototype --features contesting-test` |
| RUST-FULL | 0 | 708.987 | `cargo test --locked --jobs 2` |
| RUST-HAMLIB-DUMMY | 0 | 8.944 | `cargo test --locked --jobs 2 --test hamlib_dummy -- --nocapture` |
| RUST-RELEASE | 0 | 600.335 | `cargo build --locked --release --jobs 2` |
| RUST-TWO-SLOT-DUMMY | 0 | 1.39 | `cargo test --locked --jobs 2 --bin xlog-prototype station_session::tests::opt_in_two_slot_saved_profiles_connect_real_bundled_dummy_receivers_independently -- --exact --nocapture` |

cwd and explicit environment are recorded per receipt; test temporaries are per-ID private roots. Inherited XLOG_/XCW_ opt-ins were removed without printing their values. Test Python and denied contest UDP were explicit.

Successful process exit is not always product acceptance: P7-FA013 exit0 asserts the expected reference-event defect; P7-OSV-LOCK completes with recorded advisory matches. FRONTEND-FA014-* and FRONTEND-FA017-STOP exit1 are intended-behavior requirement failures. P7-GENERATOR exit1 is retained missing-CONTEST_SW_ROOT setup; corrected R2 passes42. RUST-FEATURE has no completed receipt, is not in accepted results, and is retained as INCOMPLETE_RUNNER with a completed R2.

The frontend original node_modules/dist were restored by inode/hash after ordinary fresh npm ci, tests/build/audit/probes. Fresh dependencies/output remain only in the named ignored stage. No assertion, timeout, isolation or lint threshold was relaxed.

Native/portable Swift, strict, native release, TSAN, pure IQ and worker use separate initially absent build paths. Rust initially compiles into new target; its later checks reuse only that task target. Worker bootstrap is test-only, with verified application-relative Python/CA/Not1MM runtime. No distributed application candidate, package/install/deploy or native UI run is claimed.

Platform supplemental VALIDATION.md records every job and step of the explicitly dispatched existing test-only contest-portability workflow, exact head and fetched log/annotation hashes. No operator-release/package/prototype dispatch. Remote test success is not packaged GUI/hardware/credential acceptance.

Compilation/source-only proof binaries previously blocked are not retried. Tool service timeouts/expired status and the original orphan feature log are recorded separately from actual accepted command exits. No full OS/native/model/CPython supply-chain or physical-radio qualification follows from policy/advisory checks.

Source/preservation/metrics and report QA scripts are retained as audit artifacts. They read only source, explicit private fixture databases, command logs and public metadata. Decompression does not authorize operating production or external hardware.
