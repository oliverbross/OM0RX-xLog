# macOS 1.2.43 contest desktop acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Source commit: `a6457e6e3a73a586f35b5835ec207f787ef9e753`
- Source changes recorded by the package: none
- Version/build: `1.2.43` / `1.2.43`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Embedded Python: 3.12.4; 92 Mach-O files verified; minimum macOS 14.0
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `2aa39c0abb9c1a52ebfbd26f8c401e36570dcd9a`
- `CodeResources` SHA-256: `6f1d50f6005e0d5a741e57612f70b39309053fa26af398eb58723c37e9b23e42`
- `codesign --verify --deep --strict`: passed for the package and installed app
- Gatekeeper: rejected as `Unnotarized Developer ID`; notarization was not performed

The installed bundle's version, CDHash, strict signature, and `CodeResources` hash matched the package.

## Rollback bundles

- 1.2.41: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.42-20261020T023515+0930/OM0RX-xLog-1.2.41.app`
- 1.2.42: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.43-20261020T024412+0930/OM0RX-xLog-1.2.42.app`

Both rollback bundles retained their original version, strict signature, and `CodeResources` hash before replacement.

## Actual packaged-desktop result

The checks below were performed through the installed Tauri application, not a mocked browser or direct Python request.

- The normal xLog logbook opened after the existing startup/retry path and showed `68,321 contacts`, 40 rows on the first page, normal search/edit/import/export controls, and the existing xLog navigation.
- The retained DB3KE draft loaded with 14.166000 MHz, 20m, SSB, Manfred Schulz, JO30EW, Germany, `DLFF-1243`, `WWFF DLFF-1243`, station `OM0RX`/`JN88TQ`, FlexRadio 8400, and its original draft ID.
- The old top-bar Normal Logging/Contesting mode buttons were absent.
- The native `Contest` menu contained: Contest Setup, Main Logging, Stats, Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator, and Remote VFO.
- Contest Setup opened as its own native window and restored `CQ WW CW · actual Not1MM Python plugin · xLog station services` with manual frequency `14.025125` MHz and the station/contest/configuration/macro/key entry points.
- Main Logging opened as its own native window with 14,025.13 kHz, CW, operator OM0RX, CQ WW CW, sent/received 599, sent zone 15, Run/S&P selection, twelve function-key macros, and QSO/multiplier/score status.
- Contest Log opened as its own native window with the Not1MM-style columns `YYYY-MM-DD HH:MM:SS`, Call, Freq, Snt, Rcv, ZN, NR, PFX, and PTS; it also displayed a separate callsign-partial table and an enabled `Export Cabrillo…` control.
- `Export Cabrillo…` reached the real macOS Save panel. The panel stated `Save the verified prepared contest export. Existing files are not replaced.`, suggested `xLog Contest`, selected Documents, and exposed Cancel/Save. Escape cancelled it; no export file was created.
- Statistics opened as its own native window with claimed score, QSOs, points, multipliers, country/zone counts, and a verified score source.
- Check Partial opened as its own native window with the Log, Master, and Telnet columns plus Call history.
- Rates opened as its own native window with last-hour, last-10, last-100, since-0000z, Run, S&P, hourly Run, and hourly S&P rates.
- Every observed contest window used the xLog visual theme and shared one restored CQ WW contest session while remaining independently positionable.

## Data preservation

After clean shutdown:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database rows: 68,322 total, 68,321 active, one historical soft-deleted, one active dirty QSO row
- Normal database revision: 100640
- Contest database `PRAGMA quick_check`: `ok`
- Contest `DXLOG` rows: zero
- Contest database SHA-256: `29cbbc90a7ba3490a861094eb9e16d5859104cabd7bde523ffd367d140de3a67`, unchanged across the desktop checks
- No `xLog Contest*` file appeared in Documents after cancelling the save panel

The normal count increased from 68,320 to 68,321 during the acceptance sequence because the existing normal-log synchronization imported `RU9YF` (30m FT8, clean/not dirty). No acceptance action logged or deleted a QSO.

## Verification performed

- Frontend export/detached-window regression set: 45 passed
- Rust contest-export set: 18 passed
- TypeScript production build and detached-window bundle checks: passed
- Packaging preflight, Swift worker build/self-test, Tauri release build, bundled-Python verification, nested signing, and final bundle verification: passed
- Actual installed-app checks: normal logbook and draft; native Contest menu; Setup, Main Logging, Log, Statistics, Check Partial, and Rates windows; real Cabrillo save panel; clean cancel; post-quit database checks

## Rejected intermediate candidates

- 1.2.40 was rejected after actual desktop use because the detached Log projection and action admission contracts were incomplete.
- 1.2.41 was rejected because the detached action invoke omitted the required `envelope` wrapper.
- 1.2.42 was rejected because the Python preparation result included presentation-only `filename` metadata that the strict native save coordinate correctly refused.
- 1.2.43 strips worker presentation metadata at the native boundary and passed the packaged-desktop save-panel check.

## Exact remaining limitations

This is an accepted implementation checkpoint, not completion of the full Not1MM port.

- The complete Not1MM plugin catalog is not yet implemented through the Python host; the currently complete contest set remains limited.
- Full new/open/multi-contest database workflows and every manual configuration dialog are not yet at Not1MM parity.
- WPX, Sweepstakes, and the remaining plugins still require completion through this same host.
- CW formatting/output consumers, N1MM group/runtime consumers, WSJT-X/fldigi flows, and Multi-Multi behavior remain incomplete.
- Keyboard/ESM behavior is partial; ESM macro highlighting is not yet rendered at full parity.
- Contest Log editing is reduced compared with Not1MM's full Edit Contact and plugin-column behavior.
- Rates, DXCC, Zone, Band Map, Cluster, Rotator, and Remote VFO reuse xLog services, but every contest-specific semantic and edge case has not been demonstrated.
- ADIF contest export, score recalculation, and complete call-history application are not yet present.
- Sound selection is not yet consumed by the voice keyer.
- Real RF/PTT, physical rotor movement, and live-station contest output were not exercised in this checkpoint.
- The bundle is Developer-ID signed but not notarized.

