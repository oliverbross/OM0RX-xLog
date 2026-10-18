# OM0RX-xLog 1.2.25 macOS release acceptance — 2026-10-18

## Release identity

- Source branch: `codex/macos-1.2.25-release`
- Release source commit: `5ebc71272914ce8dbc568301d10c564d59839c28`
- Application version and build: `1.2.25`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Installed executable SHA-256: `5782551bcb3a12573348fef7da8d1d67788c92e42c4573cbbf1f615d2d896d3b`
- Candidate and installed executable hashes match.

## Included changes

- Radio spot forwarding settings replace the former Rumlog compatibility name and expose FLEX/Maestro and TCI/SunSDR delivery behavior.
- RBN reception is independent from the visible-source filter; RBN spots are tagged and can be included or excluded explicitly.
- RBN/Spotted pickups remain visible for 15 minutes by default, with a configurable retention setting.
- Special-station filtering supports independent include and exclude choices without forcing all ordinary stations out of the result set.
- Cluster filtering includes the spotter's continent as a separate criterion from the spotted station's continent.
- Legacy saved cluster-filter projections are normalized so the new spotter-continent and excluded-special fields cannot break rendering.
- Special-filter controls use a stable three-column layout and remain readable in the cluster filter sheet.
- Confirmed and worked presentation distinguishes DXCC status from individual operation history, with green confirmed and orange/yellow worked states and resizable Chaser & DX columns across supported tabs.
- Split operation retains the selected station while the transmit VFO moves, and QSO radio refreshes use authoritative frequency, band and mode state.
- Explicit amplifier operate requests are no longer rejected by stale readiness/receipt reconciliation state.
- Previous-QSO and duplicate matching treats portable suffix variants such as `/P` as the same base station while preserving the entered callsign.

## Automated acceptance

- Frontend: 247 files, 3,412 Vitest tests and two Node tests passed.
- Focused frontend cluster-filter suites: 47/47 tests passed.
- Rust: 675 unit tests plus the integration targets passed.
- Focused Swift spotter-continent suites: 42/42 tests passed.
- Focused Swift portable-history, duplicate and indexed-history suites passed.
- Native `LogbookTests`: 22/22 tests passed.
- Focused UI suites: 13/13 tests passed.
- Packaging preflight: 3/3 checks passed.
- Worker self-test passed.
- TypeScript and production Vite build passed.
- A full portable Swift run retained one pre-existing unrelated failure in `LiveLogbookMethodsTests.rejectsHardLinkAlias`; the release-targeted Swift suites passed.

## Native package and installed-app acceptance

- The candidate was packaged from the canonical checkout at the exact release source commit above.
- Packaged bundle size: 90.60 MiB.
- Bundle identifier: `com.oliverbross.xlog.integration`.
- Developer ID signature: `Developer ID Application: Oliver Bross (4WCMQ4U946)` with hardened runtime.
- `codesign --verify --deep --strict` passed for candidate and installed bundles.
- Candidate and installed main-executable hashes match.
- The installed bundle reports version/build `1.2.25`.

## Live UI inspection

- The normal Logging profile launched successfully and remained separate from the Contesting Test profile.
- Live radio frequency and mode updates were visible without invoking transmit.
- One cluster connection remained active and the live spot count increased during observation.
- The integrated logbook loaded 68,215 contacts.
- Rotor status remained connected.
- Previous-QSO history for `SQ4FDK/P` displayed two matching QSOs, exercising portable identity matching in the running application.
- Cluster rows rendered special classifications including CONTEST, POTA and WWFF, along with worked/confirmed status presentation.
- The RBN/Spotted panel displayed its 15-minute retention wording.
- The installed application was left running on Operator Desk.

## Recovery and limits

- Previous 1.2.24 bundle backup: `/Applications/OM0RX-xLog.app.backup-1.2.24-20261018`.
- Normal application data was not replaced or modified as part of the bundle swap.
- The separately running Contesting Test application and its runtime profile remained running and were not replaced.
- No RF transmission, live amplifier operate transition, or rotor movement was performed during release acceptance.
- Developer ID signing was verified. Apple notarization was not performed and is not inferred from the valid signature.
