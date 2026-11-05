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
| Q03 | Both 1.5.21 hosted installer scopes PASS; ordinary-account qualification OPEN | [Windows retry](ci-1.5.21-windows-retry.md) on frozen source `b0d6a93c` passes real defaults without `/D`, hives, shortcuts, all 3,270 installed payload hashes, the original nested-TEMP hard192 self-test, two installed GUI launches per scope, uninstall and the harness marker. Repair `d2d22afb` also passes the unchanged native regressions and rollback safety tests. [Original 1.5.20 failures](ci-1.5.20-original.md) stay failed; [controlled diagnosis](windows-local-self-test-diagnosis.md) and [ordinary-user/UAC/upgrade cells](../../WINDOWS_INSTALLER_SCOPES.md) remain separate. |
| Q04 | Hidden observer repair verified; per-feature package counters OPEN | `5fac0a06` + `afdef570`: hidden disarmed dispatches 40→0/30s in the focused fixture, holder heartbeat preserved, context-churn starvation corrected; 21 tests and TypeScript pass. [CW counters](runtime-cw-polling.md), [native lifecycle inventory](background-ledger.md), [desktop CPU/wakeup observations](desktop-idle-counters-1.5.18.md). Process counters do not attribute a specific timer. |
| Q05 | POTA repair and baselines verified; snapshot lifetime OPEN | `1ab1f647`: cumulative POTA byte construction 3.807 GB→6.75 MB per synthetic transfer; exact Unicode/multi-park service checks pass. [POTA](runtime-pota-chunks.md), [SQL](sql-baseline.md), [signed 100k workflows](worker-workflows-1.5.18.md). [1.5.19 lifetime observations](preview-export-lifetime-1.5.19.md) identify ~525 MiB allocated preview/export structures and a 559.11 MiB footprint after expiry rejection; 20 cycles were nonmonotonic. The harness's wrong error-code assertion and missing replacement sample are explicit. GUI close/release policy and visible-save latency remain open. No schema/durability tuning. |
| Q06 | 1.5.21 Mac and hosted Windows PASS; Linux X11 PASS, Wayland QA branch FAIL | [Signed Mac native](native-1.5.21.md) passes the recorded offline journey and ADIF; [Windows retry](ci-1.5.21-windows-retry.md) passes portable/installed embedded UI checks on both fresh hosts. [Linux runtime-only](ci-1.5.21-linux-runtime.md) uses original frozen package bytes: three X11 journeys pass 36 checks each; nested Wayland times out at a valid stale-layout recovery alert ignored by its bundled acceptance code. Source-only correction `cc2149ab` passes 89 affected tests/TypeScript but needs a newly versioned package; the failed receipt remains. Ordinary desktops, equipment and physical hardware remain NOT RUN. |
| Q07 | Signed/frozen 1.5.21 HELD; phase OPEN | Source `b0d6a93c314bfa2f24036121acd7b4a42ecdd173`; [candidate provenance](../../releases/v1.5.21-quality-candidate.md). [Original 1.5.21 gate](ci-1.5.21-original.md) passed Mac/Linux builds but Windows dependency download failed before app compilation. Separate Windows-only retry and both fresh installed scopes PASS; Linux Wayland remains failed. Ordinary CI attempt 2 passed after a service-capacity failure. Portability remains five passed jobs plus two unexecuted macOS service cancellations; retry APIs failed without a new attempt. [1.5.16](native-1.5.16.md), [1.5.17](native-1.5.17.md), [1.5.18](ci-1.5.18-original.md), [1.5.19](ci-1.5.19-original.md) and [1.5.20](ci-1.5.20-original.md) keep their original failures and artifact boundaries. No fixture, count or deadline was relaxed. No daily install or public release. |

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

Read-only filesystem checks at 16:45 UTC on 5 November reconfirmed installed
version 1.5.15 and both hashes above. The protected representative backup is
335,515,648 bytes, file mode 0600 in a 0700 directory, still SHA-256
`3dd4a5a2605daa3f7eab080b8ee795ee990fc2b254e3f3234fadb2ee1eeed446`.
The CW-skimmer checkout remains at
`3a28134caa6c6c981c5f2a564fa22a69d1bc7778`; its untracked `prototype/node_modules`
entry was retained. These checks do not recount the mutable production log or
establish when that untracked entry was created.

## Qualification matrix

Cells name the measured build/profile. Candidate 1.5.21 passes the recorded Mac
native journey and three Linux X11 journeys. Its nested Wayland acceptance
failed at an unhandled explicit layout-recovery branch. Both fresh Windows
installer scopes passed in a separate retry; the original dependency download
failure remains unchanged.
Earlier measurements retain their original artifacts, source and limits.

| Journey | macOS arm64 | Windows x64 | Linux x64 |
|---|---|---|---|
| Current installed process memory | PASS: numeric native capture; incomplete WebKit ownership | NOT RUN | NOT RUN |
| Released-worker repeated health / EOF | PASS on private empty fixture; growth reproduced | NOT RUN | NOT RUN |
| New packaged worker memory / EOF | PASS: [signed 1.5.19 empty/100k/representative](memory-signed-1.5.19.md); full desktop budget open | NOT RUN | NOT RUN |
| Native packaged skip setup → logging → restart | PASS: [1.5.21 offline journey](native-1.5.21.md), including first-save defaults/37 W, Unicode edit, native menu/Close guards and ADIF; earlier failures retained | [1.5.21 hosted retry](ci-1.5.21-windows-retry.md) PASS for both fresh scopes, including two installed embedded UI launches per scope; ordinary Windows desktop NOT RUN | [1.5.21 non-root runtime container](ci-1.5.21-linux-runtime.md): three X11 embedded UI journeys PASS; nested Wayland FAIL at bundled QA recovery branch; ordinary desktop NOT RUN |
| Native radio / rotor Browse → Save → restart | NOT RUN | NOT RUN | NOT RUN |
| Hosted silent defaults / registry / shortcuts / installed payload | N/A | PASS: both 1.5.21 scopes at real defaults without `/D`, full installed payload, self-test, embedded GUI, uninstall and owned marker; ordinary-account behavior separate | N/A |
| Just me default path / no-admin / UAC cancellation | N/A | NOT RUN | N/A |
| All users Program Files / ordinary first launch | N/A | NOT RUN | N/A |
| Same-scope upgrade / cross-scope transition / uninstall retention | NOT RUN | Hosted uninstall and harness marker PASS; upgrade, real workspace/media and scope transition NOT RUN | NOT RUN |
| Native keyboard setup / clipboard / menu and Close guards | PASS within [1.5.21 recorded journey](native-1.5.21.md) | NOT RUN on ordinary desktop | NOT RUN on real desktop |
| Scaling / multiple displays / native device permissions | NOT RUN | NOT RUN | NOT RUN |
| Physical radio / rotor / audio / RF | NOT RUN | NOT RUN | NOT RUN |

Current supported package targets follow the canonical recipes: macOS arm64
WKWebView, Windows x64 WebView2 and Ubuntu 24.04 x64 WebKitGTK. Native voice and
selected direct station providers remain platform-specific. A successful shared
UI test does not add a missing native provider to another OS.

[Platform requirements, scope decisions and ordered acceptance handoff](platform-readiness.md)
record the remaining ordinary-account, real-session, provider and display cells.
