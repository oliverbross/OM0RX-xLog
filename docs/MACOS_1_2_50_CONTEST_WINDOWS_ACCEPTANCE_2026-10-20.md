# macOS 1.2.50 contest-window acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Packaged source/version commit: `7d5c6b7d225ed7cd42fa665fd99ea320b1760d0e`
- Embedded source changes: none
- Version/build: `1.2.50` / `1.2.50`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `51c9f2829792eb8dc89daa3e9e315c8c5b7c7647`
- Main executable SHA-256: `9512059bba474abe07aa3ff98436da58fc62c0832c3202f27b81a4a516d8851f`
- Worker executable SHA-256: `75b233b39d8bbc4b4117932d3d9da3e9e0de5aa514e7ba47caa0214a5aa56ffd`
- `CodeResources` SHA-256: `cb15903e491ce4ebdd7aa68f42129d4181f88c94a600aac8bc9aad682070bad0`
- Package and installed-app `codesign --verify --deep --strict`: passed
- Rollback directory: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.50-20261020T085659+0930/`
  - verified rejected-candidate copy: `OM0RX-xLog-1.2.49-rejected.app`
  - original installed bundle: `OM0RX-xLog-1.2.49-installed-original.app`
  - retained ordinary and contest application-data directories

The installed bundle's signature and three recorded hashes match the packaged candidate. Embedded `Not1MM/python-runtime.json` records Python 3.12.4, minimum macOS 14.0, source commit `7d5c6b7d225ed7cd42fa665fd99ea320b1760d0e`, and `sourceChanges: []`.

## Implemented behavior

- Contesting remains a separate Python/SQLite subsystem using the actual source-pinned Not1MM plugins. This checkpoint does not expand the retired Python-to-JSON-to-Swift contest-rule translation system.
- The ordinary xLog Operator Desk and ordinary logbook remain the normal logging workflow. There is no normal/contest top-bar switch and no contest canvas.
- A native `Contest` menu opens separate, independently positionable windows for Contest Setup, Call History, Main Logging, Stats, Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator, and Remote VFO.
- Native window titles now follow the original Not1MM names where appropriate: Main Logging, Stats, Log Display, Band Map, Cluster, Check Partial, Rates, and Remote VFO.
- Main Logging follows the original Not1MM operator layout with xLog styling: current frequency/mode/operator/contest, band strip, callsign and exchange fields, Run/S&P, twelve function-key macros, heading/distance/country/zones, and QSO/multiplier/score status.
- Log Display columns and row values are produced by the active Not1MM Python plugin. CQ WW, WPX, and Sweepstakes can therefore expose their own original log-table schemas without translating scoring rules into Swift.
- The native command admission layer now validates the plugin log projection as a first-class contract: bounded unique columns, exactly one `Call` column, fixed row width, visible-page limits, and exact QSO identity/order matching.
- Contest Band Map and Cluster reuse the existing xLog spot and station services but have contest-scoped drafts, projection identity, preferences, and activation fencing. Merely opening them does not replace the ordinary xLog logging workflow.

## Rejected 1.2.49 finding and correction

The signed 1.2.49 package was installed and exercised first. Its native Contest menu and separate windows opened, but Log Display remained at `Panel unavailable`.

The packaged failure was not a Python or web-renderer failure. The TypeScript projection had correctly moved to `pluginColumns`, `pluginRows`, and `pluginPartialRows`, while the native Rust admission validator still accepted only the earlier manual-row shape. The native boundary rejected the new projection and retained the old unavailable snapshot.

Commit `5ded940ef4d8f20d200993193c8fc72dd0db3f98` admits and validates the Not1MM plugin log projection natively. Version commit `7d5c6b7d225ed7cd42fa665fd99ea320b1760d0e` packages that correction as the distinct 1.2.50 candidate.

## Actual installed Tauri behavior

These observations were made through the installed `/Applications/OM0RX-xLog.app`. Mocked UI requests and direct Python tests were supporting checks only.

- The ordinary app opened with the retained DB3KE draft at 14.166000 MHz, 20m SSB, RST 59/59, Manfred Schulz, JO30EW, Germany, and `WWFF DLFF-1243`.
- The ordinary integrated logbook displayed `1–6 of 68,331`; the ordinary Operator Desk, logbook, cluster, map, lookup, rotor, and station-service surfaces remained present.
- The native `Contest` menu contained the thirteen expected entries and did not expose a contest workspace/canvas or a top-bar operating-mode switch.
- `OM0RX-xLog Contest — Log Display` opened as a separate native window at a contest-scoped URL. It rendered the CQ WW plugin columns `YYYY-MM-DD HH:MM:SS`, `Call`, `Freq`, `Snt`, `Rcv`, `SentNr`, `RcvNr`, and `PTS`, plus the matching partial-results table. With zero contest QSOs it showed `No contacts`, not `Panel unavailable`.
- `OM0RX-xLog Contest — Main Logging` opened separately and rendered CQ WW CW, operator OM0RX, the Not1MM entry fields, Run/S&P controls, twelve macro keys, and zero QSO/multiplier/score state.
- `OM0RX-xLog Contest — Stats` opened separately and rendered verified zero score, QSOs, points, multipliers, countries, and zones for the empty session.
- `OM0RX-xLog Contest — Band Map` opened separately with `scope=contesting`, showed current shared spots, and explicitly described contest-draft loading and one selected-radio tune per activation.
- `OM0RX-xLog Contest — Cluster` opened separately with `scope=contesting` and rendered the live shared xLog spot table with contest-specific activation wording.
- The application quit through the native application menu. No OM0RX-xLog process remained.
- No spot was activated and no Log QSO, Enter/ESM, function key, CW, PTT, tune, rotor, or RF command was used.

## Data preservation

The fresh pre-install rollback copy passed SQLite `PRAGMA quick_check` and contained 68,332 ordinary rows: 68,331 active and one historical soft deletion. Its contest `DXLOG` contained zero rows.

After final clean shutdown:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,332 total rows, 68,331 active rows, one historical soft-deleted row
- Normal database revision: 100661
- `sync_outbox`: zero rows; `sync_conflicts`: two existing rows
- Normal database SHA-256 before and after the 1.2.50 installed-app workflow: `1a75aa55c0b177cb6d675e0c95ecbe68252a8e52891dcb6ef7b765e129f7aef0`
- Active contest database `PRAGMA quick_check`: `ok`
- Contest `DXLOG`: zero rows
- Contest `CALLHISTORY`: one retained row

The ordinary database is byte-identical to its pre-install snapshot. The active-row count did not decrease, the single historical deletion was not rewritten, and the separate contest database did not receive a test QSO.

## Verification performed

- Contest frontend suite: 415 tests passed.
- Focused Not1MM Python WPX/Sweepstakes suite: 15 tests passed.
- Focused native contest-projection suite: 19 tests passed.
- Focused native contest-menu/title suite: 9 tests passed.
- Production TypeScript/Vite and detached-window bundle builds: passed.
- Tauri release build, bundled-Python worker self-test, Python relocation, Developer ID signing, and strict package verification: passed.
- Independent Sol 5.6 high review of the native plugin-projection admission change found no actionable correctness, security, or compatibility issue after the added invalid-shape tests.
- Installed-app acceptance passed for the native Contest menu, separate Main Logging/Stats/Log Display/Band Map/Cluster windows, plugin-driven empty Log Display, clean shutdown, and unchanged ordinary/contest databases.

## Exact remaining limitations

- The full Not1MM plugin catalog is not yet connected. The current registry contains CQ WW CW, CQ WPX CW, ARRL Sweepstakes CW, ICWC Medium Speed Test, CWT, CWOPS Open, K1USN Slow Speed Test, and Trans Tasman CW.
- Every original Not1MM operating and configuration window from the manual is not yet implemented. Group Chat remains hidden rather than exposed as an empty route.
- The existing setup renderer still combines several conditional setup flows that need to become the original separately opened configuration dialogs while retaining xLog styling.
- Sound-device selection, Group/Renfield networking, N1MM packet outputs, RTC score reporting, and `clearOnVFOChange` currently persist settings but do not yet drive their original runtime behavior.
- Edit Keys is not yet a faithful keymap editor: modifier handling is incomplete, the owner still hardcodes part of the keyboard behavior, and the current serialized mapping is too large for its admitted settings-string contract.
- Callsign lookup is QRZ-only; original HamQTH selection is not yet connected.
- Non-CW contest creation is currently offered by setup while the Python host still admits only the connected CW plugin set.
- Check Partial history, Stats/multiplier matrices, and Remote VFO still need further parity with the original Not1MM windows. The current Statistics window is a compact verified summary rather than the complete original matrix.
- WPX and Sweepstakes now use the plugin-driven host and log-column path, but still require the same full installed-app operator acceptance performed here for CQ WW.
- No real contest QSO, live radio-state change, RF/CW/PTT output, physical rotor movement, large Cabrillo export, or complete remaining-plugin workflow was exercised in this checkpoint.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

This is an implementation and installation checkpoint, not completion of the full Not1MM port.
