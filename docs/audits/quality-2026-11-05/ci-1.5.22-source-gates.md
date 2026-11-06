# 1.5.22 source gates — CI, portability and Mac Beta

Exact source `fc7909d63aa0f4d9fd9abf278c2b08bfd557cdd5`, declared version 1.5.22. [Ordinary CI 42139277810](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42139277810) and [Contest portability 42139277814](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42139277814) both completed SUCCESS on attempt 1. These are source gates; no package, installer, ordinary-desktop or hardware acceptance is claimed here.

Ordinary job 127635198344 passed 336 XCTest and 402 Swift Testing cases, then application-target build and resource verification without minting a release candidate.

| Portability job / ID | Actual conclusion | Actual execution summaries |
|---|---|---|
| Contest native tests (ubuntu-24.04) / `127635199157` | SUCCESS | 68 Rust tests; 0 failed/ignored |
| Contest native tests (macos-15) / `127635199554` | SUCCESS | 68 Rust tests; 0 failed/ignored |
| Contest definition generator / `127635199581` | SUCCESS | 42+7 Python tests passed |
| Contest tests (macos-15) / `127635199605` | SUCCESS | 461 XCTest executed/1 skipped/0 failed; 29 Swift Testing passed |
| Contest tests (ubuntu-24.04) / `127635199617` | SUCCESS | 431 XCTest executed/0 skipped/0 failed; 29 Swift Testing passed |
| Contest tests (windows-2022) / `127635199636` | SUCCESS | 451 XCTest executed/0 skipped/0 failed; 29 Swift Testing passed |
| Contest native tests (windows-2022) / `127635199683` | SUCCESS | 69 Rust tests; 0 failed/ignored |

All seven original jobs acquired runners and executed nonzero tests; no whole job was skipped, cancelled, failed or retried. The single existing Mac XCTest skip is the missing private real manufacturer packet and remains unqualified. Counts are executions over selected invocations/discovery probes, not a sum of unique tests across platforms. JSON retains per-invocation counts, test skip reason, every step conclusion and individual raw-log SHA256.

Ordinary raw-log SHA`cf5284cd15af5e7cf9fcd8f4ee1524effa4ac8c62ffa40974bd8852f0bd91146`. Portability terminal API receipt SHA`e3acab562f3be676f7a5abdc2fd941774d20fb9ad0a3005b2966c76a52c90a24`. All eight job logs and exact-source/attempt receipts are retained in the two ignored run directories.

Canonical all-platform package run 42139380197 and its artifacts/runtimes are separately owned and are not qualified by this report. Signed Mac, installed Windows scopes, Linux desktop, ordinary-user/UAC and physical equipment boundaries remain separate. No tracked edit, new dispatch, rerun or cancellation was made by this monitor.

[Structured receipt](ci-1.5.22-source-gates.json) · [Candidate source/provenance](../../releases/v1.5.22-quality-candidate.md) · [ADIF codec correction](adif-codec-budget.md).



## Automatic Mac Beta

[Original push run 42139277785](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42139277785) completed SUCCESS on exact S22, attempt 1. Mac job 127635199392 passes 384 Vitest files/5258 tests, worker/framing/helper/dummy/desktop build gates and two complete existing production bundle sweeps. Each sweep reports 25 window graphs; Logbook is 381779 B/125496 gzip against unchanged 405200 B, with codec absent from the static graph. Full portable core executes 1399 XCTest with 9 skips/0 failures and 628 Swift Testing passes; FLEX IQ loopback passes 24 XCTest. Exact skip reasons remain in the structured receipt.

Linux runtime job 127651251584 and unmaterialized Windows runtime matrix job 127651252230 were SKIPPED. No installer, signed package, installed runtime or ordinary-desktop acceptance is inferred from this push run. Canonical all-platform package run 42139380197 remains PENDING and separately monitored.
