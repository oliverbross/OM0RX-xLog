# Operator acceptance checkpoint — f72d4f7

Accepted on 18 October 2026 after Astra source review and a fresh compilation
and execution from clean, pushed source
`f72d4f76052f0996bc5897ce8d0d0e407a64961e`.

## Proven scope

The production ContestWorkspace and mutation owner ran in headless Vite with
the real isolated LiveWorker and SQLite store. All external station, radio,
audio, PTT, network and credential adapters were disabled.

| Scenario | Contacts | Points | Multipliers | Score | Captured export |
| --- | ---: | ---: | ---: | ---: | --- |
| CQ WW CW Run | 2 | 4 | 4 | 16 | Cabrillo |
| CQ WW SSB Run | 2 | 4 | 4 | 16 | ADIF |
| CQ WPX CW Search & Pounce | 2 | 5 | 2 | 10 | ADIF |
| CQ WPX SSB Search & Pounce | 2 | 5 | 2 | 10 | Cabrillo |

The run recorded 102 ordinary frames and two lifecycle frames, eight commits,
six serial reservations, four settled invalid-exchange action checks and four
captured exports. It exercised duplicate indications and one WW CW worker
restart/reopen/correction/deletion path. Export transport verified byte length
and digest. Protected database metadata was unchanged; source was clean before
and after the run. Forced worker response/shutdown stalls and a TERM-ignoring
descendant probe were reaped without lingering owned processes.

## Exact artifacts

Evidence directory:
`/Users/oliver/.codex/build/contest-operator-browser-clean-f72d4f76052f0996bc5897ce8d0d0e407a64961e/evidence/`.

| Artifact | SHA-256 |
| --- | --- |
| `outer-runner.json` | `1df039ea5e65c2e7a93f08da824f8f2223bd9a8ab8cb3cf31534cc529affa2b3` |
| `acceptance.json` | `9e006deaa0aeeeaa33c5593136c236829040ee45fb603fa7a421336c390de328` |
| Actual compiled XCTest host | `71a96b031f09df6d543fc16999200248b9183a00b87aba55885905f17e1fae62` |
| CQ WW CW Cabrillo | `893f9b75ad4845c07bfc26e93ad85634c32b171ff164414b36a7214a13d8c53f` |
| CQ WPX SSB Cabrillo | `0072cd65cee5df4836752e305a58580986ba63fe6363435defeb87bdcde8d583` |
| CQ WPX CW ADIF | `61d98bb54bb9baf6f12c33838df6da173a76f526714c818eab3f9969bb3dfb0e` |
| CQ WW SSB ADIF | `08ae8c9c53824ba1e7a29efa6410db3ce25f27eab3dbd8f0e85a2b12390b8ef4` |

Root verified the JSON provenance, counts and artifact digests and inspected
the actual Cabrillo headers/rows, ADIF contest IDs and WPX SSB screenshot.
The source run still displays raw multiplier IDs; the separate NAQP entry
candidate contains the pending operator-friendly labels.

## Remaining acceptance

This checkpoint does not establish both operating styles for each profile,
independent semantic parsing of every export, or post-correction/deletion
scores. The next eight-case extension must cover these. The SSB fixtures used
CW-segment frequencies within the right bands; the extension must use realistic
SSB frequencies. SCP operator integration, all other contest profiles,
packaged/native-window/save-dialog behavior, crash recovery, RF/hardware,
sponsor submission and contest-date/category eligibility remain open.
