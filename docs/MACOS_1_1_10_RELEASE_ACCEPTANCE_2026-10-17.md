# OM0RX-xLog macOS 1.1.10 release acceptance — 2026-10-17

## Release identity

- Built source commit: `09a98b8bba265feefda70c55ead53098a5523b8d`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Version: `1.1.10`
- Bundle identifier: `com.oliverbross.xlog.integration`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Signature verification: `codesign --verify --deep --strict` passed.
- Notarization was not performed or claimed by this acceptance run.

## Included fixes

- `f6e0046` — recover stale QSO spot-selection fences without replaying or clearing an unresolved mutation.
- `6298461` — canonical callsign handling, bounded lookup deadlines, and QRZ keychain-client revalidation.
- `357dc67` — explicit QRZ ready/busy/unavailable states and bounded retry without transient-cache poisoning.
- `739146d` — QRZ lookup lock-ordering and TOCTOU correction.
- `ec3b796` — deterministic QRZ contention regression tests.
- `e87c3aa` — preserve Auto Rotor intent through startup telemetry warmup.
- `e6f9d63` — rebase saved-startup Auto Rotor authority through the restored radio connection without weakening explicit Arm/Off ordering.
- Workspace panel moving/resizing, duplicate information placement, and the color-scaled cluster age strip remain included from the consolidated `main` history.

## Automated verification

- Rust unit tests after the final startup-race patch: 591 passed.
- Rust integration tests after the final startup-race patch: 22 passed.
- Focused saved-startup tests: 15 passed.
- Station-selection tests: 51 passed.
- Auto-rotor tests: 21 passed.
- Focused command-order race tests: passed.
- Packaging-script tests: 3 passed.
- Current package TypeScript/build and bundle gates: passed.
- Earlier consolidated frontend baseline: 211 files and 3,072 tests passed.
- Earlier consolidated Swift baseline: Swift Testing 466 tests across 66 suites; XCTest XLogPrototype 259 with 4 skipped, XCluster 67, XCat 163, and XStation 22. One unrelated timing-sensitive `TCIWebSocketSessionTests.testDroppingLastSessionReferenceClosesPendingConnection` failure occurred on the first run; its isolated rerun and the subsequent full rerun passed.

## Package hashes

- `xlog-prototype`: `9db53405df0adcdb7ac27dcf6152cc9f823adc5e1b438de3b24f647cecf03fd7`
- `xlog-prototype-worker`: `5528f9a7eec6027ef484217161e37b4cd701c13ed2a9bde2192111b1707dcf52`

## Installed-app acceptance

The exact installed `/Applications/OM0RX-xLog.app` was launched and inspected through the native application UI after installation.

- Radio restored as connected at 10.118000 MHz CW.
- ShackCQ cluster restored as connected with live spots; the observed count increased from 43 to 44 during verification.
- Integrated logbook retained 68,182 contacts.
- QRZ callsign intelligence resolved `LB8VA` to Ivar Nygård, Norway, grid JO59iw, DXCC 266, CQ zone 14, ITU zone 18, and a 1,327 km distance.
- The stale-QSO blocker banner was absent. `Clear QSO` and `Log QSO` were enabled.
- Rotor restored as connected and settled at 344 degrees for the 343 degree LB8VA target.
- Settings > Rotator showed both `Auto rotor` and `Enable Auto Rotor at app start` enabled. A second independent UI read confirmed that `Auto rotor` remained enabled.
- Allowed-band controls were present in Settings. The current saved UI state showed 20m, 17m, 15m, 12m, and 10m enabled; the acceptance run did not modify these preferences.

No cluster spot was selected, no QSO was logged or cleared, no manual rotor control was invoked, and no RF/CW transmission was triggered during acceptance.

## Rollback

The prior installed 1.1.9 bundle was preserved at:

`/Users/oliver/Documents/Projects/OM0RX-xLog-beta3-resume/dist/installation-backups/1.1.9-before-1.1.10-20261017-1905/OM0RX-xLog.app`

## Credential storage boundary

This release continues to use the application's separate macOS Keychain service for credentials. It does not migrate credentials to a locally encrypted cross-platform file.
