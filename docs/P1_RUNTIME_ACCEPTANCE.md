# P1 follow-up: packaged runtime acceptance

Date: 2026-10-12. Branch: `codex/unified-xlog-prototype-p1`.

## Scope and preservation

This stage packages and tests the existing synthetic cross-platform prototype. It does not integrate live xCat/xCluster/Hamlib providers, touch installed apps, open a live logbook, change station policy, use credentials, connect to the Slovakia PC, or transmit. Stable macOS v0.3.0 remains unchanged and available. The prototype does not replace that release or claim its full functionality.

Starting source: `c8956be50231c120f308ecf316721db1d44249b8`. Initial recheck matched all three installed executable hashes and the pre-existing xCat diff hash in [P0](P0_MACOS_BASELINE.md). Existing work is not included in packaging commits by accident.

## Implemented acceptance gates

- Linux: Debian package plus relocatable archive, bundled Swift runtime closure, explicit Ubuntu system dependencies, native loader/provenance inventories and notices. A separate runtime-only container installs the actual `.deb`, checks worker framing/self-test, launches the native WebKit GUI twice, tests the relocated archive and forces a fourth native Wayland launch. Network disabled, non-root, no Swift/Rust/Node/compiler tooling. Xvfb/Mesa and nested Weston provide the test displays; the WebKit sandbox is not disabled.
- Windows: portable ZIP with app-local Swift/SQLite/CRT import closure, native import audit, payload hashes and notices. A fresh native Windows job does not install Swift; it verifies absence probes, actual loaded-module origins, worker framing/self-test and two native WebView2 launches. Evergreen WebView2 is an explicit OS prerequisite, not silently installed.
- Shared native UI: opt-in CLI mode observes 14 real embedded-UI checks: three worker diagnostics, rendered map, synthetic cluster selection, keyboard logging, saved QSO readback, F2 focus, Escape clear, both profiles, native monitor open/readback and final desk. A bounded report is written only to the new CLI-selected file. Normal launches do not run acceptance actions.
- Distribution metadata: resolved JavaScript and Cargo components, available license notices, lockfiles, platform-specific runtime origins/hashes and upstream notices. This is not a complete certified SBOM, independent license review or signing approval.

## Results

| Gate | Result |
| --- | --- |
| Local macOS frontend | 21 passed; TypeScript/Vite build passed |
| Local Rust shell | 9 passed |
| Local portable Swift / process framing | 7 Swift and 2 process tests passed |
| Native three-platform matrix | 39 tests passed, zero failed per OS: 21 frontend, 9 Rust, 7 portable Swift, 2 worker-process tests. Native macOS, Windows and Linux builds/package steps passed |
| Original macOS application | Complete suite: 43 tests passed; installed binary unchanged |
| Local ad-hoc Mac prototype | Strict bundle signature verified; corrected native acceptance passed all 14 checks, including 342 loaded geographic features, 72/72 final-frame land pixel probes and 58/58 monitor-frame probes. Test bundle remains separate from installed apps |
| Linux packaging permissions | 2 regression tests passed; owner-only source notices become readable by installed users; executable permissions preserved |
| Native Linux packaging/runtime | Passed on `744e97033800df55e62fcaa7a9f467ac45ea3aab`: four launches, all 14 checks each, final map 66/66 and monitor 80/80 land pixels each. Installed `.deb`, restart, relocated archive and nested Wayland passed; native screenshots reviewed. [Run 38208026918](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38208026918) |
| Native Windows packaging/runtime | Passed on `744e97033800df55e62fcaa7a9f467ac45ea3aab`: 11 harness checks, two launches with all 14 UI checks each and exit 0; final map 59/59 and monitor 67/67 land pixels each. No Swift installation detected by documented probes; actual loaded-module origins passed. WebView2 131.0.2903.86. [Run 38208313414](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38208313414) |
| Final Windows consumer-desktop acceptance | Pending user download/test; only the remote station machine is available, and no remote deployment is authorized/performed here |

Local/native test reports are distinct from full production station acceptance. The URLSession dependency check still uses an intercepted fixture, not a real HTTPS server. All QSO data is session-memory synthetic data.

## Exact test packages

Package source: `744e97033800df55e62fcaa7a9f467ac45ea3aab`. Later documentation-only commits do not change these binaries. The [native matrix](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38207678307) builds the three operating systems; the [original Mac suite](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38207678263) also passed.

