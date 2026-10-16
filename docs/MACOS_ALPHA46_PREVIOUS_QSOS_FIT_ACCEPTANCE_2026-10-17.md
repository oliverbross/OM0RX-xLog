# macOS alpha.46 Previous QSOs fit acceptance — 2026-10-17

## Outcome

The detached Previous QSOs surface now owns exactly the available window
viewport. It no longer inherits the main application shell's 640-pixel minimum
height, which was making a shorter restored macOS window scroll as a whole and
cutting off the lower border.

The outer surface is fixed to `100dvh` with overflow contained. The heading and
window frame therefore remain stationary; when a contact history is genuinely
taller or wider than the available space, only the bordered table region
scrolls. Small and restored window sizes retain the existing compact padding.

## Source and package

- Source commit: `3921e3a`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.46`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Installed main binary SHA-256: `3e513bc07a16b31fe7010178add8cbc290bed36131c4c9691558a2b378c13603`
- Installed worker SHA-256: `3a4263830a202edd69c32a8f7acdc35e5f9c8344d8df26ccd8d6d81febeb53bf`

## Verification

- Focused Previous QSOs suite: 1 file, 8 tests passed.
- TypeScript typecheck, production Vite build and window-bundle checks: passed.
- The layout regression test requires a viewport-height detached shell with no
  outer overflow and retains the table's local scrolling region.
- Impeccable layout scan: no findings.
- Signed packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed-app native acceptance: the same 33/33 checks and flags passed from
  `/Applications/OM0RX-xLog.app`.
- Packaged and installed main/worker SHA-256 hashes match.
- Installed bundle passes strict deep signature verification under team
  `4WCMQ4U946` and is running from `/Applications`.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.45` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha46-Backup-20261017T040000ACST/OM0RX-xLog.app`
