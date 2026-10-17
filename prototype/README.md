# Unified xLog prototype — P1, not the production app

Current P2 iteration is **Mac-first real integration**: the runtime now builds
`OM0RX-xLog.app` (`1.2.9`) with actual persistent services, not
the older fixture-only preview. See [current setup and acceptance](../docs/P2_MAC_LIVE_INTEGRATION.md).
The earlier Prototype app and stable native apps remain installed and unchanged.
Automatic CI selects Mac only. The historic Windows/Linux packaging machinery
below is retained, but must not be treated as acceptance of the new live services.

P2a follow-up on `codex/unified-xlog-integration-p2`: the desktop now uses extracted xCluster parser/classification rules for the synthetic cluster and band-map labels, and adds shared station contracts/observed-state diagnostics. See [P2 integration evidence](../docs/P2_INTEGRATION_ACCEPTANCE.md). The 128-QSO memory-only session limit preserves complete classification history within bounded IPC; full durable storage and live providers are later work. The P1 evidence below remains historical baseline, not proof of complete suite integration.

This isolated development application tests one React/Tauri interface and a retained Swift domain worker on macOS, Windows and Linux. It does **not** replace `/Applications/OM0RX-xLog.app`, xCat or xCluster. Use [the current working macOS-only release](https://github.com/oliverbross/OM0RX-xLog/releases/tag/v0.3.0) for real logging/station operation.

## What is implemented

- Preserved navy/cyan operator desk, active QSO, contextual card, station pulse, band maps, offline world map, cluster, session logbook, station profile and detached monitor.
- A single selected-spot reducer connects synthetic cluster/map/band-map selection to the synthetic radio and QSO draft. Profiles are simulator or disconnected/manual; nothing opens a station socket.
- Real bounded JSON IPC to a Swift worker. Five existing domain source files are compiled directly, not copied or reimplemented. Diagnostics exercise ADIF, semantic identity, SQLite, XML, SHA-256 and a mocked URLSession callback.
- Separate Hamlib 4.7.2 **dummy-only** harness: [evidence](../docs/P1_HAMLIB_EVIDENCE.md). Helpers are not integrated into the UI yet.

This is a feasibility slice, **not complete xCat/xCluster integration or feature parity**. Session QSOs are memory-only and disappear on reload/quit. No live DB, credentials, Wavelog, hardware or existing settings are opened. No worker method accepts a command, executable, device or URL. See [acceptance evidence](../docs/P1_PROTOTYPE_ACCEPTANCE.md) and the [complete programme](../docs/LOCAL_STATION_CROSS_PLATFORM_PLAN.md).

Preview the [desktop](../docs/screenshots/prototype-desktop.png), [minimum desktop](../docs/screenshots/prototype-minimum.png) and [detached monitor](../docs/screenshots/prototype-monitor.png). [Design parity notes](DESIGN_PARITY.md) distinguish preserved identity from remaining production parity work.

## Build and test on macOS / Linux

Prerequisites: Swift 6-compatible toolchain, Rust stable, Node 22.12+ (or supported newer LTS), platform Tauri build dependencies and SQLite headers. These are developer prerequisites; final users must not need them.

```sh
XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests
bash prototype/scripts/build-worker.sh
cd prototype
npm ci
npm test
npm run build
node scripts/stage-worker.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
```

Run `npm run tauri -- dev` after staging for the isolated desktop window. For browser-only visual preview use `npm run dev`; it explicitly reports that native worker IPC is unavailable. Never treat the preview as worker acceptance.

macOS `.app` development bundle: run `bash prototype/scripts/package-macos.sh` from the repository root (after `npm ci` in `prototype`). It builds, signs and strictly verifies the isolated bundle. Notarization remains a separate acceptance step. It is named **OM0RX-xLog**, retains identifier `com.oliverbross.xlog.integration` for installed-data and Keychain continuity, and uses the shared xLog identity. No installer modifies Applications. Native title bars/file dialogs remain platform-specific.

## Windows

Use PowerShell with Swift and Rust developer environments enabled. Install SQLite through vcpkg (`sqlite3:x64-windows`), set `XLOG_SQLITE_PREFIX` to that installed triplet, and add its `bin` directory to PATH. Then:

```powershell
$env:XLOG_PORTABLE_ONLY = '1'
swift test --scratch-path .build/prototype-tests -Xcc "-I$env:XLOG_SQLITE_PREFIX/include" -Xlinker "/LIBPATH:$env:XLOG_SQLITE_PREFIX/lib"
./prototype/scripts/build-worker.ps1
cd prototype
npm ci
npm test
npm run build
node scripts/stage-worker.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
```

The [matrix workflow](../.github/workflows/prototype.yml) is the canonical CI recipe. Development executables may require installed Swift runtime libraries. Building on a developer runner does not prove clean-machine packaging, signing or hardware operation.

## Runtime packaging and native acceptance (P1 follow-up)

The follow-up packages Swift runtime dependencies with the prototype, without changing the stable applications. After building, generate dependency evidence with `node prototype/scripts/distribution-metadata.mjs` from the repository root. Then use the [Linux packaging recipe](../docs/P1_LINUX_RUNTIME_PACKAGING.md) or [Windows portable packaging recipe](../docs/P1_WINDOWS_RUNTIME_PACKAGING.md). Runtime packages are distinct from the older raw development-executable artifacts.

The workflow tests Linux packages in a network-disabled, non-root Ubuntu 24.04 runtime container without development toolchains. Windows acceptance uses a fresh native runner with no Swift setup, app-local DLLs, a restricted child environment and loaded-module evidence. That hosted Windows Server image is **not** Windows 11 consumer-desktop acceptance. The user will perform the final separate-desktop download/launch check; no station PC is remotely modified by this workflow.

The explicit `--acceptance-report /absolute/new/report.json` switch exercises the actual embedded WebView and Swift helper, synthetic spot selection, keyboard logging, loaded map geometry and detached monitor readback. It records 14 observed checks, then exits; it is disabled in normal launches. Report targets must be new files. See the [current packaging acceptance ledger](../docs/P1_RUNTIME_ACCEPTANCE.md) for executed results and remaining gates, rather than assuming the existence of a script establishes a pass.

In current `integrated-local-ui` reports, `keyboard_editor` specifically verifies the main native Log QSO menu route and the editor's Escape-to-callsign focus behavior, with the canonical draft unchanged. `details.editorFocus.physicalAccelerator` is `false`: this does not test physical OS key delivery or Cmd/Ctrl+L, which now opens the independent native Log QSO window.

## Isolation and licensing

The shell exposes only diagnostic worker requests and monitor creation; it has no shell/network/filesystem plugin. IPC has bounded framing, IDs, method allowlisting, four concurrent requests and an eight-second kill/reap deadline. The P1 shell intentionally uses one worker per request; persistent provider ownership/recovery belongs to P2.

The map bundles the existing attributed DXCC geometry (see its source/resource metadata). MapLibre renders offline polygons, not copied Apple imagery. Dependencies are lockfile-pinned. Swift Crypto is used only by the portable non-macOS target. The normal macOS app manifest remains the default. Final redistribution still needs a complete dependency/runtime/license inventory and signed OS packages.
