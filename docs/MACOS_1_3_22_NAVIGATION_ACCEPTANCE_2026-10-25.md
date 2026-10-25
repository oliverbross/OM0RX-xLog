# macOS 1.3.22 — restore Logbook navigation

The operator requested building and installing the navigation fix. Application change source is `bf0ea9f12f05b1946f5a7ed5030e8106a6a901aa`: background QSO activation/registration safety fences no longer block page navigation. QSO mutation and close protections remain, as does protection against losing unfinished editor input.

Validation before the version-only release change: 91 focused navigation, editor registration and activation tests passed; TypeScript, production frontend build and window-bundle checks passed. The two new regression cases reproduce lost registration and pending activation while Settings is open, then verify navigation through Logbook and the full QSO editor without allowing edits through the safety fence.

Build provenance: build only from the clean version commit on canonical `main` with `CARGO_BUILD_JOBS=2 bash prototype/scripts/package-macos.sh`. The script sets `XLOG_SOURCE_COMMIT` to the exact Git HEAD, embeds it in the native executable and distribution metadata, refreshes the frontend, stages worker/Python resources and signs the bundle. Exact packaged source, hashes and installed verification are recorded below after packaging. Version 1.3.22 is reserved for this source candidate.

Installation must preserve the current application data, settings and recordings and retain the replaced application for rollback. Installed-app acceptance is pending until the new bundle is running and navigation is checked.
