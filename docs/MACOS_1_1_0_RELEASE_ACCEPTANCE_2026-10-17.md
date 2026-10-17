# OM0RX-xLog 1.1.0 macOS release acceptance — 2026-10-17

## Release identity

- Source branch: `codex/macos-alpha33-release`
- Release commit: `ef9861e`
- Application version: `1.1.0`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Installed executable SHA-256: `9536f86a820b7af480ed74e21a621cb129a42307b87e9d1a6832f27897d74194`
- Candidate and installed executable hashes match.

## Included changes

- Rotor SP and LP controls occupy the lower card corners without reducing or covering the dial.
- Log QSO exposes persistent move, resize, reset and arrange controls for all five panels.
- The Operator Desk world map preserves its camera and options and repaints correctly after route return.
- Main Settings includes a Cluster tab backed by the same cluster configuration editor used on the DX Cluster screen.
- Opportunity-code regression expectation reflects the combined `C/NB+M` taxonomy.

## Automated acceptance

- Swift: 306 tests in 42 suites passed.
- Rust: 570 application tests and 22 Hamlib dummy tests passed.
- Frontend: 211 files and 3,048 tests passed with two workers.
- Focused integration suites: 128 tests passed.
- TypeScript and production Vite build passed.
- Fixed startup bundle budgets passed without changing the limits:
  - QSO: 403,988 bytes (limit 404,000)
  - Settings: 405,984 bytes (limit 406,000)
- Responsive rotor geometry passed at 37 widths from 360 to 3,840 pixels with no collisions.
- `git diff --check` passed.

## Native package and installed-app acceptance

- Packaged bundle size: 73.41 MiB.
- Developer ID signature: `Developer ID Application: Oliver Bross (4WCMQ4U946)`.
- `codesign --verify --deep --strict` passed for candidate and installed bundles.
- Candidate native acceptance: 35/35 checks passed.
- Installed native acceptance: 35/35 checks passed.
- Acceptance ran in an isolated namespace with production singleton disabled.

## Live UI inspection

- Rotor dial retained its size; SP and LP render in the lower-left and lower-right card corners without overlay.
- Settings → Cluster displays the complete shared cluster editor, including connection behavior, servers, credentials, rules and colours.
- Log QSO Arrange panels exposes move controls plus eight resize handles for each panel, with reset and finish controls.
- Operator Desk world map remained correctly painted and populated after navigating to World Map and back.
- Installed application was left running on Operator Desk.

## Recovery and limits

- Previous beta.4 bundle backup: `/Users/oliver/Documents/OM0RX-xLog-Pre1.1-Backup-20261017-1240/OM0RX-xLog.app`
- Native acceptance is synthetic and explicitly reports `station_io: false`; no RF transmission or live rotor/amplifier actuation was performed.
- Developer ID signing was verified. Apple notarization was not performed and is not inferred from the valid signature.
