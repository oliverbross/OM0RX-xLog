# Desktop quality phase — 5 November 2026

Owner: Oliver / OM0RX. Execution starts from clean canonical `main`
`da6fefb394944b28be9533ab861be9026306fa8d`; fetch/fast-forward verified.
The supplied handoff ZIP SHA-256 is
`ab9beab930aff7e8c3646aa9795052e93bfd272594a17631e8bcda0a3586b143`.
The daily logger and public release remain unchanged during this phase.

This is the single phase tracker. Focused reports are supporting evidence,
not separate release decisions. Source, component, packaged, ordinary-account
and physical evidence remain separate.

| ID | Scope / status | Evidence and next step |
|---|---|---|
| Q00 | Baseline pinned | Installed macOS 1.5.15 host/worker hashes match the retained `1873dc1d` receipt. Source includes later CWX work. Existing CW-skimmer worktree remains at `3a28134c`; no worktree reset/cleanup. |
| Q01 | Leading owner reproduced; fixed in source | `26b32e8c`: completed task retention removed; released worker grows ~120 MiB/20k reads, development worker growth 0 rounded bytes. [Memory attribution and limits](memory.md). Exact htop ~7 GB column/workload and complete desktop idle budget remain open. |
| Q02 | Fixed in source; native Windows NOT RUN | `234f0f6e`: rotor reply unwrap and empty-cache retry; 30 focused Vitest tests, TypeScript and four relevant Cargo tests passed. [Radio trace and Windows procedure](../../reviews/QUALITY_FIRST_RUN_2026-11-05.md). Radio incident remains open. |
| Q03 | Fixed in source; native acceptance pending | `1dd41330`: separate no-admin current-user and elevated all-users installers around identical payload; fresh-location guard and separate scope runners. [Scope matrix](../../WINDOWS_INSTALLER_SCOPES.md). Ordinary-user/UAC/upgrade cells remain NOT RUN. |
| Q04 | Fixed in source; packaged/idle verification pending | `5fac0a06` + `afdef570`: hidden disarmed dispatches 40→0/30s, holder heartbeat preserved, context-churn starvation corrected; 21 focused tests and TypeScript pass. [Counters](runtime-cw-polling.md). |
| Q05 | Fixed in source; packaged verification pending | `1ab1f647`: POTA byte construction 3.807 GB→6.75 MB per synthetic file transfer; exact Unicode/multi-park service checks pass. [Measurements](runtime-pota-chunks.md). This is separate from retained task memory; no schema/durability change. |
| Q06 | Packaged common journeys pending | Native Windows/Linux ordinary-desktop cells and physical hardware remain NOT RUN. Browser/component tests cannot close them. |
| Q07 | 1.5.16/17 held; 1.5.18 qualification pending; phase OPEN | [1.5.16](native-1.5.16.md) found first-contact default loss, corrected in `0c872634`. [1.5.17 Mac checks](native-1.5.17.md) passed that boundary, but Linux exposed a reproduced editor-input reset race, corrected in `59cf0cfa` with 245 affected tests passing. [1.5.18](../../releases/v1.5.18-quality-candidate.md) requires new exact-source qualification. No daily install or public release. |

## Preservation baseline

Installed version 1.5.15 was observed in place before any test launch, quit,
rebuild or production interaction. Its actual host/worker hashes are:

* Host: `388114efe485ea83fc56256af0774d6ee6b4f4bd9561798ba215fdd025399ef2`
* Worker: `0b4121e278d42546f793a7947af3ce3cf0b99b0cfc423f66ef1b3fb664202d6c`

The [historical installation receipt](../cqrlog-implementation-2026-11-04/installation-1.5.15.json)
records 69,682 live contacts, 665 managed voice files and a verified 1.5.9
rollback. Those are historical preservation counts, not assertions about the
current mutable log. No production request, settings write, manual sync,
radio/CW/PTT/audio/rotator command or app restart was issued for this audit.
Raw diagnostics and private launch proofs stay outside Git.

## Qualification matrix

| Journey | macOS arm64 | Windows x64 | Linux x64 |
|---|---|---|---|
| Current installed process memory | PASS: numeric native capture; incomplete WebKit ownership | NOT RUN | NOT RUN |
| Released-worker repeated health / EOF | PASS on private empty fixture; growth reproduced | NOT RUN | NOT RUN |
| New packaged worker memory / EOF | PASS for 1.5.16 empty/100k; full desktop budget open | NOT RUN | NOT RUN |
| Native packaged skip setup → logging → restart | PASS: [1.5.18 offline journey](native-1.5.18.md), including first-save defaults/37 W, Unicode edit, native menu/Close guards and ADIF; earlier failures retained | NOT RUN | NOT RUN |
| Native radio / rotor Browse → Save → restart | NOT RUN | NOT RUN | NOT RUN |
| Just me default path / no-admin / UAC cancellation | N/A | NOT RUN | N/A |
| All users Program Files / ordinary first launch | N/A | NOT RUN | N/A |
| Same-scope upgrade / cross-scope transition / uninstall retention | NOT RUN | NOT RUN | NOT RUN |
| Native keyboard / scaling / windows / permissions | NOT RUN on candidate | NOT RUN | NOT RUN |
| Physical radio / rotor / audio / RF | NOT RUN | NOT RUN | NOT RUN |

Current supported package targets follow the canonical recipes: macOS arm64
WKWebView, Windows x64 WebView2 and Ubuntu 24.04 x64 WebKitGTK. Native voice and
selected direct station providers remain platform-specific. A successful shared
UI test does not add a missing native provider to another OS.

[Platform requirements, scope decisions and ordered acceptance handoff](platform-readiness.md)
record the remaining ordinary-account, real-session, provider and display cells.
