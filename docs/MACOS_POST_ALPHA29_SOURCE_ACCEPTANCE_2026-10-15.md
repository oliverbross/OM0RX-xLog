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

## QRZ/WSJT-X source follow-up

Exact source `6e3ca278fa3034886c582bd020dbd55f7a8b128d` adds the
default-off, prospective QRZ enrollment UI/native owner and limits WSJT-X
eligibility to semantically new Logged ADIF contacts after enrollment. The
current ad-hoc development bundle was rebuilt at the same path without replacing
`/Applications/OM0RX-xLog.app`.

- Strict deep code-signature verification passes. The host SHA-256 is
  `d0d697370a8df03eeb35c87eaad38e37a506f203d5e93f8ece886226d2ff5f3e`;
  the worker SHA-256 is
  `8d569e9ce78d22f210afc95f5e8c01325437bf3ae60543f64322aaa820c37135`.
- The first cold isolated launch reached Monitor but exceeded the 90-second
  harness deadline before the other task surfaces reported. It was not counted
  as a pass. A fresh second run completed **33/33** checks with
  `embeddedUi: true`, `worker: true` and `station_io: false`; the compact
  evidence record is
  [mac-source.json](evidence/native-ui-6e3ca27/mac-source.json).
- Full source gates pass: frontend **2,390/2,390**, Rust **433 unit + 18
  integration**, native Swift **190/190**, portable **200 XCTest** with four
  intentional benchmark skips plus **391 Swift Testing**, and the production
  frontend/detached-window bundle gate.

This is still development-source evidence, not a notarized or installed
candidate, live QRZ/WSJT-X acceptance, or hardware/RF acceptance. No credential,
operator logbook, online-log provider or station device was accessed.

## Club Log source follow-up

Exact source `6df02197138d1ff3e7f622595c2671ca668182dc` adds the
independent, default-off Club Log real-time owner and Settings workflow. The
rebuilt ad-hoc development bundle remains uninstalled.

- Strict deep code-signature verification passes. The arm64 host SHA-256 is
  `ac5de6224b48ecc7e43424661846b621329102ad7cf94cef5279691221b92301`;
  the universal worker SHA-256 is
  `841db845af6cbdf181655d123f388f0d10d7b8d7aecbc842eee2bf9d35464b25`.
- A fresh run passes **33/33** checks with `embeddedUi: true`, `worker: true`
  and `station_io: false`; see
  [mac-source.json](evidence/native-ui-6df0219/mac-source.json).
- Full source gates pass: frontend **2,391/2,391**, Rust **433 unit + 18
  integration**, native Swift **194/194**, portable **200 XCTest** with four
  intentional benchmark skips plus **392 Swift Testing**, and the production
  frontend/detached-window bundle gate.

This is not a notarized or installed candidate, live Club Log/QRZ/WSJT-X
acceptance, or hardware/RF acceptance. No credential, operator logbook,
online-log provider or station device was accessed.

## Held Wavelog record review source follow-up

Exact source `c214d5dcf6dfccb707379b1aeb471428f696c85f` adds the
read-only held-record review details to Sync. The rebuilt ad-hoc development
bundle remains uninstalled.

- Strict deep code-signature verification passes. The arm64 host SHA-256 is
  `e6ce67aca0b79dafda06062919cf387ee1c1ce0f6bb996a04e51c955bf33bfe9`;
  the universal worker SHA-256 is
  `2070977245bce075eb0bb206f4b64ef0832c7bf0822b329dcc8b9feb0368d14c`.
- The staged distribution metadata names the exact source above. The production
  frontend and detached-window bundle gate passed while packaging.
- A fresh isolated run passes **33/33** checks with `embeddedUi: true`,
  `worker: true`, no false check and `station_io: false`; see
  [mac-source.json](evidence/native-ui-c214d5d/mac-source.json). The randomized
  acceptance namespace and incognito/private workspace exited cleanly.
- Source validation for this change passes frontend **2,391/2,391**, native
  Swift **194/194**, portable XStation **17**, XLogPrototype XCTest **201** with
  four intentional skips, and Swift Testing **392/392**. Compact 360 px and
  desktop 1000 px source-component geometry showed no horizontal overflow.

