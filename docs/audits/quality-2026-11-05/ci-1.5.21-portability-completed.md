# Historical 1.5.21 source contest portability — completed

The [companion JSON](ci-1.5.21-portability-completed.json) retains actual execution IDs separately from aggregate display aliases. This completes only the frozen-B0 portability status recorded in the [original gate report](ci-1.5.21-original.md); that report's earlier failure/cancellation history is preserved.

Run [42055606115](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42055606115) is SUCCESS at aggregate attempt 3 for exact source `b0d6a93c314bfa2f24036121acd7b4a42ecdd173`: all seven jobs are now successful. Five original successful jobs retain their 15:30 UTC execution timestamps. Only the two previously runner-capacity-cancelled Mac jobs received one later accepted bounded retry each.

| Actual Mac execution | Attempt | UTC start→finish | Actual test outcome | Raw log SHA256 |
|---|---:|---|---|---|
| [Native Rust 127533254681](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42055606115/job/127533254681) | 2 | 21:06:35 → 21:11:25 | 68 passed across 7 selected invocations; 0 failed/ignored | `2053222c22e05a71e82a7a7215a44f394542ef223ea7f17b2d7f97ce88ab54f7` |
| [Swift 127538916539](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42055606115/job/127538916539) | 3 | 21:17:03 → 21:25:11 | 461 XCTest executed: 460 passed, 1 skipped, 0 failed; 29 SwiftTesting passed across 26 invocations | `e8561eb4d06f68be26a4dd97f7fe81a0620cd8c3ed6044c8c40ef1cdaa6f0564` |

Native toolchain: Rust/Cargo 1.99.1. Swift toolchain: Apple Swift 6.0.3 with Xcode 16.2. Swift discovery checks passed. Every selected invocation executed at least one test across XCTest/SwiftTesting; zero-XCTest invocations contain actual SwiftTesting cases. The one preserved skip is the private real manufacturer-packet fixture not supplied in the pure-IQ source-slice check. This is not hardware evidence.

The native Mac execution is actual attempt 2 job 127533254681. GitHub's attempt 3 aggregate assigns carried-forward display job 127538918597 to that same successful execution (same 21:06:35 → 21:11:25 timestamps); no additional native execution is inferred. The JSON maps both IDs explicitly and retains all seven aggregate jobs.

The original attempt 1 remains 5 PASS + 2 service-capacity CANCELLED before any steps. The earlier rejected specific-job HTTP 500 and failed-jobs HTTP 502 requests remain unchanged in copied historical receipts. Later authorized requests were accepted at 21:06:29 UTC (native) and 21:16:58 UTC (Swift), each CLI exit 0. No run or retry was requested by this preservation task.

This closes the historical B0 contest-portability gap only. Candidate 1.5.21 remains HELD for its separately retained package/runtime outcomes, including the original aggregate infrastructure failure and Wayland acceptance failure. Post-B0 application changes require a new candidate's changed-input gates. No package/version/application claim is upgraded by these successful source tests.

Raw exact logs and metadata remain private ignored evidence. The companion JSON contains byte sizes, full hashes, selected filters/counts, accepted-request receipts and all aggregate job timestamps. The original preservation task wrote only ignored files and requested no CI run or retry; this focused documentation promotion changes no qualification claim.
