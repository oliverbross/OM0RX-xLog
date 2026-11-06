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
| Q02 | AU23 blank-Desk/restart recovery PASS; full-editor/map presentation OPEN | [S23 ordinary journey and exact package](../../releases/v1.5.23-windows-quality-candidate.md) recovered the preserved failing AU22 profile: two verified ordinary launches render the Desk; compact create/find/edit and restart preserve one synthetic QSO with all 12 stored columns identical. SQLite settings/rotor semantics match the zero-QSO AU22 baseline; saved Dummy radio is visible. A later 438-file profile archive also verifies both native radio JSON files byte-for-byte against AU22. At 1024×768 the full editor overlaps and the map error is obscured; editor correction `f2c73eb1` and map-error presentation `8dee6f63` are source-only relative to this package. A newer candidate must qualify both presentation corrections. [Earlier AU21/AU22 failures and renderer diagnosis](windows-ordinary-1.5.20-to-1.5.21.md) remain failures. The original discarded guest-only VHDX capture was never transferred; the verified 402-file fresh failing-profile ZIP is separate and does not recover it. Fresh ordinary onboarding, true Standard/native-x64 desktop and physical station IO remain open. |
| Q03 | S23 hosted scopes PASS; ordinary AU22→AU23 replacement/core journey PASS within bounds; overall GUI OPEN | Normal all-users UAC and recommended wizard-managed uninstall/reinstall retained Program Files and app data; Delete application data and Finish Run were unchecked. All 3,270 installed payload entries matched. The optional registry reader's quoted-path normalization failure is retained; a focused recheck passed HKLM64 version/location. Ordinary host/worker identity, medium unelevated tokens and empty shortcut arguments passed on both launches. Both normal closes had independent zero app/profile-WebView/9222 and Hamlib observations. One newly created/edited QSO survived restart; the pre-upgrade profile had zero saved QSOs, so nonempty upgrade/media/full-restore acceptance remains open. [Candidate evidence and coverage limits](../../releases/v1.5.23-windows-quality-candidate.md), [historical scope journeys](windows-ordinary-1.5.20-to-1.5.21.md), and [installer scopes](../../WINDOWS_INSTALLER_SCOPES.md) remain separate. |
| Q04 | Redundant idle notifications fixed; native CPU benefit NOT demonstrated | Earlier CW hidden-observer fixes `5fac0a06`/`afdef570` retain heartbeat/freshness/Stop/release regressions. `16c1b6f8` suppresses repeated validated-idle Spot notifications; 27 tests and TypeScript pass. [Paired native development comparison](idle-work-native-correlation.md): Spot IPC 240→240/120s, React commits 809→646, host CPU 1.440→1.501% of one core and worker 0.112→0.119%; no native CPU improvement or release budget pass. Timers/Tauri listeners, separate hook subscriber counts, capture skew and offline errors are explicit. Both 100k QSO hashes survived ordinary Quit; earlier interrupted attempts remain failed. |
| Q05 | Owner cleanup verified in worker/development controls; signed 1.5.22 tiny controls/restart bounded | [Worker correction](preview-export-lifetime-correction.md) fixes invalid_params expectation and captures replacement; exact token/generation retirement, in-flight serialization, replacement and automatic 300s expiry preserve frozen/duplicate/QSO behavior. Live heap 506.931→1.113 MiB after retirement and 1.106 MiB after expiry before another RPC; RSS and footprint are measured separately. [Actual Import Cancel/POTA Close](native-adif-controls.md) each dismiss and receive matching retired:true with zero observed RPC uses; 100k/two-QSO all-column hashes remain unchanged. Individual observer captures are partial; frontend async-owner draining has focused regressions, while native all-user drain remains UNKNOWN. Those development measurements retain their exact source. Separately, [signed 1.5.22 tiny controls/restart](native-1.5.22.md) records actual import review Cancel/confirm, native export/POTA chooser Cancel, POTA Close, duplicate skipping and retained two-QSO restart; independent read-only checks validate ADIF/POTA bytes and all 12 stored QSO columns. No instrumented signed retirement reply, signed heap/TTL/100k, CPU benefit or universal drain is inferred. Earlier development 100k preview took 8.741s; visible-save latency remains open. [Historical 1.5.19 failure](preview-export-lifetime-1.5.19.md) is retained; no schema/durability tuning. |
| Q06 | S22/S23 packages verified; separate Linux runtime PASS, original gate FAIL retained | Frozen S22 `fc7909d6`: [signed Mac pins/build](../../releases/v1.5.22-quality-candidate.md), 9/9 signed-worker tests and [tiny native journey](native-1.5.22.md) retain their bounds. [Original all-platform run 42139380197](ci-1.5.22-original.md): all three builds, actual 12 Linux lifecycle regressions and both hosted Windows scopes PASS, but Linux runtime assertion and secondary report upload FAIL; original journey/operand/cause remain UNKNOWN. [Separate Linux run 42150401167](linux-runtime-1.5.22-audit.md), QA executor `b66c433c`, consumes unchanged original S22 artifact 13469437610: three X11 and nested Wayland 36/36 checks each, owned host/wrapper exits 0, no app signals, observed workers absent; direct GUI-worker wait/EOF UNKNOWN. Recovery 52 / errors 0 preserved private reports. All four `layoutConflictRecovered` values are false, so recovery branch not runtime-exercised. No app rebuild, deadline or assertion relaxation; ordinary desktop/equipment remains OPEN. **S23 Windows-only checkpoint:** [run 42239571377 and both hosted scopes](../../releases/v1.5.23-windows-quality-candidate.md) passed on frozen `9c37130e`, with full payload/provenance/privacy checks. Eight hosted GUI exits retain Chrome_WidgetWin_0 error 1412; their success does not prove orphan-WebView absence. No S23 Mac/Linux package is inferred. |
| Q07 | Candidates 1.5.21, 1.5.22 and 1.5.23 HELD; quality phase OPEN | [S23 Windows candidate](../../releases/v1.5.23-windows-quality-candidate.md) passes hosted scopes and the bounded ordinary Desk/contact/restart recovery; new full-editor/map presentation findings require a newer package. S23 source gates, the original Mac CW-fixture failure and the later QA-only passing correction retain their exact sources. [S22 original package failure and separate same-byte Linux pass](ci-1.5.22-packaged-qualification.md) are unchanged; [1.5.21](../../releases/v1.5.21-quality-candidate.md) remains held. Original htop attribution/full desktop budget, demonstrated idle CPU improvement, fresh/Standard/native-x64 desktop, nonempty upgrade/media/full restore, real Linux desktop, physical equipment and notarization remain open. Daily Mac 1.5.15 and public release unchanged. |

