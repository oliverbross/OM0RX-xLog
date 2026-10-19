# macOS 1.2.47 Trans Tasman contest acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Trans Tasman functional source commit: `2c42f4eac83358a4ad2fba6cd8acfabb5a4345a1`
- Native descriptor-admission fix: `3a5a0367a95f370118cd2f875f734ddabefd464d`
- Packaged source/version commit: `c06c1853a1fae44e810fb8dd56b4ae4786618235`
- Embedded source changes: none
- Version/build: `1.2.47` / `1.2.47`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `7159431bea12ee0dc73538997f28f6da6b977ed1`
- `CodeResources` SHA-256: `290ddec3d5e6e08ed3e158a5afbd6b73943b68f3a4ec695114e23662744e3bcb`
- Package and installed-app `codesign --verify --deep --strict`: passed
- Rollback bundle: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.47-20261020T041913+0930/OM0RX-xLog-1.2.46.app`

The installed bundle's version, CDHash and `CodeResources` hash match the package. The embedded `Not1MM/python-runtime.json` records Python 3.12.4, source commit `c06c1853a1fae44e810fb8dd56b4ae4786618235`, `sourceChanges: []`, minimum macOS 14.0 and the relocated bundled runtime.

## Implemented behavior

- Registered the unmodified vendored Not1MM `trans_tasman.py` plugin; its accepted source SHA-256 remains `e077c5bc1f77d7f4ef75c7591cf4a0d5f984a26997fbd6831ddd7f92093e3344`.
- The Python host now applies the plugin's 160/80/40-metre CW workflow, type-5 band/mode/two-hour-block duplicate rule, prefix scoring, duplicate zero-point retention, F3 `{RST} {SENTNR}` behavior and per-band serial allocation for the plugin categories that require it.
- Corrections, deletions and chronological rebuilds preserve the correct duplicate promotion and score. The explicit host compatibility overlay corrects the upstream Cabrillo frequency defect without changing the vendor plugin bytes.
- Existing serial reservations migrate to a contest-wide scope; Trans Tasman can allocate the plugin-required per-band scopes without discarding older reservations.
- The detached Main Logging presentation uses the host's admitted bands, modes, duplicate explanation, rule identity, received serial and score labels. Python-owned serials are read-only and focusable; the legacy Reserve Serial surface remains for contests that still require manual reservation.
- Duplicate contacts remain loggable when the plugin permits retaining them at zero points.
- No contest rules were translated into Swift and the Python-to-JSON-to-Swift rule translation path was not expanded.

The first 1.2.46 installed-app run exposed a packaged-only admission defect: React emitted the new optional `allowDuplicateCommit` and `automaticSerial` descriptor fields while Rust still rejected them as unknown. Commit `3a5a0367a95f370118cd2f875f734ddabefd464d` admits and type-checks those two optional booleans while preserving strict rejection of unrelated fields. This is why the accepted replacement candidate is 1.2.47 rather than 1.2.46.

## Actual installed Tauri behavior

These observations were made through `/Applications/OM0RX-xLog.app`, not a browser mock or direct Python request.

- The ordinary xLog window restored the retained DB3KE draft at 14.166000 MHz, 20m SSB, Manfred Schulz, JO30EW, Germany and `WWFF DLFF-1243`.
- The integrated ordinary logbook showed `1–15 of 68,321` and the existing cluster, map, lookup, rotor and station-service surfaces remained present.
- The native `Contest` menu is separate from ordinary logging and contains Contest Setup, Main Logging, Stats, Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator and Remote VFO.
- `Contest Setup` opened as an independently positionable native window. Its setup/configuration actions include Station Settings, New Contest, Choose a Contest, Edit Current Contest, Configuration Settings, Edit Macros and Edit Keys.
- The installed New Contest selector visibly offered CQ WW CW, CQ WPX CW, ARRL Sweepstakes CW, ICWC Medium Speed Test, CWT, K1USN Slow Speed Test and Trans Tasman CW.
- The 1.2.47 setup form opened without the 1.2.46 native descriptor error. CQ WW remained selected; the form was cancelled, so no contest was created or changed.
- No QSO, Enter/ESM, function key, CW, PTT, tune, radio, rotor or log mutation was used.

## Data preservation

After clean shutdown:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,322 total rows, 68,321 active rows, one historical soft-deleted row and two dirty rows
- Normal database revision: 100641
- Normal database SHA-256 before replacement and after installed-app acceptance: `bfe66dab8731ee1a4a94b8660b8061412cc8b99d2deac7c0a4dbabc29097052b`
- Active contest database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows; SHA-256 before and after the 1.2.47 replacement/acceptance: `36dc8108c9a09fe422a3dcce6f58789151c34a1cff65eafbfb7002bac66acdde`
- The active contest database remains on the CQ WW CW session (`cq_ww_cw`, revision 12). Its earlier byte change from the 1.2.45 value was the intended 1.2.46 serial-scope schema migration; it did not add or alter a contest QSO.
- Second retained contest database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows; unchanged SHA-256 `39c721abc15211abf9fb96e0f25c358e91441fc59ce4714f2bc1b4a93543efeb`

## Verification performed

- Full Python host suite: 80 passed.
- Focused React/protocol suites: 117 passed.
- Production TypeScript/Vite build: passed.
- Full Swift test run: zero failures.
- Focused Rust contest-surface tests after the packaged-app finding: 18 passed.
- Independent Sol review of Trans Tasman and the descriptor fix: no blocker or additional cross-language admission mismatch found.
- Packaging preflight: four checks passed; worker self-test, Tauri release build, bundled-Python relocation, nested Developer ID signing and final strict verification passed.
- Actual installed-app acceptance: ordinary log/draft restoration, native Contest menu, separate Contest Setup, complete current selector and corrected descriptor admission passed.

## Exact remaining limitations

- The currently connected Trans Tasman path is CW only. The original plugin's SSB/digital operating modes are not yet connected.
- Trans Tasman was demonstrated in the packaged selector and its setup/native-admission path. A real contest QSO, RF/CW/PTT output, live duplicate sequence and physical rotor movement were not exercised.
- The current selector contains seven connected plugins; the complete Not1MM plugin catalog, every original configuration dialog, every original window and the remaining workflows are not yet complete.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

This is an implementation checkpoint, not completion of the full Not1MM port.
