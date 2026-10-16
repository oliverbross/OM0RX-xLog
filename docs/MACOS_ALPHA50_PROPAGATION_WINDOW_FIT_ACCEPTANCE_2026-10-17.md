# macOS alpha.50 Propagation window fit acceptance — 2026-10-17

## Outcome

The detached Propagation window now opens at a compact content-fitting height
and can be resized below the generic 480-pixel detached-window floor. Native
geometry restoration uses the same role-specific minimum, so a compact size no
longer snaps back after the window is closed and reopened.

## Source and package

- Source commit: `316864b`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.50`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Installed main binary SHA-256: `56a5d998209c88442c4ce124bed2c8bc2d1973b37ccdd2c1a8c4d16f9c2b1941`
- Installed worker SHA-256: `8a733d6b825c0124f23b453bfb3f5c0e7bd4daef7c90b0058f2ef72b8b05da27`

## Verification

- Focused native minimum, registry and display-clamping tests: 3 passed; 566
  unrelated tests filtered out per run.
- TypeScript typecheck, production Vite build and detached-window bundle checks
  passed during the single signed packaging run.
- Signed packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed bundle passes strict deep signature verification; packaged and
  installed main/worker hashes match.
- Live macOS window verification resized Propagation to `694 × 230` pixels with
  every forecast row and source label visible. Closing and reopening the window
  restored the same `694 × 230` geometry.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.49` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha50-Backup-20261017T045300ACST/OM0RX-xLog.app`
