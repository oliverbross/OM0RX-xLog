# P0/P1 implementation evidence

Date: 2026-10-12. Development branch: `codex/unified-xlog-prototype-p1`.

This is the initial P1 evidence record. The subsequent [packaged runtime acceptance ledger](P1_RUNTIME_ACCEPTANCE.md) records the newer test counts, native Windows/Linux runtime checks and remaining release boundaries. Historical counts and artifacts below are retained as evidence, not presented as the latest packages.

## Production preservation

The [P0 manifest](P0_MACOS_BASELINE.md) records production application hashes, source baselines and test counts. The v0.3.0 release is explicitly labelled **Current working macOS-only release**; its original ZIP and tag are preserved. README/release documentation was published separately to main before prototype code. The prototype has a separate bundle identity, output directory and memory-only fixtures. No production app is replaced/restarted, no live logbook is opened, and no station/configuration/credential write is part of P1.

Existing uncommitted xCat work is preserved, not silently swept into this repository or called a released baseline. Reconciliation remains required before extraction of those modules.

Final preservation recheck: all three installed application executable hashes still match the P0 manifest; xCat's pre-existing binary diff remains `fad2daaa7eacb924962ec8d0f6c1dad7eaa7993a170cc0b88d2cb731982a5939`; xCluster remains clean. The stable release tag still resolves to `325c59a538564c373c6169a718a73780d7455546`, and main contains the docs-only preservation commit `1ee876c506bea7a42cf940cd25d0a397f7d66331`. Prototype implementation remains on its separate branch.

## Evidence ledger (updated as gates run)

| Check | Result / boundary |
| --- | --- |
| Original xLog suite | 43 tests, seven suites passed after conditional portability imports |
| Existing xCat / xCluster baseline | 58 / 22 tests passed; not retested as integrated modules |
| Portable Swift unit suite, macOS | 7 passed |
| Real worker process framing, macOS | 2 passed: open stdin, fragments, malformed/oversized recovery |
| Worker self-test, macOS | ADIF roundtrip, semantic hash, SQLite memory, XML, SHA-256 and URLSession mock passed |
| Frontend | Final local suite: 12 tests passed; production bundle built; npm audit zero advisories at verification |
| Hamlib 4.7.2 macOS | 8 dummy protocol checks passed; owned process/port cleanup proven; see dedicated report |
| Rust shell tests | 5 passed locally |
| Three-platform native CI | Final source `46f1bca9ca150833cbad034927e88a4b16a01a55`: macos-14, ubuntu-24.04 and windows-2022 all passed; each ran 7 Swift, 2 process, 5 Rust and 12 frontend tests (26 passed, zero failures per platform), built its native executable and uploaded development artifacts |
| Browser / packaged UI | Mac packaged app launched; native health, self-test and ADIF IPC passed. Browser map zoom/keyboard pan passed. Compact desk and monitor now fit reviewed viewports |

Initial real-process testing found Foundation's read-up-to-count blocked while stdin stayed open; worker now uses native bounded reads and the regression passes. Initial browser rendering caught a MapLibre worker-load problem, so visual verification is not inferred from the frontend build.

The MapLibre runtime also exposed a CSS collision: the library's relative positioning reduced the map container to zero height. A specific container rule fixes actual geography/marker rendering, verified in browser and the packaged WKWebView. Browser zoom and keyboard pan were exercised. The library worker is emitted as a local asset; no external tiles or worker workaround are required.

Packaged macOS acceptance used only the separate `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Prototype.app`. Keyboard cluster selection populated W1AW, Command-Return created one session-memory QSO, and a later synthetic AC7A selection showed 7.046700 MHz/FT8 in both main and detached monitor. Restart began again with zero session QSOs. The monitor is a normal window, not always-on-top. This is synthetic state synchronization, not actual radio timing proof.

