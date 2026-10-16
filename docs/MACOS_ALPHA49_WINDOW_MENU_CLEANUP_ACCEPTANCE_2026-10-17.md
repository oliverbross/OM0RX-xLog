# macOS alpha.49 Window menu cleanup acceptance — 2026-10-17

## Outcome

Connection Doctor is no longer exposed in the native Window menu. Its internal
window role remains supported so an older saved workspace does not become
invalid merely because the operator-facing menu entry was removed.

## Source and package

- Source commit: `86a552b`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.49`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Installed main binary SHA-256: `b7bee045c68abed1e583d0c28d690b1ca315562ca06ef13f606bf69ef5869021`
- Installed worker SHA-256: `f9a3d62b71422b023de4ae94923ee3a7391df8ed43f6660fd3f9bd85b32b8225`

## Verification

- Focused native menu test: 1 passed; 565 unrelated tests filtered out.
- TypeScript typecheck, production Vite build and window-bundle checks: passed
  during the single signed packaging run.
- Signed packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed bundle passes strict deep signature verification; packaged and
  installed main/worker hashes match.
- Live macOS menu inspection confirmed that Connection Doctor is absent while
  the remaining operational Window entries, including Station Control, CW,
  Rotor, Propagation, Alerts and Antenna Reference, remain available.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.48` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha49-Backup-20261017T043400ACST/OM0RX-xLog.app`