The isolated package fixture does not create ambiguous Wavelog history, so this
run proves the package, renderer, worker and station-I/O-disabled boundary but
does not claim packaged observation of the held-group content. The exact live
record IDs remain untouched; operator/live visual confirmation, installation,
notarization and provider acceptance remain open. No credential, operator
logbook, online service or station device was accessed.

## QLog-inspired passive DX alerts source follow-up

Exact source `527a419e55044b253a4d9a9f267c59c304e93317` adds the
default-off native DX-alert rule owner and passive Alerts task-window workflow
selected from the RUMlog and QLog comparisons. The rebuilt ad-hoc development
bundle remains uninstalled.

- Strict deep code-signature verification passes. The arm64 host SHA-256 is
  `77c1a74f48c017a84774e1283749f3e61bbb117033a9cf102b6390e9f8de0115`;
  the universal worker SHA-256 is
  `2070977245bce075eb0bb206f4b64ef0832c7bf0822b329dcc8b9feb0368d14c`.
  The staged distribution metadata names the exact source above and the bundle
  identifies itself as `OM0RX-xLog`.
- A fresh isolated run passes **33/33** checks with `embeddedUi: true`,
  `worker: true`, no false check and `station_io: false`; see
  [mac-source.json](evidence/native-ui-527a419/mac-source.json). The randomized
  acceptance namespace and incognito/private workspace exited cleanly.
- Alert-specific validation passes **6 focused Rust tests** and **5 focused
  renderer tests**, plus the production frontend and detached-window bundle
  gate. The full Rust run passed **438 unit tests** and its integration runs.
  In the parallel full renderer run, 156 files passed and four unrelated
  timing-sensitive files exceeded their five-second test limit; each of those
  files passed on an independent single-worker rerun. This is therefore not
  recorded as an all-green monolithic renderer run.

The isolated fixture does not seed a live cluster stream or native delivery
notification, so it proves package integrity, the existing renderer/worker
contract and the station-I/O-disabled boundary—not live alert matching. Native
popup, bell, speech and outbound UDP remain separate default-off adapter work.
Operator visual acceptance, installation, notarization and live cluster
acceptance remain open. No credential, operator logbook, online service or
station device was accessed.

## QLog-inspired native alert delivery source follow-up

Exact source `d37aeb60df831d21f66d33d78ec56d4e4be109af` adds a native-owned,
default-off desktop-notification adapter to the passive DX-alert owner. Popup
delivery and notification sound are separate saved choices, sound requires
popup, and delivery is limited to three notifications per ten seconds; alerts
beyond that limit remain visible in the dashboard with a retained suppressed
count. Notifications contain no action button and have no tune, transmit, CW,
rotor or other station-control path. The rebuilt ad-hoc development bundle
remains uninstalled.

- Strict deep code-signature verification passes. The arm64 host SHA-256 is
  `ae3e7ce6748e9939aa59322955596cbc0d0f24db10ee7606010fdbe12fb54d86`;
  the universal worker SHA-256 is
  `2070977245bce075eb0bb206f4b64ef0832c7bf0822b329dcc8b9feb0368d14c`.
  The bundle identifies itself as `OM0RX-xLog`, and its staged distribution
  metadata names the exact source above.
- A fresh isolated run passes **33/33** checks with `embeddedUi: true`,
  `worker: true`, no false check and `station_io: false`; see
  [mac-source.json](evidence/native-ui-d37aeb6/mac-source.json). The randomized
  acceptance namespace and incognito/private workspace exited cleanly.
- Alert-delivery validation passes **9 focused Rust tests**, **6 focused
  renderer tests**, **440 native unit tests** and **18 Hamlib integration
  tests**, plus TypeScript and the production frontend/detached-window bundle
  gate. The four-worker renderer run passed **2,393/2,394 tests across 159
  files**; one unrelated Logbook timing test exceeded its five-second limit,
  then its complete file passed **19/19** in a single-worker rerun. This is not
  recorded as an all-green monolithic renderer run.

The isolated fixture does not seed live cluster traffic and keeps alert
delivery disabled, so this run does not claim observation of an actual macOS
notification, notification sound or live alert match. Speech and outbound UDP
remain deferred. Operator visual acceptance, installation, notarization and
live-cluster acceptance remain open. The Windows Remote Station Agent was off;
no credential, operator logbook, online service or station device was accessed,
and no radio, amplifier, tuner, rotor, PTT, Tune or CW action was issued.
