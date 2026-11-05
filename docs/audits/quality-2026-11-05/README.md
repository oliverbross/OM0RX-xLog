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
| Q01 | Retention repair verified in signed worker; incident scope OPEN | `26b32e8c`: completed task retention removed; [signed three-fixture comparison](memory-signed-1.5.18.md) grows 116–120 MiB/20k reads before and is flat/settles afterward. [Thirty-minute offline idle](desktop-idle-1.5.18.md) preserves all generated QSOs. User confirms htop **MEM column**; its exact process/field units/workload, WebContent/GPU ownership and complete desktop budget remain open. Provisional idle CPU goal is not met. |
| Q02 | Fixed in source; native Windows NOT RUN | `234f0f6e`: rotor reply unwrap and empty-cache retry; 30 focused Vitest tests, TypeScript and four relevant Cargo tests passed. [Radio trace and Windows procedure](../../reviews/QUALITY_FIRST_RUN_2026-11-05.md). Radio incident remains open. |
| Q03 | Windows EOL correction verified; installer qualification OPEN | `1dd41330` supplies the two-scope recipe. [Exact-source diagnosis](windows-source-clean-1.5.18.md) identifies generated HM files at the first dirty boundary; `0d6ebf2a` pins only those outputs to LF and preserves the clean-source guard. The actual-generator regression passed on native Windows in [1.5.19](../../releases/v1.5.19-quality-candidate.md); its earlier frontend failure prevented installer packaging. [Ordinary-user/UAC/upgrade cells](../../WINDOWS_INSTALLER_SCOPES.md) remain NOT RUN. |
| Q04 | Hidden observer repair verified; per-feature package counters OPEN | `5fac0a06` + `afdef570`: hidden disarmed dispatches 40→0/30s in the focused fixture, holder heartbeat preserved, context-churn starvation corrected; 21 tests and TypeScript pass. [CW counters](runtime-cw-polling.md), [native lifecycle inventory](background-ledger.md), [desktop CPU/wakeup observations](desktop-idle-counters-1.5.18.md). Process counters do not attribute a specific timer. |
| Q05 | POTA repair and baselines verified; snapshot lifetime OPEN | `1ab1f647`: cumulative POTA byte construction 3.807 GB→6.75 MB per synthetic transfer; exact Unicode/multi-park service checks pass. [POTA](runtime-pota-chunks.md), [SQL](sql-baseline.md), [signed 100k workflows](worker-workflows-1.5.18.md). [1.5.19 lifetime observations](preview-export-lifetime-1.5.19.md) identify ~525 MiB allocated preview/export structures and a 559.11 MiB footprint after expiry rejection; 20 cycles were nonmonotonic. The harness's wrong error-code assertion and missing replacement sample are explicit. GUI close/release policy and visible-save latency remain open. No schema/durability tuning. |
| Q06 | Bounded Mac and Linux package journeys PASS | [1.5.19 Mac native](native-1.5.19.md) and prior [1.5.18 Linux container runtime](ci-1.5.18-linux-runtime.md) record actual packages and persistence. Native Windows, ordinary Linux desktop and physical hardware remain NOT RUN. Browser/component tests cannot close those cells. |
| Q07 | 1.5.20 preparation; phase OPEN | [1.5.16](native-1.5.16.md) found first-contact default loss; [1.5.17](native-1.5.17.md) exposed the editor-input race; both source fixes remain included. [Original 1.5.18 gate](ci-1.5.18-original.md) failed Windows provenance preflight; [independent Linux acceptance](ci-1.5.18-linux-runtime.md) passed with unchanged package bytes and strict QA correction. [1.5.19](../../releases/v1.5.19-quality-candidate.md) verified the LF checkout correction but failed a Windows frontend QTC first-click test. `7798da53` fixes [the reproduced reset](qtc-first-input-race.md); [1.5.20](../../releases/v1.5.20-quality-candidate.md) requires new exact-source qualification. Old receipts are not relabelled. No daily install or public release. |

## Preservation baseline

Installed version 1.5.15 was observed in place before any test launch, quit,
rebuild or production interaction. Its actual host/worker hashes are:

* Host: `388114efe485ea83fc56256af0774d6ee6b4f4bd9561798ba215fdd025399ef2`
* Worker: `0b4121e278d42546f793a7947af3ce3cf0b99b0cfc423f66ef1b3fb664202d6c`

The [historical installation receipt](../cqrlog-implementation-2026-11-04/installation-1.5.15.json)
records 69,682 live contacts, 665 managed voice files and a verified 1.5.9
rollback. Those are historical preservation counts, not assertions about the
current mutable log. No production mutation, manual production sync, station
radio/CW/PTT/audio/rotator command or daily-app restart was issued by this task.
Synthetic settings/contact writes and dummy protocols are identified in their
own receipts. A later process-only check found the original daily PIDs absent;
their exit time/cause was not observed, and the daily app was not relaunched.
Installed executable hashes still matched the baseline. Raw diagnostics and
private launch proofs stay outside Git.

## Qualification matrix

Cells name the measured build/profile. Candidate 1.5.20 is pending. The 1.5.19
local Mac native and worker checks pass; its cross-platform gate failed Windows
frontend. Earlier results retain their original source and limits.

| Journey | macOS arm64 | Windows x64 | Linux x64 |
|---|---|---|---|
| Current installed process memory | PASS: numeric native capture; incomplete WebKit ownership | NOT RUN | NOT RUN |
| Released-worker repeated health / EOF | PASS on private empty fixture; growth reproduced | NOT RUN | NOT RUN |
| New packaged worker memory / EOF | PASS: [signed 1.5.19 empty/100k/representative](memory-signed-1.5.19.md); full desktop budget open | NOT RUN | NOT RUN |
| Native packaged skip setup → logging → restart | PASS: [1.5.19 offline journey](native-1.5.19.md), including first-save defaults/37 W, Unicode edit, native menu/Close guards and ADIF; earlier failures retained | NOT RUN | PASS in [1.5.18 non-root runtime container](ci-1.5.18-linux-runtime.md): four scripted embedded UI launches; ordinary desktop NOT RUN |
| Native radio / rotor Browse → Save → restart | NOT RUN | NOT RUN | NOT RUN |
| Just me default path / no-admin / UAC cancellation | N/A | NOT RUN | N/A |
| All users Program Files / ordinary first launch | N/A | NOT RUN | N/A |
| Same-scope upgrade / cross-scope transition / uninstall retention | NOT RUN | NOT RUN | NOT RUN |
| Native keyboard setup / clipboard / menu and Close guards | PASS within [1.5.19 recorded journey](native-1.5.19.md) | NOT RUN on ordinary desktop | NOT RUN on real desktop |
| Scaling / multiple displays / native device permissions | NOT RUN | NOT RUN | NOT RUN |
| Physical radio / rotor / audio / RF | NOT RUN | NOT RUN | NOT RUN |

Current supported package targets follow the canonical recipes: macOS arm64
WKWebView, Windows x64 WebView2 and Ubuntu 24.04 x64 WebKitGTK. Native voice and
selected direct station providers remain platform-specific. A successful shared
UI test does not add a missing native provider to another OS.

[Platform requirements, scope decisions and ordered acceptance handoff](platform-readiness.md)
record the remaining ordinary-account, real-session, provider and display cells.
