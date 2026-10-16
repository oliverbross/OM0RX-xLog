# OM0RX-xLog 1.0.0-beta.2 macOS release acceptance — 17 October 2026

## Release identity

- Packaged source commit: `5221269` (`Stabilize live workspace feedback`),
  on `codex/macos-alpha33-release`.
- Bundle: `/Applications/OM0RX-xLog.app`.
- Bundle identifier: `com.oliverbross.xlog.integration`.
- Version and build: `1.0.0-beta.2`.
- Architecture: Apple Silicon (`arm64`).
- Signing: local ad-hoc signature; `codesign --verify --deep --strict` passes
  for the installed app, worker, `rigctld`, and `rotctld`. Notarization is
  a separate distribution gate and is not claimed here.
- Installed UI SHA-256:
  `529c080feccee5b61eb3ea263d3b2a153c072f205d1907c3e5d9638cf1067aaf`.
- Installed worker SHA-256:
  `2c2ae67c675b7dcad5f3450e762d6f5fc03242f84d4be8f3ac8a9604a06081a5`.

## Workspace stability fix

Normal status, recovery, spot-activation, and service feedback no longer enters
the Canvas document flow. The shared feedback layer is absolutely positioned,
does not reserve or remove workspace height, and leaves only its actionable
controls pointer-active. World Map selection feedback uses the same layer.

The Canvas measurement observer now preserves its previous size object when the
measured width and height are unchanged. The toolbar status region has stable
single-line geometry. Together these changes remove the visible workspace
jump caused by spot or status updates while retaining readable diagnostics.

The installed packaged acceptance verified the rendered feedback layer as
`position: absolute` and `pointer-events: none`. The normal installed Canvas
was also captured at its restored geometry; its panels, logbook, map, and
cluster area remained aligned while service feedback was present.

## Automated verification

- Frontend: 3,012/3,012 tests pass across 208 test files.
- Native Rust: 592/592 tests pass.
- Focused Canvas/map/stability suites: 33/33 tests pass.
- Focused Settings/workspace suites: 28/28 tests pass.
- Detached Log QSO suite: 45/45 tests pass.
- TypeScript `tsc --noEmit`, Vite production build, worker self-test, Hamlib
  4.7.2 helper verification, and detached-window bundle checks pass.
- `npm audit --omit=dev`: zero known vulnerabilities.
- The portable Swift package compiled, but its `xctest` process stalled at
  zero CPU in this environment and was stopped. No Swift source was changed by
  this beta.2 workspace-stability patch, so a new full Swift pass is not
  claimed.

Only one macOS package build was performed after the final source change.

## Native packaged acceptance

The candidate bundle and the installed `/Applications` bundle each passed all
35 isolated native checks with `embeddedUi: true`, `worker: true`, and
`station_io: false`. No check failed. Coverage includes:

- production renderer and worker IPC against isolated synthetic data;
- Canvas controls, layout and preset round-trips;
- the stationary feedback overlay;
- native menu routes and separate-window lifecycle;
- detached Logbook, Awards, Band Maps, Spot History, and map rendering;
- QSO keyboard flow, edit, delete, undo, and ADIF transfer;
- Settings save/readback and required section discovery.

The Settings runtime check found Station, Logbook, Wavelog, Sync, Integrations,
QRZ, Online logs, Reference data, Rotator, Radio spots, CW, Display, Workspace,
and Backups.

The installed native menu bar contains File, Logbook, Edit, View, Station,
Online, Window, and Help. Settings is present in the application menu.
`Workspace Mode` contains exactly Canvas and Separate Windows. Window does not
contain Station Status, Station Identity, or Connection Doctor.

All 19 user-facing detached windows were opened from the installed Window menu.
Each accepted an actual 800 x 600 resize and was restored; the main Canvas
correctly enforced its 1000 x 720 minimum. Direct window captures verified the
compact Propagation (694 x 230), Rotor (640 x 480), Callsign Intelligence
(640 x 480), Previous QSOs, Log QSO, Settings, and Chaser & DX layouts.

## Integrated logbook and Wavelog

A read-only production database check after installation returned:

- SQLite `quick_check`: `ok`;
- 68,153 active contacts;
- 68,153 active contacts linked to Wavelog IDs;
- zero dirty active contacts;
- zero pending sync-outbox rows;
- zero sync conflicts.

The installed app displays the integrated-logbook count and all required local
logbook/Wavelog settings. No live account data was mutated.

The newly signed helper prompted for the existing macOS Keychain credential on
normal launch. Automation did not enter or guess a password. The operator must
choose **Always Allow** and enter the Mac login password once to let this new
local signature reuse the saved service credential.

## Radio and rotor boundary

The physical radio and rotor were intentionally off. No Tune, PTT, transmit,
rotor-motion, amplifier, or other station command was sent. The packaged
acceptance explicitly reports `station_io: false`. Physical RF and motion
acceptance remains an operator-present gate after the equipment is powered.

## Installation and rollback

The previous beta.1 installation is retained intact at:

`/Users/oliver/Documents/OM0RX-xLog-PreBeta2-Backup-20261017-001/OM0RX-xLog.app`

Its version and strict signature were verified before replacement. Candidate
and installed beta.2 executable hashes match, so rollback remains recoverable
without reconstructing the earlier build.