## Latest ordinary Windows checkpoint — 6 November 2026

[Candidate 1.5.23](../../releases/v1.5.23-windows-quality-candidate.md) recovers the
reproduced blank Desk on the preserved fresh AU22 profile. Two ordinary launches,
a synthetic contact's compact create/find/edit/restart journey, exact 12-column
SQLite equality and two independently observed clean exits passed. The full
QSO editor and map-error presentation exposed additional defects at 1024×768;
those findings keep complete GUI acceptance open. The editor correction is pushed at `f2c73eb1` and map-error presentation
at `8dee6f63`; a newly versioned package must prove both in the ordinary UI.
This is filtered-admin ARM64/x64-emulation evidence, with no physical station IO.

### Bounded daily-Mac footprint sample

A separate read-only observation at 15:08 UTC on 6 November measured the existing
1.5.15 host PID 5352 and worker PID 4894. Their physical footprints were
59,114,744 and 1,557,923,928 bytes; the tool's shared-accounted summary was
1,616,923,984 bytes (**1542.019 MiB**). The separately reported swapped summary
was 1,365,917,696 bytes and must not be added again. Worker peak footprint was
1,954,334,976 bytes. A later installed-file identity check confirmed version/pins.
The sample excludes unattributed WebKit/GPU processes, is not a controlled
before/after workload, and does not attribute the original ~7 GB htop incident.
Earlier RSS readings are a different metric/time. Private evidence is
`.build/quality-windows-resume-20261106T131149Z/mac-running-host-worker-footprint.json`
(SHA-256 `f87ea93b915d6eec2dd67a7f14da529b92aba051a1ac95ad8d9430817e6cb7c0`).
Production data, workloads and installed bundle were not changed for this sample.

