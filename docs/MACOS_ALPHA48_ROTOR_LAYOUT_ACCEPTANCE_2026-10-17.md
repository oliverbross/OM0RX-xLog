# macOS alpha.48 Rotor layout acceptance — 2026-10-17

## Outcome

The detached Rotor window now uses a compact two-column operating layout at
the user's restored 640 x 556 window size. The compass is on the left, the
bearing readback is directly below it, and Auto rotor, Off and Stop are grouped
to its right.

The redundant Rotor, Connection, Generation and Position observed rows were
removed. Explicit automatic-control and stop failures remain visible when they
occur. Windows below 480 pixels use a single-column fallback.

## Source and package

- Source commit: `953ec28`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.48`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Installed main binary SHA-256: `11fb7a215c8ee26e0dc43c2a0d1318b3b5af83308e67ccbaaa841949ebca290c`
- Installed worker SHA-256: `0a73e1626e4d9a8ae6f06eae7fcacd0647c59b0c4262c722468307d8dae89883`

## Verification

- Focused detached Rotor suite: 1 file, 9 tests passed.
- TypeScript typecheck, production Vite build and window-bundle checks: passed.
- Impeccable layout scan: no findings.
- Live installed-window inspection at 640 x 556: the compass and readback are
  left aligned, the automatic controls are to their right, the four diagnostic
  rows are absent, and no outer scrollbar is present.
- Signed packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed-app native acceptance: the same 33/33 checks and flags passed from
  `/Applications/OM0RX-xLog.app`.
- Packaged and installed main/worker SHA-256 hashes match.
- Installed bundle passes strict deep signature verification and is running
  from `/Applications`.
- Notarization remains a separate release gate and was not inferred from the
  valid Developer ID signature.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.47` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha48-Backup-20261017T042400ACST/OM0RX-xLog.app`
