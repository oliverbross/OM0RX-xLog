# Platform scope and remaining acceptance

This is the Q06 readiness contract. Successor 1.5.20, source
`3d9cb0981c30764f1188db350ffebc22a5f328a7`, passed the local signed Mac journey;
its [original all-platform gate](ci-1.5.20-original.md) passed builds/Linux native
runtime but failed both Windows installed local-logbook self-tests after
portable/default-path partial passes. Candidate 1.5.20 is HELD. Measured 1.5.19 has
frozen source `72a5926c2878ceedf70789ff4bae619ae5e14511`; its cross-platform
gate failed Windows frontend before packaging.
Earlier 1.5.18 receipts retain source `0b7c669663841c2e55569b0c21c76ad03805cad7`
and their original scope. A build target is not a claim that every provider or
ordinary desktop journey is qualified. Older P1 runtime receipts remain historical.

| Target | Runtime / distribution | Current qualification boundary |
|---|---|---|
| macOS arm64, macOS 14+ | System WKWebView; app ZIP; bundled native worker, Python and Hamlib | Signed local 1.5.20 on macOS 27.2 build 26B123; [recorded offline journey PASS](native-1.5.20.md). Minimum-OS, physical station, full screen/scaling/multiple-display, notarization and complete memory budget unqualified. |
| Windows x64, intended Windows 11 | Evergreen WebView2; portable ZIP plus separate current-user and all-users NSIS installers; app-local worker/Swift/SQLite/Hamlib/Python | Hosted 1.5.20 Server 2022 portable native checks PASS; real silent defaults/hives/shortcuts/payload PASS, installed local-logbook self-test FAIL before GUI/uninstall. WebView2 registry version 131.0.2903.86 is recorded separately from active-engine proof. Ordinary Windows 11 account, UAC, prerequisites, upgrades and physical station remain NOT RUN. |
| Ubuntu 24.04 amd64 | WebKitGTK 4.1 / GTK3; DEB plus relocatable archive; bundled worker/Swift/Hamlib and declared OS Python 3.12 | 1.5.20 runtime-only container PASS: non-root, four embedded UI launches across Xvfb/nested Wayland and relocation; WebKitGTK 2.52.6. Real desktop/GPU/session remains separate. Other distributions and architectures are not accepted here. |

Linux runtime dependencies are maintained in the canonical
[`linux-runtime-dependencies.txt`](../../../prototype/scripts/linux-runtime-dependencies.txt),
including WebKitGTK, GTK, SQLite, Secret Service, Python 3.12 and Mesa. The
package checks its actual transitive loader closure. A desktop Secret Service
provider owns credential storage/unlocking. Windows portable packages require
Evergreen WebView2; installers embed its online bootstrapper. Neither a network
bootstrapper nor an elevated hosted runner proves an offline standard-account
prerequisite route. Users need no Swift/Rust/Node compiler toolchain.

The current sources deliberately distinguish broad native platform services
from the offered Hamlib route. Native voice and indexed Direct FLEX CWX have
Mac-specific capability boundaries. Keep unsupported direct providers disabled
with their existing explanation; do not represent them as successful shared
workflows. Radio/rotor saved configuration, explicit connection/readback and
physical operation are separate evidence cells.

## Ordered handoff

| Priority / owner | Open scope | Concrete next evidence |
|---|---|---|
| P1 runtime | Original ~7 GB htop incident and whole-app envelope | User specifies htop's MEM column. Identify its process, field definition/units and workload; collect positively attributed native/WebKit memory and relevant open/use/close cycles. Keep unknown/shared helpers separate. The worker task-retention repair alone does not close this scope. |
| P1 runtime | Provisional idle CPU goal not met | [Concurrent offline idle](desktop-idle-1.5.18.md) measured host ~1.05% of one core; [single-candidate follow-up](desktop-steady-ten-1.5.18.md) measured 2.0063%. [Saved profiling](host-profile-1.5.18.md) points to WKWebView/Tauri IPC but cannot name the feature owner; post-profile exit cause is unobserved. Correlate redacted command/timer/subscriber counters with host/renderer work, separate private guard overhead, then repair and repeat affected intervals. Preserve isolation/lease/Stop supervision; no target was relaxed. |
| P2 runtime | Preview/export retained storage | [Signed 1.5.19 worker-only lifetime](preview-export-lifetime-1.5.19.md) measured ~525 MiB allocated structures while owners remained valid and 559.11 MiB footprint after expired reads; source guards reject without clearing. Define explicit close/release and expiry ownership while preserving frozen snapshots, duplicate matching and in-flight readers; capture live owners and settled memory after release/replacement. Twenty cycles were nonmonotonic, not an unbounded-leak proof. The original harness error and missing replacement sample remain recorded. |
| P1 Windows desktop | Q02 actual equipment setup | Run [WIN-SETUP-01](../../reviews/QUALITY_FIRST_RUN_2026-11-05.md#native-windows-handoff-win-setup-01) on exact installers: actual bundled radio/rotor Browse, separate save receipts, restart/readback, failure/retry; explicit read-only connection with suitable equipment separately. |
| P1 Windows packaging | Q03 standard-user and Program Files acceptance | Execute the [scope matrix](../../WINDOWS_INSTALLER_SCOPES.md#q03-acceptance-ledger) on fresh Windows 11 snapshots. Record paths without `/D`, token/elevation, UAC approve/cancel, prerequisite outcome, both hives/shortcuts, upgrade/rollback, retained workspace/external media and a second user. |
| P1 Windows runtime | Installed local-logbook self-test | [Paired unchanged-worker diagnostics](ci-1.5.20-windows-diagnostic-paired.md) reproduce TEMP-root sensitivity; RPC and [four failed native regressions](ci-windows-restore-boundary-baseline.md) identify the reference-directory rollback rename at 262–266 UTF-16 units. Repair `d2d22afb` passed [19 XCTest + 17 Swift Testing cases](ci-windows-restore-boundary-fixed.md), including unchanged original regressions, no-overwrite and rollback safety. Qualify newly versioned 1.5.21 at the original nested TEMP/defaults before any installed acceptance claim. Original 1.5.20 assertions remain failed; no count or deadline change. |
| P1 desktop QA | Common native outcomes | On exact supported packages, run keyboard create/edit/search/recovery, ADIF/backup round trip, large-log paging, cluster/map/awards/contest and orderly shutdown. Keep container simulations distinct from ordinary desktop runs. |
| P2 desktop QA | Native display/accessibility | Exercise 1024×768 where supported, Windows 100/125/150/200%, Retina/Linux scales, light/dark, clipboard, file dialogs, focus/screen-reader labels, detached windows, removed displays and geometry recovery. Capture a screenshot only for an observed defect. |
| P2 platform owner | Missing native providers | Publish provider-specific support decisions and prioritize enablement separately. Shared local logging must work independently of optional direct station providers. No new provider feature is added during this quality cycle. |
| P2 release owner | Distribution readiness | Windows publisher signing, macOS notarization, final licenses/SBOM and ordinary-user update/rollback evidence remain separate release gates. No daily install or public release is authorized by a passing candidate alone. |

No remote ordinary Windows desktop is available in this session: the connected
Desktop Commander inventory returned only one offline Mac. Hosted CI can still
qualify its bounded native package routes. Missing physical/ordinary-account
cells remain **NOT RUN**, with the procedures above ready for the owning seat.
