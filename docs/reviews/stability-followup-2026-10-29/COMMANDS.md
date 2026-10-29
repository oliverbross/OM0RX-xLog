# Exact validation commands

Arguments, cwd, UTC timestamps, exit codes and original log hashes are preserved in results.json and each compressed receipt. Counts overlap across reruns/configurations.

| ID | Exit | Seconds | Source start → end | Command |
| --- | ---: | ---: | --- | --- |
| ALL-CONTESTS | 0 | 174.057 | 9dc6772e → 9dc6772e | `/opt/homebrew/bin/python3.12 -B tools/check_all_contests_readiness.py --family-tests --output /tmp/xlog-phase5-followup-20261029-fd774aef/all-contests-readiness.json` |
| APPEND-EQUIVALENCE | 0 | 65.409 | 9dc6772e → 9dc6772e | `/opt/homebrew/bin/python3.12 -B tools/check_contest_append_equivalence.py` |
| CLEAN-NPM-CI | 0 | 8.568 | e15c6008 → e15c6008 | `npm ci` |
| CLEAN-WORKER | 0 | 404.821 | 9a003a2b → 9a003a2b | `node prototype/scripts/build-contesting-worker-process.mjs --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/worker-clean --output /tmp/xlog-phase5-followup-20261029-fd774aef/worker-build-manifest.json` |
| CLIPPY | 0 | 141.392 | 9a003a2b → 9a003a2b | `cargo clippy --locked --jobs 2 --all-targets` |
| CLOSE-CLEAN-WORKER | 0 | 378.787 | fd2fc49e → fd2fc49e | `node prototype/scripts/build-contesting-worker-process.mjs --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/worker-final-clean --output /tmp/xlog-phase5-followup-20261029-fd774aef/worker-final-build-manifest.json` |
| CLOSE-CURRENT-PROCESS | 0 | 26.921 | fd2fc49e → fd2fc49e | `node prototype/scripts/accept-contesting-worker-process.mjs --build-manifest /private/tmp/xlog-phase5-followup-20261029-fd774aef/worker-final-build-manifest.json --output /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/process-acceptance-final --expected-head fd2fc49e79d691a02323a635f0db157ca5b22e29` |
| CLOSE-FRAMING | 0 | 2.072 | fd2fc49e → fd2fc49e | `node Tests/XLogPrototypeTests/worker-process.test.mjs /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/worker-final-clean/apple/Products/Release/xlog-prototype-worker` |
| CLOSE-FRONTEND-BUILD-WRAPPER | 0 | 31.074 | fd2fc49e → fd2fc49e | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase5-followup-20261029-fd774aef/frontend_check.py CLOSE-FRONTEND-BUILD build` |
| CLOSE-FRONTEND-BUILD | 0 | 30.845 | fd2fc49e → fd2fc49e | `npm run build` |
| CLOSE-FRONTEND-WRAPPER | 0 | 515.644 | fd2fc49e → fd2fc49e | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase5-followup-20261029-fd774aef/frontend_check.py CLOSE-FRONTEND test` |
| CLOSE-FRONTEND | 0 | 515.226 | fd2fc49e → fd2fc49e | `npm test` |
| CLOSE-NATIVE-RELEASE | 0 | 75.862 | fd2fc49e → fd2fc49e | `swift build -c release --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/native-release --jobs 2 --product om0rx-xlog` |
| CLOSE-NATIVE | 0 | 49.645 | fd2fc49e → fd2fc49e | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/native --no-parallel` |
| CLOSE-PORTABLE | 0 | 308.407 | fd2fc49e → fd2fc49e | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/portable --no-parallel` |
| CLOSE-PURE-IQ | 0 | 20.718 | fd2fc49e → fd2fc49e | `/opt/homebrew/bin/python3.12 -B tools/check_portable_iq_sources.py --repository /Users/oliver/Documents/Projects/OM0RX-xLog --output /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/pure-iq-final` |
| CLOSE-STRICT | 0 | 33.029 | fd2fc49e → fd2fc49e | `swift build --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/strict --jobs 2 -Xswiftc -strict-concurrency=complete -Xswiftc -warn-concurrency` |
| CLOSE-TSAN-AUTHORITY | 0 | 55.241 | fd2fc49e → fd2fc49e | `swift test --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/tsan --jobs 2 --sanitize thread --no-parallel --filter 'WavelogDestinationAuthorityTests\|BackupRestoreAuthorityTests'` |
| CURRENT-PROCESS-R2 | 1 | 32.502 | 9a003a2b → 9a003a2b | `node prototype/scripts/accept-contesting-worker-process.mjs --build-manifest /private/tmp/xlog-phase5-followup-20261029-fd774aef/worker-build-manifest.json --output /private/tmp/xlog-phase5-followup-20261029-fd774aef/process-acceptance-r2 --expected-head 9a003a2b34e7cc107a8a6fab5ed9d1da6e6b68c7` |
| CURRENT-PROCESS-R3 | 0 | 42.245 | 9a003a2b → 9a003a2b | `node prototype/scripts/accept-contesting-worker-process.mjs --build-manifest /private/tmp/xlog-phase5-followup-20261029-fd774aef/worker-build-manifest.json --output /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/process-acceptance-r3 --expected-head 9a003a2b34e7cc107a8a6fab5ed9d1da6e6b68c7` |
| CURRENT-PROCESS | 1 | 22.942 | 9a003a2b → 9a003a2b | `node prototype/scripts/accept-contesting-worker-process.mjs --build-manifest /tmp/xlog-phase5-followup-20261029-fd774aef/worker-build-manifest.json --output /tmp/xlog-phase5-followup-20261029-fd774aef/process-acceptance --expected-head 9a003a2b34e7cc107a8a6fab5ed9d1da6e6b68c7` |
| FEATURE-RUST | 0 | 31.379 | 9a003a2b → 9a003a2b | `cargo test --locked --jobs 2 --bin xlog-prototype --features contesting-test` |
| FINAL-CLEAN-WORKER | 0 | 426.459 | f3f6e3de → f3f6e3de | `node prototype/scripts/build-contesting-worker-process.mjs --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/worker-grid-final-clean --output /tmp/xlog-phase5-followup-20261029-fd774aef/worker-grid-final-build-manifest.json` |
| FINAL-CURRENT-PROCESS | 0 | 29.713 | f3f6e3de → f3f6e3de | `node prototype/scripts/accept-contesting-worker-process.mjs --build-manifest /private/tmp/xlog-phase5-followup-20261029-fd774aef/worker-grid-final-build-manifest.json --output /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/process-acceptance-grid-final --expected-head f3f6e3dee40af29cb6801ef8ee422c521629e168` |
| FINAL-FRAMING | 0 | 2.223 | f3f6e3de → f3f6e3de | `node Tests/XLogPrototypeTests/worker-process.test.mjs /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/worker-grid-final-clean/apple/Products/Release/xlog-prototype-worker` |
| FINAL-NATIVE-RELEASE | 0 | 77.659 | f3f6e3de → f3f6e3de | `swift build -c release --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/native-release --jobs 2 --product om0rx-xlog` |
| FINAL-NATIVE | 0 | 57.096 | f3f6e3de → f3f6e3de | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/native --no-parallel` |
| FINAL-PORTABILITY-DISPATCH | 0 | 2.893 | f3f6e3de → f3f6e3de | `gh workflow run contest-portability.yml --repo oliverbross/OM0RX-xLog --ref main` |
| FINAL-PORTABLE | 0 | 298.039 | f3f6e3de → f3f6e3de | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/portable --no-parallel` |
| FINAL-STRICT | 0 | 13.071 | f3f6e3de → f3f6e3de | `swift build --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/strict --jobs 2 -Xswiftc -strict-concurrency=complete -Xswiftc -warn-concurrency` |
| FINAL-TSAN-AUTHORITY | 0 | 100.465 | f3f6e3de → f3f6e3de | `swift test --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/tsan --jobs 2 --sanitize thread --no-parallel --filter 'WavelogDestinationAuthorityTests\|BackupRestoreAuthorityTests'` |
| FULL-FRONTEND | 0 | 605.756 | 9dc6772e → 9a003a2b | `npm test` |
| FULL-NATIVE-SWIFT | 0 | 207.256 | 095f8fa8 → 8f47b19c | `swift test --jobs 2 --scratch-path .build/phase5-followup-20261029/native --no-parallel` |
| FULL-PORTABLE-SWIFT | 0 | 485.52 | 9a003a2b → 9a003a2b | `swift test --jobs 2 --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/portable --no-parallel` |
| FULL-PYTHON | 0 | 335.152 | e15c6008 → e15c6008 | `/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -v` |
| FULL-RUST | 0 | 141.661 | 9a003a2b → 9a003a2b | `cargo test --locked --jobs 2` |
| GENERATOR | 0 | 9.572 | 9dc6772e → 9dc6772e | `/opt/homebrew/bin/python3.14 -B -m unittest discover -s tools/contest_plugin_generator/tests -v` |
| GRID-TARGET | 0 | 22.446 | fd2fc49e → fd2fc49e | `swift test --jobs 2 --scratch-path .build/phase5-followup-20261029/native --no-parallel --filter 'WavelogDestinationAuthorityTests\|BackupRestoreAuthorityTests'` |
| NATIVE-RELEASE | 0 | 108.975 | 9a003a2b → 9a003a2b | `swift build -c release --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/native-release --jobs 2 --product om0rx-xlog` |
| NODE-UNIT | 0 | 1.016 | 095f8fa8 → 095f8fa8 | `node --test prototype/scripts/contesting-worker-current-scenario.node-test.mjs prototype/scripts/contesting-worker-acceptance-qso.node-test.mjs` |
| NPM-AUDIT | 0 | 5.725 | 9a003a2b → 9a003a2b | `npm audit --json` |
| OSV-LOCK | 0 | 8.093 | 9a003a2b → 9a003a2b | `/opt/homebrew/bin/python3.12 -B /tmp/xlog-phase5-followup-20261029-fd774aef/query_osv.py` |
| PATCH-FLOORS | 0 | 0.372 | 9dc6772e → 9dc6772e | `/opt/homebrew/bin/python3.12 -B tools/check_reviewed_security_patches.py` |
| PINNED-CORPUS | 0 | 2.202 | 9dc6772e → 9dc6772e | `/opt/homebrew/bin/python3.14 -B tools/contest_plugin_generator/verify_pinned_corpus.py --upstream /Users/oliver/Documents/Projects/contest-sw --ledger docs/contesting/contest-acceptance-ledger.json --inventory docs/contesting/generated/python-plugin-inventory.json` |
| PORTABILITY-DISPATCH | 0 | 2.509 | fd2fc49e → fd2fc49e | `gh workflow run contest-portability.yml --repo oliverbross/OM0RX-xLog --ref main` |
| PYTHON-RELOCATION | 0 | 0.483 | 9dc6772e → 9dc6772e | `/opt/homebrew/bin/python3.12 -B prototype/scripts/test-contest-python-relocation.py` |
| RUST-RELEASE | 0 | 359.03 | 9a003a2b → 9a003a2b | `cargo build --locked --release --jobs 2` |
| STRICT-SWIFT | 0 | 101.501 | 9a003a2b → 9a003a2b | `swift build --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/strict --jobs 2 -Xswiftc -strict-concurrency=complete -Xswiftc -warn-concurrency` |
| TARGET-FRONTEND-BUILD-R2 | 0 | 65.657 | 095f8fa8 → 095f8fa8 | `npm run build` |
| TARGET-FRONTEND-BUILD | 1 | 103.611 | e15c6008 → e15c6008 | `npm run build` |
| TSAN-REPAIRS | 0 | 332.059 | 9a003a2b → fd2fc49e | `swift test --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/tsan --jobs 2 --sanitize thread --no-parallel --filter 'StationRadioRegistryTests\|NativePowerSelectionTests\|NativeDraftPowerCaptureTests\|NativeDraftPowerAdmissionTests\|AutomaticSyncTests\|RestoreAtomicityTests\|LiveFlexSessionTests\|BackupRestoreAuthorityTests'` |
| WORKER-FRAMING | 0 | 1.786 | 9a003a2b → 9a003a2b | `node Tests/XLogPrototypeTests/worker-process.test.mjs /Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase5-followup-20261029/worker-clean/apple/Products/Release/xlog-prototype-worker` |
