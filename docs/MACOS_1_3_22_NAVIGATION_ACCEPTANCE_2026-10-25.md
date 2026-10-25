# macOS 1.3.22 — restore Logbook navigation

The operator requested building and installing the navigation fix. Application change source is `bf0ea9f12f05b1946f5a7ed5030e8106a6a901aa`: background QSO activation/registration safety fences no longer block page navigation. QSO mutation and close protections remain, as does protection against losing unfinished editor input.

Validation before the version-only release change: 91 focused navigation, editor registration and activation tests passed; TypeScript, production frontend build and window-bundle checks passed. The two new regression cases reproduce lost registration and pending activation while Settings is open, then verify navigation through Logbook and the full QSO editor without allowing edits through the safety fence.

Build provenance: build only from the clean version commit on canonical `main` with `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. The script sets `XLOG_SOURCE_COMMIT` to the exact Git HEAD, embeds it in the native executable and distribution metadata, refreshes the frontend, stages worker/Python resources and signs the bundle. Exact packaged source, hashes and installed verification are recorded below after packaging. Version 1.3.22 is reserved for this source candidate.

## Installed acceptance

Installed on 25 October 2026, approximately 18:30 Australia/Darwin, from exact packaged source `bdebae25bc7d979774593b7d5facee484222a14e`. The package was built from clean canonical `main` after aligning the tracked Rust lockfile with 1.3.22. Packaging passed six Mac staging checks, the worker self-test, the frontend/TypeScript/window-bundle checks and nine Python relocation checks. Developer ID Oliver Bross (`4WCMQ4U946`) signing and deep/strict verification passed; notarization is not claimed.

- Installed application: `/Applications/OM0RX-xLog.app`.
- Retained signed candidate and package log: `/Users/oliver/Documents/Builds/OM0RX-xLog-1.3.22-navigation`.
- Installed executable SHA-256: `b0ca3953ff17e4ef044a0fe76d76c3520669671d74cc757a92879f9155ffba29`.
- Installed worker SHA-256: `33ba379c2f54c329bcdc24a363a18d52b4f333acb9b8981ee6984f2c969b8e48`.
- Candidate and installed Info.plist, executable and worker hashes match; distribution metadata identifies the exact packaged source above.
- Closed-app backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.22-before-install-20261025T183019+0930`.
- Recoverable previous application: `/Applications/OM0RX-xLog-previous-20261025T090034Z-50692.app`.

The app quit normally before backup/replacement. The recorder was stopped. All 200 protected files (3,333,242,759 bytes) were copied with matching SHA-256 hashes and remained unchanged after installation and before reopening. This covers the integrated working copy, integration services, app support including recordings, WebKit storage and existing preferences. The backup manifest and candidate/installed receipts are retained privately in the paths above.

After reopening, the contest Main Logging window retained its current draft and displayed the same 493 QSOs / 109 multipliers and score 69,433. The main xLog window reopened through Window → Open xLog Main Window. Native UI actions opened Settings, then successfully returned through the sidebar to Logbook, displaying 68,559 contacts with no navigation-warning banner. The application was left open on Logbook.

Installed UI verification exercised the real Settings-to-Logbook route. Lost-registration and pending-activation cases were exercised by the focused regression tests, not injected into the production session. No manual tune, PTT, CW, rotor, logging, playback or recording-start command was issued for this acceptance; normal saved startup behavior was retained. These results do not establish RF or hardware acceptance. Rollback must preserve any contacts or other data created after this backup; do not restore an older database over newer work.
