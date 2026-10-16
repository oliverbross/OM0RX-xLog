# macOS alpha.37 menu acceptance — 2026-10-17

## Outcome

OM0RX-xLog `0.4.0-alpha.37` restores standard macOS menu placement and removes ambiguous duplicate labels without removing navigation or detached-window capabilities.

- **OM0RX-xLog → Settings…** is the single main Settings navigation command and retains **Command-,**.
- Settings is no longer repeated in the top-level Station menu.
- Detached-window commands in Window use explicit **Open … Window** labels, distinguishing them from the similarly named main-workspace navigation commands.
- The standard macOS Window menu, Workspace Mode choices, detached windows, and per-band Band Map submenu remain available.
- Station Status and Station Identity remain absent from Window as requested previously, while legacy saved-layout roles remain recoverable.

## Source and package identity

- Source commit: `9a4230f`
- Branch: `codex/macos-alpha33-release`
- App version: `0.4.0-alpha.37`
- Host SHA-256: `ed7533aef156a1ded9287c600724462e2a3ca63e9776f266e0f8b8ce94056255`
- Worker SHA-256: `9eccdb89fb087e424dbb5f70d58d55f5ef257be15814212016ed47bf2f4d10b3`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Signature: `codesign --verify --deep --strict` passed after installation
- Notarization: not performed for this development alpha

## Verification

- Focused native menu/workspace tests: 24/24 passed.
- Rust package check: passed.
- Production macOS package build: passed.
- Built-bundle native acceptance: 33/33 checks passed; native menu routing passed; `station_io=false`.
- Installed-bundle native acceptance: 33/33 checks passed; native menu routing passed; `station_io=false`.
- Installed and built host/worker binaries match by SHA-256.

The desktop automation inventory could launch the exact installed application but could not bind to its window because archived builds share the same bundle identifier and the automation service retains a stale identifier for the `/Applications` path. Menu hierarchy and distinct labels are covered by the focused native tests; routing and packaged runtime behavior are covered by the built and installed acceptance runs.

## Installation and rollback

- Installed app: `/Applications/OM0RX-xLog.app`
- Previous alpha.36 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha37-Backup-20261017T011736/OM0RX-xLog.app`
- User contacts, logbook mode, station settings, credentials, and workspace data were not modified.
