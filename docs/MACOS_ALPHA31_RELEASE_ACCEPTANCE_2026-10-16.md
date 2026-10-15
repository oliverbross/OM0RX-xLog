# macOS alpha.31 release acceptance — 16 October 2026

## Exact candidate

- Version: `0.4.0-alpha.31`
- Packaged source: `dd8dd642c650fc56522296860f6e2177c0804bcb`
- Architecture: Apple Silicon (`aarch64`)
- Notary submission: `bf1b2b5f-194d-41b0-bbdd-b0795e3cdff1` — `Accepted`
- Stapled archive SHA-256: `1b7e16b9e12448c35d195afe42f87389f50f8f716de48ea46624881a3982f7af`
- Installed executable SHA-256: `29c258177ddd691fef83a850d529285a7d7d60460b502d0d4b2f9f998d68829b`

The installed executable hash matches the notarized candidate. Deep strict
code-sign verification, stapler validation and Gatekeeper assessment passed;
Gatekeeper reports `source=Notarized Developer ID`.

## Automated evidence

- Frontend: 166 files, 2,462 tests passed.
- TypeScript/Vite production build and detached-window bundle checks passed.
- Rust: 459 unit tests and 21 integration tests passed.
- Clean packaged candidate acceptance: `passed`, 33/33 checks, `station_io=false`.
- Installed `/Applications/OM0RX-xLog.app` acceptance: `passed`, 33/33 checks,
  `station_io=false`.
- Packaged acceptance exercised direct contact editing, delete/undo, detached
  Logbook, detached Awards, native window lifecycle, workspace presets, Band
  Maps, Spot History recovery, menu routing and final WebGL/map pixel probes.

The detached-window acceptance runner now uses bounded frame waits because
WebKit pauses `requestAnimationFrame` in an unfocused native window. Logbook
tables expose `aria-busy`, and acceptance waits for refreshed data before
activating a contact. These checks validate the actual packaged WebViews rather
than a browser-only substitute.

## Installation and preserved state

- Previous alpha.30 bundle moved recoverably to
  `~/.Trash/OM0RX-xLog-alpha30-before-alpha31-20261016.app`.
- Pre-install app/data backup retained under
  `dist/installation-backups/alpha30-before-alpha31-20261015-2324/`.
- The existing application-support directory was not replaced or rewritten by
  installation.
- Before and after normal alpha.31 launch: 68,088 QSOs; saved draft callsign
  `HV0A`, comment `simplex`, dirty state retained.
- Normal launch rendered the restored draft, logbook, cluster, map, callsign
  intelligence and passive station observations. No RF command, tune, PTT, CW
  transmission or rotor command was issued during acceptance or installation.

Windows and Linux packaging remain intentionally deferred until macOS operator
acceptance, as requested.
