# 1.5.26 exact-source automatic gates

Source `8acc236c32fb31d58c86c4d673e0ed57fe76fdad`, tree `7c4b2a4d43c6aebf51048d8d80b3c6cc44ee35a3`, parent `1bb37c93098963149c3482f047a94d1b5aae0022`.

Automatic exact-source push gates. Source tests/build evidence only. No package, desktop, installed application, daily-data, Windows VM or physical radio acceptance is inferred.

| Gate | Result | Job scope |
| --- | --- | --- |
| [CI — 42310555102](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42310555102) | SUCCESS | 1 successful; 0 skipped |
| [Full Mac source/build — 42310555428](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42310555428) | SUCCESS | 1 successful; 2 skipped |
| [Contest portability — 42310555305](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42310555305) | SUCCESS | 7 successful; 0 skipped |

Counts are retained per framework and exact full-run log step label. Separate filtered invocations and duplicate suite summaries are not added into a unique-test total. Skipped tests and skipped jobs remain skipped.

Full logs, completed executable-job logs, run receipts and artifact verification are pinned by size and SHA-256 in the companion JSON. Raw logs remain retained privately; this report contains no local private paths.

Earlier failed evidence remains historical; success on this corrected source does not erase prior failure or qualify an earlier candidate.

HELD; quality phase remains OPEN pending remaining candidate acceptance.

Verified terminal counts (frameworks and invocations kept separate):

- CI / Test: 336 XCTest tests with 0 failures; 402 Swift Testing tests passed.
- Full Mac source/build / Release payload guard tests: Ran 16 tests in 15.875s; Ran 5 tests in 0.012s; Ran 4 tests in 0.336s; Ran 5 tests in 0.006s; Ran 12 tests in 0.027s.
- Full Mac source/build / Test atomic pinned contest catalog initialization: Ran 3 tests in 0.088s.
- Full Mac source/build / Frontend tests and build: Test Files  387 passed (387); Tests  5278 passed (5278).
- Full Mac source/build / Test FLEX IQ loopback fixture (Mac): 24 XCTest tests with 0 failures. The separate Swift Testing runner reports 0 tests for this XCTest selection; this is not a zero-test gate pass.
- Full Mac source/build / Test complete portable Swift core (Unix): XCTest reports 1405 tests, including 9 skipped, with 0 failures; 633 Swift Testing tests passed.
- Full Mac source/build / Shell contract tests: test result: ok. 1120 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; test result: ok. 34 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out.
- Full Mac source/build / Bundled Hamlib dummy protocol and lifecycle tests: test result: ok. 34 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out.

Contest portability passed all seven jobs; the companion JSON preserves each selected invocation without adding overlapping counts.

Skipped source-gate scope:

- Full Mac source/build: Package macOS application was skipped.
- Full Mac source/build: Upload macOS package was skipped.
- Full Mac source/build: Package Linux runtime and Debian application was skipped.
- Full Mac source/build: Package Windows portable runtime was skipped.
- Full Mac source/build: Package current-user and all-users EXE installers from one audited runtime was skipped.
- Full Mac source/build: Upload Linux runtime packages was skipped.
- Full Mac source/build: Upload Windows runtime package was skipped.
- Full Mac source/build: Linux runtime-only container acceptance job was skipped.
- Full Mac source/build: Windows fresh-runner runtime acceptance (${{ matrix.installer_scope }}) job was skipped.
