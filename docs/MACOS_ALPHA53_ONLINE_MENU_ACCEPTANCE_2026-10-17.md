# macOS alpha.53 Online menu acceptance — 2026-10-17

## Scope

- Added one native **Online** menu between Station and Window.
- Included only online workflows already implemented by xLog.
- Kept DX Cluster, Logbook and Settings in their existing menus instead of adding duplicate entries.
- Did not add unsupported LoTW or eQSL account/database commands from the reference application.

## Menu inventory

1. Synchronize with Wavelog…
2. Wavelog Account…
3. QRZ Callsign Lookup…
4. QRZ and Club Log Uploads…
5. Online Reference Data…

## Source and focused verification

- Release: `0.4.0-alpha.53`
- Implementation commit: `44d6403` (`Add native Online services menu`)
- Focused native Online-route test: 1/1 passed.
- Focused workspace-navigation tests: 10/10 passed.
- Signed macOS package build completed successfully, including TypeScript, Vite, detached-window bundle, Rust, worker and signature checks.
- Packaged acceptance: 33/33 passed (`integrated-local-ui`, embedded UI and worker present, station I/O intentionally excluded).
- `codesign --verify --deep --strict` passed for the packaged and installed application.

## Installed runtime proof

- Installed `/Applications/OM0RX-xLog.app` reports `0.4.0-alpha.53`.
- Native menu order reported by macOS accessibility: `Apple, OM0RX-xLog, File, Logbook, Edit, View, Station, Online, Window, Help`.
- The native Online menu contains exactly the five actions listed above, with separators between Wavelog, QRZ/online logs and reference data.
- `Wavelog Account…` opened Settings with the Wavelog tab selected.
- `QRZ Callsign Lookup…` opened Settings with the QRZ tab selected.
- One installed host and one installed worker process were observed after launch.
- Main executable SHA-256: `935b10a32e846be4b5ec4d2223445a071ada4b2fb1c670fd3276c95eaa15192d`
- Worker SHA-256: `e88d156f0c18fec257ad761741a3a7c1cea5a90a4b36c60d91b683e90ef45fd3`

## Rollback

- Previous installed alpha.52 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha53-Backup-20261017-0535/OM0RX-xLog.app`
