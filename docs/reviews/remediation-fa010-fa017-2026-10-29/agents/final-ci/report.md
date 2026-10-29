# Final CI evidence — 4ec11a7

Source HEAD: `4ec11a7a17f28992814d8f8451adbfdfb10eae74` (canonical main; clean at initial inspection). Read-only evidence task; no tracked edits, package/deploy dispatch, UI, production state, radio or hardware access.

| Exact-head run | Event | Observed result |
| --- | --- | --- |
| [CI 40837163299](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40837163299) | automatic push | PASS; job 123324540474, Test and automatic packaging/resource checks successful |
| [Cross-platform prototype 40837163186](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40837163186) | automatic push | FAIL; macOS job 123324540975 failed complete portable Swift core; downstream runtime acceptance jobs skipped |
| [Contest portability 40837557532](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40837557532) | test-only workflow_dispatch | PASS; all 7 jobs successful |

The final test-only commit did not match the portability workflow push path filter. After verifying remote main equalled the exact source HEAD and reviewing the workflow's test-only jobs, this task dispatched only `contest-portability.yml`. The returned run's `head_sha` matches exactly. No full prototype rerun was dispatched.

## Confirmed completed jobs

- CI: XCTest 330 tests, zero failures. Swift Testing reports 340 tests passed; 12 explicitly skipped tests: generated-catalogue scale test and 11 disposable FTP/FTPS integration tests. These skips remain acceptance limits.
- Prototype frontend: 4760 tests / 339 files passed; frontend build and FLEX IQ loopback step passed. Complete portable Swift core: XCTest 1218 executed, 7 skipped, 1 unexpected failure; Swift Testing 544 passed, with 7 explicit skips. Later build/package steps and Linux/Windows runtime acceptance jobs were skipped following failure.
- Portability generator: 42 generator tests and 7 reviewed dependency policy tests passed.
- Portability native macOS/Ubuntu/Windows: each passed 64 selected Rust tests in seven bounded groups (24+7+1+16+3+6+7), zero failed/ignored. Other Rust tests are filtered by design.
- Portability Swift macOS, Ubuntu and Windows: all passed discovery, 3 CW primitive tests, 1 portable cluster admission test, the broad contest run (227 XCTest + 8 Swift Testing), and the workflow's additional selected regression suites (including 12 online-log delivery and 7 native draft power tests). Windows also passed 6 ConnectionDoctor boolean fallback and 8 remote backup revision validation tests. Do not add overlapping filtered runs as unique test coverage. No explicit test-skip lines in any portability Swift job log.

## Raw evidence

All retained files are siblings of this report. `xlog-finalci-*.json` contains GitHub raw run/job metadata. `xlog-finalci-<job>.log` contains uncompressed raw job logs fetched via the GitHub API (captured to scratch then copied here, avoiding compression markers). Complete logs: CI 123324540474; generator 123325818745; native macOS 123325818804, Ubuntu 123325818707, Windows 123325818719; Swift Ubuntu 123325818529, macOS 123325818807 and Windows 123325818720. Final portability metadata is in `xlog-finalci-portability-final.json` and `xlog-finalci-portability-jobs-final.json`.

Failed exact-head prototype evidence: `xlog-finalci-platform-final.json`, `xlog-finalci-platform-jobs-final.json`, `xlog-finalci-platform-123324540975-failed.log` (12420 lines). Failure at raw log lines 8161-8162; totals at 10914-10916 and 12339.

## Exact-head prototype failure diagnosis

`BoundedSyncReconciliationTests.testLateRemoteAcknowledgementCannotWriteAfterDatabaseClose` failed with caught `sqlite("unknown error")`, reported at `Sources/XLogCore/LogbookDatabase.swift:3953` (the `sqlite3_prepare_v2` failure guard in `withStatement`). The test closes its disposable database from the synthetic PATCH handler (test line 293), expects `synchronize()` to throw `LogbookDatabaseError.syncRunChanged` (296-297), then reopens the database and checks pending edit retention. The emitted SQLite error escaped that expected error branch. The log does not identify which closed-handle statement or call path produced the error, so deeper root-cause/race attribution remains unproven. No full prototype rerun was dispatched; this failure is retained.

This is a runtime XCTest failure, distinct from the previous `5644b3a8` Swift Testing macro/autoclosure compilation failures. The previous failed job evidence remains retained by the parent task under checks F-CI-PLATFORM-FAILED-LOG / F-CI-PORTABLE-FAILED-LOG. Passing CI or portability results do not make this failed job accepted.

## Limits

CI/fixture/test results do not establish installed app identity, signing/notarization, provider credentials, production operation or physical radio acceptance. Automatic CI packaging occurred remotely as part of existing push workflows; this task did not dispatch packaging or install artifacts. The prototype workflow's automatic push matrix currently contains only macOS; cross-platform bounded contest acceptance is the separate portability matrix.

Final verification after all three workflows completed: canonical local HEAD and remote main both remained `4ec11a7a17f28992814d8f8451adbfdfb10eae74`; `git status --short` was empty. The failed prototype job remains an open acceptance boundary despite the other successful workflows.
