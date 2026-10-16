# macOS alpha.47 Callsign Intelligence fit acceptance — 2026-10-17

## Outcome

The detached Callsign Intelligence window now adapts to the user's chosen
window size without using the whole window as a scrolling page.

At the compact 640-pixel window width, DXCC, Grid and Continent remain the first
row. Zones and Distance retain the same box width and are centered together on
the second row. Callsign and DXCC band matrices remain side by side at this
width, removing the unnecessary vertical expansion that previously pushed the
lower content below the window.

Only genuinely narrow windows below 420 pixels stack the matrices. Short
windows use reduced but still legible spacing, and any unavoidable overflow is
contained by the intelligence panel rather than moving the complete window.

## Source and package

- Source commit: `eb80bc4`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.47`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Installed main binary SHA-256: `6e1ff8ef92f6ed1a1952fc47e430576f292b1daa53651ceec295392f7a1328fe`
- Installed worker SHA-256: `01c9d3c8d479c5772e4c2ea418dcd37585eaf457568044d9ba14b5cc4b73d996`

## Verification

- Focused Callsign Intelligence suite: 1 file, 7 tests passed.
- TypeScript typecheck, production Vite build and window-bundle checks: passed.
- Impeccable layout scan: no findings.
- Live installed-window inspection at 640 x 480: all identity facts, both band
  matrices and the footer were visible; Zones and Distance were centered and no
  outer scrollbar was present.
- Signed packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed-app native acceptance: the same 33/33 checks and flags passed from
  `/Applications/OM0RX-xLog.app`.
- Packaged and installed main/worker SHA-256 hashes match.
- Installed bundle passes strict deep signature verification and is running
  from `/Applications`.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.46` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha47-Backup-20261017T041000ACST/OM0RX-xLog.app`
