# Phase 7 platform validation

Run [40816487097](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40816487097) at exact head b892663915cbc0768b26dc5a7bf7ec116869e409: completed / success.

Only contest-portability.yml was dispatched, after inspecting its complete current source and verifying origin/main. Dispatch P7-PORTABILITY-DISPATCH exited 0; exact command, expected head/workflow, source heads and timestamps are preserved in the shared receipt. The workflow has contents:read, portable Swift tests, pinned generator/policy tests and isolated Rust contesting-test checks; native config disables bundling and external binaries. No package/release/deploy/prototype workflow was dispatched.

| Job | ID | Conclusion | Successful steps | Skipped steps | Annotations |
| --- | ---: | --- | ---: | ---: | --- |
| Contest definition generator | 123258658626 | success | 13 | 0 | {'warning': 1} |
| Contest tests (ubuntu-24.04) | 123258658808 | success | 10 | 9 | {'warning': 1} |
| Contest native tests (ubuntu-24.04) | 123258658872 | success | 9 | 1 | {'warning': 1} |
| Contest native tests (macos-14) | 123258658889 | success | 8 | 2 | {'warning': 1, 'notice': 1} |
| Contest native tests (windows-2022) | 123258658907 | success | 8 | 2 | {'warning': 1} |
| Contest tests (macos-14) | 123258658908 | success | 10 | 9 | {'warning': 1, 'notice': 1} |
| Contest tests (windows-2022) | 123258658911 | success | 12 | 7 | {'warning': 1} |

Every job has its own head, conclusion, timing, full step list, test signals, warnings, annotations and raw-log fetch receipt in job-evidence.json. Skipped OS-conditional steps remain SKIPPED and are not counted as passes. No job is accepted using another platform result.

Each native OS job executed 24 export, 7 native-admission, 1 passive-read, 16 module, 3 durable-file, 6 restart-intent and 7 EOF/shutdown cases (64 bounded cases per OS). Generator includes 42 generator and 7 dependency-policy tests. Swift jobs run separate filtered XCTest/Swift Testing invocations. Both frameworks can emit zero-test banners while the other executes cases; those banners and duplicate suite aggregate lines are retained, not summed as acceptance. Discovery steps check expected test availability before execution.

Logs are streamed with a 2 MiB full-retention bound per job; oversized logs retain a 128 KiB head and 1 MiB tail plus a complete-stream hash/count. All seven streams were below the bound and saved in full; each receipt verifies complete byte count and hash. Annotation pages contain fewer than 100 entries; no additional page was required.

Observed annotations and compiler/runner warnings are retained rather than suppressed. Action-runtime deprecation warnings and macOS capacity notices do not change successful test conclusions; they remain maintenance evidence. No dependency security assessment beyond the existing reviewed-floor policy and tests is claimed.

These are current automated compatibility/discovery/fixture results. They do not close FA-010 through FA-017, native operator acceptance, real-provider credentials, production data, physical hardware or RF acceptance. No source/test/config fixes, unrelated fixture reruns, packaging, installation or live station operation was performed.

Preservation: local HEAD b892663915cbc0768b26dc5a7bf7ec116869e409; Git status clean; Rust report unchanged True; workflow unchanged True. Exact hashes are in preservation.json. No earlier Rust evidence was rewritten.
