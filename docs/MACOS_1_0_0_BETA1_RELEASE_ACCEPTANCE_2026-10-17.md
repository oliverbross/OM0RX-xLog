# OM0RX-xLog 1.0.0-beta.1 macOS release acceptance — 17 October 2026

## Release identity

- Packaged source commit: `bfad17a` (`Clarify passive service timeouts`), on
  `codex/macos-alpha33-release`.
- Bundle: `/Applications/OM0RX-xLog.app`.
- Bundle identifier: `com.oliverbross.xlog.integration`.
- Version and build: `1.0.0-beta.1`.
- Architecture: Apple Silicon (`arm64`).
- Signing: local ad-hoc signature; `codesign --verify --deep --strict` passes for
  the app and its worker, `rigctld`, and `rotctld`. Notarization is a separate
  distribution gate and is not claimed here.
- Installed UI SHA-256: `81ae1e35851ca96f3e172577783d86117afd3a6bc168b350a79db1264a2eac90`.
- Installed worker SHA-256: `2c2ae67c675b7dcad5f3450e762d6f5fc03242f84d4be8f3ac8a9604a06081a5`.

## Review and automated verification

- Frontend: 3,011/3,011 tests pass across 207 suites.
- Native Rust: 592/592 tests pass after the final timeout-message regression.
- Portable Swift: full suite passes.
- TypeScript and Vite production build pass, including every detached-window
  bundle check. Vite retains its advisory for large generated chunks.
- `npm audit --omit=dev`: zero known vulnerabilities.
- The full Rust Clippy `-D warnings` gate still reports existing style/debt
  findings outside this release fix. They are not runtime failures and were not
  mechanically rewritten during this release review.

The review restored current test fixtures for the complete workspace preference
and rotor schemas, brought regression expectations back into line with the
implemented Wavelog spot colours/statuses, native radio selection, cluster
startup policy, and current Logbook controls, and corrected release-version
drift between npm, Cargo, Tauri, package metadata, README, changelog, and notes.

The installed visual sweep exposed one additional native wording defect. A
passive worker timeout incorrectly said that a radio control outcome was
unknown. Source `bfad17a` now distinguishes passive service requests from real
station/rotor controls: passive failure gives an actionable service/Keychain
message, while controls retain the fail-safe instruction to inspect observed
state before retrying. The focused regression and all 592 Rust tests pass.

## Native application and window acceptance

The final candidate bundle and the final installed bundle each pass all 33
isolated native acceptance checks with `embeddedUi: true`, `worker: true`, and
`station_io: false`. Coverage includes:

- real renderer/worker IPC and an isolated local workspace;
- workspace layout and preset round-trips;
- native menu routes;
- detached window creation, reuse, closure and docking recovery;
- World Map, Logbook, Awards and Spot History rendering;
- QSO keyboard workflow, edit, delete and undo;
- Settings save/readback;
- ADIF transfer round-trip.

The installed menu bar was inspected through macOS Accessibility. Settings is
in the application menu; Logbook follows File; Online exposes the supported
online functions; and Window does not expose Station Status, Station Identity,
or Connection Doctor. All 19 user-facing detached windows were opened from the
real installed Window menu. Each accepted an 800 x 600 resize and was restored
to its original geometry. The high-risk Callsign Intelligence layout was also
visually inspected at the resized geometry; its zones, distance, matrix, and
status content remained contained and readable.

## Integrated logbook and Wavelog

A read-only check of the production integrated database after installation
returned:

- SQLite `quick_check`: `ok`;
- 68,153 active contacts;
- 68,153 contacts linked to Wavelog IDs;
- zero dirty contacts;
- zero pending sync-outbox rows;
- zero sync conflicts.

The local-only logbook and Wavelog modes, import/export, receipt fencing,
conflict handling, safe documented-order reconciliation, and automatic sync
paths are covered by the passing application suites. The live account was not
mutated during this release review. The existing production credential remains
in macOS Keychain. Because a newly signed local worker has a new code identity,
macOS asks the operator to authorize that worker once; the operator must choose
**Always Allow** and enter the Mac login password. This review did not enter or
guess that password.

## Radio and rotor boundary

The physical radio and rotor were intentionally off. No Tune, PTT, transmit,
rotor-motion, amplifier, or other station command was sent. Offline behavior,
ownership fencing, lost-acknowledgement handling, dummy/native harnesses, and
the no-station-I/O packaged workflow passed. Physical RF and motion acceptance
remains a separate operator-present gate when the equipment is powered.

## Installation and rollback

The previous installed `0.4.0-alpha.57` bundle was moved intact to:

`/Users/oliver/Documents/OM0RX-xLog-PreBeta1-Backup-20261017-001/OM0RX-xLog.app`

Its strict signature verification passes. The initial beta package produced
before the final timeout-wording correction is also retained in the same folder
as `OM0RX-xLog-beta1-pre-timeout-fix.app`. Replacing the installed beta with the
backup is therefore recoverable without reconstructing an older build.