Local release compilation encountered the [Rust/LLVM macOS stripped-dylib alignment issue](https://github.com/rust-lang/rust/issues/157750); explicit unstripped release build dependencies resolved it. The initial development bundle launched but failed strict signature verification. `prototype/scripts/package-macos.sh` now ad-hoc signs the bundled worker and application, then passes `codesign --verify --deep --strict`. This uses no Apple account/credentials and is **not** Developer ID signing or notarization.

The initial matrix [run 38196764698](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38196764698) uploaded separate development executables for all three platforms. The original Mac app's [test-and-package CI](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38196764686) also passed. These are developer-runner builds, not end-user installer acceptance.

Final implementation source: `46f1bca9ca150833cbad034927e88a4b16a01a55`. Its [three-platform rerun](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38198293220) completed successfully on all three platforms; exact counts above were read from completed job logs. Development artifact IDs are macOS `11723763701`, Linux `11724182668` and Windows `11723794483`. The original Mac app [CI 38198293254](https://github.com/oliverbross/OM0RX-xLog/actions/runs/38198293254) also passed. Subsequent evidence-only commits do not change this implementation baseline.

## Visual evidence

The preserved design was checked at desktop 1440×940, minimum desktop 1000×720 and detached monitor 780×600. The reviewer found below-fold spectrum/footer content, cropped initial marker framing and monitor attribution/footer overflow; these were corrected in one layout batch. Its verdict scored all three resolved, then caught a narrow Mode field regression; that field was widened without further redesign.

The normal sidebar remains readable and non-scrolling. At the minimum desk size the complete spectrum and map attribution/footer are visible; all nine synthetic spots fit the initial camera. Manual pan/zoom or selection stops automatic initial reframing. Native title bars and font rendering remain platform-specific. Root `PRODUCT.md`/`DESIGN.md` are preserved.

Final reviewer disposition: **ship for the scored prototype fixes**, not production parity. Published captures: [desktop](screenshots/prototype-desktop.png), [minimum desktop](screenshots/prototype-minimum.png), [monitor](screenshots/prototype-monitor.png). The [design parity record](../prototype/DESIGN_PARITY.md) records adaptations and remaining differences without changing the incumbent design system.

## Scope achieved vs remaining

The prototype compiles the original `ADIF.swift`, `Models.swift`, `QSOADIF.swift`, `SemanticQSOIdentity.swift` and `WavelogClient.swift` directly in a portable target. Production source changes are limited to platform-conditional Crypto/FoundationNetworking imports. This proves an extraction route, not portability of the full logbook, awards, backups or station services.

The P1 frontend preserves the operator-console vocabulary and selected-spot workflow in synthetic data. It does not replace the production screens. MapLibre uses offline vector polygons; matching production cartography, text/performance and accessibility across all three webviews are open acceptance items. The ~1.29 MB uncompressed main JS bundle needs a measured startup/memory budget before release.

Still required before G1 architecture approval / P2 production migration:

- Packaged GUI launch and behavior on Windows/Linux (native developer-runner builds/tests have passed; those do not prove WebView rendering on end-user desktops).
- Clean-machine runtime closure, all bundled Swift/SQLite/Hamlib dependencies, signing/notarization and supported OS matrix. The [runtime packaging inventory](P1_RUNTIME_PACKAGING_GAPS.md) records exact initial CI artifact contents and the unproven Windows/Linux dependency closure; raw CI executables are not end-user installers.
- Actual HTTP socket/TLS transport tests (the URLSession self-test is an intercepted mock, not HTTPS proof).
- Worker crash/hang/restart and full persistent core/backup/restore migration acceptance.
- Local helper supervision integrated with provider capabilities; real radio/rotor tests only in an explicitly approved commissioning phase.
- Full CAT/CLU parity inventory, current xCat dirty-work reconciliation, shared settings/credentials and existing-user migration.

**Status: P0 preservation complete; P1 development prototype built/tested on all three platforms, with native macOS UI acceptance. G1 remains open for clean-machine packaging, Windows/Linux GUI acceptance and the remaining checks above. No production multi-platform release or full integration claim.**
