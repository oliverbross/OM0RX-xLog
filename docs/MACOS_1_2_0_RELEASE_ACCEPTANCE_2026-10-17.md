# OM0RX-xLog macOS 1.2.0 release acceptance — 2026-10-17

## Release identity

- Built source commit: `9e26a7b7819cf5146acdbc4cd8fbad0bed32c2fb`
- Dual-radio/settings feature commit: `da4b3c4`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Version: `1.2.0`
- Bundle identifier: `com.oliverbross.xlog.integration`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Signature verification: `codesign --verify --deep --strict` passed for the packaged and installed bundles, including the worker, `rigctld`, and `rotctld` nested executables.
- Notarization was not performed or claimed by this acceptance run.

## Included changes

- Station Control moved into Settings and is now named Radio; the former sidebar destination is no longer exposed, and legacy navigation resolves to Settings > Radio.
- Radio settings provide independent Radio 1 and Radio 2 setup tabs. Both slots may maintain their own saved provider, connection, credentials, session, telemetry, manual-tune state, and TCI journal.
- One persisted active-radio route controls station-facing reads and commands. A process-wide transmit lease prevents simultaneous transmit ownership, blocks active-radio switching while transmit is owned, and rejects inactive-radio transmit commands.
- The native Radio menu provides Radio Settings plus Radio 1 and Radio 2 setup submenus. These are navigation actions and do not bypass receipt-protected connection controls.
- Settings now use a grouped vertical information architecture for Station, Logbook, Connections, Services, and Application.
- WSJT-X logging has its own receive-only UDP settings area.
- RUMlog compatibility has its own receive-only spot bridge settings area. It supports one-way RUMlog Logbook/Contest UDP spots into xLog and the embedded FLEX display; it does not read or write the RUMlog database or synchronize RUMlog contacts. Wavelog remains the two-way synchronization authority.
- Existing rotator behavior and its allowed-band settings were preserved; the rotator implementation remained owned by the preceding 1.1.10 task.

## Automated verification

- Frontend: 212 files and 3,076 tests passed.
- Rust: 598 unit tests and 25 Hamlib integration tests passed.
- Swift: 310 tests across 43 suites passed.
- Focused active-radio tests: 130 passed.
- Focused `LiveApp` tests: 47 passed.
- Focused live-app rotor tests: 27 passed.
- Packaging-script tests: 3 passed.
- TypeScript `tsc --noEmit`: passed.
- Production frontend build and strict bundle budgets: passed.
- `cargo check` after the 1.2.0 version bump: passed.
- `git diff --check`: passed.

## Rendered UI verification

The redesigned settings were exercised in a browser harness at desktop and narrow widths before packaging.

- Grouped settings navigation, Radio 1/Radio 2 tabs, WSJT-X, and RUMlog compatibility rendered without browser-console errors.
- The radio summary selector regression found during review was corrected before the release build.
- The installed native application was then inspected separately after installation.

## Package hashes

- `xlog-prototype`: `1e2eaf930bf8a8acd4b750bf3bd40b8f37ad052aacdb24c62def05c12ff1d7c8`
- `xlog-prototype-worker`: `ff2fac9838f5cd4a7f7682d82a20038d60b288d99fd09738202aa43e3961a82c`
- `rigctld`: `94ad7d78cd124b0a944bc0f843250f0d5aca9062d2c61bc04ff09740a6b43d37`
- `rotctld`: `989568d3c991550b021c9d81a9f0de7455a97b211fb0079a52338f226afc4c66`

The installed executable hashes matched the packaged bundle exactly.

## Installed-app acceptance

The exact installed `/Applications/OM0RX-xLog.app` was launched and inspected through the native application UI after installation.

- The integrated logbook restored with 68,184 contacts.
- The ShackCQ cluster feed restored; the observed spot count increased from 32 to 33 during inspection.
- Station Control was absent from the sidebar, leaving Settings as the radio-configuration destination.
- Settings showed the grouped section navigation and dedicated Radio, WSJT-X, and RUMlog compatibility areas.
- Settings > Radio showed Radio 1 configured for the Remote Station Agent and Radio 2 as an independent unconfigured standby slot.
- The native Radio menu showed Radio Settings, Radio 1 > Connection & Setup, and Radio 2 > Connection & Setup.
- Radio 1 and the rotator remained offline after relaunch. Acceptance did not force a connection, acknowledge an uncertain connection receipt, or change the active radio. Therefore this run does not claim live dual-radio, live RF, or live rotator validation.
- No settings were saved, no listener was started, no spot was selected, no QSO was logged or cleared, no active-radio switch was requested, no manual rotor action was invoked, and no RF/PTT/CW transmission was triggered.

## Rollback

The prior installed 1.1.10 bundle was preserved at:

`/Users/oliver/Documents/Projects/OM0RX-xLog/dist/installation-backups/1.1.10-before-1.2.0-20261017-202700/OM0RX-xLog.app`

## Credential storage boundary

Each radio slot keeps an independent credential identity in the application's macOS Keychain service. This release does not migrate credentials to a locally encrypted cross-platform file and does not copy Radio 1 credentials into Radio 2.
