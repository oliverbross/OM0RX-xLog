# macOS alpha.56 Callsign Intelligence layout acceptance — 2026-10-17

## Outcome

Callsign Intelligence now uses the available width as two deliberate fact rows
in the Operator Desk, configurable canvas and detached window:

- DXCC, Grid and Continent occupy three equal centered cells on the first row.
- Zones and Distance occupy two wider equal cells across the second row.
- Labels and values are centered within every cell.
- Values remain on one line and are clipped with an ellipsis only if a user
  resizes a custom panel below the width needed by the content.

The custom canvas no longer replaces this layout with its former auto-fit row,
so resizing the Callsign Intelligence panel preserves the same reading order.
The detached window retains its two-column emergency reflow below 420 pixels.

## Source and package

- Version: `0.4.0-alpha.56`
- Implementation commit: `022ff0234ea6dd959ea3bd53f2202ad02c4137d7`
- Branch: `codex/macos-alpha33-release`
- Installed app: `/Applications/OM0RX-xLog.app`
- Installed UI SHA-256: `739c173a6c4e3135746574e5f05f04ee7cfb2f0ecb367ad4c5b04bc94de16bba`
- Installed worker SHA-256: `2c2ae67c675b7dcad5f3450e762d6f5fc03242f84d4be8f3ac8a9604a06081a5`
- Rollback app: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha56-Backup-20261017-gHEn5v/OM0RX-xLog.app`

## Verification

- Focused Callsign Intelligence suite: 1 file, 7 tests passed.
- TypeScript typecheck and production build passed.
- Window bundle checks passed.
- Impeccable layout scan: no findings before or after the change.
- Packaged app strict deep-signature verification passed.
- Candidate native acceptance: 33/33 checks passed with `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true` and
  `station_io: false`.
- Installed native acceptance: the same 33/33 checks and flags passed.
- Candidate and installed UI/worker hashes match exactly.
- The installed alpha.56 app was relaunched and both host and worker are
  running from `/Applications`.

## Visual boundary

The desktop automation inventory confirms the installed app is running but
cannot attach to its window because archived copies share the same bundle
identifier and its path lookup resolves an obsolete identifier. This was not
treated as rendered visual proof. The exact grid, centering and overflow rules
are covered by the focused stylesheet regression; the signed runtime is covered
by candidate and installed native acceptance.

## Safety boundary

The acceptance runs used isolated synthetic data with station I/O disabled.
They do not claim live radio, rotor, external cluster or RF acceptance.
