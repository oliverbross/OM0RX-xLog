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
| Q02 | Windows saved components retained; ordinary setup GUI still FAILED/OPEN | `234f0f6e` retains 30 focused Vitest, TypeScript and four Cargo passes. On ordinary Windows 11 ARM/x64 emulation, actual 1.5.20 radio Browse first failed, one Retry loaded 313 models; rotor loaded 57 models, both Dummy 1/dummy/9600. Finish/restart stayed blank. Later settings, rotor and actual radio JSON readbacks prove saved model 1/managed/9600/dummy components. Separate ordinary Debug caller/host/worker token proof does not establish the original Finish token or Console error. After selected-radio ApplicationData backup, actual current-user 1.5.20 → 1.5.21 retained-data uninstall/reinstall retained empty data (0 QSOs, media list []) and four QSO/settings/rotor/radio byte-equality flags; briefly rendered partial Desk then remained blank. After all-users 1.5.21 install, common-shortcut launch and ordinary restart again showed native menus/navy blank without Desk/settings. Those are bounded component/retention observations, not a successful Save/restart GUI or cause diagnosis. [Ordinary Windows evidence](windows-ordinary-1.5.20-to-1.5.21.md) and [source/procedure](../../reviews/QUALITY_FIRST_RUN_2026-11-05.md). **Fresh-base AU22 installation, GUI pending:** after storage recovery and failed in-process boot recovery, the user explicitly authorized discarding the original disposable session. Its guest-only capture was never transferred and is now discarded; no failing-state clone is retained. The independently hash-verified base was imported and booted persistently, completed an ordinary Windows shutdown, and booted again to the desktop. The [subsequent recovery and installation record](windows-ordinary-1.5.20-to-1.5.21.md#authorized-persistent-recovery-and-fresh-au22-installation--6-november-2026) records the fresh filtered-admin ARM64 desktop, actual AU22 UAC cancel/retry, Program Files default, successful install, unchecked Finish Run, matching installed host/worker hashes and common shortcut with empty arguments. The provisional Standard-account classification was corrected using raw deny-only Administrators membership; this is not Standard-user acceptance. Windows remains fixed at 800×600 with a disabled resolution selector, below the app minimum, and guest display setup is pending. No AU22 app launch or GUI pass is claimed. The original blank-Desk failure remains open; both candidates remain HELD. |
| Q03 | Hosted S22 scopes PASS; ordinary Windows 1.5.21 install/UAC cells PARTIAL | [Original S22 receipts](ci-1.5.22-original.md) bind both fresh hosted scopes to one audited payload, real defaults without `/D`, hard 192 self-test, installed GUI, uninstall and marker passes; elevated Server 2022 remains separate from ordinary desktop. In the disposable ordinary Windows 11 ARM guest, current-user 1.5.20 → 1.5.21 retained-data uninstall/reinstall has four exact retention flags true; CU 1.5.21 uninstall left Delete app data unchecked and all three checked CU install/registry/shortcut locations absent. AU 1.5.21 UAC No cancelled with three machine locations absent; authorized credential retry installed at default Program Files with Finish Run unchecked. HKLM64 version 1.5.21/location, exact host bytes and common shortcut target passed; all three old CU locations remained absent. Scoped AU After matched the original Standard profile and passed empty-data integrity/backup plus all four QSO/settings/rotor/radio retention flags. Ordinary AU caller/host/worker token components passed (unelevated, medium, type 1); the Runtime diagnostic still FAILED exit 2 on `GetWinEvent NoMatchingEventsFound`, which does not diagnose the blank GUI. Both ordinary AU Quit and the blank common-shortcut restart followed by ordinary Alt-F4 had fresh host/worker CIM Count 0 with no query error; no force or app-worker EOF claim. Nonempty QSO/media, full restore, successful GUI and native x64 remain open; no ordinary 1.5.22 GUI or Standard-user acceptance inferred; the fresh filtered-admin AU22 installation is recorded separately. [Ordinary Windows receipt](windows-ordinary-1.5.20-to-1.5.21.md), [historical hosted 1.5.21](ci-1.5.21-windows-retry.md) and [scope cells](../../WINDOWS_INSTALLER_SCOPES.md) retain their own bounds. |
| Q04 | Redundant idle notifications fixed; native CPU benefit NOT demonstrated | Earlier CW hidden-observer fixes `5fac0a06`/`afdef570` retain heartbeat/freshness/Stop/release regressions. `16c1b6f8` suppresses repeated validated-idle Spot notifications; 27 tests and TypeScript pass. [Paired native development comparison](idle-work-native-correlation.md): Spot IPC 240→240/120s, React commits 809→646, host CPU 1.440→1.501% of one core and worker 0.112→0.119%; no native CPU improvement or release budget pass. Timers/Tauri listeners, separate hook subscriber counts, capture skew and offline errors are explicit. Both 100k QSO hashes survived ordinary Quit; earlier interrupted attempts remain failed. |
| Q05 | Owner cleanup verified in worker/development controls; signed 1.5.22 tiny controls/restart bounded | [Worker correction](preview-export-lifetime-correction.md) fixes invalid_params expectation and captures replacement; exact token/generation retirement, in-flight serialization, replacement and automatic 300s expiry preserve frozen/duplicate/QSO behavior. Live heap 506.931→1.113 MiB after retirement and 1.106 MiB after expiry before another RPC; RSS and footprint are measured separately. [Actual Import Cancel/POTA Close](native-adif-controls.md) each dismiss and receive matching retired:true with zero observed RPC uses; 100k/two-QSO all-column hashes remain unchanged. Individual observer captures are partial; frontend async-owner draining has focused regressions, while native all-user drain remains UNKNOWN. Those development measurements retain their exact source. Separately, [signed 1.5.22 tiny controls/restart](native-1.5.22.md) records actual import review Cancel/confirm, native export/POTA chooser Cancel, POTA Close, duplicate skipping and retained two-QSO restart; independent read-only checks validate ADIF/POTA bytes and all 12 stored QSO columns. No instrumented signed retirement reply, signed heap/TTL/100k, CPU benefit or universal drain is inferred. Earlier development 100k preview took 8.741s; visible-save latency remains open. [Historical 1.5.19 failure](preview-export-lifetime-1.5.19.md) is retained; no schema/durability tuning. |
| Q06 | S22 packages verified; separate Linux runtime PASS, original gate FAIL retained | Frozen S22 `fc7909d6`: [signed Mac pins/build](../../releases/v1.5.22-quality-candidate.md), 9/9 signed-worker tests and [tiny native journey](native-1.5.22.md) retain their bounds. [Original all-platform run 42139380197](ci-1.5.22-original.md): all three builds, actual 12 Linux lifecycle regressions and both hosted Windows scopes PASS, but Linux runtime assertion and secondary report upload FAIL; original journey/operand/cause remain UNKNOWN. [Separate Linux run 42150401167](linux-runtime-1.5.22-audit.md), QA executor `b66c433c`, consumes unchanged original S22 artifact 13469437610: three X11 and nested Wayland 36/36 checks each, owned host/wrapper exits 0, no app signals, observed workers absent; direct GUI-worker wait/EOF UNKNOWN. Recovery 52 / errors 0 preserved private reports. All four `layoutConflictRecovered` values are false, so recovery branch not runtime-exercised. No app rebuild, deadline or assertion relaxation; ordinary desktop/equipment remains OPEN. |
| Q07 | Signed/frozen 1.5.22 HELD; quality phase OPEN | Source `fc7909d63aa0f4d9fd9abf278c2b08bfd557cdd5`; [provenance](../../releases/v1.5.22-quality-candidate.md). [S22 source gates](ci-1.5.22-source-gates.md): ordinary CI 42139277810, all seven original portability 42139277814 jobs and automatic Mac Beta 42139277785 SUCCESS with retained skips/bounds. Original package gate 42139380197 remains FAILED; bounded Linux-only run 42150401167 PASS is a distinct QA-executor/source result on the same S22 package, not relabelled original acceptance. Earlier d2 ordinary CI 42135022335 / Beta 42135022818 both SUCCESS. [1.5.21](../../releases/v1.5.21-quality-candidate.md) remains HELD; [B0 portability](ci-1.5.21-portability-completed.md) retains original capacity/API failures. Core htop/desktop budget, idle CPU, ordinary Windows blank GUI and successful ordinary GUI/nonempty retention remain OPEN. Prior failures/bytes preserved; no relaxed fixture/deadline/budget, daily install or public release. |

## Render failure containment — source only

The resumed development adds a terminal React error boundary around the selected
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
failures. Source-only work does not qualify the frozen 1.5.22 package or change
the installed daily application. No package/version/release change is included.

## Acceptance harness loading — source only

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
This change adds no package, installation or ordinary Windows acceptance claim.

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
| Native packaged skip setup → logging → restart | PASS within [1.5.21 first-save/guard journey](native-1.5.21.md); separate [signed22 tiny transfers/restart](native-1.5.22.md) retains its bounds | [S22 hosted scopes](windows-runtime-1.5.22-audit.json) PASS in both fresh scopes, two installed GUI runs each; ordinary 1.5.20/1.5.21 ARM-emulated blank GUI remains OPEN | [S22 Linux recheck](linux-runtime-1.5.22-audit.md): three X11 and nested Wayland 36/36 each PASS in non-root container; original S22 failure retained, real desktop NOT RUN |
| Native radio / rotor Browse → Save → restart | NOT RUN | PARTIAL/FAILURE: ordinary 1.5.20 radio first failure/Retry with 313 models, rotor with 57 models, Dummy 1; saved settings/rotor/radio read back and retained through the empty-profile 1.5.21 uninstall/reinstall, but 1.5.20/1.5.21 GUI blank remains unresolved | NOT RUN |
| Hosted silent defaults / registry / shortcuts / installed payload | N/A | PASS: both S22 scopes at actual defaults without `/D`, full payload, hard 192 self-test, installed GUI, uninstall/owned marker; elevated hosted runner only | N/A |
| Just me default path / no-admin / UAC cancellation | N/A | PARTIAL: strict ordinary Standard token, actual 1.5.20 CU default install and 1.5.20 → 1.5.21 retained-data uninstall/reinstall observed. Separate AU UAC No cancellation has three machine locations absent; original Finish token remains unverified | N/A |
| All users Program Files / ordinary first launch | N/A | PARTIAL/FAILURE: AU 1.5.21 authorized default install/registry/shortcut and ordinary token components PASS; Finish Run unchecked, separate common-shortcut launch/restart remained blank. Runtime outer event-query failure is separate from GUI cause | N/A |
| Same-scope upgrade / cross-scope transition / uninstall retention | NOT RUN | PARTIAL: CU 1.5.20 → 1.5.21 retained-data uninstall/reinstall preserved empty data (0 QSOs, media list []) with four retention flags true, CU uninstall left data unchecked and three CU locations absent; AU 1.5.21 install checked CU locations still absent. AU After empty-profile integrity/backup and all four byte-retention flags PASS. Direct in-place upgrade, nonempty workspace/media, full restore and successful GUI remain unqualified | NOT RUN |
| Native keyboard setup / clipboard / menu and Close guards | PASS within [1.5.21 recorded journey](native-1.5.21.md) | NOT RUN on ordinary desktop | NOT RUN on real desktop |
| Scaling / multiple displays / native device permissions | NOT RUN | NOT RUN | NOT RUN |
| Physical radio / rotor / audio / RF | NOT RUN | NOT RUN | NOT RUN |

Current supported package targets follow the canonical recipes: macOS arm64
WKWebView, Windows x64 WebView2 and Ubuntu 24.04 x64 WebKitGTK. Native voice and
selected direct station providers remain platform-specific. A successful shared
UI test does not add a missing native provider to another OS.

[Platform requirements, scope decisions and ordered acceptance handoff](platform-readiness.md)
record the remaining ordinary-account, real-session, provider and display cells.
