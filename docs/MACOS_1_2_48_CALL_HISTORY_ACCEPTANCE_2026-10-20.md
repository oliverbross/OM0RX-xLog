# macOS 1.2.48 contest call-history acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Packaged source/version commit: `578e4b6fc33d65a308ffb95e990fdd15ca9abae4`
- Embedded source changes: none
- Version/build: `1.2.48` / `1.2.48`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `734fef91fb2714cd96e23b94cd5bd190da736dee`
- `CodeResources` SHA-256: `7d729b1c1c62d1cba69f5687d193e07c01405ac76005b32a5b5d0f0b9cc66842`
- Main executable SHA-256: `350c94495d86e57d22c733b12a0a512e481bc2aa958c63080534652f69378841`
- Worker executable SHA-256: `f47b3ad1a0681a838bd29e59570bcaf465a1fd175e9326c9b42fbbb84014aa70`
- Package and installed-app `codesign --verify --deep --strict`: passed
- Rollback directory: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.48-20261020T073855+0930/`
  - verified copy: `OM0RX-xLog-1.2.47.app`
  - original installed bundle: `OM0RX-xLog-1.2.47-installed-original.app`

The installed bundle's version, signature and hashes match the packaged candidate. The embedded `Not1MM/python-runtime.json` records Python 3.12.4, source commit `578e4b6fc33d65a308ffb95e990fdd15ca9abae4`, `sourceChanges: []` and minimum macOS 14.0.

## Implemented behavior

- Contesting remains a separate Python/SQLite subsystem using source-pinned Not1MM plugins. No contest rules were translated into Swift and the Python-to-JSON-to-Swift rule translation path was not expanded.
- The native `Contest` menu opens independently positionable windows. The ordinary xLog Operator Desk remains the normal logging workspace; it is not replaced by a contest canvas or a top-level normal/contest mode switch.
- The menu contains Contest Setup, Call History, Main Logging, Stats, Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator and Remote VFO.
- Main Logging follows the original Not1MM operator layout while using xLog styling: current frequency, mode, operator and contest heading; band/mode strip; callsign and exchange fields; Run/S&P; twelve function keys; contact heading, distance, country and zones; and QSO/multiplier/score status.
- Call History is a separate native window. File preview, bounded diagnostics, cancellation fencing, atomic SQLite replacement, activation and restart persistence are connected to the admitted Python contest session.
- Call-history rows are available to the actual Not1MM session without overwriting CTY-derived country or zone data. The acceptance call `K1ABC` resolved to United States, CQ zone 5 and ITU zone 8 even though the imported history row contained CQ zone 4.
- The native contest command route is fenced to the admitted session/workspace generation, and contest CAT setup uses the active xLog radio service.
- The connected Python registry now contains eight plugins: CQ WW CW, CQ WPX CW, ARRL Sweepstakes CW, ICWC Medium Speed Test, CWT, CWOPS Open, K1USN Slow Speed Test and Trans Tasman CW.

## Actual installed Tauri behavior

These observations were made through the installed `/Applications/OM0RX-xLog.app`, including a clean quit and relaunch. Mock requests and direct Python tests were supporting checks only.

- Ordinary xLog restored the retained DB3KE draft at 14.166000 MHz, 20m SSB, RST 59/59, Manfred Schulz, JO30EW, Germany and `WWFF DLFF-1243`.
- The ordinary integrated logbook displayed `1–100 of 68,329` after normal background synchronization. The ordinary Operator Desk, cluster, map, lookup, rotor and station-service surfaces remained available.
- The main app no longer presents a top-level Normal Logging/Contesting switch. Contesting is reached through the separate native `Contest` menu.
- The macOS Window menu showed independently positionable `OM0RX-xLog`, `OM0RX-xLog Contest — Setup`, `OM0RX-xLog Contest — Call History` and `OM0RX-xLog Contest — Main Logging` windows during the workflow.
- A native macOS file picker previewed `/tmp/OM0RX-xLog-call-history-acceptance.txt` as one row and four columns with no diagnostics. Its SHA-256 was `3d8baee9c8a6c5cb7e072fbd0567c93e3be53ea33ddc40c8e4872459d2fceb4a`.
- Activating the preview produced `Not1MM session: active · 1 rows`. Closing and reopening Call History retained the same active dataset.
- After quitting and relaunching the installed app, Call History again showed the active one-row dataset for session `291ed01a-c9bb-41fc-b3ac-f55a9fdb14fb` and workspace generation `5494aba5-3ad8-4287-a78b-e7df4a66675f`.
- Main Logging reopened as its own native window after relaunch and showed CQ WW CW with a `0 / 0` QSO/multiplier score.
- The first K1ABC draft application returned the host's explicit uncertain-action state. Using the offered `Apply edit again` action completed the draft safely; it was then cleared without logging a QSO.
- One stale accessibility selection briefly copied cluster spot PR3X into the ordinary draft during acceptance. The original DB3KE draft was restored through the actual UI, and the subsequent clean relaunch proved the restored draft persisted.
- No Log QSO action, Enter/ESM, function key, CW, PTT, tune, rotor or RF command was used.

## Data preservation

Before replacement, the ordinary database contained 68,322 total rows, 68,321 active rows, one historical soft-deleted row and two dirty rows; revision was 100641 and SHA-256 was `bfe66dab8731ee1a4a94b8660b8061412cc8b99d2deac7c0a4dbabc29097052b`.

After final clean shutdown:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,330 total rows, 68,329 active rows, one historical soft-deleted row and two dirty rows
- Normal database revision: 100653
- `sync_outbox`: zero rows; `sync_conflicts`: two existing rows
- Normal database SHA-256: `bc6b641e11377eac70694b1dabff6862d7455186b5c5a13175d4a1aca1cdfbfe`
- The eight-row increase is the contiguous Wavelog import range 179168–179175: N9HUG, KB1RCC, EA8UP, OH0Z, WA3YZD, W1LE, VK6AS and EA8DNP. Every row is clean and active. The retained active count did not decrease and the historical deletion count did not change.
- The normal-database byte change is therefore expected background synchronization plus ordinary draft persistence, not a contest-log mutation or loss of existing log data.
- The active contest database `PRAGMA quick_check`: `ok`
- Contest `DXLOG`: zero rows
- `CALLHISTORY`: one row, `K1ABC | Sam | 4 | desktop acceptance`
- Active history generation: `db0e685c-bd50-461c-9da4-2db3c33ffe50`; row count: one; digest: `3d8baee9c8a6c5cb7e072fbd0567c93e3be53ea33ddc40c8e4872459d2fceb4a`
- Contest database final SHA-256: `f6b1d17c25e4a941616c23e178e361af3d3449f16b5e79a8136347549154f5e2`

The normal and contest stores remain separate: normal synchronization changed only the ordinary database, while the private contest database retained zero logged QSOs and the independently activated call-history row.

## Verification performed

- Full Python host suite: 94 passed.
- Focused React/protocol suites: 49 passed.
- Production TypeScript/Vite build: passed.
- Focused Rust workspace/navigation and layout suites: 42 passed.
- Swift portable contest suite with `XLOG_PORTABLE_ONLY=1`: 8 passed.
- Independent Sol reviews of the Python store/host, Swift admission, frontend window route and post-commit result found no remaining blocker after the session fence and bounded-output fixes.
- Packaging preflight, worker self-test, Tauri release build, bundled-Python relocation, nested Developer ID signing and final strict verification passed.
- Actual installed-app acceptance passed for ordinary draft/logbook restoration, separate Contest menu and native windows, native file picker, activation, host lookup, clean restart persistence and zero contest-QSO retention.

## Exact remaining limitations

- The complete Not1MM plugin catalog is not yet connected; eight plugins are currently registered.
- Every original Not1MM configuration page and operating window from the manual is not yet complete. The remaining plugin-specific configuration, Group/N1MM/RTC networking, voice-keyer and other original workflows still need to be carried through the same Python host and native-window architecture.
- The packaged desktop demonstrated the current CQ WW and call-history paths. WPX, Sweepstakes and the remaining connected/plugin workflows still require the same end-to-end installed-app acceptance as they are extended.
- No real contest QSO, RF/CW/PTT output, live radio change or physical rotor movement was exercised in this checkpoint.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

This is an implementation checkpoint, not completion of the full Not1MM port.
