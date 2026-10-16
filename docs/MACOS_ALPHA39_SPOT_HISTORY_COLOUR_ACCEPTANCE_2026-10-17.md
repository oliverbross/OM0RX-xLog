# macOS alpha.39 Spot History colour acceptance — 2026-10-17

## Delivered

- Spot History now renders band and mode as separate compact colour labels.
- Labels reuse the shared `clusterBandColors` and `clusterModeColors` palettes already used by DX Cluster, Logbook and Previous QSOs.
- Band and mode text remains visible and the combined cell has an explicit accessible name, so meaning does not depend on colour alone.

## Source and build

- Branch: `codex/macos-alpha33-release`
- Source commit: `ec3338c` (`Colorize Spot History band and mode labels`)
- Application version: `0.4.0-alpha.39`
- Focused Spot History test: 24/24 passed
- Production TypeScript/Vite/window-bundle build: passed
- macOS packaging checks: 3/3 passed

## Packaged and installed acceptance

- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Built bundle signature: strict deep verification passed
- Installed bundle signature: strict deep verification passed
- Built integrated acceptance: 33/33 passed; `station_io: false`
- Installed integrated acceptance: 33/33 passed; `station_io: false`
- Installed executable SHA-256: `da17ac9030c41229047e65db76bd7d0eb7c6eeb6b3e3cd36bece0fab6a391f12`
- Installed location: `/Applications/OM0RX-xLog.app`
- Runtime check: main application and packaged worker both running after launch

## Rollback

- Previous signed alpha.38 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha39-Backup-20261016T162804Z/OM0RX-xLog.app`
- The backup passed strict deep signature verification before replacement.

This acceptance confirms source tests, production compilation, bundle contents, signature integrity, isolated application acceptance and successful process launch. It does not claim live radio or network-provider behavior because station I/O was deliberately disabled for this presentation-only change.
