# Post-alpha.29 macOS source-bundle acceptance — 15 October 2026

This checkpoint validates the secure backup source added after installed
alpha.29 without replacing the installed application or widening any live-service
or station authority.

## Exact source and bundle

- Source commit: `468bbfd30974238789e37422aa21aeb0c7480270`
  (`chore: clear Swift 6 package warnings`), including
  the preceding native Dropbox account verification, Keychain credential vault,
  frozen-plan preparation and revision-conditional retention changes.
- Bundle:
  `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`.
- Host SHA-256:
  `3bbe37bbb39ca0e027212e88c6bb9d708163d10cb0dec5ea3675523f119e8fed`.
- Worker SHA-256:
  `aff2d65c50f0b2ed87eb398fd1a5e8b0c9728c96dc71551dca6c1a6b6eb62c7d`.
- The development bundle is ad-hoc signed. `codesign --verify --deep --strict`
  passes. This is not Developer ID signing, notarization, stapling or installation.

## Validation

- Frontend: **2,387/2,387 tests across 159 files**.
- Native Swift: **177 tests across 25 suites**.
- Portable Swift: **200 XCTest** with four intentional benchmark skips and
  **387 Swift Testing tests across 51 suites**. Swift 6 fixture/sendability and
  unnecessary-effect warnings found during this pass were removed before the
  final bundle was built.
- The production frontend build and detached-window bundle gate pass. Vite's
  existing large-map-chunk advisory remains non-fatal.
- Isolated native report
  `dist/alpha29-468bbfd-backup-source-acceptance.json` passes every emitted check:
  **33/33 checks, including ADIF transfer round-trip**, with `embeddedUi: true`,
  `worker: true` and `station_io: false`. It covers actual renderer/worker IPC,
  Canvas/native-window persistence and routes, task-window lifecycles, settings,
  Logbook edit/delete/undo, Spot History main-absent recovery, Awards and rendered
  MapLibre geometry.
- The default-disabled live HamQSL probe also passed twice from an isolated
  temporary workspace with current SFI 136, A 13, K 2 and five band groups.

## Explicitly open

- `/Applications/OM0RX-xLog.app` remains the signed/notarized alpha.29 baseline;
  this source bundle was not installed or launched against the operator workspace.
- Dropbox production OAuth provisioning, live upload, conditional deletion and
  tested restore remain blocked on a registered application/account flow.
- Detached-window multi-display visual checks, normal-session propagation-header
  observation and operator interaction remain open.
- The Windows Remote Station Agent was intentionally off. No radio, amplifier,
  tuner, rotor, PTT, Tune or CW action was issued. Windows and Linux builds remain
  deferred until the operator accepts a macOS candidate.