## Render failure containment — earlier source checkpoint

The earlier source change added a terminal React error boundary around the selected
window surface and its UI-scale provider. A descendant render failure now leaves
an accessible, fixed error message and `UI_RENDER_FAILED` code. The boundary
stores only a boolean and adds no timer, background task, automatic retry, reload,
window-close override or new logging. Existing local React console diagnostics
remain available for diagnosis; the rendered fallback contains no raw exception
or operator data. Healthy surface state and existing child cleanup are preserved
by focused regressions.

Validation: `vitest run src/WindowRenderBoundary.test.tsx --maxWorkers=1` passed
**3/3** after the final review correction, and `tsc --noEmit` passed with no
diagnostics. The tests cover retained healthy state, an actual throwing child,
private rendered output with the original React diagnostic retained, terminal
fallback behavior, unconsumed Escape and existing child cleanup after failure.
No new native, physical-output or packaged-runtime acceptance is inferred.

This is independent error containment, **not a diagnosed correction for the
ordinary Windows 1.5.20/1.5.21 blank Desk**. It does not catch document/module
loading failures, event-handler/asynchronous errors or native WebView painting
failures. Those source checks did not qualify the frozen 1.5.22 package or change
the installed daily application. No package/version/release change was produced
at that checkpoint. This boundary and the harness-loading change below are
included in the later S23 source; its measured package/ordinary qualification is
recorded separately above.

## Acceptance harness loading — earlier source checkpoint

The [hosted macOS beta job for `e14b181c`](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42197903500/job/127825671994)
passed 385 test files / 5,261 tests, then failed the existing Settings startup
JavaScript assertion: **408,635 bytes exceeded the unchanged 408,000-byte limit**.
This was a build-budget failure, not a test or infrastructure pass. The separate
[ordinary CI run](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42197903434)
succeeded.

The common window entry now imports the acceptance harness only inside the
existing native-confirmed acceptance branch. Its activation is awaited before
the surface loads or mounts. Normal Settings startup no longer includes that
harness through the common bootstrap. The query-string/native authorization,
render boundary, diagnostics and all budget limits remain unchanged.

Focused boundary **3/3** and existing acceptance **9/9** tests passed. The local
production build passed TypeScript and every window-bundle assertion; Settings
measured **405,301 bytes**, 2,699 bytes below the limit. Built-manifest inspection
found no acceptance entry in either the common bootstrap or Settings startup
import closure, while retaining the dynamic acceptance entry. The failed hosted
run used Node **22.23.4** and this local check used Node **24.11.1**; these are
qualified build results, not a controlled performance comparison.

The corrected [hosted beta run for `f20f9203`](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42204377529)
subsequently completed **SUCCESS**. Its Node **22.23.4** frontend step passed
**385 files / 5,261 tests** and measured Settings at **405,301 bytes** (gzip
**131,180 bytes**) under the unchanged **408,000-byte** limit. This confirms the
specific hosted size-gate correction. FLEX IQ, complete portable Swift core,
worker/framing/shell/helper checks and the development desktop build passed.
Packaging steps and separate Linux/Windows runtime-acceptance jobs were
**skipped**; this source/build run adds no packaged-runtime qualification.
The [ordinary main CI for documentation head `b94aeecf`](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42204694060)
also completed **SUCCESS**. The original failed budget run remains historical.

Private result receipt SHA-256:
`15efae088a959a63f3a496b63522a4f2cccb968c52606d8f912ab2bd306f7c5d`.
This source/build checkpoint produced no package or installation. The harness-loading
correction is included in frozen S23; later Windows qualification is recorded in
the [1.5.23 candidate record](../../releases/v1.5.23-windows-quality-candidate.md).

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

The newer 1.5.22 signed Mac artifact and bounded two-QSO native transfer/restart
journey have the separate source/pins in [candidate provenance](../../releases/v1.5.22-quality-candidate.md)
and [native evidence](native-1.5.22.md). Original S22 build/Windows scopes passed while Linux failed with unavailable reports;
the separate Linux-only same-byte recheck passed. Original failure and bounded
follow-up remain distinct; the cells below name each measured build/profile.

