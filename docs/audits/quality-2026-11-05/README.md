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
| Q02 | Source repair; ordinary Windows setup still OPEN | `234f0f6e` retains its 30 focused Vitest, TypeScript and four Cargo passes. In disposable Standard `xlogqa` on Windows 11 ARM/x64 emulation, actual 1.5.20 radio Browse first failed; one Retry loaded 313 models. Rotor Browse loaded 57; both bundled Dummy 1 models and dummy/9600 endpoints were selected. Finish and an ordinary restart showed blank webcontent/native menus. Packaged-Python readback later observed onboarding=true/revision2 and rotor Hamlib Dummy1/managed/9600/dummy/revision1; separate radio JSON was present but its model was not read back. The outer diagnostic failed its JSON boundary; those are component observations, not a Save/restart UI pass. Cause, GUI verification and exact x64 desktop qualification remain open. [Procedure/source trace](../../reviews/QUALITY_FIRST_RUN_2026-11-05.md). |
| Q03 | Hosted 1.5.21 scopes PASS; ordinary Windows cells PARTIAL | [Hosted retry](ci-1.5.21-windows-retry.md) on `b0d6a93c` preserves both real defaults without `/D`, all 3,270 installed hashes, hard192 self-test, installed GUI, uninstall and marker passes. Separate ordinary Windows 11 ARM evidence passes strict Standard/non-elevated/medium-integrity token and observed 1.5.20 current-user setup completion at its LocalAppData default; no UAC prompt was observed. Actual Finish-launch token, all-users/UAC cancel/retry, upgrade, nonempty QSO/media retention and scope transition remain unverified. [Original failures](ci-1.5.20-original.md), [controlled diagnosis](windows-local-self-test-diagnosis.md) and [ordinary-account cells](../../WINDOWS_INSTALLER_SCOPES.md) retain their own artifact bounds. |
| Q04 | Redundant idle notifications fixed; native CPU benefit NOT demonstrated | Earlier CW hidden-observer fixes `5fac0a06`/`afdef570` retain heartbeat/freshness/Stop/release regressions. `16c1b6f8` suppresses repeated validated-idle Spot notifications; 27 tests and TypeScript pass. [Paired native development comparison](idle-work-native-correlation.md): Spot IPC 240→240/120s, React commits 809→646, host CPU 1.440→1.501% of one core and worker 0.112→0.119%; no native CPU improvement or release budget pass. Timers/Tauri listeners, separate hook subscriber counts, capture skew and offline errors are explicit. Both 100k QSO hashes survived ordinary Quit; earlier interrupted attempts remain failed. |
| Q05 | Owner cleanup verified in worker and bounded native development controls; next package pending | [Worker correction](preview-export-lifetime-correction.md) fixes invalid_params expectation and captures replacement; exact token/generation retirement, in-flight serialization, replacement and automatic 300s expiry preserve frozen/duplicate/QSO behavior. Live heap 506.931→1.113 MiB after retirement and 1.106 MiB after expiry before another RPC; RSS and footprint are measured separately. [Actual Import Cancel/POTA Close](native-adif-controls.md) each dismiss and receive matching retired:true with zero observed RPC uses; 100k/two-QSO all-column hashes remain unchanged. Individual observer captures are partial; frontend async-owner draining has focused regressions, while native all-user drain remains UNKNOWN. These development inputs do not qualify signed bytes. Native 100k preview took 8.741s; visible-save latency remains open. [Historical 1.5.19 failure](preview-export-lifetime-1.5.19.md) is retained; no schema/durability tuning. |
| Q06 | 1.5.21 historical package bounds retained; new candidate required | [Signed Mac](native-1.5.21.md) and [hosted Windows scopes](ci-1.5.21-windows-retry.md) retain their passes. [Actual Linux 1.5.21 bytes](ci-1.5.21-linux-runtime.md): three X11 journeys PASS36 each; nested Wayland FAIL at the bundled stale-layout Reload branch. `cc2149ab` fixes that source branch; `795f77c2` adds owned process receipts/cleanup and Linux-only regressions (not executed locally without a daemon). [Codec correction](adif-codec-budget.md) `d2f22973` passes 1,456 affected tests, TypeScript and every unchanged bundle gate; original 795 CI still fails its 407119>405200-byte budget after all5,256 tests passed. No new package built yet. Ordinary Windows and full platform/equipment qualification remain open. |
| Q07 | Signed/frozen 1.5.21 HELD; quality phase OPEN | Frozen source `b0d6a93c314bfa2f24036121acd7b4a42ecdd173`; [provenance](../../releases/v1.5.21-quality-candidate.md). [B0 portability completed](ci-1.5.21-portability-completed.md): two bounded later macOS executions pass, retaining the original five passes and original service cancellations/API failures. This does not qualify changed Swift/UI/QA inputs. Current pushed correction `d2f22973` passes ordinary CI run 42135022335; Beta run 42135022818 is pending. Next unused candidate preparation remains separate, with new-package Linux X11/Wayland/cleanup, affected native checks and required gates pending. Core htop and ordinary Windows failures remain unverified. Prior 1.5.16–1.5.20 receipts keep original failures and byte boundaries. No fixture, deadline or budget was relaxed; no daily install or public release. |

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

The later read-only installed-file check after the bounded native controls again
confirmed 1.5.15 and both executable hashes above. No installed-app binding,
launch, replacement or production-log recount was used for that check.

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
| Native packaged skip setup → logging → restart | PASS: [1.5.21 offline journey](native-1.5.21.md), including first-save defaults/37 W, Unicode edit, native menu/Close guards and ADIF; earlier failures retained | [1.5.21 hosted retry](ci-1.5.21-windows-retry.md) PASS for both fresh scopes, including two installed embedded UI launches per scope; ordinary Windows20 ARM/emulated Finish/restart blank as Q02; full ordinary qualification OPEN | [1.5.21 non-root runtime container](ci-1.5.21-linux-runtime.md): three X11 embedded UI journeys PASS; nested Wayland FAIL at bundled QA recovery branch; ordinary desktop NOT RUN |
| Native radio / rotor Browse → Save → restart | NOT RUN | PARTIAL/FAILURE OBSERVED on ordinary Windows 11 ARM/x64-emulated 1.5.20: radio first failure/Retry313, rotor57, both Dummy1 selected; Finish/restart blank. Metadata component readback as Q02; actual GUI verification/cause remain OPEN | NOT RUN |
| Hosted silent defaults / registry / shortcuts / installed payload | N/A | PASS: both 1.5.21 scopes at real defaults without `/D`, full installed payload, self-test, embedded GUI, uninstall and owned marker; ordinary-account behavior separate | N/A |
| Just me default path / no-admin / UAC cancellation | N/A | PARTIAL: strict Standard token, actual 1.5.20 current-user default install completed without observed UAC. Finish token/UAC cancellation remain pending | N/A |
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
