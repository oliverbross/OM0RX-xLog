# macOS alpha.36 release acceptance — 2026-10-17

## Outcome

OM0RX-xLog `0.4.0-alpha.36` restores first-class access to the integrated logbook mode. The implementation had not been removed: the local database, contact operations, ADIF path, and Wavelog synchronization boundary remained present, but the mode selector had become buried at the bottom of **Settings → Station** as Settings grew. The selector now has its own **Settings → Logbook** tab in the main and detached Settings surfaces.

The installed app was replaced with the signed alpha.36 build. Existing contacts and saved station settings were not modified. The saved mode was intentionally left unchanged so installation could not trigger an unexpected synchronization.

## User-visible behavior

- **Integrated logbook only** keeps logging, editing, deleting/undoing, searching, importing, and exporting in the local database without Wavelog network synchronization.
- **Integrated logbook + Wavelog synchronization** keeps the local database authoritative while enabling the existing Wavelog synchronization workflow.
- The selected-but-unsaved mode is labelled **Selected mode (save to apply)**.
- The native **Sync** route opens **Settings → Logbook** when integrated-only mode is active instead of showing a disruptive top-of-window warning.
- Credentials are not displayed on the Logbook tab.

## Source and package identity

- Source commit: `cf5a0f5574f3f1d264f711a53fa847ecfffbea11`
- Branch: `codex/macos-alpha33-release`
- App version: `0.4.0-alpha.36`
- Host SHA-256: `60407e5fe23641f2cccd800939c5322c2bff4dcc34334d6e06029432e75ddf7d`
- Worker SHA-256: `1988a593f566750135aed4ece722d791fa98d4330d93b92ece0f4dc42d3ac4a7`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Signature: `codesign --verify --deep --strict` passed after installation
- Notarization: not performed for this development alpha

## Verification

- Focused frontend tests: 53/53 passed.
- TypeScript: `tsc --noEmit` passed.
- Standalone backend mode tests: passed.
- Production frontend build: passed as part of macOS packaging.
- Built-bundle native acceptance: 33/33 checks passed; `station_io=false`.
- Installed-bundle native acceptance: 33/33 checks passed; `station_io=false`.
- Installed and built host/worker binaries match byte-for-byte by SHA-256.
- Installed acceptance explicitly passed local logbook readback, contact edit, contact delete/undo, settings routing, detached logbook lifecycle, ADIF roundtrip, and workspace restoration.

The native UI automation inventory could launch the exact installed app but could not bind to its window because several archived app copies share the same bundle identifier and the automation service retained a stale identifier for the `/Applications` path. Visual tab rendering is therefore covered by the focused component tests, while runtime and packaging are covered by the two independent native acceptance runs.

## Installation and rollback

- Installed app: `/Applications/OM0RX-xLog.app`
- Previous installed bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha36-Backup-20261017T005626/OM0RX-xLog.app`
- User data location was not moved, cleared, migrated, or rewritten.
- Live saved logbook mode was not changed during acceptance.

## Regression cause

The regression was information architecture, not removed backend functionality. Wavelog and Sync gained dedicated Settings tabs while the integrated/Wavelog mode selector remained below the longer Station form. This made the previously implemented mode look absent in the installed app. A dedicated Logbook tab prevents the control from being lost again as Station settings evolve.
