# macOS 1.2.67 Not1MM review acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Packaged source/version commit: `cfca24ef08e92c36b06739d552449347517010ae`
- Exchange-default implementation commit: `bdff7d6dadc563d5546bb1b198400f946312fa81`
- Embedded source changes: none
- Version/build: `1.2.67` / `1.2.67`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `b0efd39a518926751dc9ccb6616743a40a53695c`
- Main executable SHA-256: `e79068679badc579426e79957f0b9b679d06cb36c12c468b54e593751256d733`
- Worker executable SHA-256: `bbaac38696935208622e7922444def6f1566281290015f56ac0b849d9ac94f93`
- `python-runtime.json` SHA-256: `d17822978b9d2f6d4845cbaf208fbfc977c91c5e51d1bb38034be57be9a5b181`
- `CodeResources` SHA-256: `57f6fef6d095e74e47baee613829f2cc47370af0d718ef04f69da6f967888ddd`
- Package and installed-app `codesign --verify --deep --strict`: passed

The installed bundle's signature and four recorded hashes match the packaged candidate. Embedded `Not1MM/python-runtime.json` records Python 3.12.4, source commit `cfca24ef08e92c36b06739d552449347517010ae`, and `sourceChanges: []`.

## Independent-review findings

The findings from the review of `6f308695` were checked against the latest branch before this candidate was packaged.

### Already resolved before 1.2.67

- Main Logging now owns its keyboard path: CW/Enter/ESM, function keys, WPM, Stop, focus, and replay protection are admitted from the actual detached logging window (`2517e4da`, `6af58bc8`).
- Call History activation/retry is admitted through the native command path (`d3378922`).
- CWT/SST Name is editable and cleared for the next QSO; corrections preserve historical sent exchanges; setup validates its sent exchange (`6163e5f0`, `312b2c3f`).
- Spot-selection failure is surfaced instead of silently swallowed, and Edit Keys persists and executes through the host-owned command path (`2517e4da`).
- Large export completion is returned before transient window cleanup (`87057182`).
- Detached-window scaling, field alignment, single-line labels, and overflow behavior use xLog's existing interface-scale preference (`dbb966a0`, `4d965398`).

### Fixed in 1.2.67

- A fresh contest no longer invents a sent exchange. New Contest and a changed Log Type start with `Sent Exchange` empty.
- The Main Logging window no longer renders a synthetic Sent Exchange entry column for plugins, such as CWT, whose original Not1MM field schema does not provide one.
- Report fields remain the only automatic entry defaults: `599` for CW and `59` for SSB. The installed CWT acceptance exercised the CW default; SSB remains covered by focused tests rather than an installed SSB contest workflow.
- After logging, report fields reset to the mode default while callsign and received-exchange fields clear.

## Actual installed Tauri behavior

These observations were made through the installed `/Applications/OM0RX-xLog.app`. Mocked UI requests and direct Python tests were supporting checks only.

- The ordinary xLog workspace remained the application workspace. The top bar has no normal/contest switch or contest canvas.
- The native `Contest` menu opened separate native windows for Contest Setup, Station Settings, Configuration Settings, Call History, Main Logging, Stats, Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator, and Remote VFO.
- Contest windows retained native macOS close, minimize, and green full-screen controls and the established xLog dark, cyan, teal, and status-color system.
- The actual CWT Main Logging window showed only Callsign, Name, and Number or State. The fields were aligned, did not overflow, and no synthetic Sent Exchange or acceptance residue such as `CHANGED` was visible.
- New Contest with Log Type CWT displayed an empty Sent Exchange value. The dialog was cancelled without creating another contest.
- Two disposable CWT contacts were present through the actual app: K1ABC / ALICIA / 999 in S&P and K2XYZ / BOB / 456 in Run. Both retained `599` reports and historical sent exchange `OLIVER`; score was 2 QSO, 2 multipliers, 4 points.
- The actual contest Log Display showed both rows with their distinct names and numbers after correction.
- Export through the actual macOS Save dialog returned the window to an enabled state and then reported `Saved OM0RX-xLog-1.2.67-CWT-acceptance.log.` The 609-byte Cabrillo file at `/tmp/OM0RX-xLog-1.2.67-CWT-acceptance.log` has SHA-256 `261ec166fbded138211323f1fb9a78be0c3689028699241151e32b783c2e4489`, `CONTEST: CW-OPS`, and `CLAIMED-SCORE: 4`.
- The acceptance CWT setup was restored from its test residue to Sent Exchange `OLIVER`. The original CQ WW CW session was then reopened with Sent Exchange `15`, Run off, and zero QSOs.
- After a complete application quit and relaunch, the ordinary N0GRA draft and normal logbook reappeared. Contest Setup retained both contest databases and preselected CQ WW CW in Choose a Contest; pressing OK reopened the session with its prior state.
- No spot, rotor, radio, CW, PTT, or tune action was invoked.

## Data preservation

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,351 QSO rows at the read-only integrity check; the installed UI subsequently displayed 68,350 active rows after restart. Normal logging remained live during acceptance, so a byte-for-byte unchanged claim is not made.
- CWT database `PRAGMA quick_check`: `ok`; `DXLOG`: two rows; `xlog_operation`: 30 rows.
- CWT K1ABC row: CW, 599/599, SentNr `OLIVER`, Name `ALICIA`, received exchange `ALICIA 999`, S&P.
- CWT K2XYZ row: CW, 599/599, SentNr `OLIVER`, Name `BOB`, received exchange `BOB 456`, Run.
- CWT persisted settings: Sent Exchange `OLIVER`; revision 30.
- Original CQ WW database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows; `xlog_operation`: 16 rows.
- CQ WW persisted settings: Sent Exchange `15`; revision 16; Run off.
- No normal or contest record was deleted by this checkpoint.

## Verification performed

- Focused contest frontend suite: 121 tests passed.
- Focused Not1MM Python host suite: 57 tests passed after the exchange-default change; the full host suite immediately before it passed 104 tests.
- Contest worker tests: 2 passed.
- Production TypeScript/Vite build: passed.
- Tauri release build, bundled-worker relocation/self-test, source-provenance manifest, Developer ID signing, and strict package verification: passed.
- Installed-app acceptance passed for native menu/window ownership, CWT entry projection, two distinct CWT names, Run/S&P metadata, correction, export completion, database integrity, application restart, and reopening the retained CQ WW session.

## Exact remaining limitations

- The complete Not1MM plugin catalog and every original operating/configuration workflow are not yet connected. This is an implementation checkpoint, not completion of the port.
- A restarted application retains the contest databases and last chooser selection, but it does not automatically reopen the active contest; the operator currently uses Contest Setup → Choose a Contest → OK.
- WPX, Sweepstakes, the remaining plugins, and their complete original windows/workflows still require the same installed-application operator acceptance.
- SSB report reset to `59` is regression-tested but was not exercised through an installed SSB contest in this checkpoint.
- No live radio-state change, RF/CW/PTT output, physical rotor movement, or real-station contest QSO was exercised.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

The accepted direction remains: executable Not1MM Python plugins and behavior behind native detached xLog-styled windows, reusing xLog station services, with no expansion of the retired Python-to-JSON-to-Swift rule translation system.