| Journey | macOS arm64 | Windows x64 | Linux x64 |
|---|---|---|---|
| Current installed process memory | PASS: numeric native capture; incomplete WebKit ownership | NOT RUN | NOT RUN |
| Released-worker repeated health / EOF | PASS on private empty fixture; growth reproduced | NOT RUN | NOT RUN |
| New packaged worker memory / EOF | PASS: [signed 1.5.19 empty/100k/representative](memory-signed-1.5.19.md); full desktop budget open | NOT RUN | NOT RUN |
| Native packaged skip setup → logging → restart | PASS within [1.5.21 first-save/guard journey](native-1.5.21.md); separate [signed22 tiny transfers/restart](native-1.5.22.md) retains its bounds | [S23](../../releases/v1.5.23-windows-quality-candidate.md) hosted scopes PASS; separate ordinary filtered-admin ARM-emulated same-profile upgrade, compact create/edit and restart PASS. Full-editor/map presentation OPEN; earlier blank-Desk failures retained | [S22 Linux recheck](linux-runtime-1.5.22-audit.md): three X11 and nested Wayland 36/36 each PASS in non-root container; original S22 failure retained, real desktop NOT RUN |
| Native radio / rotor Browse → Save → restart | NOT RUN | PARTIAL: AU22 radio first Browse failure/Retry313 and rotor57 saved Dummy1/dummy/9600; AU23 displays retained radio/station values and SQLite rotor/settings match the preserved baseline after restart. New fresh onboarding, connected station and cold-catalogue cause remain open | NOT RUN |
| Hosted silent defaults / registry / shortcuts / installed payload | N/A | PASS within separate S22 and [S23 hosted reports](../../releases/v1.5.23-windows-quality-candidate.md): both scopes, actual defaults, registry/shortcuts, full payload, installed GUI and owned-marker uninstall retention; elevated runner only | N/A |
| Just me default path / no-admin / UAC cancellation | N/A | PARTIAL: strict ordinary Standard token, actual 1.5.20 CU default install and 1.5.20 → 1.5.21 retained-data uninstall/reinstall observed. Separate AU UAC No cancellation has three machine locations absent; original Finish token remains unverified | N/A |
| All users Program Files / ordinary first launch | N/A | S23 retained-path upgrade, full installed payload/registration, strict ordinary launch and Desk/reopen PASS in filtered-admin ARM/x64 emulation. Fresh ordinary onboarding/native-x64/true Standard and full UI acceptance remain OPEN; AU21/AU22 blank failures retained | N/A |
| Same-scope upgrade / cross-scope transition / uninstall retention | NOT RUN | PARTIAL: historical CU20→21 empty-profile retention retained; ordinary AU22→AU23 wizard-managed replacement preserves SQLite settings/rotor and saved radio UI. One new QSO survives restart with exact 12-column equality. Nonempty pre-upgrade contacts/media, full restore and direct overwrite remain unqualified | NOT RUN |
| Native keyboard setup / clipboard / menu and Close guards | PASS within [1.5.21 recorded journey](native-1.5.21.md) | S23 two ordinary title-bar closes and independent process/profile/helper cleanup PASS within timestamps; keyboard setup, clipboard and remaining menu/Close-guard journeys NOT RUN | NOT RUN on real desktop |
| Scaling / multiple displays / native device permissions | NOT RUN | OPEN: ordinary1024×768 exposes full-editor overlap and obscured map error in S23; larger/multiple-display/device-permission qualification NOT RUN | NOT RUN |
| Physical radio / rotor / audio / RF | NOT RUN | NOT RUN | NOT RUN |

Current supported package targets follow the canonical recipes: macOS arm64
WKWebView, Windows x64 WebView2 and Ubuntu 24.04 x64 WebKitGTK. Native voice and
selected direct station providers remain platform-specific. A successful shared
UI test does not add a missing native provider to another OS.

[Platform requirements, scope decisions and ordered acceptance handoff](platform-readiness.md)
record the remaining ordinary-account, real-session, provider and display cells.