- [Windows portable ZIP artifact](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38207678307/artifacts/11727874156): download the GitHub artifact, extract its outer wrapper, then extract `OM0RX-xLog-Prototype-windows-x86_64.zip` into a new folder. Keep every DLL beside the executables. Follow the [desktop test checklist](P1_WINDOWS_RUNTIME_PACKAGING.md#users-later-windows-desktop-test). This is an unsigned synthetic prototype, not an installer for the station agent or a replacement for the stable applications.
- [Ubuntu 24.04 amd64 Debian/archive artifact](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38207678307/artifacts/11727514686): use the `.deb` or relocatable `.tar.gz` described in the [Linux recipe](P1_LINUX_RUNTIME_PACKAGING.md).

SHA-256 values below apply to the inner package files, not GitHub's outer artifact ZIP. All three downloaded payload hashes were independently checked locally. Actions artifacts require GitHub access and expire after 30 days; these are test downloads, not permanent release assets.

| Package | SHA-256 |
| --- | --- |
| Windows portable ZIP | `522120e2a795e0a2e071577a1ce4dab0ec94485e92aa9204be8dc8448f69e135` |
| Ubuntu `.deb` | `a0e915c312bc7808c717e384f10cd7a4c2c94b62f81a90be1961eb80f2542e84` |
| Linux `.tar.gz` | `a17e1c7bac582c298eaad1441b26d129501dc73e8849c11e457c448110318baa` |

Compact native reports and selected screenshots are retained in [source-controlled evidence](evidence/p1-runtime-744e970/), so acceptance evidence survives artifact expiration. Larger loader inventories and complete diagnostic output remain in the associated Actions artifacts.

## Remaining release boundaries

Windows hosted-runner acceptance cannot establish Windows 11/10 physical desktop behavior. Native Windows screenshots show the complete desk/map, but the hosted 1024×768 desktop taskbar covers the lower edge; this is not full small-screen/high-DPI layout acceptance. Wine is not substituted for native Windows/WebView2 proof. Linux Xvfb and nested Wayland do not prove physical GPUs, a physical Wayland session or arbitrary distributions. Production release still needs final supported-OS decisions, Windows signing, macOS Developer ID/notarization for the new shell, full license/SBOM review, application update/rollback and the later real-provider/data migration phases.

Final preservation check: installed xLog, xCat and xCluster executable hashes still match P0; the existing xCat diff hash is unchanged. Remote `main` remains `1ee876c506bea7a42cf940cd25d0a397f7d66331` and stable `v0.3.0` remains `325c59a538564c373c6169a718a73780d7455546`. No production app, logbook or station was replaced or restarted.

## Native findings resolved during this stage

1. Visual Studio's `v143` alias did not contain the assumed CRT layout. Packaging now validates versioned x64 redistributable directories.
2. Swift's compiler-host and application-runtime `BlocksRuntime.dll` differ. Packaging selects the official versioned runtime component, records shadowed candidates and still rejects conflicting same-tier versions.
3. A Microsoft redistribution reference returned 404. The canonical URL was verified, all 17 notice endpoints checked, and bounded download errors identify the failed notice without dumping response HTML.
4. Two cached Cargo notices had owner-only permissions. Shared metadata and Linux staging now normalize permissions; non-root install/readback checks caught this defect.
5. GTK's native select arrow clipped `SSB` to `SS`. The desktop mode track is now 88px; existing design and control behavior remain unchanged. Screenshot capture waits briefly for native close animations rather than recording a fading monitor overlay.
6. Native Windows monitor creation deadlocked inside a synchronous Tauri command. Window creation now uses the documented async command path; failed GUI runs retain screenshots, native report, module evidence and diagnostic streams.
7. A positive map feature count did not prove complete pixels after closing the monitor. Acceptance now closes/focuses before collecting its final frame, verifies loaded tiles and samples actual land framebuffer pixels. Focus triggers a normal map resize/repaint. Every interior probe must match; border/spot neighborhoods are excluded geometrically, sampling is bounded to three attempts, and failure diagnostics retain mismatched counts/coordinates/colors. This avoids both missing-tile false passes and coastline anti-aliasing false failures.

Detailed recipes: [Linux](P1_LINUX_RUNTIME_PACKAGING.md), [Windows](P1_WINDOWS_RUNTIME_PACKAGING.md). The [initial artifact inventory](P1_RUNTIME_PACKAGING_GAPS.md) remains historical evidence; the new runtime artifacts/results supersede only the gaps directly tested here.
