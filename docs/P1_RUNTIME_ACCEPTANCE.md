# P1 follow-up: packaged runtime acceptance

Date: 2026-10-12. Branch: `codex/unified-xlog-prototype-p1`.

## Scope and preservation

This stage packages and tests the existing synthetic cross-platform prototype. It does not integrate live xCat/xCluster/Hamlib providers, touch installed apps, open a live logbook, change station policy, use credentials, connect to the Slovakia PC, or transmit. Stable macOS v0.3.0 remains unchanged and available. The prototype does not replace that release or claim its full functionality.

Starting source: `c8956be50231c120f308ecf316721db1d44249b8`. Initial recheck matched all three installed executable hashes and the pre-existing xCat diff hash in [P0](P0_MACOS_BASELINE.md). Existing work is not included in packaging commits by accident.

## Implemented acceptance gates

- Linux: Debian package plus relocatable archive, bundled Swift runtime closure, explicit Ubuntu system dependencies, native loader/provenance inventories and notices. A separate runtime-only container installs the actual `.deb`, checks worker framing/self-test, launches the native WebKit GUI twice and tests the relocated archive. Network disabled, non-root, no Swift/Rust/Node/compiler tooling. Xvfb/Mesa provide the test display.
- Windows: portable ZIP with app-local Swift/SQLite/CRT import closure, native import audit, payload hashes and notices. A fresh native Windows job does not install Swift; it verifies absence probes, actual loaded-module origins, worker framing/self-test and two native WebView2 launches. Evergreen WebView2 is an explicit OS prerequisite, not silently installed.
- Shared native UI: opt-in CLI mode observes 14 real embedded-UI checks: three worker diagnostics, rendered map, synthetic cluster selection, keyboard logging, saved QSO readback, F2 focus, Escape clear, both profiles, native monitor open/readback and final desk. A bounded report is written only to the new CLI-selected file. Normal launches do not run acceptance actions.
- Distribution metadata: resolved JavaScript and Cargo components, available license notices, lockfiles, platform-specific runtime origins/hashes and upstream notices. This is not a complete certified SBOM, independent license review or signing approval.

## Results

| Gate | Result |
| --- | --- |
| Local macOS frontend | 17 passed; TypeScript/Vite build passed |
| Local Rust shell | 9 passed |
| Local ad-hoc Mac prototype | Strict bundle signature verified; native acceptance passed all 14 checks, including 342 loaded geographic features and live monitor readback of synthetic W1AW |
| Native Linux packaging/runtime | Pending first CI execution for this implementation |
| Native Windows packaging/runtime | Pending first CI execution for this implementation |
| Final Windows consumer-desktop acceptance | Pending user download/test; only the remote station machine is available, and no remote deployment is authorized/performed here |

Local/native test reports are distinct from full production station acceptance. The URLSession dependency check still uses an intercepted fixture, not a real HTTPS server. All QSO data is session-memory synthetic data.

## Remaining release boundaries

Windows hosted-runner acceptance cannot establish Windows 11/10 physical desktop behavior. Wine is not substituted for native Windows/WebView2 proof. Linux Xvfb does not prove Wayland, physical GPUs or arbitrary distributions. Production release still needs final supported-OS decisions, Windows signing, macOS Developer ID/notarization for the new shell, full license/SBOM review, application update/rollback and the later real-provider/data migration phases.

Detailed recipes: [Linux](P1_LINUX_RUNTIME_PACKAGING.md), [Windows](P1_WINDOWS_RUNTIME_PACKAGING.md). The [initial artifact inventory](P1_RUNTIME_PACKAGING_GAPS.md) remains historical evidence; the new runtime artifacts/results supersede only the gaps directly tested here.
