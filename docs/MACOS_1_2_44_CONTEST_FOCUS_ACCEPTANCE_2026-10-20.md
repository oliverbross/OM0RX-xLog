# macOS 1.2.44 contest field-focus acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Functional source commit: `d897dcb59e773bbd49c67a05d4a898493dc5a683`
- Packaged source/version commit: `143957830fb3f1ee13c3341fa33c34fac2bb44ea`
- Embedded source changes: none
- Version/build: `1.2.44` / `1.2.44`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `9f68f9ee0db179f4bc3cb14f2f017ffdbe59efcc`
- `CodeResources` SHA-256: `10b9a23cdd8873a340b1e2afed6f79ebd9e5082e2618d2956061a04383250fc3`
- Package and installed-app `codesign --verify --deep --strict`: passed
- Rollback bundle: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.44-20261020T0325+0930/OM0RX-xLog-1.2.43.app`

The installed bundle's version, CDHash and `CodeResources` hash matched the package. The embedded Python runtime provenance records commit `143957830fb3f1ee13c3341fa33c34fac2bb44ea` and an empty `sourceChanges` list.

## Implemented behavior

- The detached surface protocol now uses the exact Not1MM entry identities `callsign`, `sent`, `receive`, `other_1` and `other_2`.
- Python is authoritative for current focus and forward/reverse tab maps. The detached window serializes focus admission, skips hidden fields and rejects stale or uncertain focus/ESM replies.
- Enter sends the exact focused field to Not1MM ESM. Buffered field edits are flushed before the key action without discarding other pending entry fields.
- A newly logged/replaced draft resets desired DOM focus to Callsign.
- The compatibility adapter for older translated contests only maps its existing generic exchange field onto logical `other_2`; this change does not expand the translation system.

## Actual installed Tauri behavior

These observations were made through `/Applications/OM0RX-xLog.app`, not a browser mock or direct Python request.

- Normal xLog restored the retained DB3KE draft with 14.166000 MHz, 20m, SSB, Manfred Schulz, JO30EW, Germany, `DLFF-1243`, `WWFF DLFF-1243`, and the existing station identity.
- The integrated normal logbook showed `1–15 of 68,321`; its normal navigation, draft and cluster services remained present.
- The native `Contest` menu contained Contest Setup, Main Logging, Stats, Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator and Remote VFO.
- Main Logging opened as an independently positionable native window titled `OM0RX-xLog Contest — Main Logging` with CQ WW CW, 14,025.13 kHz, CW, operator OM0RX, SNT/RCV 599, sent zone 15, Run/S&P controls and F1–F12 macros.
- Initial focus was Callsign. Native Tab was demonstrated as `Callsign → SNT → RCV → CQ Zone → Callsign`; the hidden `other_1` input was skipped.
- A temporary unlogged `K1ABC` callsign survived the immediate focus change and populated CQ zone 5 from the reference data. The callsign and received zone were then cleared and focus was restored to Callsign.
- No Enter, function-key transmit, CW, PTT, RF or QSO-log action was used during this acceptance.

## Data preservation

After clean shutdown:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,322 total rows, 68,321 active rows, one historical soft-deleted row, two dirty rows
- Normal database revision: 100641
- Normal database SHA-256 before and after installed-app acceptance: `bfe66dab8731ee1a4a94b8660b8061412cc8b99d2deac7c0a4dbabc29097052b`
- Active contest database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows
- The restored contest draft has blank callsign and received zone, frequency 14.025125 MHz, SNT/RCV 599, sent zone 15, S&P state, and Callsign focus.
- The active contest database byte hash changed because the acceptance deliberately exercised and persisted draft/focus state and cached the K1ABC reference lookup. No contest QSO or historical Run/S&P row was created or corrected.
- The second retained contest database remained byte-identical at SHA-256 `39c721abc15211abf9fb96e0f25c358e91441fc59ce4714f2bc1b4a93543efeb` with zero `DXLOG` rows.

## Verification performed

- Affected frontend suites: 112 passed.
- Independent final Sol high review: no correctness blocker; its 120 targeted checks and TypeScript check passed.
- Rust contest-surface validation: 18 passed.
- TypeScript/Vite production build and detached-window bundle checks: passed.
- Packaging preflight, Swift worker build/self-test, Hamlib staging, distribution metadata, Tauri release build, bundled-Python relocation, nested signing and final bundle verification: passed.
- Installed-app acceptance: normal log/draft restore, native Contest menu, separate Main Logging window, exact Tab focus map, buffered draft retention, safe cleanup and post-quit database integrity.

## Exact remaining limitations

- On a cold launch, the first native Main Logging command still brought Contest Setup forward while the Python session owner was being restored; repeating Main Logging after restoration opened the correct detached window. This startup routing remains to be corrected.
- Shift-Tab, Space-from-Callsign and Enter/ESM were covered by automated tests in this slice but were not exercised against RF-capable installed-app output.
- The complete Not1MM plugin catalog, all independent configuration dialogs, new/open database workflows, every manual window and the remaining contest workflows are not yet complete.
- Real CW/PTT/RF, physical rotor movement and a live-station contest QSO were not exercised.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

This is an implementation checkpoint, not completion of the full Not1MM port.
