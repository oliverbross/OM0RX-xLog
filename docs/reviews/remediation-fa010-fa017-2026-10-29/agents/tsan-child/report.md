# TSAN owned-child bootstrap

Scope: only Tests/XLogPrototypeTests/NativeRestoreInterruptionTests.swift changed. No application code, other tracked files, commits, packaging, install, GUI, production roots, provider traffic, or hardware actions performed by this agent.

## Failure evidence

Inspected archived docs/reviews/remediation-fa010-fa017-2026-10-29/checks/F-TSAN.log.gz with Python gzip, never gzcat. Lines 361–364 show the controlled owned child failed before the publication checkpoint because ThreadSanitizer interceptors were not installed: TSAN was loaded too late through the xctest bundle. Runtime explicitly identified by the diagnostic was tsan-clean/out/Products/Debug/XLogPrototypeTests.xctest/Contents/Frameworks/libclang_rt.tsan_osx_dynamic.dylib. This was a harness startup failure, not an established race report.

## Source change

Added macOS-only MachO import and macOS-only environment preparation immediately before the existing Process launch. dyld APIs enumerate images already loaded by the parent and locate the actual libclang_rt.tsan_osx_dynamic.dylib path. That path is prepended to DYLD_INSERT_LIBRARIES only when not already present; existing entries and all other environment values are retained. If TSAN is not loaded, the environment is unchanged. Linux/Windows paths are unchanged.

No test skip, sanitizer suppression, instrumentation disablement, or deadline increase was added. Existing executable and bundle selection, child root/suite, checkpoint PID/executable/root, live-process checks, termination checks, and restore/sync rejection assertions remain intact. git diff --check on the test file passed.

## Focused validation

Runner: /opt/homebrew/bin/python3.12 -B /tmp/xlog-remediation-20261029-86a971e0/run_check.py ID --env XLOG_PORTABLE_ONLY=1 --timeout 180 -- swift test --scratch-path /Users/oliver/Documents/Projects/OM0RX-xLog/.build/remediation-followup-20261029-86a971e0/tsan-clean --jobs 2 --sanitize thread --no-parallel --filter NativeRestoreInterruptionTests/testControlledProcessInterruptionAtDatabasePublicationBlocksFreshOwner

- TSAN-CHILD-BOOTSTRAP: exit 1, 11.629 seconds, no timeout. Root identified the concurrent new closed-authority fixture's unsupported XLogSettings initializer and corrected it to .defaults; this run is compilation setup failure, not executed TSAN acceptance. Raw log SHA256: 409cbed1daa49107ba0cf45eddbfe1666659bd76347fc13fa7471e8e953bf522 (12221 bytes).
- TSAN-CHILD-BOOTSTRAP-2: exit 0, 64.762 seconds, no timeout. Started 2026-10-29T08:56:55.535500+00:00, finished 2026-10-29T08:58:00.298313+00:00. Raw log SHA256: 32369847e038a28489286bca791e3004137f150c2fdf4fa23e91c924d4b953ee (5560 bytes).
- Second run source HEAD start: 4ec11a7a17f28992814d8f8451adbfdfb10eae74; end: 36d908d7959d9eaa518029bad3afca1c118767d7. Root committed its separate closed-handle guards while the run was active. Runner diff SHA256: c6f1e86f2506067f2f01904ff7289c8d5415b105ed5c13d036d90be61da6bf0f. The harness source was frozen throughout this run.

Normal ctx_read access to the first /tmp runner log was denied because it was outside the active project. No alternate-path retry or allowlist change was used. Root was asked to archive both runner logs into the project for selected-test/output inspection; until that archive is available, the second-run acceptance stated here is the runner's observed exit 0. Root will commit the frozen harness and run the final suite.
