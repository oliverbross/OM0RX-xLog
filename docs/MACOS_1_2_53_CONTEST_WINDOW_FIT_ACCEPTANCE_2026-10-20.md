# macOS 1.2.53 contest-window fit acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Packaged source/version commit: `71e9e5f2fc7438610295dec6dcc5044c2218d53d`
- Window-fit implementation commit: `2b422a711531cf9e1834a7f35587a5dbf33bbe14`
- Embedded source changes: none
- Version/build: `1.2.53` / `1.2.53`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `01fa1337e448325d0ba0275543285249c17e3cdf`
- Main executable SHA-256: `908e03ebc3bdae740eeb932b664e2eea6034655eb6c2ee6d98117a72e69e5e5e`
- Worker executable SHA-256: `dbf972948fda63c9d1f60191d22f9ae7e548419aacd6dc1984b8dc1a34430a97`
- `CodeResources` SHA-256: `e60ea44921f07d3fb555d9f095bb21139b8d55159b7e94ccfa8667289c652374`
- Package and installed-app `codesign --verify --deep --strict`: passed
- Recoverable previous bundle: `/Applications/OM0RX-xLog-1.2.52.replaced.app`

The installed bundle's signature and three recorded hashes match the packaged candidate. Embedded `Not1MM/python-runtime.json` records Python 3.12.4, minimum macOS 14.0, source commit `71e9e5f2fc7438610295dec6dcc5044c2218d53d`, and `sourceChanges: []`.

## Fit corrections in this checkpoint

- Rates owns a compact 340×300 default and its own density rules. Generic detached-window list and table selectors no longer jam its labels and values together.
- Check Partial uses a 660×500 default with equal Log, Master, and Telnet columns; the Call History disclosure remains visible without an outer scrollbar.
- Empty CQ WW DXCC and CQ Zone trackers are admitted as ready zero-state matrices. Unsupported contest plugins remain unavailable instead of being misrepresented as supported empty trackers.
- DXCC now opens at 920×460 and Zone at 760×460. Exact saved legacy defaults (`1280×800`/`920×720` for DXCC and `1180×800`/`760×680` for Zone) migrate to the compact sizes. Custom sizes, positions, and maximized state remain untouched.
- The windows keep the existing xLog dark surface, cyan/teal status color, typography, borders, and native detached-window behavior. No contest canvas or top-bar normal/contest switch was reintroduced.

## Rejected intermediate observations

The installed 1.2.51 candidate exposed three concrete desktop failures: Rates labels and values were compressed together, Check Partial overflowed its useful content area, and empty CQ WW multiplier matrices were treated as unavailable.

The installed 1.2.52 candidate corrected those functional failures. Rates and Check Partial were clean and usable, while DXCC and Zone correctly rendered ready zero-state tables. Its remaining rejection was visual: the multiplier windows retained 920×720 and 760×680 defaults, leaving excessive unused vertical space.

Version 1.2.53 carries the exact-default geometry migration and compact multiplier defaults as a distinct signed candidate.

## Actual installed Tauri behavior

These observations were made through the installed `/Applications/OM0RX-xLog.app`. Mocked UI requests and direct Python tests were supporting checks only.

- The ordinary xLog workspace restored the retained DB3KE draft at 14.166000 MHz, 20m SSB, RST 59/59, Manfred Schulz, JO30EW, Germany, and `WWFF DLFF-1243`.
- The ordinary integrated logbook displayed `1–6 of 68,332`. The existing Operator Desk, ordinary logbook, map, cluster, rotor, and station-service surfaces remained the normal application workspace.
- The native `Contest` menu contained thirteen entries and opened separate native windows; it did not expose a contest canvas.
- DXCC opened at the compact 920×460 logical default, rendered the six Not1MM bands plus Total, and showed `0 worked` rather than `Panel unavailable`.
- Zone opened at the compact 760×460 logical default, rendered the six bands plus Total, and showed `0 worked` rather than `Panel unavailable`.
- Rates opened at 340×300 with readable aligned labels and values, no outer scrollbar, and the established xLog color system.
- Check Partial opened at 660×500 with three equal Log/Master/Telnet columns and a visible Call History disclosure.
- The application quit through the native application menu. No OM0RX-xLog, worker, or contest-runtime process remained.
- No spot was activated and no Log QSO, Enter/ESM, function key, CW, PTT, tune, rotor, or RF command was used.

## Data preservation

The installed-app workflow was evaluated against the current local state, which contained one newer ordinary record than the earlier 1.2.50 checkpoint.

Before and after the 1.2.53 workflow:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,333 total rows, 68,332 active rows, one historical soft-deleted row
- Normal database revision after clean shutdown: 100669
- `sync_outbox`: zero rows; `sync_conflicts`: two existing rows
- Normal database SHA-256: `e84d823c0262ffe7a23cf5c14c6eb324c32a36ddff982a5e42dca61475f48c81`
- Active CQ WW contest database `PRAGMA quick_check`: `ok`
- Active CQ WW `DXLOG`: zero rows; `CALLHISTORY`: one retained row
- Secondary retained contest database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows

The ordinary database is byte-identical across the 1.2.53 installed-app workflow. No normal or contest QSO was created, changed, or deleted by acceptance.

## Verification performed

- Focused contest frontend suite: 109 tests passed.
- Full Not1MM Python host suite: 94 tests passed.
- Workspace-window/default-migration native suite: 27 tests passed.
- Detached-geometry migration native suite: 8 tests passed.
- Production TypeScript/Vite and detached-window bundle build: passed.
- Tauri release build, bundled-worker self-test, Python relocation, Developer ID signing, and strict package verification: passed.
- Independent Sol 5.6 high review of the compact-window and exact-default migration changes found no actionable correctness, security, compatibility, or persistence issue.
- Installed-app acceptance passed for retained ordinary state, the native Contest menu, compact DXCC/Zone/Rates/Check Partial windows, ready empty multiplier tables, clean shutdown, and unchanged databases.

## Exact remaining limitations

- The full Not1MM plugin catalog and every original operating/configuration workflow are not yet connected. This remains an implementation checkpoint, not completion of the port.
- Statistics remains a compact verified summary rather than the complete original Not1MM statistics detail/matrix.
- Main Logging still needs faithful ESM-active macro highlighting and live TX/CW indicator state.
- Rates still displays the fixed label `Since 0000z`; the original dynamic UTC-hour label remains to be connected through the Python-owned projection.
- Contest Setup still combines some original dialogs and persists several settings whose complete runtime behavior is not connected.
- WPX, Sweepstakes, and the remaining admitted plugins still need the same installed-application operator acceptance as CQ WW.
- No real contest QSO, live radio-state change, RF/CW/PTT output, physical rotor movement, large Cabrillo export, or complete remaining-plugin workflow was exercised in this checkpoint.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

The accepted direction remains: actual Not1MM Python plugins and behavior behind native detached xLog-styled windows, using xLog station services, with no expansion of the retired Python-to-JSON-to-Swift rule translation system.
