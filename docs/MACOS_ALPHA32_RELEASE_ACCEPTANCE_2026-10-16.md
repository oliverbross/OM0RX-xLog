# macOS alpha.32 release acceptance — 16 October 2026

## Exact candidate

- Version: `0.4.0-alpha.32`
- Packaged source: `e270ab56cc6b17cdd649d9fbf013c4a356a60de0`
- Architecture: Apple Silicon (`aarch64`)
- Installed executable SHA-256: `fc071a9f32571f6d4e043ee357653a2a40f98c8535d10b3c06aaefce3bf36d73`
- Installed worker SHA-256: `0066e5c3f515ac2cd64fe640a578c228bdbb6ace006ad01adcbfdd88478db358`

The installed hashes match the clean candidate. Deep strict code-sign
verification passed with the configured Developer ID identity. This candidate
was not submitted for notarization, so Gatekeeper correctly reports
`source=Unnotarized Developer ID`; this is not a notarized release claim.

## Automated evidence

- The universal Swift worker built from a clean clone and passed its embedded
  self-test with `station_io=false` and `network_contact=false`.
- The Tauri production bundle and detached-window bundle gates passed.
- Clean packaged candidate acceptance: `passed`, 33/33 checks,
  `station_io=false`.
- Acceptance exercised direct contact editing, delete/undo, detached Logbook,
  detached Awards, native window lifecycle, workspace presets, Band Maps,
  Spot History recovery, menu routing and final WebGL/map pixel probes.
- The prior editor timeout was traced to the isolated test mode not installing
  the passive, disabled Follow Radio state owner. Source `e270ab5` installs
  that owner without starting radio/session services; its 10 focused native
  tests pass.

The preserved report is
`dist/alpha32-e270ab5-native-acceptance.json`.

## Installation and preserved state

- `/Applications/OM0RX-xLog.app` now reports `0.4.0-alpha.32` and is running
  from the installed bundle.
- Alpha.31 and cloned application-support state are retained under
  `dist/installation-backups/alpha31-before-alpha32-20261016-1745/`.
- The live database remains in place with 68,119 QSOs and no soft-deleted
  records at the post-install check.
- No RF command, tune, PTT, CW transmission or rotor command was issued during
  packaged acceptance or installation.

Commits after `e270ab5` continue source development and are not claimed to be
inside the installed alpha.32 bundle. Windows and Linux packaging remain
deferred until macOS operator acceptance, as requested.
