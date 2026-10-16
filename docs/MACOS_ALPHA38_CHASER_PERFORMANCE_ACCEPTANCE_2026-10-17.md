# macOS alpha.38 Chaser & DX performance acceptance — 2026-10-17

## Outcome

OM0RX-xLog `0.4.0-alpha.38` removes the repeat cold-logbook scan that delayed Chaser & DX on a large integrated logbook.

- Retained local opportunities are accepted before automatic network refresh begins.
- Automatic refresh uses one selected-programme request plus one coalesced all-feed batch instead of five independent full projections.
- Opportunity reference history is stored in the existing revision-safe aggregate cache.
- A partial SQLite index limits cold history work to QSOs that actually contain POTA, SOTA, IOTA, WWFF or castle references.
- Manual Refresh feeds still bypasses the automatic cooldown and refreshes every source.

## Production-size benchmark

The benchmark used a temporary SQLite backup of the active integrated logbook. The live database and station interfaces were not modified or contacted.

- Contacts: **68,142**
- Contacts carrying an activation reference: **1,036**
- Previous cold reference projection: **2.315 s**
- Alpha.38 cold indexed projection: **0.059 s**
- Alpha.38 in-process cached projection: **0.000015 s**
- Alpha.38 reopened persisted projection: **0.0052 s**

The indexed cold path is approximately **39× faster**; reopening against the persisted aggregate is approximately **445× faster** than the prior cold path. These measurements cover the logbook-history portion of Chaser & DX loading, not subjective screen-paint timing.

## Source and package identity

- Source commit: `fb80bdef478f0e0855b6f32806353e070e077530`
- Branch: `codex/macos-alpha33-release`
- App version: `0.4.0-alpha.38`
- Host SHA-256: `d7c8db22d8c53f0d85fba9cda3ed669caa4c3e1e40c330a6952c1d738a8638aa`
- Worker SHA-256: `1b33f9d8597e8e00b222a16fbeb0c908910eb3e418880961460ccd47ab8b29ae`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Signature: `codesign --verify --deep --strict` passed after installation
- Notarization: not performed for this development alpha

## Verification

- Focused Chaser frontend tests: **12/12 passed**.
- Focused persisted-aggregate, invalidation and all-feed batching tests: passed.
- TypeScript check, production Vite build and detached-window bundle inventory: passed.
- Production macOS package build: passed.
- Built-bundle native acceptance: **33/33** checks passed; `station_io=false`.
- Installed-bundle native acceptance: **33/33** checks passed; `station_io=false`.
- Installed and built host/worker binaries match by SHA-256.
- Installed app launched with both host and worker processes running.

## Installation and rollback

- Installed app: `/Applications/OM0RX-xLog.app`
- Previous alpha.37 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha38-Backup-20261017T014200/OM0RX-xLog.app`
- User contacts, logbook mode, station settings, credentials and workspace data were not replaced.

