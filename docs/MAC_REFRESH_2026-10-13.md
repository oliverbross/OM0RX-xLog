# Installed Mac refresh — 13 October 2026

## Scope and package

The user requested refreshing the installed Integration app to continue testing and explicitly prioritized macOS before Windows/Linux work. Only `/Applications/OM0RX-xLog Integration.app` was replaced. Its original bundle ID and alpha.13 version label remain; the embedded source ID and `DistributionMetadata/mac-refresh.json` distinguish this update.

- Source: `df387639b77e55d92821560b0cdc5c54fbe2f945` (committed and pushed).
- Base Mac CI run: `38383133017`, successful for `5ab88fb5291b78e54c89d2b8d9fa6113f1178ace`.
- Original CI inner archive SHA-256: `63d92a07dd4aa938cd026419eaa32231d893bed290663ae2b4aeede442b6229d`.
- Host/frontend/Hamlib retain the CI artifact; only the Swift worker and its resource bundle were rebuilt locally with Apple Swift 6.4 and the Xcode build system. Application source is unchanged between those commits; the change is packaging scripts and regression tests. Pending native window-attempt/status changes were excluded.
- Installed host SHA-256: `da322e60f7ecdf650cf9b8e1c97555f9e0cc6307295c83c521324a620810f202`.
- Installed worker SHA-256: `34c6c2442220008b46a0ec25eb5f9421b0fb2593a8cee6cdc6a07350d257453c`.
- Developer ID signature passes deep/strict verification. Apple notarization `308c50a5-a9a8-44ea-ae4b-7a33eaf75403` is Accepted; ticket stapled; installed Gatekeeper assessment reports `Notarized Developer ID`.

## Defect found and corrected during installation

The first CI bundle passed build/signature checks but its worker crashed on the real Mac: `CTYResolver.bundledCSV()` reached SwiftPM's fatal `Bundle.module` lookup. Crash evidence is `xlog-prototype-worker-2026-10-13-202028.ips` in the local DiagnosticReports directory. Its generated accessor searched the app root or the CI build path, not the signed `Contents/Resources` location. The old/local Xcode accessor supports `Bundle.main.resourceURL`.

A staged app-root resource-copy experiment was rejected by strict signing as unsealed root content and was not installed. The durable correction consistently selects the Xcode build system for Mac worker build, staging and package bin-path lookup, preserving normal `Contents/Resources`. Three offline packaging regressions and shell syntax checks pass; the actual release worker build succeeds. The corrected package was signed and notarized again before installation.

The earlier permanent restriction on directly invoking candidate native acceptance was not retried. This update used the user's newly requested normal installed-app restart. A separate diagnostic `swiftc` probe and `cmp` backup comparison were denied by tool policy and not executed or rerouted; no allowlist/security settings changed. Allowed SHA-256 and read-only SQLite checks verified the backup instead.

## Data preservation and observed runtime

After cleanly quitting Integration, a private rollback directory was created at `~/Library/Application Support/OM0RX-xLog Integration Updates/20261013-5ab88fb`. It contains the previous signed app as a ZIP, full Integration workspace, service data, window geometry, WebKit state and the workspace preferences plist. No Keychain contents were exported or changed.

The workspace database backup matched SHA-256 `ceaec62bc212e835fa4f3085af0e3b480d0416e216ed7f71f83b9beb8346a06b`; SQLite quick-check returned `ok`. A full-row bidirectional comparison after the failed attempt found zero missing/changed or added/changed contacts. There were 67,906 active contacts and zero dirty contacts.

After corrected launch:

- One installed host/worker pair remained running (observed PIDs 81479/81485).
- The actual UI loaded OM0RX/JN88TQ and 67,906 contacts; database readback again reported 67,906 active, zero dirty.
- The actual Cluster page reported ShackCQ Connected, 34 shown / 89 received spots.
- The new separate `spot-history.sqlite` contained 101 retained observations and passed quick-check. This proves live recording began, not every History filter/statistics/retention behavior.
- The operator independently began interacting with the app and connected the radio while the agent observed. Further UI actions were stopped to avoid interference. No tuning, PTT, CW, rotor motion, station policy change or credential change was performed by the agent. Observed connected radio telemetry is not an agent-run RF acceptance test.
- Original native xLog database SHA-256 remained `500108d92a0fa7f9dab5b651d59ac8dc605c9a396fb4b5c08f73774a36d1d1ec`; the original app was untouched.

Automatic Wavelog code is now installed, but no new sync authorization was enabled and no sync was executed during this refresh. The prior approved persistent-sync request remains an open live acceptance item. Full saved-window/draft preservation, all-screen undocking, performance, other parity gates and any new hardware acceptance are not proven by this smoke check. Windows/Linux follow-up is deferred per the user's priority.

## Later staged update — not installed

Mac CI `38399628607` succeeded for exact source `5277847c3559e7a2f80ee654885b17b9e58fb624`, including portable Swift tests, frontend tests/build, Rust shell tests, helper tests and Mac packaging. Its `xlog-integration-macos-5277847c3559e7a2f80ee654885b17b9e58fb624` artifact was downloaded without rebuilding or mixing later working-tree changes. Embedded `DistributionMetadata/components.json` names that exact commit, and the worker resources occupy the corrected `Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle` location.

- Original CI ZIP SHA-256: `4ed696cf17a861cdc94256e2ef4c06a9ef523d03d62cb1a452e277236ee62e6c`.
- Staged app/helpers signed with the existing Developer ID Application identity; deep/strict validation passed.
- Apple notarization `e893de20-abb0-4082-9040-ae21ad3f4e51`: Accepted. Ticket stapling and validation passed; Gatekeeper reports `Notarized Developer ID`.
- Final archive: `dist/OM0RX-xLog-Integration-5277847-notarized.zip`.
- Final archive SHA-256: `405b5cdccb112891efbaf930081abd09f5ec3df4e7513b4acf3163a09c293eb1`.
- Extracted staging app: `/tmp/xlog-mac-5277847-9cou4Z/extracted/OM0RX-xLog Integration.app`.

This package includes the durable-save-first QSO response and the read-only-previewed Wavelog history reconciliation repair. It does not include the later intermediate-width desk CSS adjustment. No installed app was replaced/restarted, no logbook or station write was performed, and no native candidate acceptance was invoked. Installation awaits coordination with the operator's active logging session; installed latency and real synchronization remain unverified. Original apps, data and credentials remain unchanged.
