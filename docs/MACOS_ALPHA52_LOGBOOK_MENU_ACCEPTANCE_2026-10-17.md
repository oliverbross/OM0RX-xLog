# macOS alpha.52 Logbook menu acceptance — 2026-10-17

## Scope

- Replaced the previous generic Logbook navigation submenu with one purpose-built native Logbook menu.
- Positioned Logbook directly after File in the macOS menu bar.
- Exposed only existing xLog capabilities; no disabled placeholders or duplicate submenus were added.

## Menu inventory

1. Operator Desk
2. Log QSO
3. Logbook
4. Open Logbook Window
5. Import ADIF…
6. Export QSOs as ADIF…
7. Synchronize with Wavelog…
8. Awards

## Source and focused verification

- Release: `0.4.0-alpha.52`
- Implementation commit: `1039f0e` (`Add native Logbook workflow menu`)
- Focused native routing test: 1/1 passed.
- Signed macOS package build completed successfully, including TypeScript, Vite, detached-window bundle, Rust, worker, and signature checks.
- Packaged acceptance: 33/33 passed (`integrated-local-ui`; station I/O intentionally excluded).
- `codesign --verify --deep --strict` passed for the packaged and installed application.

## Installed runtime proof

- Installed `/Applications/OM0RX-xLog.app` reports `0.4.0-alpha.52`.
- Native menu order reported by macOS accessibility: `Apple, OM0RX-xLog, File, Logbook, Edit, View, Station, Window, Help`.
- The native Logbook menu contains the eight entries listed above, separated into navigation, transfer/synchronization, and awards groups.
- `Import ADIF…` opened the integrated Logbook view with its existing import, encoding, export-format and export controls.
- `Synchronize with Wavelog…` opened Settings with the Sync tab selected.
- `Open Logbook Window` opened `OM0RX-xLog — Logbook` alongside the main window.
- Main executable SHA-256: `33ae3ec346776c6a7cbc3f17adad906b6bd9deb42348c0247ea60bce52242a5d`
- Worker SHA-256: `84c701c7d35a78b7b2cc9c0b35cb940b6ecda2c97729b1d8783759b7c81d5664`

## Rollback

- Previous installed alpha.51 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha52-Backup-20261017-0521/OM0RX-xLog.app`
